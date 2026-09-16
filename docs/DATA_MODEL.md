# MINEGUARD AI — data model, derived layer and API contract

Everything the product shows is either a **stored record** (a human wrote it) or a
**derived value** (the engine computed it from stored records). This document is the
boundary between those two, because the whole design rests on it: a score is never
typed in, and a workflow transition never edits a score directly.

Verified against the running service by `python3 tools/e2e_test.py` — **109 checks**
in-process, **104** when the same suite is pointed at a live server with
`MINEGUARD_BASE=http://127.0.0.1:8000` (the 5 remaining checks exercise multipart upload
and report file downloads, which the in-process `TestClient` covers directly). Plus
`cd frontend && npm run smoke` — 12 routes rendered (the admin route asserts the deployed-model table
actually has rows) plus a real inspection submission,
against the built bundle and the served data.

---

## 1. Storage

| | |
|---|---|
| Engine | file-backed JSON document store, `api/store.py` |
| File | `data/store.json` (single document, all collections) |
| Locking | one `threading.RLock` around recompute + persist; `Store.lock` is exposed because the workflow does multi-record writes |
| Persistence point | `Store.touch()` → `recompute()` + `persist()`; **every** write path ends there |
| Atomicity | write to `store.json.tmp` then rename |
| Sequences | `_seq` per collection, ids formatted `VIO-nnnn`, `CA-nnn`, `INSP-nnnn`, `EV-nnnn`, `DOC-nnnn`, `AW-mmdd-nn`, `ACT-nnnnn`, `OVR-nnn` |

The brief preferred PostgreSQL/Supabase. This sandbox has neither, so the store sits
behind a repository seam instead: routers and services only ever talk to
`store.data[...]`, `store.find()`, `store.zone_assessment()`, `store.log()`, `store.touch()`.
Replacing the JSON document with SQLAlchemy tables means re-implementing `Store` and
nothing else — the routers, the engine, the alert and report generators are storage-agnostic.

Two storage notes:

* `computed.history` **is** persisted (one row per zone and per mine per day for the 90-day window ≈ 2 160 rows), which is what keeps the file at 0.85 MB and makes a restart show the same trend lines. A defensive `out.pop("risk_history")` in `persist()` drops any legacy in-memory series so it cannot double up.
* there is no separate audit table — the activity log (`activity`) is written by the same service calls that mutate records, so an action cannot be recorded without its log line.

---

## 2. Stored collections

`● stored · ◐ derived-and-denormalised-for-reads`

### `mines` ◐
`id, code, name, location, operator, mine_type, status, annual_output_kt, workforce, regulatory_body, licence, description, reporting_current`
plus `◐ risk_score, risk_level, compliance_score` (refreshed by `Store._refresh_columns`),
and `zones: string[]` (zone ids).

`reporting_current` is real data, not decoration: the statutory-return component of the
compliance score reads it, so a mine with an outstanding return cannot score above 95.

### `zones` ◐
`id, mine_id, name, short_name, zone_type (EXTRACTION|EQUIPMENT|WORKER_OPS|ENVIRONMENT|STORAGE), primary_department, inspection_cadence_days, notes, status, geometry{x,y,w,h,label_anchor}`
plus `◐ risk_score, risk_level, risk_tone, compliance_score, mine_name`.

`geometry` is what the mine map draws from; it is authored data, not a computed field.
Five zones per mine, matching PRD §7 (A extraction, B equipment, C worker operations,
D environmental, E storage/dispatch).

### `inspections`
`id, mine_id, zone_id, department, inspector_id, inspector, inspection_date, status, observations, overall_rating (COMPLIANT|NEEDS_ATTENTION|NON_COMPLIANT), evidence_file, violation_ids[], issues_found, evidence_count`

`violation_ids` and `issues_found` are maintained by the workflow service when findings
are raised from a round, so an inspection can always be reconciled with its outcomes.

### `violations`
`id, inspection_id, mine_id, zone_id, department, category, severity (LOW|MEDIUM|HIGH|CRITICAL), status, description, regulation, notes, created_at, due_date, closed_at, assigned_to, occurrences, action_ids[], evidence_count`
plus `◐ risk_contribution`.

`occurrences` is the count of prior open-or-closed findings of the **same category in the
same zone**, maintained at creation time; it is the input to the repeat factor, not a UI
convenience. `regulation` is copied from the category catalogue so a record stays
quotable even if the catalogue changes later.

`risk_contribution` is a **slice of the zone's own factor points** — see §4. Closed
violations are 0 by construction.

### `corrective_actions`
`id, violation_id, mine_id, zone_id, description, status (PENDING|ASSIGNED|IN_PROGRESS|SUBMITTED|VERIFIED|REJECTED|CLOSED), assigned_to, created_at, due_date, started_at, completed_at, closed_at, resolution_notes, verification_notes, verified_by, verified_at, evidence_count, priority`

### `evidence`
`id, violation_id, action_id, type (PHOTO|DOCUMENT|NOTE), file_name, note, uploaded_by, uploaded_at, size_kb, kind (OBSERVATION|RESOLUTION|VERIFICATION)`

Evidence rows store a **reference**, not bytes: the register needs to prove something was
attached and by whom, and shipping binaries through a prototype API would add a file
server without adding any decision-making. Uploaded documents are the exception — they
are written to `data/uploads/` because their text has to be read back.

### `documents`
`id, file_name, mine_id, zone_id, doc_type, uploaded_at, uploaded_by, status (UPLOADED|QUEUED_FOR_EXTRACTION|CLASSIFIED|PROCESSED|FAILED), pages, confidence, ocr_engine, extracted{}, linked_violations[], summary, flags[]`

Uploads additionally carry `stored_path, notes, severity_hint, text_chars` — the fields
that only exist once a real file has been written to `data/uploads/` and read back.

### `users`
`id, name, role (INSPECTOR|OFFICER|MANAGER|ADMIN), department, designation, mine_id, initials`

### `config`
`departments, violation_categories{dept:[{name, default_severity, regulation}]}, violation_statuses, action_statuses, severity_levels, risk_bands, sla{resolution_days{...}, verification_days}, counts, ocr_engines`

Read-only at runtime. Served by `GET /api/config` and mirrored into
`GET /api/bootstrap` so the UI renders **labels, bands, weights and categories from the
server** instead of duplicating them in TypeScript.

### `workflow_overrides`
`id, violation_id, actor_id, actor, role, from_status, to_status, reason, at`
Written only when a MANAGER/ADMIN passes `override: true`, with a reason ≥ 15 chars.
Surfaced in the violation audit trail and on the admin page.

### `activity`
`id, at, actor_id, actor, kind, message, entity`
Append-only, written by `store.log()` from inside each service call.

---

## 3. Derived layer — `computed`

Rebuilt by `api/services/computed.py::compute_all()` on every `touch()`:

```
computed = {
  as_of, generated_at, history_days,
  zones:  { <zone_id>: { risk: RiskAssessment, compliance: {...}, contributions: {violation_id: points} } },
  mines:  { <mine_id>: { risk_score, risk_level, tone, compliance_score, critical_zones,
                         open_violations, overdue_actions, zone_ids } },
  enterprise: { risk_score, risk_level, tone, compliance_score, compliance_label },
  history: [ { scope_type, scope_id, mine_id, date, risk_score, risk_level,
               compliance_score, contributing_factors{5 keys} } ]
}
```

`history` holds one row per zone **and** per mine per day for 90 days. Rebuilding it is
expensive, so mutations call `recompute(with_history=False)` and splice today's rows
onto the stored series instead of replaying 90 days. Only a reset or a scenario run
replays the whole window (that is why "Reset demo scenario" takes a few seconds).

Independent derived collections, also regenerated: `alerts`, `insights`, plus the
per-request read models in `api/routers/intelligence.py` (dashboard, analytics, dossiers).

---

## 4. Risk engine (`api/services/risk_engine.py`)

Single entry point for all scoring: `RuleBasedRiskScoringStrategy.score(ZoneObservation)`.
The frontend contains **no** scoring code; the API contains **no** inline arithmetic.

Five factors, each `min(cap, coefficient × raw)` — the cap keeps one dimension from
dominating, the linear (non-saturating) form keeps a near-cap zone sensitive to a new
critical finding:

| factor | raw input | coefficient | cap |
|---|---|---|---|
| `severity` | Σ `SEVERITY_WEIGHTS[severity]` over open findings (LOW 10, MEDIUM 25, HIGH 50, CRITICAL 80) | 0.09 | 45 |
| `repeat` | Σ repeat-ladder weight over findings with `occurrences ≥ 2` (2nd 20, 3rd 35, 4th+ 55) | 0.05 | 20 |
| `unresolved` | Σ ageing weight (0–7d → 5, 8–15d → 12, 16–30d → 25, 30d+ → 45) | 0.12 | 25 |
| `overdue` | 1.5 per overdue action + 0.35 per day past due | — | 15 |
| `inspection_delay` | 1.1 per day past `inspection_cadence_days`, or a flat 4.0 when a zone has never been inspected | — | 12 |

`score = clamp(Σ factors, 0, 100)`, `risk_band(score)` maps to PRD §11 bands
(≤20 LOW, ≤40 MODERATE, ≤60 ELEVATED, ≤80 HIGH, else CRITICAL).

Every assessment returns `factors[]` with `label, points, cap, coefficient, formula,
detail, evidence[]`, plus `drivers[]` and `recommended_actions[]`. Those strings are
built from the same quantities that produced the number, so explanation and score cannot
disagree.

### Contribution attribution

`attribute_contributions(obs, factor_points)` splits `severity + repeat + unresolved +
overdue` points back over the open findings **in proportion to the same raw quantities**
each factor is computed from. `inspection_delay` is excluded because it belongs to the
zone's calendar, not to one record. Result: for every zone, Σ contributions equals the
sum of those four factor points (asserted in e2e), and a violation created through the
API carries a non-zero contribution immediately because the attribution runs inside
`recompute()`, not in the seeder.

### Aggregation

Mine score is exposure weighted, not a mean:

```
w_i      = 1 + 0.04·open_i + 0.30·critical_i
weighted = Σ(w_i · score_i) / Σ w_i
mine     = 0.6·weighted + 0.4·worst_zone
if critical_zones: mine = max(mine, 62 + 3·(critical_zones − 1))
```

Enterprise risk is `aggregate_enterprise_score` — the **mean of mine scores**, unweighted:
the group view reports exposure across sites rather than being held hostage by the worst
one, and the mine-level blend above is where the worst-zone pressure is applied. This is
why a single CRITICAL zone makes a *mine* HIGH while the enterprise can still sit in
ELEVATED: documented behaviour, deliberate design.

---

## 5. Compliance score (`api/services/compliance.py`)

Separate model, deliberately **not** `100 − risk`. Risk answers *"how bad could this get"*;
compliance answers *"how well is the process being run"*. A mine can be at 87 risk with
decent compliance (fast closures, blocked by one overdue plant) or low risk with poor
discipline (nothing open because nobody looked).

`score = 100 − Σ penalties`, each capped:

| component | penalty | cap |
|---|---|---|
| open findings outside their SLA window | 4.0 per breach + 1.0 per at-risk | 22 |
| closures completed late | 1.5 each | 6 |
| overdue corrective actions | engine's own overdue raw | 18 |
| submissions waiting on verification | 2.0 each | 6 |
| inspection cadence breach | scaled by how far past 80 % of cadence | 12 |
| evidence completeness | (1 − coverage) × 24 | 12 |
| statutory return outstanding | flat | 5 |

Components are returned with `label, value, penalty, detail` and rendered verbatim
(`CompliancePanel`), so the number is never presented without its arithmetic.

---

## 6. Early warning and operator state

Six detectors in `api/services/alerts.py` — `TREND_ACCELERATION`, `REPEAT_CLUSTER`,
`OVERDUE_ACCUMULATION`, `VERIFICATION_GAP`, `INSPECTION_GAP`, `CROSS_FUNCTIONAL` — run on
every recompute over the stored records plus `computed.history`. Each alert carries
`reasons[]` (label/value/delta from real figures), `narrative`, `recommendation`, and
where a counterfactual applies, `projected_impact` produced by `simulate()` — the same
function the write paths use, so "closing these three actions takes the zone from 87 to
71" is an engine answer.

Alerts are **regenerated**, so any human state on them would be lost. Hence:

* each alert gets a stable `key = "<KIND>:<scope_id>"`;
* `POST /api/alerts/{id}/ack` writes that key into `alert_state` (created lazily on the first ack, so an untouched store has no such collection) with status, actor, date and note;
* `build_alerts()` re-applies `alert_state` after generating, so an acknowledgement survives any later mutation, and withdrawing it returns the alert to `OPEN`.

Acknowledging requires MANAGER or ADMIN and a non-empty note (`ValueError` → 400). It
never changes a score — the UI says so in the response message, because an alert is a
briefing object while the records underneath are the risk.

---

## 7. Workflow state machine

```
inspections ──creates──▶ violations ──raises──▶ corrective_actions
                              │                        │
        OPEN → ASSIGNED → IN_PROGRESS → ACTION_SUBMITTED → UNDER_VERIFICATION → CLOSED
```

Guards, all enforced in `api/services/workflow.py` (the UI mirrors them for display only):

Violation side:

* only forward-by-one or backward-to-`IN_PROGRESS` moves are permitted (`ACTION_SUBMITTED → UNDER_VERIFICATION → CLOSED`, `UNDER_VERIFICATION → IN_PROGRESS` on rejection);
* any jump that skips a stage is refused **unless** the actor is MANAGER/ADMIN, passes `override: true` and supplies a written justification — the override is then appended to `workflow_overrides` with `skipped_steps`;
* `→ CLOSED` additionally requires a linked corrective action in `VERIFIED`/`CLOSED`, so nothing closes on assertion alone;
* `due_date` is **committed at assignment** (`assign_violation` sets `due_date or default_due_date(severity)`, i.e. today + `config.sla.resolution_days[severity]`), so a finding carries no promise until an owner makes one — while `sla_state` is still measured from `created_at + SLA` (`ON_TRACK` → `AT_RISK` at 70 % of the window → `BREACHED`), which is what stops an unowned CRITICAL finding from ageing invisibly; `overdue`/`days_overdue` stay null-safe on actions and remain tied to the real committed date;
* every transition calls `store.touch()`, so the response carries the *post-mutation* zone, mine and enterprise scores; measured on a live probe, closing a HIGH finding with an attributed contribution of 5.1 pt moved its zone 58.4 → 53.3 — the register's number and the map's number are the same arithmetic;
* a verification can be **withdrawn** (`VERIFIED → REJECTED`), which reopens the violation for rework, and a rejected action cannot be verified again until it is reworked and resubmitted — a rejection is not a suggestion.

Action side (`corrective_actions`):

* statuses advance one stage at a time (`ASSIGNED → IN_PROGRESS → SUBMITTED → VERIFIED → CLOSED`), never more;
* `SUBMITTED` requires resolution notes; `VERIFIED`/`CLOSED`/`REJECTED` require MANAGER or ADMIN; a rejection requires a written reason;
* the action status drives the violation status through `ACTION_TO_VIOLATION_STATUS` (`SUBMITTED → ACTION_SUBMITTED`, `VERIFIED → CLOSED`, `REJECTED → IN_PROGRESS`), so the two records cannot drift apart;
* `can_verify` (true when `status == "SUBMITTED"`) is what the UI arms the verify controls with — a rejected action cannot be "verified" into existence.

Assignment (`POST /api/violations/{id}/assign`) additionally refuses owners whose role is
not `OFFICER`/`MANAGER`, so a finding cannot be parked on an inspector or a manager, and
`due_date` defaults to `default_due_date(severity)` when omitted.

**Known gap, stated plainly:** verification checks the verifier's role and notes, not that
resolution evidence was attached to the action — evidence coverage feeds the compliance
score's documentation component, so missing evidence shows up there rather than as a hard
block. A gate would be two lines in `WorkflowService.update_action` if management wants it
enforced rather than scored.

Permission failures are `403`, illegal transitions `409` (and `400` for
`WorkflowError` on create paths). Role comes from `X-User-Id`; there is no auth layer by
instruction, but authorisation is real and server-side — the UI identity switcher changes
what the API accepts.

---

## 8. Endpoint → data map

| Surface | Reads | Writes |
|---|---|---|
| `/api/bootstrap` | config + mines + zones + users + engine meta | — |
| `/api/dashboard?mine_id=` | computed, alerts, insights, activity | — |
| `/api/mines`, `/api/mines/{id}`, `/api/zones/{id}{,/risk}` | computed + records | — |
| `/api/analytics?days=` | 90-day replay + register | — |
| `/api/inspections` | inspections | `POST` creates inspection + findings → violations + actions, returns `risk_impact` |
| `/api/violations` | violations (filter/search/sort) | `POST`, `PATCH` status, `POST /{id}/assign` |
| `/api/corrective-actions` | actions + owner load | `POST`, `PATCH` status/notes |
| `/api/evidence` | — | `POST` attaches evidence, bumps counts, re-scores |
| `/api/risk/simulate` | engine over a hypothetical state | — |
| `/api/documents{,/upload,/…/reprocess,/…/link}` | documents + extraction | link may create violations (normal workflow) |
| `/api/reports{,/generate,/preview/{type},/download/{type}}` | everything | `generate` stores a stamped copy |
| `/api/config`, `/api/users`, `/api/activity`, `/api/admin/overrides` | as stored | — |
| `/api/admin/reset`, `/api/admin/scenario` | — | re-seed baseline / apply `ZONE_B_ESCALATION` |

`X-Mineguard-Engine` and `X-Mineguard-Compute-Ms` are on every response; the status bar
reads them so "these scores are computed" stays checkable on screen.

---

## 9. Deviations from the PRD — and why

1. **PRD §33 "Zone A 32 → LOW"** contradicts §11's own bands (LOW ≤ 20). §11 wins: 32 renders MODERATE.
2. **Illustrative KPI values** in the brief (07 critical zones, 12 overdue, 38 open violations) are not hardcoded. Tiles read live counts, labelled honestly: `CRITICAL ALERTS`, `HIGH-RISK ZONES (≥61)`, and `zones needing attention (≥41)` alongside the ≥61 figure.
3. **Three statutory departments** (`SAFETY`, `ENVIRONMENT`, `LABOUR`) drive categories, SLA and assignment, while the five **zones** are physical areas (PRD §7). A zone has a `primary_department`; a violation carries the department of the round that found it. Zone letters ≠ departments.
4. **PRD §44's demo arc (87 → 91 → 68)** is reproduced in shape, not in digits, because digits come from the data. Measured on the reset baseline: Zone B sits at **86.6 CRITICAL**; `POST /api/admin/scenario {ZONE_B_ESCALATION}` adds one HIGH repeat finding and it becomes **94.4** (Δ +7.8, the severity and repeat factors moving, exactly as §44 describes); closing that finding's action returns it to **86.6**. Reaching the PRD's 68 requires clearing the zone's *other* legacy exposure too — `POST /api/risk/simulate` with Zone B's 8 open findings and 7 open actions projects **94.4 → 12.0**. Numbers are derived, so a rehearsal and a live run always match.
5. **No OCR claims.** `extract()` uses a PDF text layer (`pypdf`/`pdftotext`) when present and reports `FAILED` for scanned images when no OCR engine is installed — availability is reported by `GET /api/config.ocr_engines` and shown in the UI, rather than inventing transcription accuracy.
6. **File store instead of Postgres** (§1). Repository seam documented above.
7. **No authentication** (PRD "don't build unnecessary auth first"). Identity is a header; authorisation is enforced server-side.

---

## 10. Extension points

* **Real ML** — implement the `MLModelRiskScoringStrategy` contract (`score_batch(observations) -> RiskAssessment[]`), keep the factor decomposition as the explanation channel, then A/B it against `RuleBasedRiskScoringStrategy` on the same `history` rows. Nothing in the routers, alert generation or UI changes: they consume `RiskAssessment`.
* **Postgres** — re-implement `Store` (find/zone/mine/user/log/touch) over SQLAlchemy sessions; move `computed` into materialised tables refreshed by the same `touch()`.
* **OCR** — add an engine to `documents.available_engines()`; the pipeline, statuses and flags are already generic.
* **Evidence storage** — `stored_path` is the only coupling point for object storage (S3/Azure Blob).
* **Notifications** — alerts are already keyed and idempotent, so a WhatsApp/email sink can diff `alert_state` instead of re-parsing narratives.

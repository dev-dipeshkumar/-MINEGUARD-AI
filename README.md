# MINEGUARD AI

### Predict Compliance Risks Before They Become Critical

An enterprise **compliance command center** for coal mine operations — built for
**SIH26024**. It ingests inspections, violations and corrective actions, scores the
*forward-looking risk* of every zone, mine and the enterprise, explains each score as a
decomposition of the factors behind it, and drives the workflow that closes the finding out.

It is not a dashboard with charts bolted on. It answers four questions on every screen:

| Question | Where it is answered |
|---|---|
| **What happened?** | Inspection register, violation register, activity stream, evidence trail |
| **What is unresolved?** | Open violations, corrective-action queues, SLA states, aging |
| **What is becoming risky?** | Risk engine (0–100) + six early-warning detectors with trend deltas |
| **Why — and what should I do next?** | Factor contributions, drivers, ranked recommendations with **projected point impact**, and a what-if simulator that re-runs the real engine |

**License: MIT** — see [LICENSE](LICENSE). Problem statement: **SIH26024**.

> **Honesty note, stated up front.** This is *explainable rule-based intelligence* (Phase 1).
> No trained model is claimed anywhere. The scoring path is a deterministic, auditable rule
> engine whose contract is designed so a trained model can replace it later without touching
> a router, a table or a chart. The UI says so too — the top bar carries a
> `Rule-based · Phase 1` badge and every score header says `Phase 1 rules`.

---

## Contents

| § | Section | § | Section |
|---|---|---|---|
| 2 | [Quickstart](#2-quickstart) | 11 | [Reports & document intelligence](#11-reports--document-intelligence) |
| 3 | [Modules](#3-modules) | 12 | [Testing & verification](#12-testing--verification) |
| 4 | [Architecture](#4-architecture) | 13 | [Demo script](#13-demo-script) |
| 5 | [Risk model](#5-risk-model) | 14 | [Repository layout](#14-repository-layout) |
| 6 | [Compliance score](#6-compliance-score--deliberately-a-different-number) | 15 | [Design system & UI principles](#15-design-system--ui-principles) |
| 7 | [Explainability contract](#7-explainability-contract) | 16 | [Extension points](#16-extension-points) |
| 8 | [Early warning](#8-early-warning) | 17 | [Security posture](#17-security-posture-as-built-and-what-it-is-not) |
| 9 | [Workflow and permissions](#9-workflow-and-permissions) | 18 | [Limitations](#18-limitations-acknowledged-not-hidden) |
| 10 | [API surface](#10-api-surface) | 19 | [Troubleshooting](#19-troubleshooting) |
| 20 | [License](#20-license) | — | — |

---

## 2. Quickstart

```bash
# 1 — backend (Python 3.11+)
pip install -r requirements.txt
python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000

# 2 — frontend (in a second shell)
cd frontend && npm install
npm run build            # emits frontend/dist, which the API then serves as an SPA
#  - or -
npm run dev              # Vite on :5173, proxying /api to :8000 (override via VITE_API_TARGET)
```

Open <http://localhost:8000> (built app + API on one origin) or <http://localhost:5173> (dev).
On first boot the store seeds itself deterministically — **4 mines · 20 zones · 77
inspections · 78 violations · 76 corrective actions · 66 evidence records · 4 documents ·
2 160 history rows · 31 alerts**. `data/` is git-ignored precisely because it is derived.

Verification, in one line each:

```bash
python3 tools/e2e_test.py                  # 109 checks, in-process, no port needed
MINEGUARD_BASE=http://127.0.0.1:8000 python3 tools/e2e_test.py   # 104 checks against the live server
cd frontend && npm run typecheck           # tsc --noEmit
cd frontend && npm run build               # production bundle
cd frontend && npm run smoke               # renders all 12 routes against a live server
cd frontend && SMOKE_WRITE=1 npm run smoke  # + drives a real inspection submission end to end
```

Role is a header, not a session: `X-User-Id: U-101` (inspector) / `U-201` (officer) /
`U-301` (mine manager) / `U-401` (enterprise admin). The UI's role switcher changes what the
API will accept, so permission logic is genuinely exercised rather than staged.

---

## 3. Modules

Eleven screens, one backend. Every number on screen is fetched, never computed twice.

| # | Module | Route | What it does |
|---|---|---|---|
| 1 | **Enterprise Command Center** | `/` | Enterprise risk + compliance side by side, 90-day trend, KPI tiles with drill-through links, top alerts, mine risk board, overdue load by owner, live activity |
| 2 | **Mine Compliance Map** | `/mines`, `/mines/:id` | Zone map per mine (A extraction, B equipment, C worker ops, D environmental, E storage) painted by engine score; zone dossier drawer with factors, aging, inspections and open actions |
| 3 | **Risk Intelligence** | `/risk` | The whole scoring surface: band distribution, factor weights as deployed, ranked zones, per-factor contributions, enterprise decomposition |
| 4 | **Inspection Management** | `/inspections` | Register + due-zone board + inspector load; the field form **projects the risk impact of a finding before you submit it** |
| 5 | **Violation Management** | `/violations` | Filterable register (mine/zone/department/severity/status/age), status funnel, per-row attributed risk points, full audit drawer |
| 6 | **Corrective Actions** | `/actions` | Assignment, progress, evidence, verification queue, overdue-by-owner table, one-tap actions sized for gloves in the field |
| 7 | **AI Early Warning** | `/early-warning` | Ranked alerts by detector with reasons, deltas and recommendations; acknowledge/withdraw for managers, with operator state that survives regeneration |
| 8 | **Compliance Intelligence** | `/risk` + `/early-warning` | Recurring-category analytics, closure performance, cadence health, cross-mine trends — insights generated from the data, never canned strings |
| 9 | **Document Intelligence** | `/documents` | Upload → extract → classify → link-to-violation pipeline with flags and confidence; explicitly decoupled from scoring |
| 10 | **Reports** | `/reports` | Six report types, preview → generate → stamp, markdown/CSV/TXT download, executive summary assembled from the same engine output |
| 11 | **Administration** | `/admin` | Engine config as deployed, user/role directory, activity log, override register, API surface index, reset + scenario controls |

Deliberately **not** built, per the brief's own exclusions: authentication, a chatbot,
blockchain, a decorative ML banner, or fifty variations of the same dashboard.

---

## 4. Architecture

```
┌────────────────────────── React 18 + TypeScript + Vite + Tailwind ──────────────────────────┐
│  pages/ (11)      components/ (ui, charts, risk, layout, drawers, MineMap, DemoTray)        │
│  state/app.tsx — boot, actor, theme, revision, toasts, invalidate            lib/api.ts —    │
│  one fetch wrapper: relative /api, X-User-Id header, ApiError, engine-telemetry subscription│
│                                  ▲                        NO SCORING CODE LIVES HERE          │
└──────────────────────────────────┼──────────────────────────────────────────────────────────┘
                                   │ REST/JSON
┌──────────────────────────────────▼──────────────────────────────────────────────────────────┐
│ FastAPI                                                                                       │
│  routers/  intelligence · workflow · enterprise        deps.py — get_store / get_actor /     │
│                                                          require_role                         │
│  services/                                                                                     │
│    risk_engine.py  ◀── THE ONLY PLACE RISK ARITHMETIC EXISTS                                  │
│    compliance.py   · computed.py (recompute, history, simulate) · alerts.py · insights.py    │
│    workflow.py (state machine + guards)  · documents.py · reports.py                          │
│  store.py — repository seam: Store.lock · next_id · log · recompute · touch                  │
│  data/store.json — file-backed document store (swap point for Postgres)                      │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Four rules the codebase actually keeps:**

1. **One engine.** `RuleBasedRiskScoringStrategy` is the only implementation of scoring. Routers,
   report builders, alert detectors and the frontend all consume its output — nothing
   re-derives a score, and there is no second formula hiding in a component.
2. **Stored vs derived.** Humans write records; the engine writes scores. Only
   `risk_score/risk_level/risk_tone/compliance_score` on `mines`/`zones` and
   `risk_contribution` on `violations` are denormalised, and all are *written by the engine*
   inside `Store._refresh_columns()`.
3. **One refresh point.** Every mutation ends in `store.touch()` → recompute → persist. The HTTP
   response of any workflow call therefore carries the *post-mutation* zone, mine and
   enterprise scores. Nothing can mutate state and leave a stale score behind.
4. **Replaceable intelligence.** Strategies are selected by `create_engine()`; `computed`,
   `alerts` and `reports` depend only on the `RiskAssessment` shape. Swapping in a trained model
   is an implementation change, not a refactor.

---

## 5. Risk model

`score ∈ [0, 100] = clamp(Σ capped factor points)`. Bands from the specification:
**≤20 LOW · 21–40 MODERATE · 41–60 ELEVATED · 61–80 HIGH · 81–100 CRITICAL.**

The repeat ladder in the brief starts at "+10 for a first occurrence". Since a first
occurrence cannot be a *repeat*, that weight exists in `config.severity_levels` for
transparency but contributes nothing — a factor that punished every new finding for being new
would drown the signal from genuinely recurring control failures.

Five inputs, each `min(cap, coefficient × raw)` — linear rather than saturating, so a zone
already near the ceiling still responds to a new critical finding:

| Factor | Raw input | Coefficient | Cap |
|---|---|---|---|
| Violation severity | Σ weights of open findings — `LOW 10 · MEDIUM 25 · HIGH 50 · CRITICAL 80` | ×0.09 | 45 |
| Repeat violations | Σ ladder weights, over findings with `occurrences ≥ 2` only: `2nd +20 · 3rd +35 · 4th+ 55` | ×0.05 | 20 |
| Unresolved aging | Per finding, by age: `0–7d → 5 · 8–15d → 12 · 16–30d → 25 · 30d+ → 45` | ×0.12 | 25 |
| Overdue actions | `1.5 × count + 0.35 × days past due` | — | 15 |
| Inspection delay | `1.1 × days past cadence`, or a flat 4.0 if the zone has never been inspected | — | 12 |

**Aggregation.** A mine is exposure-weighted, not averaged: `w = 1 + 0.04·open + 0.30·critical`,
`mine = 0.6·Σ(w·zone)/Σw + 0.4·worst_zone`, floored at `62 + 3·(critical_zones − 1)` when any
zone is CRITICAL. Enterprise risk is the mean of mine scores, so a single bad yard lifts its
site decisively without holding the group hostage.

**Attributed contribution per violation.** `attribute_contributions()` apportions a zone's
live `severity + repeat + unresolved + overdue` points back over its open findings in
proportion to the same raw quantities each factor is computed from (`inspection_delay` is
excluded — it belongs to the zone's calendar, not to one record). Two properties are asserted
in the test suite: the per-zone sum equals those factor points (measured: `74.6` vs `74.6`),
and a violation created through the API carries a non-zero contribution immediately
(because the attribution runs in `recompute()`, not in the seeder).

Worked example — **Alpha Colliery Zone B**, the CRITICAL zone of the demo. Straight from
`GET /api/zones/Z-ALPHA-B/risk`, with the engine's own `detail` strings:

```
29.7 / 45   severity         7 open violations (1 critical, 4 high, 2 medium) — severity exposure 330
12.0 / 20   repeat           6 repeat occurrences across 3 categories; worst: Safety Equipment — 6×
17.9 / 25   unresolved       7 unresolved: 1 within 7d · 2 at 8–15d · 3 at 16–30d · 1 beyond 30d (oldest 33d)
15.0 / 15   overdue          CAPPED — 3 actions past due (CA-906, CA-907, CA-909), longest 20 days
12.0 / 12   inspection delay CAPPED — last round 30d ago against a 21d cadence, 9d overdue
────
86.6 CRITICAL (compliance 50.6)  ← adding one HIGH repeat finding takes it to 94.4
```

Two of the five factors are pinned at their cap, which is exactly what the caps are for:
the zone cannot be pushed to 100 by volume alone, and it cannot look "fine" once the
cap is hit either — the drivers list still names each live condition. Every factor carries
`raw`, so `29.7 = min(45, 0.09 × 330)` is checkable by hand.

`tools/calibrate.py` prints this table for every zone; it is how the seed was tuned so the
demo spans LOW to CRITICAL instead of clustering in the middle.

---

## 6. Compliance score — deliberately a different number

A mirror of risk (`100 − risk`) would be decoration. Compliance measures **process
discipline** and is computed separately in `api/services/compliance.py`:

`score = 100 − Σ capped penalties`

| Component | Penalty | Cap |
|---|---|---|
| Findings open past their SLA window | 4.0 per breach + 1.0 per at-risk | 22 |
| Closures completed late | 1.5 each | 6 |
| Overdue corrective actions | the engine's own overdue raw | 18 |
| Submissions waiting on verification | 2.0 each | 6 |
| Inspection cadence breach | scaled past 80 % of cadence | 12 |
| Evidence completeness | `(1 − coverage) × 24` | 12 |
| Statutory return outstanding | flat | 5 |

That is why Zone B reads **86.6 risk / 50.6 compliance** while Neelam reads **5.3 / 95.3**:
one zone has genuine exposure being worked correctly; the other is simply clean.
Both scores are always rendered next to their components, never as a bare number.

---

## 7. Explainability contract

`RiskAssessment` is the product surface, and nothing may display a score without it:

`RiskAssessment.as_dict()` — the literal payload shape returned by `/api/zones/{id}/risk`
and `/api/mines/{id}/risk`, abbreviated:

```jsonc
{
  "zone_id": "Z-ALPHA-B", "mine_id": "MINE-ALPHA", "as_of": "2026-09-04",
  "risk_score": 86.6, "risk_level": "CRITICAL", "tone": "critical",
  "method": "rule-based-v1 · 5 factors · capped-linear · normalised 0-100",
  "factors": [
    { "key": "severity", "label": "Violation Severity", "points": 29.7, "cap": 45.0,
      "raw": 330.0, "share": 66,
      "detail": "7 open violations (1 critical, 4 high, 2 medium) — severity exposure 330." },
    { "key": "overdue", "label": "Overdue Corrective Actions", "points": 15.0, "cap": 15.0,
      "raw": 27.0, "share": 100,
      "detail": "3 corrective action(s) overdue (CA-906, CA-907, CA-909), longest 20 days." }
  ],
  "drivers": [
    "1 CRITICAL severity violation is open right now.",
    "4 HIGH severity finding(s) are unresolved.",
    "6 of these are repeat occurrences — corrective action from the previous cycle did not hold."
  ],
  "recommended_actions": [
    { "priority": "immediate", "action": "Conduct an immediate targeted safety inspection of Zone B — Equipment & Conveyor Yard.",
      "owner_hint": "Field Inspector" }
  ],
  "metrics": { "open_violations": 7, "critical_violations": 1, "high_violations": 4,
               "repeat_violations": 6, "overdue_action_count": 3, "max_overdue_days": 20,
               "unresolved_30_plus": 1, "days_since_inspection": 30, "inspection_cadence_days": 21 }
}
```

The coefficients and caps are served as data too, not baked into the client: one builder
(`risk_engine.describe_engine`) produces `mode · label · phase · factors[{key,label,weight_cap,coefficient}]
· bands[] · severity_weights · repeat_ladder · ageing_bands`, and `/api/bootstrap` and `/api/config`
return that **same object** — the suite asserts they are identical. So the risk page and the admin page
print the model that is deployed, not a copy of the model the developer remembered.

* `ExplanationPanel` renders the factor bars from `factors[]` — bar width is `points / cap`.
* `RecommendationList` renders `recommended_actions[]`, generated by rules over the zone's own
  state (open criticals, aging buckets, repeat categories, overdue owners, missed cadence).
* `projected_impact` comes from `computed.simulate()`, i.e. **the same engine re-run against a
  hypothetical state** — so every "this would take it from 87 to 71" claim in the UI is a real
  computation, and the write paths use the identical function so the promise and the result match.

---

## 8. Early warning

Six detectors in `api/services/alerts.py`, re-run on every recompute over stored records plus
the 90-day history series:

| Detector | Fires when (verbatim from `api/services/alerts.py`) |
|---|---|
| `TREND_ACCELERATION` | A zone's score rose ≥ 8 pts in 14 days **or** ≥ 12 pts in 30 days, and the zone is at ≥ 41 (so clean zones don't get noise) |
| `REPEAT_CLUSTER` | ≥ 3 open findings share a category, or one category reached a 3rd+ occurrence — CRITICAL when the worst is 4× and the zone is ≥ 61 |
| `OVERDUE_ACCUMULATION` | Any action past due in the zone; severity `CRITICAL` at ≥ 18 days, `HIGH` at ≥ 10, else `MEDIUM`. Carries the owner names and a "close all N" projection |
| `VERIFICATION_GAP` | Something submitted for verification more than 2 days ago (SLA is 3) |
| `INSPECTION_GAP` | Past the zone's statutory cadence; `HIGH` once the overrun exceeds 40 % of the cadence |
| `CROSS_FUNCTIONAL` | One zone with open findings across ≥ 2 departments and ≥ 4 findings — a process signal, not a department one |

Each alert carries `reasons[]` (label/value/delta, all real numbers), a `narrative`, a
`recommendation`, and `projected_impact` where a counterfactual applies.

Alerts are **regenerated**, so operator state is kept separately: stable `key = "<KIND>:<scope_id>"`
merged from `alert_state`. `POST /api/alerts/{id}/ack` needs MANAGER/ADMIN and a note, and
never calls `touch()` — acknowledging a briefing cannot change a score. Withdrawal returns it to `OPEN`.

---

## 9. Workflow and permissions

```
Inspection ──▶ Finding ──▶ Violation ──▶ Evidence ──▶ Severity/Risk ──▶ Corrective Action
                                                                                    │
   OPEN → ASSIGNED → IN_PROGRESS → ACTION_SUBMITTED → UNDER_VERIFICATION → CLOSED ◀─┘
```

Enforced in `api/services/workflow.py` (the UI mirrors these states for display only):

| Guard | Behaviour |
|---|---|
| Skipping stages | `409` with the exact path it must follow. `OPEN → CLOSED` is never free |
| Explicit override | MANAGER/ADMIN only, requires `override: true` **and** a written justification; recorded in `workflow_overrides` with `skipped_steps` and surfaced in the audit trail + admin page |
| Closure | Requires a linked action in `VERIFIED`/`CLOSED` — nothing closes on assertion |
| Verification | `VERIFIED`/`CLOSED`/`REJECTED` require MANAGER/ADMIN; an officer submitting their own fix cannot sign it off (`403`) |
| Rework | A withdrawal `VERIFIED → REJECTED` reopens the violation, and a `REJECTED` action **cannot** be re-verified until it is reworked and resubmitted |
| Assignment | Owner must be `OFFICER`/`MANAGER`; `due_date` defaults to today + severity SLA (`3/7/14/30` days) |
| Evidence | Attaching evidence bumps counts, feeds documentation completeness in compliance, and re-scores |
| Recalculation | Every transition returns `risk_impact {before, after, delta, factor_delta[], explanation}` |

Role failures are `403`, illegal transitions `409`, validation `422`, business rules `400`.

---

## 10. API surface

39 endpoints across three routers; all of them are read or written by the UI (nothing is a stub).

| Group | Endpoints |
|---|---|
| Bootstrap & health | `GET /api/health` · `/api/bootstrap` · `/api/dashboard?mine_id=` · `/api/analytics?days=` |
| Structure | `GET /api/mines` · `/api/mines/{id}` · `/api/mines/{id}/risk` · `/api/zones/{id}` · `/api/zones/{id}/risk` |
| Intelligence | `GET /api/alerts?severity=&scope_id=` · `/api/insights` · `POST /api/alerts/{id}/ack` |
| Inspections | `GET/POST /api/inspections` · `GET /api/inspections/{id}` |
| Violations | `GET /api/violations` (filters + `search`/`sort`/`limit`) · `GET /api/violations/{id}` · `POST /api/violations` · `PATCH /api/violations/{id}` · `POST /api/violations/{id}/assign` |
| Actions & evidence | `GET/POST /api/corrective-actions` · `PATCH /api/corrective-actions/{id}` · `POST /api/evidence` |
| Risk tools | `POST /api/risk/simulate` (close/resolve/add/inspect what-if, real re-run) |
| Documents | `GET /api/documents` · `POST /api/documents/upload` (multipart) · `POST /api/documents/{id}/reprocess` · `POST /api/documents/{id}/link` |
| Reports | `GET /api/reports` · `POST /api/reports/generate` · `GET /api/reports/preview/{type}` · `GET /api/reports/download/{type}?format=md\|csv\|txt` |
| Admin | `GET /api/config` · `/api/users` · `/api/activity?limit=5..200` · `/api/admin/overrides` · `POST /api/admin/reset` · `POST /api/admin/scenario` |

Two response headers make the intelligence claim checkable rather than asserted:
`X-Mineguard-Engine: rule-based` and `X-Mineguard-Compute-Ms`. The status bar subscribes to
them and shows `Explainable rule-based risk intelligence · n ms` for the request that produced
what you are looking at.

`GET /api` returns a self-describing index of the surface, rendered read-only in the admin page.

---

## 11. Reports & document intelligence

**Reports.** Six types, each with an explicit scope: `MINE_RISK_ASSESSMENT` (mine),
`MINE_COMPLIANCE_SUMMARY` (mine), `OPEN_VIOLATIONS` (mine or enterprise),
`OVERDUE_ACTIONS` (mine or enterprise), `DEPARTMENT_COMPLIANCE` (enterprise),
`EARLY_WARNING` (enterprise). `build_report()` returns typed **sections** — `KEY_FACTS`,
`TABLE`, `EXPLANATION`, `ACTIONS`, `CALLOUT`, `LIST` — plus `executive_summary` and `counts`.
The UI renders only `sections[]` and never re-formats numbers, which is why a CSV, the
on-screen preview and the markdown download can never disagree. Preview → generate (stamped,
logged) → download.

**Documents.** Upload → write file → extract text (PDF text layer via `pypdf`/`pdftotext`) →
classify against the seven document families → structured field extraction → gap flags →
confidence + engine name → optional link to a violation, which *creates a register entry
through the normal workflow* and therefore re-scores. Scanned pages with no OCR engine
available return `status: FAILED` with the reason and a `flags[]` entry, and
`GET /api/config.ocr_engines` reports exactly which engines are installed. Document
intelligence is **decoupled from scoring**: a PDF never changes a risk score until a human
raises a finding from it.

---

## 12. Testing & verification

| Harness | What it proves |
|---|---|
| `tools/e2e_test.py` | **109 checks** over the real HTTP surface, in-process (`TestClient`) so it needs no port: 8 demo scenes in order, workflow guards, 403/409/422 paths, attribution identities, config/bootstrap agreement on the deployed model, alert ack persistence across regeneration, every report type generating, exports downloading, upload + reprocess, analytics consistency, cross-collection referential integrity (no orphan actions/violations/zones) |
| same file with `MINEGUARD_BASE` set | **104 checks** against a live server — the 5 in-process-only ones are multipart upload and file downloads |
| `frontend: npm run typecheck` | `tsc --noEmit` across 9 014 lines of TS/TSX, `strict` |
| `frontend: npm run build` | Production bundle, no warnings |
| `frontend: npm run smoke` | Bundles the app with esbuild and renders **all 12 routes** in jsdom against the live API, asserting content, then **clicks through real interactions** (zone drawer, action tabs, violation drawer + risk dossier, report generation) and captures `window.onerror` + `console.error`. `SMOKE_WRITE=1` fills the inspection form, submits it, and asserts the engine's response moved the severity factor and returned a real explanation |

The smoke harness found three genuine bugs the type checker could not: a temporal-dead-zone
crash in the inspections page (every visitor hit it), a dossier-shape mismatch in the zone
drawer, and a form whose silent validation failure blocked submission. It resets the store
after mutating runs, so the suite is repeatable.

```bash
cd frontend && npm run verify      # typecheck + smoke in one command
```

---

## 13. Demo script

Eight scenes; `DemoTray` (bottom-right) navigates them, arms the one-click escalation, and
restores the baseline with **RESET DEMO SCENARIO**, so a broken take-back is impossible.

| # | Scene | What you click | What you say |
|---|---|---|---|
| 1 | Fragmentation | `/` | "Inspections, findings and actions live in different places; nothing says which one is becoming dangerous." |
| 2 | Discovery | `/mines/MINE-ALPHA` | "One zone dominates the map: Zone B, 86.6 CRITICAL. The map paints it before any table does." |
| 3 | Explainability | `/risk`, then Zone B's drawer | "Not a number — five capped factors with points, the conditions in words, and what to do." |
| 4 | Escalation | `POST /api/admin/scenario {"name":"ZONE_B_ESCALATION"}` | "One new HIGH repeat finding from a field round." Zone B **86.6 → 94.4**, Δ +7.8 |
| 5 | Immediate reaction | `/violations?zone=Z-ALPHA-B&sort=risk` | "The finding is already at the top of the register with its attributed points, and the alerts re-ranked in the same request." |
| 6 | Accountability | `/actions` → assign + action | "Ownership with a committed date. It cannot skip stages — the API refuses, not the UI." |
| 7 | Closure | evidence → submit → manager verify | "An officer submits; only a manager verifies. Risk falls immediately — **94.4 → 86.6**, exactly the attributed 7.8 pt" |
| 8 | Organizational learning | `/early-warning`, `/reports` | "The recurring category keeps its weight, so the next quarter is cheaper than this one." |

Two numbers worth quoting: the seeded enterprise sits at **42.1 ELEVATED risk / 80.3 STRONG
compliance**, and `POST /api/risk/simulate` for Zone B with all 8 open findings and 7 open
actions resolved projects **94.4 → 12.0** — a real re-run of the engine, not an estimate.

---

## 14. Repository layout

```
mineguard/
├── api/
│   ├── main.py                  app, CORS, timing/engine middleware, ValueError→400, SPA fallback
│   ├── deps.py                  get_store · get_actor (X-User-Id) · require_role
│   ├── store.py                 document store, lock, next_id, log, recompute/touch, derived columns
│   ├── seed.py                  deterministic scenario generator (90 days of history)
│   ├── routers/                 intelligence · workflow · enterprise
│   └── services/                risk_engine · compliance · computed · alerts · insights ·
│                                workflow (state machine) · documents · reports
├── frontend/
│   ├── src/pages/               11 pages (CommandCenter, Mines + MineDetail, Inspections,
│   │                            Violations, Actions, RiskIntelligence, EarlyWarning,
│   │                            Reports, Documents, Admin)
│   ├── src/components/          ui.tsx (29 exported primitives) · charts.tsx · risk.tsx · layout.tsx ·
│   │                            ZoneDrawer · ViolationDrawer · MineMap · DemoTray
│   ├── src/state/app.tsx        useApp / useAsync / useDocumentTitle / toasts / revision
│   ├── src/lib/                 api.ts (fetch + engine telemetry) · format.ts · types.ts
│   ├── scripts/                 render-smoke.mjs + smoke-entry.tsx (jsdom harness)
│   └── vite.config.ts           /api proxy to :8000
├── tools/                       e2e_test.py · calibrate.py
├── docs/DATA_MODEL.md           every collection, stored-vs-derived, formulas, deviations, swap points
└── requirements.txt             backend deps + run commands
```

~16 700 lines: 6 742 lines of Python, 9 014 of TypeScript/TSX, 979 in tools, docs and the
smoke harness. React and Tailwind are the only runtime dependencies on the front end — no
component kit and no chart library, because the 29 UI primitives and every chart (trend,
factor bars, donut, band strip, status funnel, score ring, sparklines) are built in-house so
nothing in the visual layer is outside our control.

---

## 15. Design system & UI principles

* **Semantic tokens only.** `--bg-app/-panel/-raised/-sunken`, `--line`, `--text*`, `--accent`,
  `--ok/warn/danger/info`, `--risk-low…critical`, in `.theme-dark` and `.theme-light`. Not one
  hex literal in a component; the whole app re-themes from two classes on `<html>`, and the
  choice persists in `localStorage`.
* **Risk is never colour alone.** Every level pairs a band colour with its word, a dot and a
  tooltip; bars carry their numeric points. Bands are chosen for contrast in both themes.
* **Density over decoration.** No gradients, no cartoon icons, no oversized rounded cards, no
  generic admin-template look. Panels, hairlines, monospace numerals, tight type scale.
* **Every state is designed.** Skeletons while loading, `EmptyState` with a route out, `ErrorState`
  that names what to change, toasts on mutation with the engine's own message, and
  score-change flashes where a number just moved.
* **Responsive by intent, not by shrink.** The register and the audit drawers are built for a phone
  in a truck: status controls are buttons rather than hover menus, the drawer goes full-width
  below 560px, filter chips wrap instead of hiding behind a menu, and hover tooltips never carry the
  only copy of a fact. On
  coarse-pointer devices inputs go to 16 px (below that mobile Safari zooms on focus) and tap
  targets to 36 px; wide tables scroll inside their panel instead of forcing page-level zoom-out.
* **Traceability in the UI.** Scores link to their factors, factors link to the records behind
  them, and `?filters` are encoded in URLs so `/violations?zone=Z-ALPHA-B&status=OPEN_ANY` is a
  shareable, working link rather than a screenshot of a state.

---

## 16. Extension points

| Future work | Seam already in place |
|---|---|
| Trained model | Implement `MLModelRiskScoringStrategy` (contract in `risk_engine.py`), keep the factor decomposition as the explanation channel, and A/B it against the rules over the same stored `computed.history` rows. `create_engine("…")` switches it; routers, alerts, reports and UI are untouched. |
| PostgreSQL / Supabase | Re-implement `Store` (`find/zone/mine/user/log/touch/_refresh_columns`) over SQLAlchemy; `computed` becomes materialised tables refreshed by the same `touch()`. No query is scattered outside that seam. |
| Real OCR | Add an engine to `documents.available_engines()`; statuses, confidence and flags are already generic, and `config.ocr_engines` reports availability. |
| Object storage | `stored_path` is the only coupling point for S3/Azure Blob. |
| WhatsApp/email alerts | Alerts are keyed and idempotent, so a sink diffs `alert_state` instead of re-parsing narratives. |
| SSO / RBAC | `get_actor` is one function; roles are already enforced at the service layer, so a real token validator slots in without touching business rules. |

---

## 17. Security posture (as built, and what it is not)

| Aspect | Reality in this prototype |
|---|---|
| Authentication | **None.** Identity is the `X-User-Id` header, resolved in `api/deps.py::get_actor`, defaulting to the admin. This is intentional for a demo and is the first thing to remove before any real deployment. |
| Authorisation | Real and server-side: role checks live in the service layer (`WorkflowService`, `require_role`), so they cannot be bypassed by the UI — but they trust the header above them. |
| Injection / ORM exposure | No SQL at all; the store is a JSON document keyed by ids validated against the collections. Pydantic models constrain enums (`Literal` severities, statuses, departments), so bad values fail as `422` rather than reaching state. |
| Uploads | `POST /api/documents/upload` allows an extension allowlist, rejects empty files and anything over 12 MB, sanitises the stored file name to `[A-Za-z0-9._-]`, and never serves the file back inline. |
| Secrets | Nothing secret is read from code paths: no keys, no tokens, no credentials in the repo or in the frontend bundle. |
| CORS | `*` in development, because the API and the built SPA are normally same-origin; tighten alongside a real auth layer. |
| PII | Demo personnel are fictional. Nothing in the seed comes from a real mine, worker or inspection. |

A production variant needs: a real identity provider in front of `get_actor`, per-mine data
scope filters, an append-only audit store, and rate limiting on the upload and report routes.
None of those are prototype work — they are deployment work, and `get_actor` is the seam.

---

## 18. Limitations, acknowledged not hidden

1. **The intelligence is rule-based.** Factor weights, caps and coefficients are hand-tuned and
   documented, not learned. No accuracy claim is made anywhere, and none should be inferred
   from the words "AI" or "early warning".
2. **The store is a JSON document.** Correct for a prototype at this data volume; a single
   global lock is the price. Fine at 20 zones and 90 days of history, not at enterprise scale.
3. **No authentication.** Identity is a trusted header; authorisation is real and server-side.
4. **OCR is optional by environment.** With no Tesseract installed, scanned images surface as
   `FAILED` with the reason rather than being silently guessed.
5. **Verification does not hard-gate on attached evidence.** Evidence coverage is *scored* (it
   drives the documentation component of compliance) instead of blocking closure. The gate is
   two lines in `WorkflowService.update_action` if policy demands it — see
   `docs/DATA_MODEL.md` §7.
6. **Illustrative figures in the brief are not hardcoded.** Where the specification's own numbers
   conflicted with its bands (e.g. "Zone A 32 → LOW" against `LOW ≤ 20`), the bands win and the
   tile is labelled `MODERATE`. All seven deviations are listed with reasons in `docs/DATA_MODEL.md` §9.
7. **The rule weights are hand-tuned, not fitted.** `tools/calibrate.py` exists precisely so
   the coefficients can be re-balanced against a real register's distribution; until someone does
   that against production data, the numbers are an engineer's defensible starting point, not a
   validated model.

---

## 19. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/` returns 404 while `/api/health` is 200 | `frontend/dist` is missing — `main.py` mounts the SPA only when the build exists. `cd frontend && npm install && npm run build`, then restart uvicorn so the static mount registers. |
| `ModuleNotFoundError: uvicorn/fastapi` | Sandbox or venv was reset; `pip install -r requirements.txt`. |
| Scores look stale after editing files under `api/` | `data/store.json` wins over `api/seed.py`. `curl -X POST :8000/api/admin/reset -H 'X-User-Id: U-401' -d '{}'` or delete the file and restart. |
| 403 on verify/ack | Wrong role for that action — switch identity in the top bar (`U-301`/`U-401`). |
| 409 on a status change | The transition skips stages. Follow the flow, or override as MANAGER/ADMIN with a written justification. |
| Numbers changed after running tests | Intended — the suites mutate through the real API. Both reset the store on exit; `POST /api/admin/reset` restores the baseline at any time. |

---

## 20. License

MIT © 2026 MINEGUARD AI contributors — see [LICENSE](LICENSE).

In practice: use it, fork it, ship it, relicense your derivative work, no attribution
machinery beyond keeping the copyright and permission notice in source distributions.
Two things it does **not** grant, stated because both are easy to assume:

* **No warranty of operational correctness.** This is a decision-support prototype. Its risk
  scores are explainable rule outputs over the records you feed it, and nothing in it substitutes
  for a DGMS inspection, a statutory return, or a competent person's judgement. Do not close a
  real safety gap because a model said the band improved.
* **No license to any mine, operator, regulation or dataset name.** The four sites
  (`Alpha Colliery`, `Brahma Open Cast`, `Garba Deep Block`, `Neelam Integrated Mine`) and every
  record in `api/seed.py` are fictional demonstration data. The clause-like strings attached to
  the 17 violation categories — e.g. `"Coal Mine Reg. 106(2) — protective equipment"`,
  `"Mines Act 60 — supervision ratio"` — are illustrative labels used to make a register entry
  quotable in the UI. They are **not** verified quotations of current statute: check them against
  the actual DGMS/Coal India text before anything built on this is used for a real obligation.

If you need an explicit patent grant instead — a plausible requirement for a public-sector or
operator deployment — swap in Apache-2.0: one file and one line here, and the code does not
change. Contributions are accepted under the same license (inbound = outbound); no CLA, no
assigner agreement.

---

### Further reading

* [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — every collection field-by-field, the derived
  `computed` layer, the exact formulas and constants, alert keying, the endpoint→data map, and
  the documented deviations from the specification.
* [`requirements.txt`](requirements.txt) — one-command recovery.
* Problem statement: **SIH26024** — compliance risk prediction for coal mines (also noted in
  the header, so the two must stay consistent).

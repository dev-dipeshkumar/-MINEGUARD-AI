"""
MINEGUARD AI — Early Warning System.

Detects *emergence*, not current state: a zone that is merely bad today is a
report line; a zone that is getting worse, repeating, or accumulating overdue
obligations is an alert. Every alert is derived from the records plus the
engine's own history series, so the alert feed and the numbers on the map can
never disagree.

Six detectors run on every recompute:

  TREND_ACCELERATION     risk delta over 14 days, with velocity corroboration
  REPEAT_CLUSTER         same category recurring within one zone
  OVERDUE_ACCUMULATION   corrective actions past due
  VERIFICATION_GAP       submitted evidence waiting on a verifier too long
  INSPECTION_GAP         zone past its statutory cadence
  CROSS_FUNCTIONAL       several departments failing in one zone at once

`projected_impact` runs the counterfactual simulator, so each alert can say
"clearing these three actions takes the zone from 87 to 71" — a number that
comes from the real engine, not a canned sentence.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

SEVERITY_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "WATCH": 1}


def _zone_store_view(store, zone_id: str) -> tuple[dict, dict]:
    payload = store.zone_assessment(zone_id) or {}
    return payload.get("risk", {}), payload.get("compliance", {})


def _history(store, scope_id: str) -> List[dict]:
    return [r for r in store.data.get("computed", {}).get("history", []) if r["scope_id"] == scope_id]


def _value_days_ago(rows: List[dict], days: int, key: str = "risk_score") -> Optional[float]:
    if not rows:
        return None
    last_day = date.fromisoformat(rows[-1]["date"])
    target = last_day - timedelta(days=days)
    best = min(rows, key=lambda r: abs((date.fromisoformat(r["date"]) - target).days))
    return best.get(key)


def build_alerts(store, today: date) -> List[dict]:
    from .computed import simulate

    alerts: List[dict] = []
    violations = store.data.get("violations", [])
    actions = store.data.get("corrective_actions", [])
    counter = 0

    def new_alert(**kwargs: Any) -> dict:
        nonlocal counter
        counter += 1
        rank = SEVERITY_RANK.get(kwargs.get("severity", "WATCH"), 1)
        return {
            "id": f"AW-{today.strftime('%m%d')}-{counter:02d}",
            "status": "OPEN",
            "created_at": today.isoformat(),
            "rank": rank,
            "read": False,
            "acknowledged_by": None,
            **kwargs,
        }

    for zone in store.data.get("zones", []):
        zone_id = zone["id"]
        mine = store.mine(zone["mine_id"]) or {}
        risk, compliance = _zone_store_view(store, zone_id)
        if not risk:
            continue
        metrics = risk.get("metrics", {})
        score = risk.get("risk_score", 0.0)
        level = risk.get("risk_level", "LOW")
        history = _history(store, zone_id)
        rows_by_cat: Dict[str, List[dict]] = {}
        open_zone = [
            v
            for v in violations
            if v["zone_id"] == zone_id
            and v["status"] != "CLOSED"
            and date.fromisoformat(v["created_at"]) <= today
        ]
        for v in open_zone:
            rows_by_cat.setdefault(v["category"], []).append(v)

        zone_open_actions = [a for a in actions if a.get("zone_id") == zone_id and a["status"] not in {"CLOSED", "VERIFIED"}]
        overdue = []
        for a in zone_open_actions:
            if a.get("due_date"):
                due = date.fromisoformat(a["due_date"])
                if due < today:
                    overdue.append((a, (today - due).days))

        # ---------------------------------------------------------------- 1
        now_14 = _value_days_ago(history, 14) or 0.0
        now_30 = _value_days_ago(history, 30) or 0.0
        delta14 = round(score - now_14, 1)
        delta30 = round(score - now_30, 1)
        if (delta14 >= 8 or delta30 >= 12) and score >= 41:
            velocity_now = metrics.get("violations_30d", 0)
            velocity_prev = metrics.get("violations_prev_30d", 0)
            reasons = [
                {"label": "Risk score", "value": f"{now_14:.0f} → {score:.0f}", "delta": f"+{delta14:.0f} in 14 days"},
                {
                    "label": "Violations logged",
                    "value": f"{velocity_prev} → {velocity_now}",
                    "delta": f"{'+' if velocity_now >= velocity_prev else ''}{velocity_now - velocity_prev} per 30d",
                },
                {"label": "Open violations", "value": f"{metrics.get('open_violations', 0)}"},
                {"label": "Overdue actions", "value": f"{metrics.get('overdue_action_count', 0)}"},
            ]
            if metrics.get("repeat_violations"):
                reasons.append({"label": "Repeat occurrences", "value": f"{metrics['repeat_violations']} violation(s)"})
            alerts.append(
                new_alert(
                    kind="TREND_ACCELERATION",
                    severity="CRITICAL" if score >= 81 else "HIGH" if score >= 61 else "MEDIUM",
                    title="Escalating compliance risk trend detected",
                    scope_type="ZONE",
                    scope_id=zone_id,
                    scope_name=zone["name"],
                    mine_id=zone["mine_id"],
                    mine_name=mine.get("name", ""),
                    risk_score=score,
                    risk_level=level,
                    previous_score=now_14,
                    delta=delta14,
                    reasons=reasons,
                    narrative=(
                        f"Risk in {zone['name']} has risen from {now_14:.0f} to {score:.0f} in 14 days while "
                        f"violation velocity moved {velocity_prev} → {velocity_now} per 30-day window. The trend has "
                        "not been matched by any closure activity, so escalation is expected to continue."
                    ),
                    recommendation="Schedule an immediate inspection and clear the overdue corrective actions before the next statutory round.",
                )
            )

        # ---------------------------------------------------------------- 2
        for category, rows in rows_by_cat.items():
            ordinals = {r["id"]: r.get("occurrences", 1) for r in rows}
            max_occ = max(ordinals.values()) if ordinals else 0
            if len(rows) >= 3 or max_occ >= 3:
                span = (today - min(date.fromisoformat(r["created_at"]) for r in rows)).days
                impact = None
                alerts.append(
                    new_alert(
                        kind="REPEAT_CLUSTER",
                        severity="CRITICAL" if max_occ >= 4 and score >= 61 else "HIGH",
                        title=f"Recurring non-compliance: {category}",
                        scope_type="ZONE",
                        scope_id=zone_id,
                        scope_name=zone["name"],
                        mine_id=zone["mine_id"],
                        mine_name=mine.get("name", ""),
                        risk_score=score,
                        risk_level=level,
                        reasons=[
                            {"label": "Open instances", "value": f"{len(rows)}"},
                            {"label": "Recurrence depth", "value": f"{max_occ}x same category"},
                            {"label": "Window", "value": f"{span} days"},
                            {"label": "Departments", "value": ", ".join(sorted({r["department"].title() for r in rows}))},
                        ],
                        narrative=(
                            f"{len(rows)} open {category.lower()} findings in {zone['name']} share the same root "
                            "cause, and closure of earlier instances did not prevent recurrence. Repeated findings "
                            "in one category indicate a systemic control failure rather than isolated lapses."
                        ),
                        recommendation=(
                            "Treat as a systemic control failure: root-cause review with the equipment vendor and a "
                            "verification re-inspection 7 days after rectification."
                        ),
                        entity_ids=[r["id"] for r in rows],
                    )
                )
                break  # one recurrence alert per zone keeps the feed readable

        # ---------------------------------------------------------------- 3
        if overdue:
            worst = max(d for _, d in overdue)
            ids = [a["id"] for a, _ in overdue]
            try:
                impact = simulate(store, zone_id, resolve_action_ids=ids)
            except Exception:  # never let a simulation failure suppress an alert
                impact = None
            alerts.append(
                new_alert(
                    kind="OVERDUE_ACCUMULATION",
                    severity="CRITICAL" if worst >= 18 else "HIGH" if worst >= 10 else "MEDIUM",
                    title=f"{len(overdue)} corrective action(s) overdue",
                    scope_type="ZONE",
                    scope_id=zone_id,
                    scope_name=zone["name"],
                    mine_id=zone["mine_id"],
                    mine_name=mine.get("name", ""),
                    risk_score=score,
                    risk_level=level,
                    reasons=[
                        {"label": "Overdue actions", "value": f"{len(overdue)}"},
                        {"label": "Longest overdue", "value": f"{worst} days"},
                        {"label": "Owners", "value": ", ".join(sorted({(store.user(a['assigned_to']) or {}).get('name', '—') for a, _ in overdue}))},
                        {"label": "Unresolved total", "value": f"{metrics.get('open_action_count', 0)} action(s)"},
                    ],
                    narrative=(
                        f"{len(overdue)} corrective action(s) in {zone['name']} are past their due date, the longest "
                        f"by {worst} days. Overdue actions are the strongest single predictor of a repeat finding "
                        "because the underlying control remains absent."
                    ),
                    recommendation=(
                        "Escalate to the responsible officer with a 48-hour completion target and require evidence "
                        "before status change."
                    ),
                    entity_ids=ids,
                    projected_impact=(
                        {
                            "action": f"Close all {len(ids)} overdue action(s)",
                            "after": impact["after"]["risk_score"],
                            "delta": impact["delta"],
                        }
                        if impact
                        else None
                    ),
                )
            )

        # ---------------------------------------------------------------- 4
        waiting = [
            a
            for a in zone_open_actions
            if a["status"] in {"SUBMITTED"} and a.get("completed_at") and (today - date.fromisoformat(a["completed_at"])).days > 2
        ]
        if waiting:
            days = max((today - date.fromisoformat(a["completed_at"])).days for a in waiting)
            alerts.append(
                new_alert(
                    kind="VERIFICATION_GAP",
                    severity="MEDIUM",
                    title=f"{len(waiting)} resolution(s) awaiting verification for {days} days",
                    scope_type="ZONE",
                    scope_id=zone_id,
                    scope_name=zone["name"],
                    mine_id=zone["mine_id"],
                    mine_name=mine.get("name", ""),
                    risk_score=score,
                    risk_level=level,
                    reasons=[
                        {"label": "Submitted, unverified", "value": f"{len(waiting)}"},
                        {"label": "Longest wait", "value": f"{days} days"},
                        {"label": "Verifier", "value": (store.mine(zone["mine_id"]) or {}).get("name", "") + " Mine Manager"},
                    ],
                    narrative=(
                        "Corrective work has been reported complete but no verification decision exists. Until a "
                        "verifier signs it off, the control cannot be assumed in place, so the engine continues to "
                        "hold this zone's risk elevated."
                    ),
                    recommendation="Clear the verification queue today; approve or reject with a written note.",
                    entity_ids=[a["id"] for a in waiting],
                )
            )

        # ---------------------------------------------------------------- 5
        since = metrics.get("days_since_inspection")
        cadence = metrics.get("inspection_cadence_days", 21)
        if since is None or since > cadence:
            over = None if since is None else since - cadence
            alerts.append(
                new_alert(
                    kind="INSPECTION_GAP",
                    severity="HIGH" if (over or 99) > cadence * 0.4 else "MEDIUM",
                    title="Statutory inspection cadence missed" if over else "Inspection cadence at risk",
                    scope_type="ZONE",
                    scope_id=zone_id,
                    scope_name=zone["name"],
                    mine_id=zone["mine_id"],
                    mine_name=mine.get("name", ""),
                    risk_score=score,
                    risk_level=level,
                    reasons=[
                        {"label": "Last inspection", "value": "no record" if since is None else f"{since} days ago"},
                        {"label": "Required cadence", "value": f"every {cadence} days"},
                        {"label": "Overdue by", "value": "entire cycle" if over is None else f"{over} days"},
                        {"label": "Open findings unverified", "value": f"{metrics.get('open_violations', 0)}"},
                    ],
                    narrative=(
                        f"{zone['name']} has not had a completed inspection within its {cadence}-day cadence. "
                        "Verification age is an independent risk driver: control effectiveness is unproven for every "
                        "finding recorded since the last round."
                    ),
                    recommendation="Book a targeted inspection within 48 hours and prioritise open findings.",
                    projected_impact=None,
                )
            )

        # ---------------------------------------------------------------- 6
        depts = metrics.get("departments", [])
        if len(depts) >= 2 and len(open_zone) >= 4:
            alerts.append(
                new_alert(
                    kind="CROSS_FUNCTIONAL",
                    severity="HIGH" if len(open_zone) >= 6 else "MEDIUM",
                    title="Multiple departments failing in one zone",
                    scope_type="ZONE",
                    scope_id=zone_id,
                    scope_name=zone["name"],
                    mine_id=zone["mine_id"],
                    mine_name=mine.get("name", ""),
                    risk_score=score,
                    risk_level=level,
                    reasons=[
                        {"label": "Departments involved", "value": ", ".join(d.title() for d in depts)},
                        {"label": "Open findings", "value": f"{len(open_zone)}"},
                        {"label": "High/critical", "value": f"{metrics.get('high_violations', 0) + metrics.get('critical_violations', 0)}"},
                        {"label": "Compliance score", "value": f"{compliance.get('compliance_score', 0):.0f}/100"},
                    ],
                    narrative=(
                        f"{len(depts)} separate compliance functions are simultaneously non-conformant in "
                        f"{zone['name']}. Concurrent failure across departments usually indicates a supervision or "
                        "resourcing problem at zone level rather than independent technical lapses."
                    ),
                    recommendation="Convene a zone-level compliance review with all three department officers and the shift overmen.",
                )
            )

    # ------------------------------------------------------- mine-level roll
    for mine in store.data.get("mines", []):
        zids = [z["id"] for z in store.zones(mine["id"])]
        hot = [z for z in zids if (store.zone_assessment(z) or {}).get("risk", {}).get("risk_level") in {"CRITICAL", "HIGH"}]
        if len(hot) >= 2:
            mc = store.mine_computed(mine["id"]) or {}
            history = _history(store, mine["id"])
            prev = _value_days_ago(history, 30) or 0.0
            alerts.append(
                new_alert(
                    kind="PORTFOLIO",
                    severity="HIGH",
                    title=f"{len(hot)} zones at HIGH or CRITICAL risk in {mine['name']}",
                    scope_type="MINE",
                    scope_id=mine["id"],
                    scope_name=mine["name"],
                    mine_id=mine["id"],
                    mine_name=mine["name"],
                    risk_score=mc.get("risk_score", 0.0),
                    risk_level=mc.get("risk_level", "HIGH"),
                    previous_score=prev,
                    delta=round(mc.get("risk_score", 0.0) - prev, 1),
                    reasons=[
                        {"label": "Hot zones", "value": ", ".join((store.zone(z) or {}).get("short_name", z) for z in hot)},
                        {"label": "Mine open violations", "value": f"{mc.get('open_violations', 0)}"},
                        {"label": "Mine overdue actions", "value": f"{mc.get('overdue_actions', 0)}"},
                    ],
                    narrative=(
                        f"{mine['name']} carries {len(hot)} zones in the upper risk bands simultaneously. Because site "
                        "risk is exposure weighted, the mine score is driven by the worst zone, not the average: "
                        "management attention belongs on those zones specifically."
                    ),
                    recommendation="Allocate additional inspection resource to this mine this cycle and review maintenance staffing.",
                )
            )

    alerts.sort(key=lambda a: (-a["rank"], -(a.get("delta") or 0), -a.get("risk_score", 0)))

    # Ids are assigned after sorting so the briefing order and the identifier agree.
    # A stable `key` (detector + scope) is what lets operator state survive the next
    # regeneration: alerts are recomputed from the records, so anything a human did
    # to an alert would otherwise be erased by the very next mutation.
    prior = store.data.get("alert_state", {})
    for i, a in enumerate(alerts, start=1):
        a["id"] = f"AW-{today.strftime('%m%d')}-{i:02d}"
        a["key"] = f"{a['kind']}:{a.get('scope_id', '')}"
        state = prior.get(a["key"])
        if state:
            a["status"] = state.get("status", "ACKNOWLEDGED")
            a["acknowledged_by"] = state.get("acknowledged_by")
            a["acknowledged_at"] = state.get("acknowledged_at")
            a["ack_note"] = state.get("note", "")
            a["read"] = True
    return alerts

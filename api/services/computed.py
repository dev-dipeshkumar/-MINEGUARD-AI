"""
MINEGUARD AI — computation orchestrator.

Bridges the raw records in `Store` to the risk engine and the compliance
model, and materialises everything the API serves:

  * per-zone risk assessment + compliance breakdown (with explanations)
  * per-mine aggregate risk / compliance
  * enterprise aggregate
  * the trailing risk-history series (trend, velocity, alerts)
  * map geometry status

Write paths call this with ``with_history=False`` so a field inspector
submitting a violation gets a sub-second response: only today's point is
recomputed and spliced into the stored series. Load / seed / reset rebuild the
whole window so the trend data is always replayed through the *same* scoring
code that produces the live number — no hardcoded history anywhere.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from .compliance import calculate_compliance
from .risk_engine import ZoneObservation


def _score_day(store, day: date, with_contributions: bool = False) -> tuple[Dict[str, dict], Dict[str, dict]]:
    """Score every zone for one day; returns (zone_results, mine_results)."""
    zone_results: Dict[str, dict] = {}
    assessments_by_mine: Dict[str, List[Any]] = {}
    comp_by_mine: Dict[str, List[float]] = {}

    for obs in store.observations(day):
        assessment = store.engine.scoring.score(obs)
        closed_90, total_90 = store.closure_stats(obs.zone_id, day)
        mine = store.mine(obs.mine_id) or {}
        compliance = calculate_compliance(
            obs,
            total_violations_90d=total_90,
            closed_in_window=closed_90,
            evidence_compliance=store.evidence_coverage(obs.zone_id, day),
            reporting_current=bool(mine.get("reporting_current", True)),
        )
        payload = {
            "zone_id": obs.zone_id,
            "zone_name": obs.zone_name,
            "zone_type": obs.zone_type,
            "mine_id": obs.mine_id,
            "risk": assessment.as_dict(),
            "compliance": compliance.as_dict(),
        }
        if with_contributions:
            from .risk_engine import attribute_contributions

            payload["contributions"] = attribute_contributions(obs, {f.key: f.points for f in assessment.factors})
        zone_results[obs.zone_id] = payload
        assessments_by_mine.setdefault(obs.mine_id, []).append(assessment)
        comp_by_mine.setdefault(obs.mine_id, []).append(compliance.score)

    from .risk_engine import aggregate_mine_score, risk_band

    mine_results: Dict[str, dict] = {}
    for mine_id, assessments in assessments_by_mine.items():
        critical_zones = sum(1 for a in assessments if a.level == "CRITICAL")
        risk = aggregate_mine_score(assessments, critical_zones=critical_zones)
        level, tone = risk_band(risk)
        comps = comp_by_mine.get(mine_id, [])
        mine_results[mine_id] = {
            "risk_score": risk,
            "risk_level": level,
            "tone": tone,
            "compliance_score": round(sum(comps) / len(comps), 1) if comps else 0.0,
            "critical_zones": critical_zones,
            "open_violations": sum(a.metrics["open_violations"] for a in assessments),
            "overdue_actions": sum(a.metrics["overdue_action_count"] for a in assessments),
            "zone_ids": [a.zone_id for a in assessments],
        }
    return zone_results, mine_results


def _history_row(scope_type: str, scope_id: str, mine_id: Optional[str], day: date, risk: float, level: str, compliance: float, factors: Dict[str, float]) -> dict:
    return {
        "scope_type": scope_type,
        "scope_id": scope_id,
        "mine_id": mine_id,
        "date": day.isoformat(),
        "risk_score": risk,
        "risk_level": level,
        "compliance_score": round(compliance, 1),
        "contributing_factors": factors,
    }


def build_history(store, days: int, today: date) -> List[dict]:
    from .risk_engine import risk_band

    rows: List[dict] = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        zone_results, mine_results = _score_day(store, day)
        for zone_id, payload in zone_results.items():
            risk = payload["risk"]
            rows.append(
                _history_row(
                    "ZONE",
                    zone_id,
                    payload["mine_id"],
                    day,
                    risk["risk_score"],
                    risk["risk_level"],
                    payload["compliance"]["compliance_score"],
                    {f["key"]: f["points"] for f in risk["factors"]},
                )
            )
        for mine_id, payload in mine_results.items():
            comps = [p["compliance"]["compliance_score"] for p in zone_results.values() if p["mine_id"] == mine_id]
            rows.append(
                _history_row(
                    "MINE",
                    mine_id,
                    mine_id,
                    day,
                    payload["risk_score"],
                    payload["risk_level"],
                    sum(comps) / len(comps) if comps else 0.0,
                    {},
                )
            )
    return rows


def compute_all(store, with_history: bool = True) -> Dict[str, Any]:
    from .risk_engine import aggregate_enterprise_score, risk_band

    today = date.today()
    zone_results, mine_results = _score_day(store, today, with_contributions=True)

    previous: List[dict] = list(store.data.get("computed", {}).get("history", [])) if not with_history else []
    if with_history:
        history = build_history(store, int(store.data.get("history_days", 90) or 90), today)
    else:
        # keep the stored series, refresh today's point, and keep it in order
        previous = [r for r in previous if r["date"] != today.isoformat()]
        fresh_zone, fresh_mine = zone_results, mine_results
        for zone_id, payload in fresh_zone.items():
            risk = payload["risk"]
            previous.append(
                _history_row(
                    "ZONE",
                    zone_id,
                    payload["mine_id"],
                    today,
                    risk["risk_score"],
                    risk["risk_level"],
                    payload["compliance"]["compliance_score"],
                    {f["key"]: f["points"] for f in risk["factors"]},
                )
            )
        for mine_id, payload in fresh_mine.items():
            previous.append(
                _history_row("MINE", mine_id, mine_id, today, payload["risk_score"], payload["risk_level"], payload["compliance_score"], {})
            )
        previous.sort(key=lambda r: (r["date"], r["scope_type"], r["scope_id"]))
        history = previous

    ent_risk = aggregate_enterprise_score([m["risk_score"] for m in mine_results.values()])
    ent_comp = round(
        sum(m["compliance_score"] for m in mine_results.values()) / max(1, len(mine_results)),
        1,
    )
    ent_level, ent_tone = risk_band(ent_risk)
    compliance_label = (
        "EXCELLENT" if ent_comp >= 90 else "STRONG" if ent_comp >= 80 else "STABLE" if ent_comp >= 68 else "MARGINAL" if ent_comp >= 55 else "DEFICIENT"
    )

    return {
        "generated_at": str(store.data.get("computed", {}).get("generated_at", "")),
        "as_of": today.isoformat(),
        "history_days": int(store.data.get("history_days", 90) or 90),
        "zones": zone_results,
        "mines": mine_results,
        "history": history,
        "enterprise": {
            "risk_score": ent_risk,
            "risk_level": ent_level,
            "tone": ent_tone,
            "compliance_score": ent_comp,
            "compliance_label": compliance_label,
        },
    }


# ---------------------------------------------------------------------------
# Counterfactual simulation — "what happens if we do X"
# ---------------------------------------------------------------------------


def simulate(
    store,
    zone_id: str,
    *,
    close_violation_ids: Optional[List[str]] = None,
    resolve_action_ids: Optional[List[str]] = None,
    add_violation: Optional[Dict[str, Any]] = None,
    inspect_now: bool = False,
) -> Dict[str, Any]:
    """
    Re-run the real engine against a hypothetical state and report the delta.

    This is what makes the recommendation list quantitative instead of
    rhetorical: management sees how far risk actually falls if the three
    overdue actions are cleared, and an inspector sees the projected impact of
    a finding before submitting it. Same scoring code, same weights, no
    separate "estimate" formula anywhere.
    """
    from dataclasses import replace
    from datetime import date as _date

    from .risk_engine import InspectionRecord, ViolationRecord

    close_ids = set(close_violation_ids or [])
    resolve_ids = set(resolve_action_ids or [])
    today = _date.today()

    obs = next((o for o in store.observations(today) if o.zone_id == zone_id), None)
    if obs is None:
        raise KeyError(f"unknown zone {zone_id}")

    before = store.engine.scoring.score(obs)

    violations = [v for v in obs.violations if v.id not in close_ids]
    if add_violation:
        series = store.occurrence_index(today).get((zone_id, add_violation["category"]), [])
        violations = list(violations) + [
            ViolationRecord(
                id=add_violation.get("id", "DRAFT"),
                zone_id=zone_id,
                department=add_violation["department"],
                category=add_violation["category"],
                severity=add_violation["severity"],
                status="OPEN",
                description=add_violation.get("description", "Draft finding"),
                created_at=today,
                closed_at=None,
                occurrences=len(series) + 1,
            )
        ]

    actions = []
    for a in obs.actions:
        if a.id in resolve_ids and a.due_date and a.due_date < today:
            actions.append(replace(a, status="CLOSED", completed_at=today, due_date=today))
        else:
            actions.append(a)

    inspections = list(obs.inspections)
    if inspect_now:
        inspections.append(InspectionRecord(id="DRAFT-INSP", zone_id=zone_id, inspection_date=today, status="COMPLETED"))

    hypothetical = ZoneObservation(
        mine_id=obs.mine_id,
        zone_id=obs.zone_id,
        zone_name=obs.zone_name,
        zone_type=obs.zone_type,
        as_of=today,
        violations=tuple(violations),
        actions=tuple(actions),
        inspections=tuple(inspections),
        inspection_cadence_days=obs.inspection_cadence_days,
    )
    after = store.engine.scoring.score(hypothetical)

    factor_delta = [
        {
            "key": f.key,
            "label": f.label,
            "before": round(f.points, 1),
            "after": round(next(x.points for x in after.factors if x.key == f.key), 1),
        }
        for f in before.factors
    ]
    return {
        "zone_id": zone_id,
        "zone_name": obs.zone_name,
        "before": {"risk_score": before.score, "risk_level": before.level},
        "after": {"risk_score": after.score, "risk_level": after.level},
        "delta": round(after.score - before.score, 1),
        "factor_delta": [f for f in factor_delta if abs(f["after"] - f["before"]) >= 0.05],
        "after_factors": [f.as_dict() for f in after.factors],
        "after_drivers": after.drivers,
        "note": (
            "Re-scored with the live risk engine against the hypothetical state — not a separate estimate."
        ),
    }

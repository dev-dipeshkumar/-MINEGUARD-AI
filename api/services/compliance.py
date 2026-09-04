"""
MINEGUARD AI — Compliance scoring.

Compliance answers a different question from risk:

    Compliance  = "is our process being run properly right now?"
    Risk        = "how likely is this to become a serious problem?"

They are calculated independently and are deliberately non-symmetric. A zone
can have excellent register discipline while carrying one severe, ageing
finding — high compliance, high risk — and the product surfaces that gap
instead of averaging it away, because the management response to the two is
completely different.

Components (all measured, none asserted):
  * SLA adherence        — is each open finding inside its severity-based window?
  * Corrective follow-thru — overdue / submitted-but-unverified actions
  * Inspection cadence   — elapsed time against the statutory cadence
  * Evidence completeness— share of open findings with attached evidence
  * Regulatory reporting — is the statutory return current for the site?
Credits are earned, not defaulted: recent verification activity and clean
windows lift the score; nothing is added for records that do not exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, List, Sequence

from .risk_engine import ZoneObservation

SLA_DAYS = {"CRITICAL": 3, "HIGH": 7, "MEDIUM": 14, "LOW": 30}
PENALTY_CAPS = {
    "closure": 22.0,
    "late_closure": 6.0,
    "overdue": 18.0,
    "verification": 6.0,
    "cadence": 12.0,
    "documentation": 12.0,
    "reporting": 5.0,
}
CREDIT_CAPS = {"clean_window": 5.0, "on_time": 8.0}


@dataclass
class ComplianceBreakdown:
    score: float
    components: List[dict]

    def as_dict(self) -> dict:
        return {"compliance_score": round(self.score, 1), "components": self.components}


def calculate_compliance(
    obs: ZoneObservation,
    *,
    total_violations_90d: int,
    closed_in_window: int,
    evidence_compliance: float,
    reporting_current: bool,
) -> ComplianceBreakdown:
    """Process-discipline score, 0-100 (higher is better)."""
    today = obs.as_of
    open_v = obs.open_violations()

    # -- SLA adherence ------------------------------------------------------
    breaches = 0
    at_risk = 0
    for v in open_v:
        allowed = SLA_DAYS.get(v.severity, 14)
        age = max(0, (today - v.created_at).days)
        if age > allowed:
            breaches += 1
        elif age >= allowed * 0.7:
            at_risk += 1
    closure_penalty = min(PENALTY_CAPS["closure"], breaches * 4.0 + at_risk * 1.0)

    # -- closures that were late -------------------------------------------
    late_closures = 0
    on_time_closures = 0
    for v in obs.violations:
        if v.status == "CLOSED" and v.closed_at:
            allowed = SLA_DAYS.get(v.severity, 14)
            if (v.closed_at - v.created_at).days > allowed + 2:
                late_closures += 1
            else:
                on_time_closures += 1
    late_penalty = min(PENALTY_CAPS["late_closure"], late_closures * 1.5)

    # -- corrective follow-through -----------------------------------------
    overdue = obs.overdue_actions()
    overdue_raw = sum(2.0 + days * 0.06 for _a, days in overdue)
    overdue_penalty = min(PENALTY_CAPS["overdue"], overdue_raw)
    waiting = [
        a
        for a in obs.actions
        if a.status == "SUBMITTED" and a.completed_at and (today - a.completed_at).days > 2
    ]
    verification_penalty = min(PENALTY_CAPS["verification"], len(waiting) * 2.0)

    # -- cadence ------------------------------------------------------------
    days_since = obs.days_since_inspection()
    cadence = obs.inspection_cadence_days
    if days_since is None:
        cadence_penalty = PENALTY_CAPS["cadence"]
    else:
        cadence_penalty = min(PENALTY_CAPS["cadence"], max(0.0, (days_since - cadence * 0.8)) / max(1, cadence) * 10.0)

    # -- documentation and reporting ---------------------------------------
    documentation_penalty = min(PENALTY_CAPS["documentation"], (1.0 - evidence_compliance) * 24.0)
    reporting_penalty = 0.0 if reporting_current else PENALTY_CAPS["reporting"]

    # -- earned credits -----------------------------------------------------
    window_start = today - timedelta(days=90)
    in_window = [v for v in obs.violations if v.created_at >= window_start]
    clean_credit = CREDIT_CAPS["clean_window"] if not in_window else 0.0
    on_time_credit = min(CREDIT_CAPS["on_time"], on_time_closures * 1.5)

    total = (
        100.0
        - closure_penalty
        - late_penalty
        - overdue_penalty
        - verification_penalty
        - cadence_penalty
        - documentation_penalty
        - reporting_penalty
        + clean_credit
        + on_time_credit
    )
    # Assurance discount: a zone nobody has walked recently cannot claim a
    # perfect process score, even when its paperwork is clean.
    if days_since is None or days_since > cadence * 0.6:
        total *= 0.985
    score = max(0.0, min(100.0, total))

    components = [
        {
            "key": "closure",
            "label": "Open findings inside SLA",
            "value": f"{len(open_v) - breaches} of {len(open_v)} within window" if open_v else "no open findings",
            "penalty": round(closure_penalty, 1),
            "detail": f"{breaches} breached, {at_risk} approaching their window.",
        },
        {
            "key": "overdue",
            "label": "Overdue corrective actions",
            "value": f"{len(overdue)} past due date",
            "penalty": round(overdue_penalty, 1),
            "detail": f"{len(waiting)} submitted and awaiting verification.",
        },
        {
            "key": "cadence",
            "label": "Inspection schedule adherence",
            "value": "no inspection on record" if days_since is None else f"{days_since}d elapsed of {cadence}d cadence",
            "penalty": round(cadence_penalty, 1),
            "detail": "Cadence is set by zone hazard class.",
        },
        {
            "key": "documentation",
            "label": "Evidence completeness",
            "value": f"{evidence_compliance * 100:.0f}% of open findings have evidence",
            "penalty": round(documentation_penalty, 1),
            "detail": "Photograph, register scan or signed note.",
        },
        {
            "key": "reporting",
            "label": "Regulatory return currency",
            "value": "current" if reporting_current else "one return outstanding",
            "penalty": round(reporting_penalty, 1),
            "detail": "Half-yearly and annual returns for the site.",
        },
    ]
    if late_closures:
        components.append(
            {
                "key": "late_closure",
                "label": "Closures completed outside SLA",
                "value": f"{late_closures} late closure(s)",
                "penalty": round(late_penalty, 1),
                "detail": "Closed, but after the permitted window.",
            }
        )
    if clean_credit or on_time_credit:
        components.append(
            {
                "key": "credit",
                "label": "Verification credit",
                "value": f"{on_time_closures} on-time closure(s)" + (", clean 90-day window" if clean_credit else ""),
                "penalty": round(-(clean_credit + on_time_credit), 1),
                "detail": "Earned by demonstrably closing work, not by absence of findings.",
            }
        )

    return ComplianceBreakdown(score=score, components=components)


def aggregate_compliance(zone_scores: Sequence[float], weights: Sequence[float] | None = None) -> float:
    if not zone_scores:
        return 0.0
    if weights is None:
        weights = [1.0] * len(zone_scores)
    total = sum(weights) or 1.0
    return round(sum(w * s for w, s in zip(weights, zone_scores)) / total, 1)

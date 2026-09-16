"""
MINEGUARD AI — Compliance Risk Engine
=====================================

Single source of truth for risk scoring. Nothing in the API layer or the
frontend performs scoring arithmetic: every score shown in the product comes
from this module, which is why the same zone always reports the same number on
every screen and in every report.

Layered design (so rule-based scoring can be replaced by a trained model)
-------------------------------------------------------------------------
    RiskScoringStrategy (protocol)
        ├── RuleBasedRiskScoringStrategy   ← Phase 1, shipped
        └── MLModelRiskScoringStrategy     ← Phase 2, contract only

A strategy consumes `ZoneObservation` (an immutable feature snapshot for one
mine zone at a point in time) and returns `RiskAssessment` (score, band,
factor decomposition, plain-language drivers, recommended actions).

The exact same records the rules read are what a model would be trained on, so
Phase 2 is a strategy swap in `create_engine()` plus historical re-scoring —
not a rewrite. `score_batch()` is stateless and vector-friendly for that.

Scoring model
-------------
    risk_score = min(100, severity + repeat + unresolved + overdue + inspection_delay)

Each factor is a capped-linear function of an exposure raw value:

  * capped  → no single driver can put a zone in "critical" alone;
  * linear  → one more violation, one more overdue action, or one more delayed
              inspection still moves the score. A compliance score that stops
              responding to reality is worse than no score at all.

Coefficients are the calibration surface. They were tuned so the seeded
enterprise baseline lands in the documented bands; the raw factor values are
returned alongside every score so the tuning is auditable, not a black box.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Protocol, Sequence, Tuple

# ---------------------------------------------------------------------------
# Tunables — the single place where the model is re-balanced
# ---------------------------------------------------------------------------

SEVERITY_WEIGHTS: Dict[str, int] = {"LOW": 10, "MEDIUM": 25, "HIGH": 50, "CRITICAL": 80}

# Repeat-violation ladder from the spec (1st=10, 2nd=20, 3rd=35, more=55).
REPEAT_OCCURRENCE_WEIGHTS: Dict[int, int] = {1: 10, 2: 20, 3: 35}
REPEAT_OCCURRENCE_WEIGHT_EXTRA = 55

# Unresolved-age impact bands (0-7 / 8-15 / 16-30 / 30+ days).
AGING_LOW_MAX, AGING_LOW_W = 7, 5
AGING_MOD_MAX, AGING_MOD_W = 15, 12
AGING_HIGH_MAX, AGING_HIGH_W = 30, 25
AGING_CRIT_W = 45

FACTOR_CAPS: Dict[str, float] = {
    "severity": 45.0,
    "repeat": 20.0,
    "unresolved": 25.0,
    "overdue": 15.0,
    "inspection_delay": 12.0,
}

FACTOR_COEFFS: Dict[str, float] = {
    "severity": 0.09,
    "repeat": 0.05,
    "unresolved": 0.12,
    "overdue_count": 1.5,
    "overdue_days": 0.35,
    "inspection_per_day": 1.1,
    "inspection_missing": 4.0,
}

DEFAULT_INSPECTION_CADENCE_DAYS = 21

RISK_BANDS: Tuple[Tuple[int, str, str], ...] = (
    (20, "LOW", "low"),
    (40, "MODERATE", "moderate"),
    (60, "ELEVATED", "elevated"),
    (80, "HIGH", "high"),
    (100, "CRITICAL", "critical"),
)

FACTOR_LABELS: Dict[str, str] = {
    "severity": "Violation Severity",
    "repeat": "Repeat Violations",
    "unresolved": "Unresolved Issues",
    "overdue": "Overdue Corrective Actions",
    "inspection_delay": "Inspection Delay",
}


def aging_weight(age_days: int) -> int:
    """
    Ageing band weight for a single unresolved finding.

    Shared by the unresolved factor and by `attribute_contributions`, so the
    number in the violation register can never drift from the score above it.
    """
    if age_days <= AGING_LOW_MAX:
        return AGING_LOW_W
    if age_days <= AGING_MOD_MAX:
        return AGING_MOD_W
    if age_days <= AGING_HIGH_MAX:
        return AGING_HIGH_W
    return AGING_CRIT_W


def attribute_contributions(obs: "ZoneObservation", factors: Mapping[str, float]) -> Dict[str, float]:
    """
    Apportion a zone's live factor points back onto the records that produced them.

    Every violation-centre row quotes a "risk contribution". It has to be a slice of
    the zone score shown on the same screen, so each record-driven factor is split in
    proportion to the *same raw quantities* the factor is computed from — severity
    exposure, ageing band, repeat depth and overdue action weight. Nothing is invented
    here, and `inspection_delay` is deliberately left out because it belongs to the
    zone's calendar rather than to any single finding.
    """
    open_v = obs.open_violations()
    if not open_v:
        return {}
    out: Dict[str, float] = {}

    def apportion(points: float, weights: Sequence[float]) -> None:
        total = float(sum(weights))
        if points <= 0 or total <= 0:
            return
        for v, w in zip(open_v, weights):
            if w <= 0:
                continue
            out[v.id] = out.get(v.id, 0.0) + points * (float(w) / total)

    apportion(factors.get("severity", 0.0), [SEVERITY_WEIGHTS.get(v.severity, 15) for v in open_v])
    apportion(
        factors.get("unresolved", 0.0),
        [aging_weight(max(0, (obs.as_of - v.created_at).days)) for v in open_v],
    )
    apportion(
        factors.get("repeat", 0.0),
        [
            REPEAT_OCCURRENCE_WEIGHTS.get(v.occurrences, REPEAT_OCCURRENCE_WEIGHT_EXTRA) if v.occurrences >= 2 else 0.0
            for v in open_v
        ],
    )
    # Mirrors the overdue factor's raw = count*10 + days*2, grouped onto the violation
    # that owns the action, so closing the action is what removes the weight.
    overdue_weight: Dict[str, float] = {}
    for action, days in obs.overdue_actions():
        if action.violation_id:
            overdue_weight[action.violation_id] = overdue_weight.get(action.violation_id, 0.0) + 10.0 + 2.0 * days
    apportion(factors.get("overdue", 0.0), [overdue_weight.get(v.id, 0.0) for v in open_v])

    return {k: round(v, 1) for k, v in sorted(out.items(), key=lambda kv: -kv[1])}


def risk_band(score: float) -> Tuple[str, str]:
    """Return (level, tone) for a 0-100 score."""
    for upper, label, tone in RISK_BANDS:
        if score <= upper:
            return label, tone
    return "CRITICAL", "critical"


def risk_level(score: float) -> str:
    return risk_band(score)[0]


def risk_tone(score: float) -> str:
    return risk_band(score)[1]


# ---------------------------------------------------------------------------
# Records (the engine's inputs / outputs)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ViolationRecord:
    id: str
    zone_id: str
    department: str
    category: str
    severity: str
    status: str
    description: str
    created_at: date
    closed_at: Optional[date] = None
    occurrences: int = 1

    @property
    def is_open(self) -> bool:
        return self.status != "CLOSED"

    def open_on(self, day: date) -> bool:
        if self.created_at > day:
            return False
        if self.status == "CLOSED":
            return self.closed_at is not None and self.closed_at > day
        return True


@dataclass(frozen=True)
class ActionRecord:
    id: str
    violation_id: str
    zone_id: str
    status: str
    due_date: Optional[date] = None
    completed_at: Optional[date] = None

    @property
    def is_open(self) -> bool:
        return self.status not in {"CLOSED", "REJECTED"}

    def open_on(self, day: date) -> bool:
        if not self.is_open:
            return False
        return True


@dataclass(frozen=True)
class InspectionRecord:
    id: str
    zone_id: str
    inspection_date: date
    status: str


@dataclass
class ZoneObservation:
    """Feature snapshot for one zone — the model input."""

    mine_id: str
    zone_id: str
    zone_name: str
    zone_type: str
    as_of: date
    violations: Sequence[ViolationRecord] = field(default_factory=tuple)
    actions: Sequence[ActionRecord] = field(default_factory=tuple)
    inspections: Sequence[InspectionRecord] = field(default_factory=tuple)
    inspection_cadence_days: int = DEFAULT_INSPECTION_CADENCE_DAYS
    critical_multiplier: float = 1.0

    def open_violations(self) -> List[ViolationRecord]:
        return [v for v in self.violations if v.open_on(self.as_of)]

    def overdue_actions(self) -> List[Tuple[ActionRecord, int]]:
        out: List[Tuple[ActionRecord, int]] = []
        for a in self.actions:
            if not a.open_on(self.as_of) or a.due_date is None:
                continue
            if a.completed_at is not None and a.completed_at >= self.as_of:
                continue
            days = (self.as_of - a.due_date).days
            if days > 0:
                out.append((a, days))
        return out

    def open_actions(self) -> List[ActionRecord]:
        return [a for a in self.actions if a.open_on(self.as_of)]

    def days_since_inspection(self) -> Optional[int]:
        dates = [i.inspection_date for i in self.inspections if i.inspection_date <= self.as_of]
        if not dates:
            return None
        return max(0, (self.as_of - max(dates)).days)


@dataclass
class RiskFactor:
    key: str
    label: str
    points: float
    cap: float
    raw: float
    detail: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "points": round(self.points, 1),
            "cap": self.cap,
            "raw": round(self.raw, 1),
            "detail": self.detail,
            "share": round((self.points / self.cap) * 100) if self.cap else 0,
        }


@dataclass
class RiskAssessment:
    zone_id: str
    mine_id: str
    as_of: date
    score: float
    level: str
    tone: str
    factors: List[RiskFactor]
    drivers: List[str]
    recommended_actions: List[dict[str, str]]
    metrics: dict[str, Any]
    method: str = "rule-based-v1"

    def as_dict(self) -> dict[str, Any]:
        return {
            "zone_id": self.zone_id,
            "mine_id": self.mine_id,
            "as_of": self.as_of.isoformat(),
            "risk_score": self.score,
            "risk_level": self.level,
            "tone": self.tone,
            "factors": [f.as_dict() for f in self.factors],
            "drivers": self.drivers,
            "recommended_actions": self.recommended_actions,
            "metrics": self.metrics,
            "method": self.method,
        }


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


class RiskScoringStrategy(Protocol):
    name: str

    def score(self, observation: ZoneObservation) -> RiskAssessment:
        ...

    def score_batch(self, observations: Iterable[ZoneObservation]) -> List[RiskAssessment]:
        ...


def _capped(raw: float, cap: float) -> float:
    return max(0.0, min(cap, raw))


class RuleBasedRiskScoringStrategy:
    """Explainable rule-based risk intelligence (Phase 1)."""

    name = "rule-based-v1"

    def score_batch(self, observations: Iterable[ZoneObservation]) -> List[RiskAssessment]:
        return [self.score(o) for o in observations]

    # -- factors -----------------------------------------------------------

    @staticmethod
    def _severity(open_v: Sequence[ViolationRecord]) -> Tuple[float, float, str]:
        raw = float(sum(SEVERITY_WEIGHTS.get(v.severity, 15) for v in open_v))
        points = _capped(raw * FACTOR_COEFFS["severity"], FACTOR_CAPS["severity"])
        if not open_v:
            return points, raw, "No open violations recorded in this zone."
        counts: Dict[str, int] = {}
        for v in open_v:
            counts[v.severity] = counts.get(v.severity, 0) + 1
        parts = ", ".join(
            f"{counts[s]} {s.lower()}" for s in ("CRITICAL", "HIGH", "MEDIUM", "LOW") if counts.get(s)
        )
        return points, raw, f"{len(open_v)} open violations ({parts}) — severity exposure {raw:.0f}."

    @staticmethod
    def _repeat(open_v: Sequence[ViolationRecord]) -> Tuple[float, float, str]:
        repeats = [v for v in open_v if v.occurrences >= 2]
        raw = float(sum(REPEAT_OCCURRENCE_WEIGHTS.get(v.occurrences, REPEAT_OCCURRENCE_WEIGHT_EXTRA) for v in repeats))
        points = _capped(raw * FACTOR_COEFFS["repeat"], FACTOR_CAPS["repeat"])
        if not repeats:
            return points, raw, "No repeat violations in the current exposure window."
        cats: Dict[str, int] = {}
        for v in repeats:
            cats[v.category] = max(cats.get(v.category, 0), v.occurrences)
        worst_cat, worst_n = max(cats.items(), key=lambda kv: kv[1])
        return points, raw, (
            f"{len(repeats)} violation(s) are repeat occurrences across {len(cats)} category(ies). "
            f"Worst: {worst_cat} — {worst_n}x recurrence."
        )

    @staticmethod
    def _unresolved(open_v: Sequence[ViolationRecord], as_of: date) -> Tuple[float, float, str, Dict[str, int]]:
        raw = 0.0
        buckets = {"d0_7": 0, "d8_15": 0, "d16_30": 0, "d30p": 0}
        oldest = 0
        for v in open_v:
            age = max(0, (as_of - v.created_at).days)
            oldest = max(oldest, age)
            weight = aging_weight(age)
            raw += weight
            buckets["d0_7" if age <= AGING_LOW_MAX else "d8_15" if age <= AGING_MOD_MAX else "d16_30" if age <= AGING_HIGH_MAX else "d30p"] += 1
        points = _capped(raw * FACTOR_COEFFS["unresolved"], FACTOR_CAPS["unresolved"])
        if not open_v:
            return points, raw, "Nothing unresolved.", buckets
        detail = (
            f"{len(open_v)} unresolved: {buckets['d0_7']} within 7 days, {buckets['d8_15']} at 8-15 days, "
            f"{buckets['d16_30']} at 16-30 days, {buckets['d30p']} beyond 30 days (oldest {oldest}d)."
        )
        return points, raw, detail, buckets

    @staticmethod
    def _overdue(obs: ZoneObservation) -> Tuple[float, float, str, int]:
        overdue = obs.overdue_actions()
        if not overdue:
            return 0.0, 0.0, "No corrective actions past their due date.", 0
        total_days = sum(d for _, d in overdue)
        worst = max(d for _, d in overdue)
        raw = float(len(overdue) * 10 + total_days * 2)
        points = _capped(
            len(overdue) * FACTOR_COEFFS["overdue_count"] + total_days * FACTOR_COEFFS["overdue_days"],
            FACTOR_CAPS["overdue"],
        )
        ids = ", ".join(a.id for a, _ in overdue[:3])
        detail = f"{len(overdue)} corrective action(s) overdue ({ids}), longest {worst} days."
        return points, raw, detail, worst

    @staticmethod
    def _inspection_delay(obs: ZoneObservation, days_since: Optional[int]) -> Tuple[float, float, str]:
        cadence = obs.inspection_cadence_days
        if days_since is None:
            raw = FACTOR_COEFFS["inspection_missing"] * 10
            points = _capped(FACTOR_COEFFS["inspection_missing"] * 2.5, FACTOR_CAPS["inspection_delay"])
            return points, raw, "No inspection on record for this zone."
        excess = days_since - cadence
        raw = float(excess * 10) if excess > 0 else 0.0
        points = _capped(
            max(0.0, excess) * FACTOR_COEFFS["inspection_per_day"] + max(0.0, days_since - cadence * 0.75) * 0.15,
            FACTOR_CAPS["inspection_delay"],
        )
        if excess > 0:
            detail = f"Last inspection {days_since}d ago against a {cadence}d cadence — {excess}d overdue."
        elif days_since > cadence * 0.75:
            detail = f"Inspection due soon: {days_since}d elapsed of a {cadence}d cadence."
        else:
            detail = f"Inspection cadence met ({days_since}d since last, cadence {cadence}d)."
        return points, raw, detail

    # -- explanation -------------------------------------------------------

    @staticmethod
    def _drivers(metrics: Dict[str, Any]) -> List[str]:
        out: List[str] = []
        if metrics["critical_violations"]:
            out.append(
                f"{metrics['critical_violations']} CRITICAL severity violation"
                f"{'s are' if metrics['critical_violations'] != 1 else ' is'} open right now."
            )
        if metrics["high_violations"]:
            out.append(f"{metrics['high_violations']} HIGH severity finding(s) are unresolved.")
        if metrics["repeat_violations"]:
            out.append(
                f"{metrics['repeat_violations']} of these are repeat occurrences — corrective action from the "
                "previous cycle did not hold."
            )
        if metrics["unresolved_30_plus"]:
            out.append(
                f"{metrics['unresolved_30_plus']} issue(s) have been open for more than 30 days, past the "
                "escalation threshold."
            )
        if metrics["overdue_action_count"]:
            out.append(
                f"{metrics['overdue_action_count']} corrective action(s) are overdue by up to "
                f"{metrics['max_overdue_days']} days."
            )
        if metrics["inspection_overdue"]:
            days_since = metrics["days_since_inspection"]
            if days_since is None:
                out.append("No inspection on record for this zone, so no control in it is currently verified.")
            else:
                out.append(
                    f"The zone is {days_since - metrics['inspection_cadence_days']} day(s) past its mandatory "
                    "inspection cadence, so controls are unverified."
                )
        if metrics["violations_30d"] >= 3:
            out.append(
                f"Violation velocity: {metrics['violations_30d']} logged in the last 30 days "
                f"(previous 30: {metrics['violations_prev_30d']})."
            )
        if metrics["departments"]:
            out.append(f"Exposure spans {len(metrics['departments'])} department(s): {', '.join(metrics['departments'])}.")
        return out

    @staticmethod
    def _recommendations(metrics: Dict[str, Any], zone_name: str, level: str) -> List[dict[str, str]]:
        recs: List[dict[str, str]] = []
        immediate = level in {"CRITICAL", "HIGH"}
        if metrics["critical_violations"] or immediate:
            recs.append(
                {
                    "priority": "immediate",
                    "action": f"Conduct an immediate targeted safety inspection of {zone_name}.",
                    "owner_hint": "Field Inspector",
                }
            )
        if metrics["overdue_action_count"]:
            recs.append(
                {
                    "priority": "immediate" if immediate else "high",
                    "action": f"Escalate {metrics['overdue_action_count']} overdue corrective action"
                    f"{'s' if metrics['overdue_action_count'] != 1 else ''} to the responsible officer and set a "
                    "48-hour completion target.",
                    "owner_hint": "Department Officer",
                }
            )
        if metrics["repeat_violations"]:
            recs.append(
                {
                    "priority": "high",
                    "action": "Open a root-cause review on the recurring violation category — replacement alone has "
                    "not stopped recurrence.",
                    "owner_hint": "Mine Manager",
                }
            )
        if metrics["unresolved_30_plus"]:
            recs.append(
                {
                    "priority": "high",
                    "action": f"Close or formally extend {metrics['unresolved_30_plus']} long-aged issue(s) with a "
                    "documented justification.",
                    "owner_hint": "Mine Manager",
                }
            )
        if metrics["inspection_overdue"]:
            recs.append(
                {
                    "priority": "medium",
                    "action": "Restore the statutory inspection cadence for this zone within 7 days.",
                    "owner_hint": "Field Inspector",
                }
            )
        recs.append(
            {
                "priority": "medium",
                "action": f"Schedule a verification re-inspection of {zone_name} within 7 days of closure to confirm "
                "risk reduction.",
                "owner_hint": "Field Inspector",
            }
        )
        return recs

    # -- entry point ---------------------------------------------------------

    def score(self, obs: ZoneObservation) -> RiskAssessment:
        open_v = obs.open_violations()
        days_since = obs.days_since_inspection()

        sev_pts, sev_raw, sev_detail = self._severity(open_v)
        rep_pts, rep_raw, rep_detail = self._repeat(open_v)
        un_pts, un_raw, un_detail, buckets = self._unresolved(open_v, obs.as_of)
        ovd_pts, ovd_raw, ovd_detail, max_overdue = self._overdue(obs)
        insp_pts, insp_raw, insp_detail = self._inspection_delay(obs, days_since)

        total = sev_pts + rep_pts + un_pts + ovd_pts + insp_pts
        score = round(max(0.0, min(100.0, total)), 1)
        level, tone = risk_band(score)

        window_now = obs.as_of
        last30_start = window_now - timedelta(days=30)
        prev30_start = window_now - timedelta(days=60)
        recent = [v for v in obs.violations if last30_start <= v.created_at <= window_now]
        previous = [v for v in obs.violations if prev30_start <= v.created_at < last30_start]

        metrics: Dict[str, Any] = {
            "open_violations": len(open_v),
            "critical_violations": sum(1 for v in open_v if v.severity == "CRITICAL"),
            "high_violations": sum(1 for v in open_v if v.severity == "HIGH"),
            "violations_30d": len(recent),
            "violations_prev_30d": len(previous),
            "repeat_violations": sum(1 for v in open_v if v.occurrences >= 2),
            "open_action_count": len(obs.open_actions()),
            "overdue_action_count": len(obs.overdue_actions()),
            "max_overdue_days": max_overdue,
            "unresolved_30_plus": buckets["d30p"],
            "days_since_inspection": days_since,
            "inspection_cadence_days": obs.inspection_cadence_days,
            "inspection_overdue": bool(days_since is None or days_since > obs.inspection_cadence_days),
            "departments": sorted({v.department for v in open_v}),
            "severity_exposure": sum(SEVERITY_WEIGHTS.get(v.severity, 15) for v in open_v),
            "target_exposure": SEVERITY_EXPOSURE_TARGET,
            "factor_points": {
                "severity": round(sev_pts, 1),
                "repeat": round(rep_pts, 1),
                "unresolved": round(un_pts, 1),
                "overdue": round(ovd_pts, 1),
                "inspection_delay": round(insp_pts, 1),
            },
        }

        factors = [
            RiskFactor("severity", FACTOR_LABELS["severity"], sev_pts, FACTOR_CAPS["severity"], sev_raw, sev_detail),
            RiskFactor("repeat", FACTOR_LABELS["repeat"], rep_pts, FACTOR_CAPS["repeat"], rep_raw, rep_detail),
            RiskFactor("unresolved", FACTOR_LABELS["unresolved"], un_pts, FACTOR_CAPS["unresolved"], un_raw, un_detail),
            RiskFactor("overdue", FACTOR_LABELS["overdue"], ovd_pts, FACTOR_CAPS["overdue"], ovd_raw, ovd_detail),
            RiskFactor(
                "inspection_delay",
                FACTOR_LABELS["inspection_delay"],
                insp_pts,
                FACTOR_CAPS["inspection_delay"],
                insp_raw,
                insp_detail,
            ),
        ]

        return RiskAssessment(
            zone_id=obs.zone_id,
            mine_id=obs.mine_id,
            as_of=obs.as_of,
            score=score,
            level=level,
            tone=tone,
            factors=factors,
            drivers=self._drivers(metrics),
            recommended_actions=self._recommendations(metrics, obs.zone_name, level),
            metrics=metrics,
            method=f"{self.name} · 5 factors · capped-linear · normalised 0-100",
        )


SEVERITY_EXPOSURE_TARGET = 400  # reference exposure for a fully saturated zone


class MLModelRiskScoringStrategy:  # pragma: no cover — Phase 2 contract
    """
    Phase 2 slot. A trained model (gradient boosting classifier or time-series
    forecaster) would be loaded here and consume the identical
    `ZoneObservation` features.

    Deliberately raises rather than silently falling back: the product must
    never claim a model is behind a number when rules are. The API reports
    `engine.mode` so the UI can label every score truthfully.
    """

    name = "ml-v0"

    def __init__(self, model_path: Optional[str] = None) -> None:
        self.model_path = model_path

    def score(self, observation: ZoneObservation) -> RiskAssessment:
        raise NotImplementedError(
            "ML scorer is not trained — insufficient labelled closure history for production use. "
            "Phase 1 rule-based scoring is active and is labelled as such in the UI."
        )

    def score_batch(self, observations: Iterable[ZoneObservation]) -> List[RiskAssessment]:
        raise NotImplementedError("ML scorer is not trained.")


def describe_engine(engine: Any) -> Dict[str, Any]:
    """
    The scoring model as deployed, as data.

    One function builds this for both `/api/bootstrap` and `/api/config`, because the admin
    page and the risk-intelligence page must not be able to disagree about which weights are
    live — and neither of them may restate the numbers the engine actually uses.
    """
    return {
        "mode": engine.mode,
        "label": engine.label,
        "phase": engine.phase,
        "factors": [
            {
                "key": k,
                "label": FACTOR_LABELS[k],
                "weight_cap": FACTOR_CAPS[k],
                "coefficient": FACTOR_COEFFS.get(k)
                or (FACTOR_COEFFS["overdue_count"] if k == "overdue" else None),
            }
            for k in FACTOR_LABELS
        ],
        "bands": [{"max": b[0], "label": b[1], "tone": b[2]} for b in RISK_BANDS],
        "severity_weights": SEVERITY_WEIGHTS,
        "repeat_ladder": REPEAT_OCCURRENCE_WEIGHTS,
        "ageing_bands": {
            "0-7": AGING_LOW_W,
            "8-15": AGING_MOD_W,
            "16-30": AGING_HIGH_W,
            "30+": AGING_CRIT_W,
        },
    }


def create_engine(strategy: str = "rule-based") -> RiskScoringStrategy:
    """Provider used by the API layer — the only place a strategy is chosen."""
    if strategy in {"ml", "ml-v0"}:
        return MLModelRiskScoringStrategy()
    return RuleBasedRiskScoringStrategy()


# ---------------------------------------------------------------------------
# Aggregation: zone → mine → enterprise
# ---------------------------------------------------------------------------


def aggregate_mine_score(assessments: Sequence[RiskAssessment], critical_zones: int = 0) -> float:
    """
    Mine risk is exposure weighted, not a plain average: a zone carrying many
    open critical findings contributes more of the site score, and any critical
    zone lifts the site floor — one genuinely critical zone means the site is
    not fine.
    """
    if not assessments:
        return 0.0
    weights = [
        1.0 + 0.04 * a.metrics.get("open_violations", 0) + 0.30 * a.metrics.get("critical_violations", 0)
        for a in assessments
    ]
    total = sum(weights) or 1.0
    weighted = sum(w * a.score for w, a in zip(weights, assessments)) / total
    worst = max(a.score for a in assessments)
    blended = 0.6 * weighted + 0.4 * worst
    if critical_zones:
        blended = max(blended, 62.0 + 3.0 * (critical_zones - 1))
    return round(max(0.0, min(100.0, blended)), 1)


def aggregate_enterprise_score(mine_scores: Sequence[float]) -> float:
    if not mine_scores:
        return 0.0
    return round(sum(mine_scores) / len(mine_scores), 1)

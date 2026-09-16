"""
MINEGUARD AI — application state store.

The prototype runs on a file-backed JSON store instead of a live PostgreSQL
instance. The schema below is a 1:1 map of the SQL DDL in `docs/DATA_MODEL.md`
(same tables, columns and relationships), so moving to Postgres means replacing
this class with SQLAlchemy sessions — no service, router or UI change.

Two rules make the whole product consistent:

1. Reads never compute. Every score the API returns comes from `computed`,
   which `recompute()` fills by calling the risk engine.
2. Every mutation ends with `recompute()` + `persist()`, exactly as a trigger
   or background job would in production. That is why a violation created in
   the field is reflected in the mine score, the alert feed and the trend chart
   in the same request cycle.

Dates are stored relative to "today" at seed time, so a demo never shows
stale or future-dated sample data no matter what day it runs on.
"""

from __future__ import annotations

import bisect
import json
import os
import threading
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from .services.compliance import calculate_compliance
from .services.risk_engine import (
    SEVERITY_WEIGHTS,
    ActionRecord,
    InspectionRecord,
    RiskAssessment,
    ViolationRecord,
    ZoneObservation,
    aggregate_enterprise_score,
    aggregate_mine_score,
    create_engine,
    risk_band,
)

DATA_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "store.json"))
HISTORY_DAYS = int(os.environ.get("MINEGUARD_HISTORY_DAYS", "90"))
SEVERITY_ORDER = ("CRITICAL", "HIGH", "MEDIUM", "LOW")

VIOLATION_STATUSES: Tuple[str, ...] = (
    "OPEN",
    "ASSIGNED",
    "IN_PROGRESS",
    "ACTION_SUBMITTED",
    "UNDER_VERIFICATION",
    "CLOSED",
)
ACTION_STATUSES: Tuple[str, ...] = (
    "PENDING",
    "ASSIGNED",
    "IN_PROGRESS",
    "SUBMITTED",
    "VERIFIED",
    "REJECTED",
    "CLOSED",
)
# Which violation status each corrective-action status implies, so the two
# records can never drift apart.
ACTION_TO_VIOLATION_STATUS = {
    "PENDING": "OPEN",
    "ASSIGNED": "ASSIGNED",
    "IN_PROGRESS": "IN_PROGRESS",
    "SUBMITTED": "ACTION_SUBMITTED",
    "VERIFIED": "CLOSED",
    "REJECTED": "IN_PROGRESS",
    "CLOSED": "CLOSED",
}
ROLES: Tuple[str, ...] = ("INSPECTOR", "OFFICER", "MANAGER", "ADMIN")


def _days_ago(n: int, base: Optional[date] = None) -> date:
    return (base or date.today()) - timedelta(days=n)


def _to_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


@dataclass
class Engine:
    mode: str
    scoring: Any

    @property
    def label(self) -> str:
        if self.mode == "rule-based":
            return "Explainable rule-based risk intelligence"
        return "Trained predictive model"

    @property
    def phase(self) -> str:
        return "Phase 1 (deterministic, auditable)" if self.mode == "rule-based" else "Phase 2 (experimental)"


class Store:
    """One instance per API process, guarded by a re-entrant lock."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.engine = Engine(
            mode=os.environ.get("MINEGUARD_ENGINE", "rule-based"),
            scoring=create_engine(os.environ.get("MINEGUARD_ENGINE", "rule-based")),
        )
        self.data: Dict[str, Any] = {}
        self.seq: Dict[str, int] = {}
        self.load()

    # ------------------------------------------------------------------ ids
    def next_id(self, table: str, prefix: str, pad: int = 4) -> str:
        existing = {str(r.get("id", "")) for r in self.data.get(table, [])}
        counter = self.seq.get(table, 0)
        while True:
            counter += 1
            candidate = f"{prefix}-{counter:0{pad}d}"
            if candidate not in existing:
                self.seq[table] = counter
                return candidate

    # -------------------------------------------------------- persistence
    def load(self) -> None:
        if os.path.exists(DATA_PATH):
            try:
                with open(DATA_PATH, "r", encoding="utf-8") as fh:
                    payload = json.load(fh)
                if payload.get("seed_day") == date.today().isoformat() and payload.get("computed"):
                    self.data = payload
                    self.seq = payload.get("_seq", {})
                    self.recompute()  # cheap path: today's scores, no history rebuild
                    return
            except (json.JSONDecodeError, OSError, KeyError):
                pass
        self.seed()
        self.recompute()
        self.persist()

    def recompute(self, with_history: bool = True) -> None:
        """Re-score every zone from current state, then aggregate upward."""
        with self.lock:
            from .services.computed import compute_all

            self.data["computed"] = compute_all(self, with_history=with_history)
            self._refresh_columns()
            self.data["alerts"] = self._generate_alerts(date.today())
            self.data["insights"] = self._generate_insights(date.today())

    def _refresh_columns(self) -> None:
        computed = self.data["computed"]
        for z in self.data.get("zones", []):
            payload = computed["zones"].get(z["id"])
            if payload:
                z["risk_score"] = payload["risk"]["risk_score"]
                z["risk_level"] = payload["risk"]["risk_level"]
                z["risk_tone"] = payload["risk"]["tone"]
                z["compliance_score"] = payload["compliance"]["compliance_score"]
        contributions: dict = {}
        for payload in computed["zones"].values():
            contributions.update(payload.get("contributions") or {})
        for v in self.data.get("violations", []):
            # Denormalised read column, always a slice of the zone's own factor
            # points — the register and the map can therefore never disagree.
            v["risk_contribution"] = contributions.get(v["id"], 0.0)
        for m in self.data.get("mines", []):
            payload = computed["mines"].get(m["id"])
            if payload:
                m["risk_score"] = payload["risk_score"]
                m["risk_level"] = payload["risk_level"]
                m["compliance_score"] = payload["compliance_score"]

    def persist(self) -> None:
        os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
        out = deepcopy(self.data)
        out["_seq"] = self.seq
        out.pop("risk_history", None)  # history is rebuilt on load; keep the file small
        tmp = DATA_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(out, fh, default=str)
        os.replace(tmp, DATA_PATH)

    def reset(self) -> None:
        """Restore the deterministic demo scenario (used by RESET DEMO SCENARIO)."""
        with self.lock:
            self.seq = {}
            self.seed()
            self.recompute()
            self.persist()

    # ---------------------------------------------------------------- seed
    def seed(self) -> None:
        from .seed import build_seed

        self.data = build_seed()
        self.data["seed_day"] = date.today().isoformat()
        self._index_sequences()

    def _index_sequences(self) -> None:
        for table, _prefix in (
            ("inspections", "INSP"),
            ("violations", "VIO"),
            ("corrective_actions", "CA"),
            ("evidence", "EV"),
            ("documents", "DOC"),
            ("workflow_overrides", "OVR"),
        ):
            highest = 0
            for row in self.data.get(table, []):
                try:
                    highest = max(highest, int(str(row["id"]).split("-")[-1]))
                except (ValueError, IndexError):
                    continue
            self.seq[table] = highest

    # ------------------------------------------------------------- lookups
    def zones(self, mine_id: Optional[str] = None) -> List[dict]:
        return [z for z in self.data.get("zones", []) if mine_id is None or z["mine_id"] == mine_id]

    def zone(self, zone_id: str) -> Optional[dict]:
        return next((z for z in self.data["zones"] if z["id"] == zone_id), None)

    def mine(self, mine_id: str) -> Optional[dict]:
        return next((m for m in self.data["mines"] if m["id"] == mine_id), None)

    def user(self, user_id: str) -> Optional[dict]:
        return next((u for u in self.data.get("users", []) if u["id"] == user_id), None)

    def find(self, table: str, row_id: str) -> Optional[dict]:
        return next((r for r in self.data.get(table, []) if r.get("id") == row_id), None)

    def rows(self, table: str) -> List[dict]:
        return list(self.data.get(table, []))

    def violations_for(self, zone_id: Optional[str] = None, mine_id: Optional[str] = None) -> List[dict]:
        out = []
        for v in self.data.get("violations", []):
            if zone_id and v["zone_id"] != zone_id:
                continue
            if mine_id and v["mine_id"] != mine_id:
                continue
            out.append(v)
        return out

    def actions_for(self, zone_id: Optional[str] = None, mine_id: Optional[str] = None) -> List[dict]:
        out = []
        for a in self.data.get("corrective_actions", []):
            if zone_id and a.get("zone_id") != zone_id:
                continue
            if mine_id and a.get("mine_id") != mine_id:
                continue
            out.append(a)
        return out

    def evidence_for(self, violation_id: str) -> List[dict]:
        return [e for e in self.data.get("evidence", []) if e.get("violation_id") == violation_id]

    def log(self, actor: str, kind: str, message: str, entity: Optional[str] = None) -> None:
        activity = self.data.setdefault("activity", [])
        activity.append(
            {
                "id": f"ACT-{len(activity) + 1:05d}",
                "at": datetime.now().isoformat(timespec="seconds"),
                "actor_id": actor,
                "actor": (self.user(actor) or {}).get("name", actor),
                "kind": kind,
                "message": message,
                "entity": entity,
            }
        )
        self.data["activity"] = activity[-500:]

    def touch(self) -> None:
        """Re-score + persist after any mutation. Called by every write path."""
        self.recompute()
        self.persist()

    def counts(self) -> dict:
        c = self.data.get("computed", {})
        return {
            "mines": len(self.data.get("mines", [])),
            "zones": len(self.data.get("zones", [])),
            "inspections": len(self.data.get("inspections", [])),
            "violations": len(self.data.get("violations", [])),
            "corrective_actions": len(self.data.get("corrective_actions", [])),
            "evidence": len(self.data.get("evidence", [])),
            "documents": len(self.data.get("documents", [])),
            "history_rows": len(c.get("history", [])),
            "alerts": len(self.data.get("alerts", [])),
        }

    # --------------------------------------------------- engine input data
    def occurrence_index(self, as_of: Optional[date] = None) -> Dict[Tuple[str, str], List[str]]:
        """
        (zone, category) -> ordered violation ids. The position of a violation
        in that list IS its occurrence count — recurrence is derived from the
        record itself rather than from a box someone can leave unticked.
        """
        day = as_of or date.today()
        grouped: Dict[Tuple[str, str], List[Tuple[date, str]]] = {}
        for v in self.data.get("violations", []):
            key = (v["zone_id"], v["category"])
            created = _to_date(v["created_at"])
            if created <= day:
                grouped.setdefault(key, []).append((created, v["id"]))
        return {k: [i for _, i in sorted(v)] for k, v in grouped.items()}

    def observations(self, as_of: Optional[date] = None, mine_id: Optional[str] = None) -> List[ZoneObservation]:
        """Engine-ready feature snapshots for every zone, valid as of a date."""
        day = _to_date(as_of or date.today())
        occ = self.occurrence_index(day)

        vio_by_zone: Dict[str, List[ViolationRecord]] = {}
        for v in self.data.get("violations", []):
            ordinal = 1
            series = occ.get((v["zone_id"], v["category"]), [])
            if v["id"] in series:
                ordinal = series.index(v["id"]) + 1
            vio_by_zone.setdefault(v["zone_id"], []).append(
                ViolationRecord(
                    id=v["id"],
                    zone_id=v["zone_id"],
                    department=v["department"],
                    category=v["category"],
                    severity=v["severity"],
                    status=v["status"],
                    description=v["description"],
                    created_at=_to_date(v["created_at"]),
                    closed_at=_to_date(v["closed_at"]) if v.get("closed_at") else None,
                    occurrences=ordinal,
                )
            )

        act_by_zone: Dict[str, List[ActionRecord]] = {}
        for a in self.data.get("corrective_actions", []):
            act_by_zone.setdefault(a["zone_id"], []).append(
                ActionRecord(
                    id=a["id"],
                    violation_id=a["violation_id"],
                    zone_id=a["zone_id"],
                    status=a["status"],
                    due_date=_to_date(a["due_date"]) if a.get("due_date") else None,
                    completed_at=_to_date(a["completed_at"]) if a.get("completed_at") else None,
                )
            )

        insp_by_zone: Dict[str, List[InspectionRecord]] = {}
        for i in self.data.get("inspections", []):
            insp_by_zone.setdefault(i["zone_id"], []).append(
                InspectionRecord(
                    id=i["id"],
                    zone_id=i["zone_id"],
                    inspection_date=_to_date(i["inspection_date"]),
                    status=i["status"],
                )
            )

        out: List[ZoneObservation] = []
        for z in self.data.get("zones", []):
            if mine_id and z["mine_id"] != mine_id:
                continue
            out.append(
                ZoneObservation(
                    mine_id=z["mine_id"],
                    zone_id=z["id"],
                    zone_name=z["name"],
                    zone_type=z["zone_type"],
                    as_of=day,
                    violations=tuple(vio_by_zone.get(z["id"], [])),
                    actions=tuple(act_by_zone.get(z["id"], [])),
                    inspections=tuple(insp_by_zone.get(z["id"], [])),
                    inspection_cadence_days=z.get("inspection_cadence_days", 21),
                )
            )
        return out

    def evidence_coverage(self, zone_id: str, as_of: Optional[date] = None) -> float:
        day = _to_date(as_of or date.today())
        open_v = [
            v
            for v in self.data.get("violations", [])
            if v["zone_id"] == zone_id and v["status"] != "CLOSED" and _to_date(v["created_at"]) <= day
        ]
        if not open_v:
            return 1.0
        have = sum(1 for v in open_v if any(e.get("violation_id") == v["id"] for e in self.data.get("evidence", [])))
        return round(have / len(open_v), 3)

    def closure_stats(self, zone_id: str, as_of: date) -> Tuple[int, int]:
        start = as_of - timedelta(days=90)
        total = closed = 0
        for v in self.data.get("violations", []):
            if v["zone_id"] != zone_id:
                continue
            created = _to_date(v["created_at"])
            if not (start <= created <= as_of):
                continue
            total += 1
            if v["status"] == "CLOSED" and v.get("closed_at"):
                closed += 1
        return closed, total

    # ---------------------------------------------------- derived history
    def history_for(self, scope_id: str, days: int = 30) -> List[dict]:
        rows = [r for r in self.data.get("computed", {}).get("history", []) if r["scope_id"] == scope_id]
        return rows[-days:]

    def trend(self, scope_id: str, days: int = 30) -> dict:
        rows = self.history_for(scope_id, days)
        if not rows:
            return {"series": [], "change": 0.0, "change_pct": 0.0, "direction": "stable"}
        series = [{"date": r["date"], "risk": r["risk_score"], "compliance": r["compliance_score"]} for r in rows]
        first, last = series[0]["risk"], series[-1]["risk"]
        change = round(last - first, 1)
        pct = round((change / first * 100), 1) if first else 0.0
        direction = "rising" if change >= 3 else "falling" if change <= -3 else "stable"
        return {"series": series, "change": change, "change_pct": pct, "direction": direction}

    def zone_assessment(self, zone_id: str) -> Optional[dict]:
        return self.data.get("computed", {}).get("zones", {}).get(zone_id)

    def mine_computed(self, mine_id: str) -> Optional[dict]:
        return self.data.get("computed", {}).get("mines", {}).get(mine_id)

    @property
    def enterprise(self) -> dict:
        return self.data.get("computed", {}).get("enterprise", {})

    # ---------------------------------------------------------- alerting
    def _generate_alerts(self, today: date) -> List[dict]:
        from .services.alerts import build_alerts

        return build_alerts(self, today)

    def _generate_insights(self, today: date) -> List[dict]:
        from .services.insights import build_insights

        return build_insights(self, today)

    # ------------------------------------------------- write-path helpers
    def sync_violation_from_action(self, action: dict) -> dict:
        """Keep the violation and its corrective action in lock-step."""
        vio = self.find("violations", action["violation_id"])
        if not vio:
            return action
        mapped = ACTION_TO_VIOLATION_STATUS.get(action["status"])
        if mapped and vio["status"] != mapped:
            vio["status"] = mapped
            if mapped == "CLOSED":
                vio["closed_at"] = action.get("closed_at") or date.today().isoformat()
            else:
                vio["closed_at"] = None
        if action.get("assigned_to") and vio.get("assigned_to") != action["assigned_to"]:
            vio["assigned_to"] = action["assigned_to"]
        if action.get("due_date"):
            vio["due_date"] = action["due_date"]
        return action


store = Store()

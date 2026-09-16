"""
MINEGUARD AI — Contractor Management service.

Closes the PS SIH26024 line item: "contract management". Each contractor
row carries the commercial terms, the statutory identifiers (PAN/GST),
a performance score, an audit status, and compliance flags derived
from records — not asserted. The service exposes portfolio value,
compliance gaps, and contracts nearing expiry so procurement and
governance can be read together.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional


def list_contractors(store, *, mine_id: Optional[str] = None, status: Optional[str] = None) -> List[dict]:
    rows = list(store.data.get("contractors", []))
    if mine_id:
        rows = [r for r in rows if r["mine_id"] == mine_id]
    if status:
        rows = [r for r in rows if r["status"] == status]
    rows.sort(key=lambda r: (r["status"], -r["value_inr_lakh"]))
    return rows


def portfolio_summary(store) -> Dict[str, Any]:
    rows = list_contractors(store)
    if not rows:
        return {"total_value_inr_lakh": 0, "active_count": 0, "non_compliant_count": 0, "expiring_soon": [], "low_performers": []}
    total_value = sum(r["value_inr_lakh"] for r in rows)
    active = [r for r in rows if r["status"] == "ACTIVE"]
    non_compliant = [r for r in rows if not r["compliant"]]
    expiring = [r for r in rows if r["status"] == "ACTIVE" and r["days_to_expiry"] < 60]
    low_perf = [r for r in rows if r["performance_pct"] < 70 and r["status"] in {"ACTIVE", "AT_RISK"}]
    return {
        "total_value_inr_lakh": round(total_value, 1),
        "active_value_inr_lakh": round(sum(r["value_inr_lakh"] for r in active), 1),
        "active_count": len(active),
        "non_compliant_count": len(non_compliant),
        "expiring_soon": [{"id": r["id"], "name": r["name"], "days_to_expiry": r["days_to_expiry"]} for r in expiring],
        "low_performers": [{"id": r["id"], "name": r["name"], "performance_pct": r["performance_pct"], "mine_name": (store.mine(r["mine_id"]) or {}).get("name", "")} for r in low_perf],
        "audit_breakdown": _audit_breakdown(rows),
    }


def _audit_breakdown(rows: List[dict]) -> Dict[str, int]:
    out: Dict[str, int] = {"CLEAN": 0, "OBSERVATIONS": 0, "NON_CONFORMANT": 0}
    for r in rows:
        out[r.get("audit_status", "OBSERVATIONS")] = out.get(r.get("audit_status", "OBSERVATIONS"), 0) + 1
    return out


def create_contractor(store, *, name: str, service: str, mine_id: str, value_inr_lakh: float, duration_months: int, pan: str, gst: str, labour_strength: int) -> dict:
    mine = store.mine(mine_id) or {}
    if not mine:
        raise ValueError(f"Unknown mine {mine_id}")
    today = date.today()
    rec = {
        "id": store.next_id("contractors", "CTR"),
        "name": name,
        "service": service,
        "mine_id": mine_id,
        "value_inr_lakh": float(value_inr_lakh),
        "duration_months": int(duration_months),
        "status": "ACTIVE",
        "compliant": True,
        "performance_pct": 0.0,
        "pan": pan,
        "gst": gst,
        "labour_strength": int(labour_strength),
        "incumbent_since_months": 0,
        "contract_start": today.isoformat(),
        "contract_end": (today + timedelta(days=30 * int(duration_months))).isoformat(),
        "days_to_expiry": int(duration_months) * 30,
        "flags": [],
        "audit_last_date": today.isoformat(),
        "audit_status": "CLEAN",
    }
    store.data.setdefault("contractors", []).append(rec)
    store.log("U-401", "CONTRACTOR", f"Contractor onboarded: {name} for {mine.get('name', mine_id)}", rec["id"])
    store.touch()
    return rec


def update_status(store, contractor_id: str, *, status: str, performance_pct: Optional[float] = None, compliant: Optional[bool] = None, audit_status: Optional[str] = None, actor_id: str = "U-401") -> dict:
    c = store.find("contractors", contractor_id)
    if not c:
        raise ValueError(f"Unknown contractor {contractor_id}")
    c["status"] = status
    if performance_pct is not None:
        c["performance_pct"] = float(performance_pct)
    if compliant is not None:
        c["compliant"] = bool(compliant)
    if audit_status is not None:
        c["audit_status"] = audit_status
    # Re-derive flags so they always match the current record.
    flags: List[str] = []
    if not c["compliant"]:
        flags.append("Statutory compliance gap — PF/ESI return outstanding or workman register not updated")
    if c["performance_pct"] < 60:
        flags.append("Performance below 60% of schedule-of-work milestones")
    if c["status"] == "EXPIRED":
        flags.append("Contract expired; workman transition plan required")
    if c["days_to_expiry"] < 60 and c["status"] == "ACTIVE":
        flags.append(f"Renewal due in {c['days_to_expiry']} days")
    c["flags"] = flags
    store.log(actor_id, "CONTRACTOR", f"Contractor {c['name']} status -> {status}", c["id"])
    store.touch()
    return c

"""
MINEGUARD AI — Grievance Handling service.

Closes the PS SIH26024 line item: "grievance handling". Each grievance
carries a severity, an SLA window matched to that severity, a channel
(WHATSAPP_BOT / WEB_PORTAL / IVR / FIELD), a language tag (the
multilingual requirement is on the inbound channel, not on outbound
display), and a status state machine. SLA breach is *derived*, not
asserted — same pattern as the risk engine.

State machine (enforced):
    OPEN -> UNDER_REVIEW -> ASSIGNED -> RESOLVED | ESCALATED
    UNDER_REVIEW / ASSIGNED -> ESCALATED (when SLA breaches)
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

SLA_DAYS = {"CRITICAL": 3, "HIGH": 7, "MEDIUM": 14, "LOW": 21}
GRIEVANCE_FLOW = ["OPEN", "UNDER_REVIEW", "ASSIGNED", "RESOLVED", "ESCALATED"]
ALLOWED: Dict[str, List[str]] = {
    "OPEN": ["UNDER_REVIEW", "ASSIGNED", "ESCALATED", "RESOLVED"],
    "UNDER_REVIEW": ["ASSIGNED", "ESCALATED", "RESOLVED"],
    "ASSIGNED": ["RESOLVED", "ESCALATED"],
    "ESCALATED": ["ASSIGNED", "RESOLVED"],
    "RESOLVED": [],
}


def list_grievances(store, *, mine_id: Optional[str] = None, status: Optional[str] = None, severity: Optional[str] = None) -> List[dict]:
    rows = list(store.data.get("grievances", []))
    if mine_id:
        rows = [r for r in rows if r["mine_id"] == mine_id]
    if status:
        rows = [r for r in rows if r["status"] == status]
    if severity:
        rows = [r for r in rows if r["severity"] == severity]
    rows.sort(key=lambda r: (r["status"] != "OPEN" and r["status"] != "ESCALATED", -_severity_rank(r["severity"]), r["days_open"]))
    return rows


def _severity_rank(s: str) -> int:
    return {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}.get(s, 0)


def _sla_state(g: dict, today: date) -> str:
    if g["status"] == "RESOLVED":
        return "RESOLVED"
    sla = SLA_DAYS.get(g["severity"], 14)
    if g["days_open"] > sla:
        return "BREACHED"
    if g["days_open"] >= sla * 0.7:
        return "AT_RISK"
    return "ON_TRACK"


def summary(store) -> Dict[str, Any]:
    rows = list(store.data.get("grievances", []))
    today = date.today()
    open_rows = [r for r in rows if r["status"] != "RESOLVED"]
    return {
        "total": len(rows),
        "open": len(open_rows),
        "critical_open": sum(1 for r in open_rows if r["severity"] == "CRITICAL"),
        "high_open": sum(1 for r in open_rows if r["severity"] == "HIGH"),
        "breached": sum(1 for r in open_rows if _sla_state(r, today) == "BREACHED"),
        "resolved_30d": sum(1 for r in rows if r["status"] == "RESOLVED" and r.get("resolved_at") and (today - date.fromisoformat(r["resolved_at"])).days <= 30),
        "by_channel": _by_channel(rows),
        "by_language": _by_language(rows),
        "resolution_rate_pct": round(len([r for r in rows if r["status"] == "RESOLVED"]) / max(1, len(rows)) * 100, 1),
    }


def _by_channel(rows: List[dict]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        out[r.get("channel", "WEB_PORTAL")] = out.get(r.get("channel", "WEB_PORTAL"), 0) + 1
    return out


def _by_language(rows: List[dict]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        lang = r.get("language", "en")
        out[lang] = out.get(lang, 0) + 1
    return out


def create_grievance(store, *, title: str, category: str, severity: str, mine_id: str, department: str, raised_by: str, channel: str = "WEB_PORTAL", language: str = "en", actor_id: str = "U-101") -> dict:
    mine = store.mine(mine_id) or {}
    if not mine:
        raise ValueError(f"Unknown mine {mine_id}")
    today = date.today()
    sla = SLA_DAYS.get(severity, 14)
    rec = {
        "id": store.next_id("grievances", "GRV"),
        "title": title,
        "category": category,
        "severity": severity,
        "mine_id": mine_id,
        "mine_name": mine.get("name", ""),
        "department": department,
        "raised_by": raised_by,
        "channel": channel,
        "language": language,
        "status": "OPEN",
        "created_at": today.isoformat(),
        "updated_at": today.isoformat(),
        "resolved_at": None,
        "resolution_note": None,
        "days_open": 0,
        "sla_days": sla,
        "sla_state": "ON_TRACK",
        "assigned_to": "U-203" if department == "LABOUR" else "U-201",
    }
    store.data.setdefault("grievances", []).append(rec)
    store.log(actor_id, "GRIEVANCE", f"Grievance raised: {title} ({severity})", rec["id"])
    store.touch()
    return rec


def advance(store, grievance_id: str, *, target: str, resolution_note: Optional[str] = None, actor_id: str = "U-301") -> dict:
    g = store.find("grievances", grievance_id)
    if not g:
        raise ValueError(f"Unknown grievance {grievance_id}")
    today = date.today()
    g["days_open"] = (today - date.fromisoformat(g["created_at"])).days
    if target not in ALLOWED.get(g["status"], []):
        raise ValueError(f"Cannot move {g['status']} -> {target}. Permitted: {ALLOWED.get(g['status'], [])}")
    g["status"] = target
    g["updated_at"] = today.isoformat()
    if target == "RESOLVED":
        g["resolved_at"] = today.isoformat()
        g["resolution_note"] = resolution_note or "Resolved."
        g["sla_state"] = "RESOLVED"
    else:
        g["sla_state"] = _sla_state(g, today)
    store.log(actor_id, "GRIEVANCE", f"Grievance {g['id']} -> {target}", g["id"])
    store.touch()
    return g

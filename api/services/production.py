"""
MINEGUARD AI — Production Reporting service.

Closes the PS SIH26024 line item: "production reporting" as a governance
activity. Each row is a monthly production return authored by a mine
manager; the service derives portfolio variance, performance against
target, and flags the mines whose output is materially below plan so
that production and compliance can be read on the same dashboard.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional


def list_reports(store, *, mine_id: Optional[str] = None, months: int = 6) -> List[dict]:
    rows = list(store.data.get("production_reports", []))
    if mine_id:
        rows = [r for r in rows if r["mine_id"] == mine_id]
    rows = [r for r in rows if r["period_month"] >= (date.today() - timedelta(days=30 * months)).strftime("%Y-%m")]
    rows.sort(key=lambda r: (r["period_month"], r["mine_id"]))
    return rows


def latest_per_mine(store) -> List[dict]:
    """The most recent return per mine — the tile on the dashboard."""
    by_mine: Dict[str, dict] = {}
    for r in store.data.get("production_reports", []):
        cur = by_mine.get(r["mine_id"])
        if cur is None or r["period_month"] > cur["period_month"]:
            by_mine[r["mine_id"]] = r
    return list(by_mine.values())


def portfolio_summary(store) -> Dict[str, Any]:
    rows = list_reports(store)
    if not rows:
        return {"total_target_kt": 0, "total_actual_kt": 0, "variance_pct": 0.0, "performers": [], "laggards": []}
    last_month = max(r["period_month"] for r in rows)
    month_rows = [r for r in rows if r["period_month"] == last_month]
    total_target = sum(r["target_kt"] for r in month_rows)
    total_actual = sum(r["actual_kt"] for r in month_rows)
    variance = round((total_actual - total_target) / max(1, total_target) * 100, 1)
    performers = sorted(month_rows, key=lambda r: -r["performance_pct"])[:2]
    laggards = sorted(month_rows, key=lambda r: r["performance_pct"])[:2]
    return {
        "period_month": last_month,
        "total_target_kt": round(total_target, 1),
        "total_actual_kt": round(total_actual, 1),
        "variance_pct": variance,
        "performers": [{"mine_id": r["mine_id"], "mine_name": r["mine_name"], "performance_pct": r["performance_pct"]} for r in performers],
        "laggards": [{"mine_id": r["mine_id"], "mine_name": r["mine_name"], "performance_pct": r["performance_pct"], "gap_kt": round(r["target_kt"] - r["actual_kt"], 1)} for r in laggards],
    }


def create_report(store, *, mine_id: str, period_month: str, target_kt: float, actual_kt: float, shifts_worked: int, overburden_m3: float, strip_ratio: float, reported_by: str, remarks: str = "") -> dict:
    mine = store.mine(mine_id)
    if not mine:
        raise ValueError(f"Unknown mine {mine_id}")
    target = float(target_kt)
    actual = float(actual_kt)
    rec = {
        "id": store.next_id("production_reports", "PRD"),
        "mine_id": mine_id,
        "mine_name": mine["name"],
        "period_month": period_month,
        "period_label": date.fromisoformat(f"{period_month}-01").strftime("%b %Y"),
        "target_kt": round(target, 1),
        "actual_kt": round(actual, 1),
        "variance_pct": round((actual - target) / max(0.01, target) * 100, 1),
        "performance_pct": round(actual / max(0.01, target) * 100, 1),
        "shifts_worked": int(shifts_worked),
        "overburden_m3": float(overburden_m3),
        "strip_ratio": float(strip_ratio),
        "reported_by": reported_by,
        "reported_at": date.today().isoformat(),
        "status": "DRAFT",
        "verified": False,
        "remarks": remarks,
    }
    store.data.setdefault("production_reports", []).append(rec)
    store.log(reported_by, "PRODUCTION", f"Production return for {mine['name']} · {rec['period_label']} · {actual}/{target} kt", rec["id"])
    store.touch()
    return rec

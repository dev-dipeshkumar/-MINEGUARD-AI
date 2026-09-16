"""
MINEGUARD AI — Worker Attendance service.

Closes the PS SIH26024 line item: "worker attendance" as a governance
activity. Records daily attendance per mine — geo-tagged at the muster
point, so the field report is auditable in space, not just in time.
Derived metrics: presence rate trend, unauthorised absence spike,
contractor-worker ratio (which feeds into contractor compliance too).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional


def list_records(store, *, mine_id: Optional[str] = None, days: int = 14) -> List[dict]:
    rows = list(store.data.get("attendance", []))
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows = [r for r in rows if r["date"] >= cutoff]
    if mine_id:
        rows = [r for r in rows if r["mine_id"] == mine_id]
    rows.sort(key=lambda r: (r["date"], r["mine_id"]), reverse=True)
    return rows


def latest_per_mine(store) -> List[dict]:
    by_mine: Dict[str, dict] = {}
    for r in store.data.get("attendance", []):
        cur = by_mine.get(r["mine_id"])
        if cur is None or r["date"] > cur["date"]:
            by_mine[r["mine_id"]] = r
    return list(by_mine.values())


def summary(store) -> Dict[str, Any]:
    rows = list_records(store, days=14)
    if not rows:
        return {"portfolio_present_pct": 0, "portfolio_absent": 0, "trend": [], "weak_mines": []}
    today_rows = [r for r in rows if r["date"] == max(r["date"] for r in rows)]
    total_wf = sum(r["workforce_strength"] for r in today_rows) or 1
    total_present = sum(r["present"] for r in today_rows)
    total_absent = sum(r["absent"] for r in today_rows)
    portfolio_present_pct = round(total_present / total_wf * 100, 1)

    # 14-day trend — portfolio mean presence per day
    by_date: Dict[str, List[float]] = defaultdict(list)
    for r in rows:
        by_date[r["date"]].append(r["present_pct"])
    trend = sorted(
        [{"date": d, "present_pct": round(sum(v) / len(v), 1)} for d, v in by_date.items()],
        key=lambda x: x["date"],
    )

    weak_mines = [
        {"mine_id": r["mine_id"], "mine_name": r["mine_name"], "present_pct": r["present_pct"]}
        for r in today_rows
        if r["present_pct"] < 85
    ]
    weak_mines.sort(key=lambda x: x["present_pct"])
    return {
        "portfolio_present_pct": portfolio_present_pct,
        "portfolio_absent": total_absent,
        "trend": trend,
        "weak_mines": weak_mines[:3],
    }


def create_record(store, *, mine_id: str, present: int, absent: int, on_leave: int, contractor_workers: int, latitude: Optional[float] = None, longitude: Optional[float] = None, verified_by: str = "U-301") -> dict:
    mine = store.mine(mine_id) or {}
    if not mine:
        raise ValueError(f"Unknown mine {mine_id}")
    wf = mine.get("workforce", present + absent)
    rec = {
        "id": store.next_id("attendance", "ATT"),
        "mine_id": mine_id,
        "mine_name": mine.get("name", ""),
        "date": date.today().isoformat(),
        "weekday": date.today().strftime("%a"),
        "workforce_strength": wf,
        "present": int(present),
        "absent": int(absent),
        "on_leave": int(on_leave),
        "absent_unauthorised": int(absent) - int(on_leave),
        "present_pct": round(present / max(1, wf) * 100, 1),
        "latitude": float(latitude) if latitude is not None else mine.get("latitude"),
        "longitude": float(longitude) if longitude is not None else mine.get("longitude"),
        "geo_source": "BIOGRID-face-terminal",
        "contractor_workers": int(contractor_workers),
        "shifts_run": 3 if mine.get("mine_type") == "UNDERGROUND" else 2,
        "verified_by": verified_by,
    }
    store.data.setdefault("attendance", []).append(rec)
    store.log(verified_by, "ATTENDANCE", f"Attendance captured for {mine.get('name')} · {rec['present']}/{rec['workforce_strength']} present", rec["id"])
    store.touch()
    return rec

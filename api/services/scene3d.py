"""
MINEGUARD AI — 3D scene service.

The novel 3D map needs more data than the 2D map: per-mine truck
routes, conveyor segments, ventilation ducts, gas sensor positions,
worker cluster coordinates, and a 90-day risk history per zone so the
time scrubber can animate heights.

This service composes all of that from the existing store (no new
collections added — the 3D scene is a *view* of the same records
the rest of the product uses).
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------- helpers
def _zone_world_pos(zone: dict, mine: dict) -> tuple[float, float, float]:
    """Translate schematic geometry into world coordinates centred on the mine."""
    g = zone.get("geometry") or {"x": 10, "y": 10, "w": 30, "h": 30}
    SCALE = 0.4
    # Offset relative to mine centre — keeps the 3D scene readable.
    cx = (g["x"] + g["w"] / 2 - 50) * SCALE
    cz = (g["y"] + g["h"] / 2 - 50) * SCALE
    # For the multi-mine portfolio view, the mine's own lat/long becomes
    # an island offset. For the per-mine view, the mine is at the origin.
    return cx, 0.0, cz


def _mine_island_offset(mine: dict, all_mines: List[dict]) -> tuple[float, float]:
    """For the portfolio view: arrange mines as islands in a 2x2 grid."""
    # Stable 2x2 layout keyed by mine index, not on real lat/long (which
    # would scatter them too widely for a single scene).
    idx = next((i for i, m in enumerate(all_mines) if m["id"] == mine["id"]), 0)
    row, col = idx // 2, idx % 2
    return (col - 0.5) * 40.0, (row - 0.5) * 30.0


def _zone_history_series(store, zone_id: str, days: int = 90) -> List[float]:
    """Return a 90-element list of risk scores — one per day, oldest first."""
    history = store.history_for(zone_id, days)
    if not history:
        return []
    # Pad missing days at the front with the earliest known score so the
    # scrubber has a continuous series.
    by_date = {row["date"]: row["risk_score"] for row in history}
    today = date.today()
    out: List[float] = []
    last_value = 0.0
    for offset in range(days - 1, -1, -1):
        d = (today - timedelta(days=offset)).isoformat()
        v = by_date.get(d)
        if v is not None:
            last_value = v
        out.append(last_value)
    return out


def _truck_schedule(mine: dict, zones: List[dict]) -> List[dict]:
    """Generate haul-truck routes for open-cast mines (Brahma, Neelam).

    A truck is a spline path through 3-4 waypoints. For underground mines
    we return an empty list (trucks are surface-only).
    """
    if mine.get("mine_type") != "OPEN_CAST":
        return []
    # Trucks circulate between the extraction zone and the storage/dispatch zone
    extraction = next((z for z in zones if z["zone_type"] == "EXTRACTION"), None)
    storage = next((z for z in zones if z["zone_type"] == "STORAGE"), None)
    if not extraction or not storage:
        return []
    eg = extraction["geometry"]
    sg = storage["geometry"]
    SCALE = 0.4
    # Two trucks on a closed loop with a midpoint detour
    def waypoints() -> List[tuple[float, float]]:
        return [
            ((eg["x"] + eg["w"] / 2 - 50) * SCALE, (eg["y"] + eg["h"] / 2 - 50) * SCALE),
            ((eg["x"] + eg["w"] - 50) * SCALE, (eg["y"] - 50) * SCALE),  # exit ramp
            ((sg["x"] - 50) * SCALE, (sg["y"] + sg["h"] / 2 - 50) * SCALE),
            ((sg["x"] + sg["w"] / 2 - 50) * SCALE, (sg["y"] + sg["h"] / 2 - 50) * SCALE),
        ]
    return [
        {
            "id": f"TRK-{mine['code']}-01",
            "type": "HAUL_TRUCK",
            "capacity_t": 60,
            "waypoints": waypoints(),
            "speed": 0.18,
            "phase_offset": 0.0,
            "label": "DT-220",
        },
        {
            "id": f"TRK-{mine['code']}-02",
            "type": "HAUL_TRUCK",
            "capacity_t": 60,
            "waypoints": waypoints(),
            "speed": 0.16,
            "phase_offset": 0.5,
            "label": "DT-221",
        },
    ]


def _conveyor_segments(mine: dict, zones: List[dict]) -> List[dict]:
    """Conveyor belt segments — only for mines with an equipment zone."""
    equipment = next((z for z in zones if z["zone_type"] == "EQUIPMENT"), None)
    storage = next((z for z in zones if z["zone_type"] == "STORAGE"), None)
    if not equipment:
        return []
    eg = equipment["geometry"]
    SCALE = 0.4
    segments: List[dict] = [{
        "id": f"CNV-{mine['code']}-01",
        "from": ((eg["x"] - 50) * SCALE, (eg["y"] + eg["h"] / 2 - 50) * SCALE),
        "to": ((eg["x"] + eg["w"] - 50) * SCALE, (eg["y"] + eg["h"] / 2 - 50) * SCALE),
        "length_m": round(eg["w"] * SCALE * 10, 1),
        "status": "RUNNING",
    }]
    if storage:
        sg = storage["geometry"]
        segments.append({
            "id": f"CNV-{mine['code']}-02",
            "from": ((eg["x"] + eg["w"] - 50) * SCALE, (eg["y"] + eg["h"] / 2 - 50) * SCALE),
            "to": ((sg["x"] + sg["w"] / 2 - 50) * SCALE, (sg["y"] + sg["h"] / 2 - 50) * SCALE),
            "length_m": round(20 * SCALE * 10, 1),
            "status": "RUNNING",
        })
    return segments


def _ventilation_ducts(mine: dict, zones: List[dict]) -> List[dict]:
    """Ventilation duct segments — only for underground mines."""
    if mine.get("mine_type") != "UNDERGROUND":
        return []
    extraction = next((z for z in zones if z["zone_type"] == "EXTRACTION"), None)
    if not extraction:
        return []
    eg = extraction["geometry"]
    SCALE = 0.4
    # Main ventilation raise: vertical shaft from surface down to extraction
    return [{
        "id": f"VEN-{mine['code']}-01",
        "from": ((eg["x"] + eg["w"] / 2 - 50) * SCALE, 0.0, (eg["y"] + eg["h"] / 2 - 50) * SCALE),
        "to": ((eg["x"] + eg["w"] / 2 - 50) * SCALE, -8.0, (eg["y"] + eg["h"] / 2 - 50) * SCALE),
        "flow_direction": "DOWNCAST",
        "air_volume_m3_s": 240,
        "status": "RUNNING",
    }]


def _gas_sensors(mine: dict, zones: List[dict]) -> List[dict]:
    """Methane / CO sensor positions for underground mines."""
    if mine.get("mine_type") != "UNDERGROUND":
        return []
    out: List[dict] = []
    SCALE = 0.4
    for i, z in enumerate(zones):
        if z["zone_type"] not in {"EXTRACTION", "EQUIPMENT"}:
            continue
        g = z["geometry"]
        out.append({
            "id": f"GS-{mine['code']}-{i+1:02d}",
            "zone_id": z["id"],
            "position": ((g["x"] + g["w"] / 2 - 50) * SCALE, -2.0, (g["y"] + g["h"] / 2 - 50) * SCALE),
            "type": "METHANE",
            "reading_pct": 0.4 + (i * 0.15) % 1.0,
            "alarm_threshold_pct": 1.25,
            "status": "NORMAL" if i % 3 else "ALARM",
        })
    return out


def _worker_clusters(store, mine: dict, zones: List[dict]) -> List[dict]:
    """Worker cluster positions for the WORKER_OPERATIONS zone, sized by attendance."""
    attendance = store.data.get("attendance", [])
    mine_att = [a for a in attendance if a["mine_id"] == mine["id"]]
    latest_present = mine_att[0]["present"] if mine_att else mine.get("workforce", 0)
    worker_zone = next((z for z in zones if z["zone_type"] == "WORKER_OPERATIONS"), None)
    if not worker_zone:
        return []
    g = worker_zone["geometry"]
    SCALE = 0.4
    # Cluster workers in 4 sub-groups around the muster point
    cx = (g["x"] + g["w"] / 2 - 50) * SCALE
    cz = (g["y"] + g["h"] / 2 - 50) * SCALE
    per_cluster = max(1, latest_present // 4)
    return [
        {"id": f"WKR-{mine['code']}-{i+1}", "position": (cx + 1.2 * (i % 2), 0.0, cz + 1.2 * (i // 2 - 0.5)), "count": per_cluster, "shift": "A" if i == 0 else "B" if i == 1 else "C" if i == 2 else "OFF"}
        for i in range(4)
    ]


def _environmental_features(mine: dict, zones: List[dict]) -> dict:
    """Stockpiles, water bodies, greenery positions for environmental + storage zones."""
    SCALE = 0.4
    stockpiles: List[dict] = []
    water: List[dict] = []
    greenery: List[dict] = []
    for z in zones:
        g = z["geometry"]
        cx = (g["x"] + g["w"] / 2 - 50) * SCALE
        cz = (g["y"] + g["h"] / 2 - 50) * SCALE
        if z["zone_type"] == "STORAGE":
            # Three stockpile cones in the storage yard
            for i, ox in enumerate((-1.5, 0, 1.5)):
                stockpiles.append({
                    "id": f"STK-{z['id']}-{i+1}",
                    "position": (cx + ox, 0.0, cz),
                    "height": 1.2 + i * 0.3,
                    "radius": 1.0 + i * 0.15,
                    "material": "COAL" if i < 2 else "OVERBURDEN",
                })
        elif z["zone_type"] == "ENVIRONMENTAL":
            # Settler pond + afforestation patches
            water.append({
                "id": f"WTB-{z['id']}",
                "position": (cx, 0.0, cz),
                "size": (g["w"] * SCALE * 0.7, g["h"] * SCALE * 0.7),
                "depth": 0.4,
                "status": "TREATMENT",
            })
            for i in range(4):
                greenery.append({
                    "id": f"TRE-{z['id']}-{i+1}",
                    "position": (cx + 1.2 * (i % 2 - 0.5), 0.0, cz + 1.2 * (i // 2 - 0.5)),
                    "height": 0.8 + 0.3 * (i % 3),
                })
    return {"stockpiles": stockpiles, "water": water, "greenery": greenery}


def _risk_beacon(zone: dict, payload: dict) -> Optional[dict]:
    """Vertical light beam on CRITICAL zones — visible across the whole scene."""
    risk = (payload.get("risk") or {})
    if risk.get("risk_level") not in {"CRITICAL"}:
        return None
    g = zone.get("geometry") or {"x": 0, "y": 0, "w": 30, "h": 30}
    SCALE = 0.4
    return {
        "id": f"BCN-{zone['id']}",
        "position": ((g["x"] + g["w"] / 2 - 50) * SCALE, 0.0, (g["y"] + g["h"] / 2 - 50) * SCALE),
        "intensity": 1.0,
        "color": "#dc2626",
        "height": 12.0,
        "pulse_hz": 0.8,
    }


def _open_violation_markers(store, zone_id: str, zone: dict) -> List[dict]:
    """Red spheres on the zone for each open violation."""
    violations = [v for v in store.data.get("violations", []) if v["zone_id"] == zone_id and v["status"] != "CLOSED"]
    if not violations:
        return []
    g = zone.get("geometry") or {"x": 0, "y": 0, "w": 30, "h": 30}
    SCALE = 0.4
    cx = (g["x"] + g["w"] / 2 - 50) * SCALE
    cz = (g["y"] + g["h"] / 2 - 50) * SCALE
    out: List[dict] = []
    for i, v in enumerate(violations[:8]):  # cap at 8 to keep the scene readable
        # Spread markers around the zone perimeter
        angle = (i / 8) * 2 * math.pi
        radius = min(g["w"], g["h"]) * SCALE * 0.4
        x = cx + radius * math.cos(angle)
        z = cz + radius * math.sin(angle)
        out.append({
            "id": v["id"],
            "position": (x, 1.5, z),
            "severity": v["severity"],
            "category": v["category"],
            "age_days": (date.today() - date.fromisoformat(v["created_at"])).days,
        })
    return out


# ---------------------------------------------------------------- public API

def mine_scene(store, mine_id: str) -> Dict[str, Any]:
    """Per-mine 3D scene — the data needed for the deep /mines/:id 3D view."""
    mine = store.mine(mine_id)
    if not mine:
        raise ValueError(f"Unknown mine {mine_id}")
    zones = store.zones(mine_id)
    today = date.today()

    zone_scenes: List[dict] = []
    for z in zones:
        payload = store.zone_assessment(z["id"]) or {}
        risk = payload.get("risk") or {}
        compliance = payload.get("compliance") or {}
        history_series = _zone_history_series(store, z["id"], days=90)
        zone_scenes.append({
            "id": z["id"],
            "name": z["name"],
            "short_name": z["short_name"],
            "zone_type": z["zone_type"],
            "mine_type": mine.get("mine_type"),
            "geometry": z.get("geometry"),
            "latitude": z.get("latitude"),
            "longitude": z.get("longitude"),
            "risk_score": risk.get("risk_score", 0),
            "risk_level": risk.get("risk_level", "LOW"),
            "risk_tone": risk.get("tone", "low"),
            "compliance_score": compliance.get("compliance_score", 0),
            "open_violations": risk.get("metrics", {}).get("open_violations", 0),
            "critical_violations": risk.get("metrics", {}).get("critical_violations", 0),
            "high_violations": risk.get("metrics", {}).get("high_violations", 0),
            "trend_30d": (history_series[-1] - history_series[-30]) if len(history_series) >= 30 else 0,
            "history_90d": history_series,
            "factors": [f.get("key") for f in risk.get("factors", [])],
            "beacon": _risk_beacon(z, payload),
            "violation_markers": _open_violation_markers(store, z["id"], z),
        })

    return {
        "mine": {
            "id": mine["id"],
            "code": mine["code"],
            "name": mine["name"],
            "mine_type": mine["mine_type"],
            "location": mine["location"],
            "workforce": mine.get("workforce", 0),
            "annual_output_kt": mine.get("annual_output_kt", 0),
            "latitude": mine.get("latitude"),
            "longitude": mine.get("longitude"),
            "risk_score": mine.get("risk_score", 0),
            "risk_level": mine.get("risk_level", "LOW"),
            "compliance_score": mine.get("compliance_score", 0),
        },
        "zones": zone_scenes,
        "trucks": _truck_schedule(mine, zones),
        "conveyors": _conveyor_segments(mine, zones),
        "ventilation": _ventilation_ducts(mine, zones),
        "gas_sensors": _gas_sensors(mine, zones),
        "worker_clusters": _worker_clusters(store, mine, zones),
        "environmental": _environmental_features(mine, zones),
        "alerts": [a for a in store.data.get("alerts", []) if a.get("mine_id") == mine_id][:5],
        "as_of": today.isoformat(),
    }


def portfolio_scene(store) -> Dict[str, Any]:
    """All 4 mines as islands in a single scene — the /3d portfolio view."""
    mines = store.data.get("mines", [])
    islands: List[dict] = []
    for mine in mines:
        zones = store.zones(mine["id"])
        offset_x, offset_z = _mine_island_offset(mine, mines)
        zone_summaries: List[dict] = []
        for z in zones:
            payload = store.zone_assessment(z["id"]) or {}
            risk = payload.get("risk") or {}
            g = z.get("geometry") or {"x": 0, "y": 0, "w": 30, "h": 30}
            SCALE = 0.4
            cx = offset_x + (g["x"] + g["w"] / 2 - 50) * SCALE
            cz = offset_z + (g["y"] + g["h"] / 2 - 50) * SCALE
            zone_summaries.append({
                "id": z["id"],
                "name": z["name"],
                "short_name": z["short_name"],
                "zone_type": z["zone_type"],
                "position": [cx, 0, cz],
                "size": [g["w"] * SCALE, g["h"] * SCALE],
                "risk_score": risk.get("risk_score", 0),
                "risk_level": risk.get("risk_level", "LOW"),
                "risk_tone": risk.get("tone", "low"),
                "beacon": _risk_beacon(z, payload),
            })
        islands.append({
            "id": mine["id"],
            "code": mine["code"],
            "name": mine["name"],
            "mine_type": mine["mine_type"],
            "position": [offset_x, 0, offset_z],
            "risk_score": mine.get("risk_score", 0),
            "risk_level": mine.get("risk_level", "LOW"),
            "compliance_score": mine.get("compliance_score", 0),
            "workforce": mine.get("workforce", 0),
            "annual_output_kt": mine.get("annual_output_kt", 0),
            "zones": zone_summaries,
            "trucks": _truck_schedule(mine, zones),
            "conveyors": _conveyor_segments(mine, zones),
            "ventilation": _ventilation_ducts(mine, zones),
            "gas_sensors": _gas_sensors(mine, zones),
        })
    return {
        "islands": islands,
        "as_of": date.today().isoformat(),
        "enterprise": store.data.get("computed", {}).get("enterprise", {}),
    }

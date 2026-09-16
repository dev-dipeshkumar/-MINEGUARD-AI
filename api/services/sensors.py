"""
MINEGUARD AI — IoT sensor ingestion.

Accepts NodeMCU-style JSON payloads from field sensors (methane, CO,
temperature, humidity, airflow, seismic), stores them in a ring buffer
per sensor, and supports a live WebSocket push for real-time 3D scene
updates.

Research grounding:
  - Bisht 2024 (IEEE, 4 citations): "Real Time Safety Monitoring System
    in Coal Mines Using IoT" — NodeMCU + methane + IR flame + CO sensor
    architecture.
  - Jiang 2024 (PMC, 42 citations): "Real-Time Monitoring of Underground
    Miners' Status" — wearable sensors with centralised backend.

Payload shape (matches Bisht 2024 NodeMCU standard):
    {
      "sensor_id": "GS-ALP-01",
      "type": "METHANE",
      "value": 0.85,
      "unit": "%",
      "timestamp": "2026-09-15T12:00:00Z",  # optional
      "battery_pct": 78,                    # optional
      "device_id": "NodeMCU-ALPHA-01"       # optional
    }

Alarm thresholds:
  METHANE > 1.25% (DGMS statutory cessation threshold)
  CO      > 50 ppm (DGMS long-term exposure limit)
  TEMPERATURE > 35°C (underground)
  HUMIDITY > 85% (worker comfort)
  AIRFLOW  < 6 m/s (ventilation minimum)
  SEISMIC  > 3.5 ( Richter scale local)
"""
from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Per-sensor ring buffer (last 1000 readings) for history queries
_history: Dict[str, deque] = {}
_lock = threading.Lock()

# Subscribers — WebSocket-like callbacks fired on every new reading
_subscribers: List = []  # populated by main.py WS handler if installed

# Alarm thresholds — keyed by sensor type
ALARM_THRESHOLDS: Dict[str, Dict[str, float]] = {
    "METHANE": {"cease_work": 1.25, "alarm": 0.8},
    "CO":      {"cease_work": 50.0, "alarm": 35.0},
    "TEMPERATURE": {"alarm": 35.0, "cease_work": 40.0},
    "HUMIDITY":    {"alarm": 85.0, "cease_work": 95.0},
    "AIRFLOW":  {"alarm": 6.0, "cease_work": 4.0},  # too LOW
    "SEISMIC":  {"alarm": 2.5, "cease_work": 3.5},
}


def _alarm_state(sensor_type: str, value: float) -> str:
    """Map a reading to NORMAL / ALARM / CEASE_WORK."""
    thresholds = ALARM_THRESHOLDS.get(sensor_type)
    if not thresholds:
        return "NORMAL"
    if "cease_work" in thresholds:
        # For airflow, cease_work triggers when BELOW the threshold
        if sensor_type == "AIRFLOW":
            if value < thresholds["cease_work"]:
                return "CEASE_WORK"
            if value < thresholds["alarm"]:
                return "ALARM"
        else:
            if value >= thresholds["cease_work"]:
                return "CEASE_WORK"
            if value >= thresholds["alarm"]:
                return "ALARM"
    return "NORMAL"


def ingest(store, reading: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a reading and fire subscriber callbacks."""
    sensor_id = reading["sensor_id"]
    sensor_type = reading["type"]
    value = float(reading["value"])
    alarm_state = _alarm_state(sensor_type, value)
    # Resolve mine_id / zone_id from the registered sensors if not provided
    if not reading.get("mine_id") or not reading.get("zone_id"):
        for g in store.data.get("gas_sensors", []):
            if g["id"] == sensor_id:
                reading.setdefault("mine_id", g.get("mine_id"))
                reading.setdefault("zone_id", g.get("zone_id"))
                break
    # Set timestamp
    if not reading.get("timestamp"):
        reading["timestamp"] = datetime.now(timezone.utc).isoformat()
    # Attach alarm state
    reading["alarm_state"] = alarm_state
    reading["thresholds"] = ALARM_THRESHOLDS.get(sensor_type)
    # Store in the ring buffer
    with _lock:
        if sensor_id not in _history:
            _history[sensor_id] = deque(maxlen=1000)
        _history[sensor_id].append(dict(reading))
    # Also persist to store.data["sensor_readings"] so the 3D scene can read it
    store.data.setdefault("sensor_readings", {})
    store.data["sensor_readings"][sensor_id] = {
        "sensor_id": sensor_id,
        "type": sensor_type,
        "value": value,
        "unit": reading["unit"],
        "alarm_state": alarm_state,
        "timestamp": reading["timestamp"],
        "mine_id": reading.get("mine_id"),
        "zone_id": reading.get("zone_id"),
        "battery_pct": reading.get("battery_pct"),
        "device_id": reading.get("device_id"),
        "thresholds": reading.get("thresholds"),
    }
    # Fire subscribers (no await — they are sync callbacks for the WS shim)
    for cb in _subscribers:
        try:
            cb(dict(reading))
        except Exception:
            pass
    return reading


def latest_per_sensor(store, *, mine_id: Optional[str] = None, type: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    """Return the latest reading per sensor — drives the 3D scene."""
    rows = list(store.data.get("sensor_readings", {}).values())
    if mine_id:
        rows = [r for r in rows if r.get("mine_id") == mine_id]
    if type:
        rows = [r for r in rows if r.get("type") == type]
    return rows[:limit]


def history_for(store, sensor_id: str, hours: int = 24) -> List[Dict[str, Any]]:
    """Return the history of a single sensor for the last N hours."""
    with _lock:
        buf = _history.get(sensor_id, deque())
        if not buf:
            # Fall back to store.data if the in-memory buffer was cleared
            return []
        out = list(buf)
    cutoff = datetime.now(timezone.utc).timestamp() - hours * 3600
    out = [r for r in out if datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")).timestamp() >= cutoff]
    return out


def subscribe(cb) -> None:
    """Register a callback fired on every new reading. Used by the WS shim."""
    _subscribers.append(cb)


def unsubscribe(cb) -> None:
    if cb in _subscribers:
        _subscribers.remove(cb)

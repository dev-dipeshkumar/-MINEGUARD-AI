"""MINEGUARD AI — read APIs: dashboard, mines, zones, analytics, alerts, insights."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..deps import get_actor, get_store, require_role
from ..services.computed import simulate
from ..services.risk_engine import SEVERITY_WEIGHTS, describe_engine

router = APIRouter(tags=["intelligence"])


def _violations_summary(store, *, mine_id: Optional[str] = None, zone_id: Optional[str] = None) -> dict:
    today = date.today()
    rows = [
        v
        for v in store.data["violations"]
        if (mine_id is None or v["mine_id"] == mine_id) and (zone_id is None or v["zone_id"] == zone_id)
    ]
    open_rows = [v for v in rows if v["status"] != "CLOSED"]
    return {
        "total": len(rows),
        "open": len(open_rows),
        "critical": sum(1 for v in open_rows if v["severity"] == "CRITICAL"),
        "high": sum(1 for v in open_rows if v["severity"] == "HIGH"),
        "aged_30": sum(1 for v in open_rows if (today - date.fromisoformat(v["created_at"])).days > 30),
        "unassigned": sum(1 for v in open_rows if not v.get("assigned_to")),
    }


def _overdue_actions(store, *, mine_id: Optional[str] = None, zone_id: Optional[str] = None) -> List[dict]:
    today = date.today()
    out = []
    for a in store.data["corrective_actions"]:
        if a["status"] in {"CLOSED", "VERIFIED"} or not a.get("due_date"):
            continue
        if mine_id and a.get("mine_id") != mine_id:
            continue
        if zone_id and a.get("zone_id") != zone_id:
            continue
        due = date.fromisoformat(a["due_date"])
        if due >= today:
            continue
        out.append({**a, "days_overdue": (today - due).days, "owner": (store.user(a["assigned_to"]) or {}).get("name", "—")})
    out.sort(key=lambda r: -r["days_overdue"])
    return out


@router.get("/api/health")
def health(store=Depends(get_store)):
    return {
        "status": "ok",
        "engine": {"mode": store.engine.mode, "label": store.engine.label, "phase": store.engine.phase},
        "counts": store.counts(),
        "as_of": store.data["computed"]["as_of"],
    }


@router.get("/api/bootstrap")
def bootstrap(store=Depends(get_store)):
    """Everything the shell needs in one call, so the app boots without a request storm."""
    return {
        "mines": store.data["mines"],
        "zones": store.data["zones"],
        "users": store.data["users"],
        "config": store.data["config"],
        "enterprise": store.data["computed"]["enterprise"],
        "engine": describe_engine(store.engine),
        "as_of": store.data["computed"]["as_of"],
        "generated_at": store.data["computed"]["generated_at"],
    }


@router.get("/api/dashboard")
def dashboard(
    store=Depends(get_store),
    mine_id: Optional[str] = Query(None),
    alert_limit: int = Query(5, ge=1, le=50),
    insight_limit: int = Query(4, ge=1, le=12),
):
    computed = store.data["computed"]
    today = date.today()
    zones = [z for z in store.data["zones"] if mine_id is None or z["mine_id"] == mine_id]
    zone_ids = {z["id"] for z in zones}
    violations = [v for v in store.data["violations"] if v["zone_id"] in zone_ids]
    open_v = [v for v in violations if v["status"] != "CLOSED"]
    alerts = [a for a in store.data.get("alerts", []) if mine_id is None or a["mine_id"] == mine_id]
    overdue = _overdue_actions(store, mine_id=mine_id)
    enterprise = computed["enterprise"] if mine_id is None else (store.mine_computed(mine_id) or {})

    heat = []
    for z in zones:
        payload = computed["zones"].get(z["id"], {})
        risk = payload.get("risk", {})
        heat.append(
            {
                **z,
                "risk_score": risk.get("risk_score", z.get("risk_score", 0)),
                "risk_level": risk.get("risk_level", "LOW"),
                "tone": risk.get("tone", "low"),
                "compliance_score": payload.get("compliance", {}).get("compliance_score", 0),
                "open_violations": risk.get("metrics", {}).get("open_violations", 0),
                "overdue_actions": risk.get("metrics", {}).get("overdue_action_count", 0),
                "top_factor": max(risk.get("factors", [{"label": "—", "points": 0}]), key=lambda f: f["points"])["label"]
                if risk.get("factors")
                else "—",
                "trend": store.trend(z["id"], 30)["change"],
            }
        )
    heat.sort(key=lambda z: -z["risk_score"])

    band_counts: Dict[str, int] = {"LOW": 0, "MODERATE": 0, "ELEVATED": 0, "HIGH": 0, "CRITICAL": 0}
    for z in heat:
        band_counts[z["risk_level"]] = band_counts.get(z["risk_level"], 0) + 1

    department_health = []
    for dept in store.data["config"]["departments"]:
        dv = [v for v in open_v if v["department"] == dept]
        recent = [v for v in violations if v["department"] == dept and (today - date.fromisoformat(v["created_at"])).days <= 30]
        prev = [
            v
            for v in violations
            if v["department"] == dept and 30 < (today - date.fromisoformat(v["created_at"])).days <= 60
        ]
        department_health.append(
            {
                "department": dept,
                "open": len(dv),
                "high_or_critical": sum(1 for v in dv if v["severity"] in {"HIGH", "CRITICAL"}),
                "trend_pct": round((len(recent) - len(prev)) / max(1, len(prev)) * 100, 1),
                "exposure": sum(SEVERITY_WEIGHTS[v["severity"]] for v in dv),
            }
        )

    mine_cards = []
    for m in store.data["mines"]:
        mc = store.mine_computed(m["id"]) or {}
        trend = store.trend(m["id"], 30)
        mine_cards.append(
            {
                "id": m["id"],
                "name": m["name"],
                "code": m["code"],
                "location": m["location"],
                "mine_type": m["mine_type"],
                "status": m["status"],
                "risk_score": mc.get("risk_score", 0),
                "risk_level": mc.get("risk_level", "LOW"),
                "compliance_score": mc.get("compliance_score", 0),
                "open_violations": mc.get("open_violations", 0),
                "overdue_actions": mc.get("overdue_actions", 0),
                "critical_zones": mc.get("critical_zones", 0),
                "trend": trend["change"],
                "alerts": sum(1 for a in store.data.get("alerts", []) if a["mine_id"] == m["id"] and a["severity"] in {"CRITICAL", "HIGH"}),
            }
        )
    mine_cards.sort(key=lambda m: -m["risk_score"])

    return {
        "enterprise": {
            **enterprise,
            "compliance_label": (
                "EXCELLENT"
                if enterprise.get("compliance_score", 0) >= 90
                else "STRONG"
                if enterprise.get("compliance_score", 0) >= 78
                else "STABLE"
                if enterprise.get("compliance_score", 0) >= 65
                else "MARGINAL"
                if enterprise.get("compliance_score", 0) >= 50
                else "DEFICIENT"
            ),
        },
        "kpis": {
            "critical_alerts": sum(1 for a in alerts if a["severity"] == "CRITICAL"),
            "high_risk_zones": band_counts["HIGH"] + band_counts["CRITICAL"],
            "zones_needing_attention": band_counts["ELEVATED"] + band_counts["HIGH"] + band_counts["CRITICAL"],
            "overdue_actions": len(overdue),
            "open_violations": len(open_v),
            "critical_violations": sum(1 for v in open_v if v["severity"] == "CRITICAL"),
            "unassigned_violations": sum(1 for v in open_v if not v.get("assigned_to")),
            "verification_backlog": sum(1 for v in open_v if v["status"] in {"ACTION_SUBMITTED", "UNDER_VERIFICATION"}),
            "compliance": enterprise.get("compliance_score", 0),
            "risk": enterprise.get("risk_score", 0),
        },
        "band_distribution": band_counts,
        "priority_alerts": alerts[:alert_limit],
        "insights": store.data.get("insights", [])[:insight_limit],
        "zone_heat": heat,
        "mine_cards": mine_cards,
        "department_health": department_health,
        "overdue_actions": overdue[:8],
        "risk_trend": store.trend(mine_id, 30) if mine_id else enterprise_trend(store),
        "activity": list(reversed(store.data.get("activity", [])))[:10],
        "as_of": computed["as_of"],
        "generated_at": computed["generated_at"],
    }


def enterprise_trend(store) -> dict:
    series = []
    history = store.data["computed"]["history"]
    dates = sorted({r["date"] for r in history if r["scope_type"] == "MINE"})
    for d in dates[-30:]:
        rows = [r for r in history if r["date"] == d and r["scope_type"] == "MINE"]
        if not rows:
            continue
        series.append(
            {
                "date": d,
                "risk": round(sum(r["risk_score"] for r in rows) / len(rows), 1),
                "compliance": round(sum(r["compliance_score"] for r in rows) / len(rows), 1),
            }
        )
    if not series:
        return {"series": [], "change": 0.0, "change_pct": 0.0, "direction": "stable"}
    change = round(series[-1]["risk"] - series[0]["risk"], 1)
    return {
        "series": series,
        "change": change,
        "change_pct": round(change / max(1.0, series[0]["risk"]) * 100, 1),
        "direction": "rising" if change >= 3 else "falling" if change <= -3 else "stable",
    }


# --------------------------------------------------------------------- mines
@router.get("/api/mines")
def list_mines(store=Depends(get_store)):
    out = []
    for m in store.data["mines"]:
        mc = store.mine_computed(m["id"]) or {}
        trend = store.trend(m["id"], 30)
        out.append(
            {
                **m,
                "zones": [
                    {
                        **z,
                        "trend": store.trend(z["id"], 30)["change"],
                        "open_violations": (store.zone_assessment(z["id"]) or {}).get("risk", {}).get("metrics", {}).get("open_violations", 0),
                    }
                    for z in store.zones(m["id"])
                ],
                "trend": trend,
                "summary": _violations_summary(store, mine_id=m["id"]),
                "overdue_actions": len(_overdue_actions(store, mine_id=m["id"])),
            }
        )
    return out


@router.get("/api/mines/{mine_id}")
def mine_detail(mine_id: str, store=Depends(get_store)):
    mine = store.mine(mine_id)
    if not mine:
        raise HTTPException(status_code=404, detail="Mine not found.")
    mc = store.mine_computed(mine_id) or {}
    zones = []
    for z in store.zones(mine_id):
        payload = store.zone_assessment(z["id"]) or {}
        risk = payload.get("risk", {})
        zones.append(
            {
                **z,
                "risk": risk,
                "compliance": payload.get("compliance", {}),
                "trend": store.trend(z["id"], 30),
                "overdue_actions": _overdue_actions(store, zone_id=z["id"]),
                "recent_violations": [
                    v for v in sorted(store.violations_for(zone_id=z["id"]), key=lambda x: x["created_at"], reverse=True)[:5]
                ],
                "recent_inspections": sorted(
                    [i for i in store.data["inspections"] if i["zone_id"] == z["id"]],
                    key=lambda x: x["inspection_date"],
                    reverse=True,
                )[:5],
            }
        )
    zones.sort(key=lambda z: -(z.get("risk") or {}).get("risk_score", 0))
    return {
        **mine,
        "computed": mc,
        "zones": zones,
        "trend": store.trend(mine_id, 30),
        "summary": _violations_summary(store, mine_id=mine_id),
        "alerts": [a for a in store.data.get("alerts", []) if a["mine_id"] == mine_id],
        "overdue_actions": _overdue_actions(store, mine_id=mine_id),
        "officers": [u for u in store.data["users"] if u.get("mine_id") in {mine_id, None}],
    }


@router.get("/api/mines/{mine_id}/risk")
def mine_risk(mine_id: str, store=Depends(get_store)) -> Dict[str, Any]:
    if not store.mine(mine_id):
        raise HTTPException(status_code=404, detail="Mine not found.")
    mc = store.mine_computed(mine_id) or {}
    zones = []
    for z in store.zones(mine_id):
        payload = store.zone_assessment(z["id"]) or {}
        zones.append({"zone_id": z["id"], "name": z["name"], **payload.get("risk", {}), "compliance": payload.get("compliance", {})})
    zones.sort(key=lambda x: -x.get("risk_score", 0))
    return {
        "scope": "MINE",
        "mine_id": mine_id,
        "risk_score": mc.get("risk_score", 0),
        "risk_level": mc.get("risk_level", "LOW"),
        "compliance_score": mc.get("compliance_score", 0),
        "method": "exposure-weighted aggregate of zone scores with worst-zone influence",
        "zones": zones,
        "trend": store.trend(mine_id, 30),
    }


@router.get("/api/zones/{zone_id}/risk")
def zone_risk(zone_id: str, store=Depends(get_store)):
    payload = store.zone_assessment(zone_id)
    zone = store.zone(zone_id)
    if not payload or not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")
    return {
        "zone": zone,
        **payload["risk"],
        "compliance": payload["compliance"],
        "trend": store.trend(zone_id, 30),
        "history": [
            r for r in store.data["computed"]["history"] if r["scope_id"] == zone_id
        ][-90:],
    }


@router.get("/api/zones/{zone_id}")
def zone_dossier(zone_id: str, store=Depends(get_store)):
    zone = store.zone(zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")
    payload = store.zone_assessment(zone_id) or {}
    risk = payload.get("risk", {})
    violations = sorted(store.violations_for(zone_id=zone_id), key=lambda v: v["created_at"], reverse=True)
    today = date.today()
    overdue_ids = {a["id"] for a in _overdue_actions(store, zone_id=zone_id)}
    actions = sorted(
        [a for a in store.data["corrective_actions"] if a.get("zone_id") == zone_id],
        key=lambda a: a.get("due_date") or "9999",
    )
    try:
        relief = simulate(
            store,
            zone_id,
            resolve_action_ids=sorted(overdue_ids),
        ) if overdue_ids else None
    except Exception:
        relief = None
    return {
        **zone,
        "mine": store.mine(zone["mine_id"]),
        "risk": risk,
        "compliance": payload.get("compliance", {}),
        "trend": store.trend(zone_id, 30),
        "violations": [{**v, "overdue": v.get("id") in {a["violation_id"] for a in actions if a["id"] in overdue_ids}} for v in violations],
        "actions": [{**a, "overdue": a["id"] in overdue_ids} for a in actions],
        "inspections": sorted(
            [i for i in store.data["inspections"] if i["zone_id"] == zone_id],
            key=lambda i: i["inspection_date"],
            reverse=True,
        )[:12],
        "overdue_actions": _overdue_actions(store, zone_id=zone_id),
        "alerts": [a for a in store.data.get("alerts", []) if a["scope_id"] == zone_id],
        "closure_relief": relief,
        "aging": [
            {
                "id": v["id"],
                "days": (today - date.fromisoformat(v["created_at"])).days,
                "severity": v["severity"],
                "category": v["category"],
            }
            for v in violations
            if v["status"] != "CLOSED"
        ],
    }


# ----------------------------------------------------------------- analytics
@router.get("/api/analytics")
def analytics(store=Depends(get_store), days: int = Query(30, ge=7, le=90), mine_id: Optional[str] = None):
    today = date.today()
    start = today - timedelta(days=days)
    violations = [
        v
        for v in store.data["violations"]
        if (mine_id is None or v["mine_id"] == mine_id) and date.fromisoformat(v["created_at"]) >= start
    ]
    all_violations = [v for v in store.data["violations"] if mine_id is None or v["mine_id"] == mine_id]

    # Q1 — which mine is becoming riskier
    mine_trends = []
    for m in store.data["mines"]:
        trend = store.trend(m["id"], days)
        mc = store.mine_computed(m["id"]) or {}
        mine_trends.append(
            {
                "mine_id": m["id"],
                "name": m["name"],
                "code": m["code"],
                "risk_score": mc.get("risk_score", 0),
                "risk_level": mc.get("risk_level", "LOW"),
                "compliance_score": mc.get("compliance_score", 0),
                "change": trend["change"],
                "change_pct": trend["change_pct"],
                "direction": trend["direction"],
                "series": trend["series"],
                "critical_zones": mc.get("critical_zones", 0),
            }
        )
    mine_trends.sort(key=lambda x: -x["change"])

    # Q2 — department exposure
    departments = []
    for dept in store.data["config"]["departments"]:
        dv = [v for v in all_violations if v["department"] == dept]
        open_dv = [v for v in dv if v["status"] != "CLOSED"]
        recent = [v for v in dv if date.fromisoformat(v["created_at"]) >= today - timedelta(days=30)]
        prev = [v for v in dv if today - timedelta(days=60) <= date.fromisoformat(v["created_at"]) < today - timedelta(days=30)]
        by_cat: Dict[str, int] = {}
        for v in open_dv:
            by_cat[v["category"]] = by_cat.get(v["category"], 0) + 1
        departments.append(
            {
                "department": dept,
                "open": len(open_dv),
                "closed": len([v for v in dv if v["status"] == "CLOSED"]),
                "total": len(dv),
                "high_or_critical": sum(1 for v in open_dv if v["severity"] in {"HIGH", "CRITICAL"}),
                "trend_pct": round((len(recent) - len(prev)) / max(1, len(prev)) * 100, 1),
                "velocity": {"previous": len(prev), "current": len(recent)},
                "exposure": sum(SEVERITY_WEIGHTS[v["severity"]] for v in open_dv),
                "top_categories": sorted(by_cat.items(), key=lambda kv: -kv[1])[:3],
            }
        )
    departments.sort(key=lambda d: -d["exposure"])

    # Q3 — recurring issues
    window_start = today - timedelta(days=days)
    recurring: Dict[tuple, dict] = {}
    for v in store.data["violations"]:
        created = date.fromisoformat(v["created_at"])
        if created < window_start:
            continue
        key = (v["category"], v["zone_id"])
        entry = recurring.setdefault(
            key,
            {
                "category": v["category"],
                "zone_id": v["zone_id"],
                "zone": (store.zone(v["zone_id"]) or {}).get("short_name", ""),
                "mine": (store.mine(v["mine_id"]) or {}).get("name", ""),
                "occurrences": 0,
                "ids": [],
                "severities": [],
                "first": v["created_at"],
                "last": v["created_at"],
            },
        )
        entry["occurrences"] += 1
        entry["ids"].append(v["id"])
        entry["severities"].append(v["severity"])
        entry["first"] = min(entry["first"], v["created_at"])
        entry["last"] = max(entry["last"], v["created_at"])
    rec_rows = [r for r in recurring.values() if r["occurrences"] >= 2]
    for r in rec_rows:
        prior = len(
            [
                v
                for v in store.data["violations"]
                if (v["category"], v["zone_id"]) == (r["category"], r["zone_id"])
                and window_start - timedelta(days=days) <= date.fromisoformat(v["created_at"]) < window_start
            ]
        )
        r["prior_occurrences"] = prior
        r["trend"] = "INCREASING" if r["occurrences"] > prior else "STABLE" if r["occurrences"] == prior else "DECREASING"
        r["max_depth"] = max(
            [v.get("occurrences", 1) for v in store.data["violations"] if v["id"] in r["ids"]] or [1]
        )
    rec_rows.sort(key=lambda r: (-r["occurrences"], -r["max_depth"]))

    # Q4 — overdue corrective actions
    overdue = _overdue_actions(store, mine_id=mine_id)
    by_owner: Dict[str, dict] = {}
    for a in overdue:
        owner = a["owner"]
        entry = by_owner.setdefault(owner, {"owner": owner, "count": 0, "max_days": 0, "zones": set(), "action_ids": []})
        entry["count"] += 1
        entry["max_days"] = max(entry["max_days"], a["days_overdue"])
        entry["zones"].add((store.zone(a["zone_id"]) or {}).get("short_name", a["zone_id"]))
        entry["action_ids"].append(a["id"])
    owner_rows = [
        {**e, "zones": sorted(e["zones"]), "zone_count": len(e["zones"])} for e in by_owner.values()
    ]
    owner_rows.sort(key=lambda r: (-r["count"], -r["max_days"]))

    # status funnel + severity mix + category mix
    funnel = []
    for status in store.data["config"]["violation_statuses"]:
        funnel.append(
            {
                "status": status,
                "count": len([v for v in all_violations if v["status"] == status]),
            }
        )
    severity_mix = [
        {
            "severity": s,
            "count": len([v for v in all_violations if v["severity"] == s and v["status"] != "CLOSED"]),
            "weight": w,
        }
        for s, w in SEVERITY_WEIGHTS.items()
    ]
    cat_counts: Dict[str, int] = {}
    for v in all_violations:
        cat_counts[v["category"]] = cat_counts.get(v["category"], 0) + 1
    category_mix = sorted(
        ({"category": k, "count": n, "share": round(n / max(1, len(all_violations)) * 100, 1)} for k, n in cat_counts.items()),
        key=lambda x: -x["count"],
    )[:10]

    # inspection cadence table
    cadence = []
    for z in store.zones(mine_id):
        risk = (store.zone_assessment(z["id"]) or {}).get("risk", {})
        m = risk.get("metrics", {})
        cadence.append(
            {
                "zone_id": z["id"],
                "zone": z["short_name"],
                "mine": (store.mine(z["mine_id"]) or {}).get("name", ""),
                "cadence_days": m.get("inspection_cadence_days", z.get("inspection_cadence_days")),
                "days_since": m.get("days_since_inspection"),
                "overdue": bool(m.get("inspection_overdue")),
                "points": (m.get("factor_points") or {}).get("inspection_delay", 0),
                "open_violations": m.get("open_violations", 0),
            }
        )
    cadence.sort(key=lambda c: (not c["overdue"], -(c["days_since"] or 999)))

    # closure performance
    closed = [v for v in all_violations if v["status"] == "CLOSED" and v.get("closed_at")]
    ages = [
        (date.fromisoformat(v["closed_at"]) - date.fromisoformat(v["created_at"])).days
        for v in closed
    ]
    closure = {
        "closed_90d": len(closed),
        "median_days": sorted(ages)[len(ages) // 2] if ages else 0,
        "best_days": min(ages) if ages else 0,
        "worst_days": max(ages) if ages else 0,
        "on_time_rate": round(
            sum(1 for a in ages if a <= 14) / len(ages) * 100, 1
        )
        if ages
        else 100.0,
    }

    return {
        "period_days": days,
        "as_of": today.isoformat(),
        "mine_risk_trends": mine_trends,
        "departments": departments,
        "recurring_issues": rec_rows[:8],
        "overdue": {"total": len(overdue), "by_owner": owner_rows, "items": overdue[:20]},
        "status_funnel": funnel,
        "severity_mix": severity_mix,
        "category_mix": category_mix,
        "cadence": cadence,
        "closure": closure,
        "totals": _violations_summary(store, mine_id=mine_id),
    }


@router.get("/api/alerts")
def list_alerts(
    store=Depends(get_store),
    severity: Optional[str] = None,
    mine_id: Optional[str] = None,
    kind: Optional[str] = None,
):
    rows = store.data.get("alerts", [])
    if severity:
        rows = [a for a in rows if a["severity"] == severity.upper()]
    if mine_id:
        rows = [a for a in rows if a["mine_id"] == mine_id]
    if kind:
        rows = [a for a in rows if a["kind"] == kind.upper()]
    kinds = sorted({a["kind"] for a in store.data.get("alerts", [])})
    return {
        "alerts": rows,
        "total": len(rows),
        "by_severity": {
            s: len([a for a in store.data.get("alerts", []) if a["severity"] == s]) for s in ("CRITICAL", "HIGH", "MEDIUM")
        },
        "kinds": kinds,
        "engine": {"mode": store.engine.mode, "label": store.engine.label},
    }


class AlertAck(BaseModel):
    acknowledged: bool = True
    note: str = Field(default="", max_length=400)


@router.post("/api/alerts/{alert_id}/ack")
def acknowledge_alert(alert_id: str, payload: AlertAck, store=Depends(get_store), actor: dict = Depends(get_actor)):
    """
    Mark an alert as handled. Acknowledging is a management decision — an
    inspector or officer cannot clear a warning about their own backlog — and the
    state is stored per detector+scope key so it survives alert regeneration.
    Nothing here changes a risk score: an alert is a briefing object, the records
    behind it are what drive the engine.
    """
    alert = next((a for a in store.data.get("alerts", []) if a["id"] == alert_id), None)
    if alert is None:
        raise HTTPException(status_code=404, detail=f"No alert '{alert_id}' in the current briefing.")
    if payload.acknowledged:
        require_role(actor, "MANAGER", "ADMIN")
        if not payload.note.strip():
            raise ValueError("An acknowledgement needs a note explaining the decision taken.")
    key = alert.get("key") or f"{alert['kind']}:{alert.get('scope_id', '')}"
    state = store.data.setdefault("alert_state", {})
    if payload.acknowledged:
        state[key] = {
            "status": "ACKNOWLEDGED",
            "acknowledged_by": actor.get("id"),
            "acknowledged_at": date.today().isoformat(),
            "note": payload.note.strip(),
        }
        alert.update({**state[key], "read": True})
        store.log(actor.get("id"), "ALERT", f"{alert_id} acknowledged: {payload.note.strip()}", alert.get("scope_id"))
    else:
        state.pop(key, None)
        alert.update({"status": "OPEN", "acknowledged_by": None, "acknowledged_at": None, "ack_note": "", "read": False})
        store.log(actor.get("id"), "ALERT", f"{alert_id} acknowledgement withdrawn.", alert.get("scope_id"))
    remaining = [a for a in store.data.get("alerts", []) if a.get("status") != "ACKNOWLEDGED"]
    return {
        "alert": alert,
        "open_alerts": len(remaining),
        "acknowledged": len(store.data.get("alerts", [])) - len(remaining),
        "message": (
            f"{alert_id} acknowledged by {actor.get('name')}. The underlying records are unchanged — close them to move the score."
            if payload.acknowledged
            else f"{alert_id} is open again."
        ),
    }


@router.get("/api/insights")
def insights(store=Depends(get_store)):
    return {
        "insights": store.data.get("insights", []),
        "note": "Generated from live records on every recompute — no insight text is hardcoded.",
    }

"""
MINEGUARD AI — write APIs: inspections, violations, corrective actions, evidence.

Every mutation here ends in `store.touch()`, which re-runs the risk engine, so
a score on screen is always the engine's answer for the current state rather
than a value the client negotiated.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from ..deps import get_actor, get_store, require_role
from ..services import workflow as W
from ..services.computed import simulate
from ..services.risk_engine import SEVERITY_WEIGHTS as _SW
from ..services.risk_engine import SEVERITY_WEIGHTS

router = APIRouter(tags=["workflow"])


# --------------------------------------------------------------------- models
class Finding(BaseModel):
    category: str = Field(min_length=2, max_length=80)
    department: Optional[str] = None
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    description: str = Field(min_length=10, max_length=600)
    notes: str = Field(default="", max_length=600)
    evidence_file: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None
    create_action: bool = True


class InspectionCreate(BaseModel):
    mine_id: str
    zone_id: str
    department: Literal["SAFETY", "ENVIRONMENT", "LABOUR"]
    inspector_id: str
    inspection_date: Optional[str] = None
    observations: str = Field(min_length=10, max_length=2000)
    overall_rating: Literal["COMPLIANT", "NON_COMPLIANT", "NEEDS_ATTENTION"] = "COMPLIANT"
    evidence_file: Optional[str] = None
    findings: List[Finding] = Field(default_factory=list)

    @field_validator("inspection_date")
    @classmethod
    def _valid_date(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        try:
            d = date.fromisoformat(v)
        except ValueError as exc:
            raise ValueError("Inspection date must be a valid ISO date (YYYY-MM-DD).") from exc
        if d > date.today():
            raise ValueError("An inspection cannot be dated in the future.")
        return d.isoformat()


class ViolationCreate(BaseModel):
    mine_id: str
    zone_id: str
    department: Optional[Literal["SAFETY", "ENVIRONMENT", "LABOUR"]] = None
    category: str = Field(min_length=2, max_length=80)
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    description: str = Field(min_length=10, max_length=600)
    notes: str = Field(default="", max_length=600)
    inspection_id: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None
    evidence_file: Optional[str] = None


class StatusChange(BaseModel):
    status: Literal["OPEN", "ASSIGNED", "IN_PROGRESS", "ACTION_SUBMITTED", "UNDER_VERIFICATION", "CLOSED"]
    note: str = Field(default="", max_length=600)
    override: bool = False


class AssignPayload(BaseModel):
    officer_id: str
    due_date: Optional[str] = None


class ActionCreate(BaseModel):
    violation_id: str
    description: str = Field(min_length=5, max_length=600)
    assigned_to: str
    due_date: Optional[str] = None


class ActionUpdate(BaseModel):
    status: Optional[Literal["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "VERIFIED", "REJECTED", "CLOSED"]] = None
    resolution_notes: Optional[str] = Field(default=None, max_length=1200)
    verification_notes: Optional[str] = Field(default=None, max_length=1200)
    due_date: Optional[str] = None
    assigned_to: Optional[str] = None


class EvidenceCreate(BaseModel):
    violation_id: Optional[str] = None
    action_id: Optional[str] = None
    file_name: str = Field(min_length=3, max_length=160)
    note: str = Field(default="", max_length=600)
    kind: Literal["OBSERVATION", "RESOLUTION", "VERIFICATION"] = "OBSERVATION"


class SimulatePayload(BaseModel):
    zone_id: str
    close_violation_ids: List[str] = Field(default_factory=list)
    resolve_action_ids: List[str] = Field(default_factory=list)
    add_violation: Optional[Dict[str, str]] = None
    inspect_now: bool = False


def _decorate(store, v: dict) -> dict:
    """Attach read-only derived fields the list/detail views need."""
    today = date.today()
    created = date.fromisoformat(v["created_at"])
    age = (today - created).days
    due = date.fromisoformat(v["due_date"]) if v.get("due_date") else None
    sla = W.SLA_DAYS.get(v["severity"], 14)
    zone = store.zone(v["zone_id"]) or {}
    return {
        **v,
        "age_days": age,
        "zone_name": zone.get("name", ""),
        "zone_short": zone.get("short_name", ""),
        "mine_name": (store.mine(v["mine_id"]) or {}).get("name", ""),
        "owner_name": (store.user(v.get("assigned_to")) or {}).get("name") if v.get("assigned_to") else None,
        "overdue": bool(due and due < today and v["status"] != "CLOSED"),
        "days_overdue": max(0, (today - due).days) if due and v["status"] != "CLOSED" else 0,
        "sla_days": sla,
        "sla_state": "CLOSED"
        if v["status"] == "CLOSED"
        else "BREACHED"
        if age > sla
        else "AT_RISK"
        if age >= sla * 0.7
        else "ON_TRACK",
        "evidence_items": store.evidence_for(v["id"]),
        "actions": [a for a in store.data["corrective_actions"] if a["violation_id"] == v["id"]],
        "next_status": _next_status(store, v),
        "allowed_transitions": W.ALLOWED_TRANSITIONS.get(v["status"], []),
        "projected_risk_relief": None,
    }


def _zone_factors(store, zone_id: str) -> Dict[str, float]:
    risk = (store.zone_assessment(zone_id) or {}).get("risk", {})
    return {f["key"]: f["points"] for f in risk.get("factors", [])}


def _factor_delta(before: Dict[str, float], after: Dict[str, float]) -> List[Dict[str, Any]]:
    from ..services.risk_engine import FACTOR_LABELS

    out = []
    for key, label in FACTOR_LABELS.items():
        b, a = before.get(key, 0.0), after.get(key, 0.0)
        if abs(a - b) >= 0.05:
            out.append({"key": key, "label": label, "before": round(b, 1), "after": round(a, 1), "delta": round(a - b, 1)})
    return out


def _next_status(store, v: dict) -> Optional[str]:
    order = W.FLOW_ORDER
    idx = order.index(v["status"])
    if v["status"] == "UNDER_VERIFICATION":
        return "CLOSED"
    if v["status"] == "CLOSED":
        return None
    if v["status"] == "OPEN" and not v.get("assigned_to"):
        return "ASSIGNED"
    return order[idx + 1] if idx + 1 < len(order) else None


def _explain_impact(before: Dict[str, float], after: Dict[str, float], score_before: float, score_after: float) -> str:
    """
    Plain-language account of why a number moved — including the
    counter-intuitive case, where completing an inspection lowers the
    inspection-delay factor even while severity exposure rises.
    """
    deltas = _factor_delta(before, after)
    ups = [d for d in deltas if d["delta"] > 0]
    downs = [d for d in deltas if d["delta"] < 0]
    net = round(score_after - score_before, 1)
    parts = []
    if ups:
        parts.append("increased: " + ", ".join(f"{d['label']} +{d['delta']:.1f}" for d in ups))
    if downs:
        parts.append("decreased: " + ", ".join(f"{d['label']} {d['delta']:.1f}" for d in downs))
    if not parts:
        return "No factor moved materially, so the zone score is unchanged."
    lead = "Severity exposure " if (not downs and not ups) else ""
    verdict = (
        f"Net effect on zone risk: {net:+.1f} points."
        if abs(net) >= 0.5
        else "Net effect on zone risk is close to zero: the increase and the relief offset each other."
    )
    return f"{lead}{'; '.join(parts)}. {verdict}"


def _action_view(store, a: dict) -> dict:
    today = date.today()
    due = date.fromisoformat(a["due_date"]) if a.get("due_date") else None
    v = store.find("violations", a["violation_id"]) or {}
    zone = store.zone(a.get("zone_id", "")) or {}
    return {
        **a,
        "violation_severity": v.get("severity", "MEDIUM"),
        "violation_status": v.get("status", ""),
        "violation_category": v.get("category", ""),
        "zone_name": zone.get("name", ""),
        "zone_short": zone.get("short_name", ""),
        "mine_name": (store.mine(a["mine_id"]) or {}).get("name", ""),
        "owner_name": (store.user(a["assigned_to"]) or {}).get("name", "—"),
        "owner_initials": (store.user(a["assigned_to"]) or {}).get("initials", "—"),
        "days_overdue": max(0, (today - due).days) if due and a["status"] not in {"CLOSED", "VERIFIED"} and due < today else 0,
        "age_days": (today - date.fromisoformat(a["created_at"])).days,
        "is_overdue": bool(due and due < today and a["status"] not in {"CLOSED", "VERIFIED"}),
        "evidence_items": [e for e in store.data["evidence"] if e.get("action_id") == a["id"]],
        "can_verify": a["status"] == "SUBMITTED",
    }


# ---------------------------------------------------------------- inspections
@router.get("/api/inspections")
def list_inspections(
    store=Depends(get_store),
    mine_id: Optional[str] = None,
    zone_id: Optional[str] = None,
    department: Optional[str] = None,
    inspector_id: Optional[str] = None,
    days: int = Query(90, ge=7, le=365),
):
    cutoff = date.today() - timedelta(days=days)
    rows = []
    for i in store.data["inspections"]:
        if mine_id and i["mine_id"] != mine_id:
            continue
        if zone_id and i["zone_id"] != zone_id:
            continue
        if department and i["department"] != department.upper():
            continue
        if inspector_id and i["inspector_id"] != inspector_id:
            continue
        if date.fromisoformat(i["inspection_date"]) < cutoff:
            continue
        rows.append(
            {
                **i,
                "mine_name": (store.mine(i["mine_id"]) or {}).get("name", ""),
                "zone_name": (store.zone(i["zone_id"]) or {}).get("name", ""),
                "zone_short": (store.zone(i["zone_id"]) or {}).get("short_name", ""),
                "violations": [store.find("violations", vid) for vid in i.get("violation_ids", []) if store.find("violations", vid)],
            }
        )
    rows.sort(key=lambda r: r["inspection_date"], reverse=True)
    # zones whose cadence has lapsed: where the next round should go
    due = []
    for z in store.zones(mine_id):
        risk = (store.zone_assessment(z["id"]) or {}).get("risk", {})
        m = risk.get("metrics", {})
        since = m.get("days_since_inspection")
        cadence = m.get("inspection_cadence_days", 21)
        if since is None or since >= cadence * 0.75:
            due.append(
                {
                    "zone_id": z["id"],
                    "zone": z["name"],
                    "zone_short": z["short_name"],
                    "mine": (store.mine(z["mine_id"]) or {}).get("name", ""),
                    "department": z["primary_department"],
                    "days_since": since,
                    "cadence": cadence,
                    "overdue": bool(since is None or since > cadence),
                    "risk_score": risk.get("risk_score", 0),
                    "risk_level": risk.get("risk_level", "LOW"),
                    "open_violations": m.get("open_violations", 0),
                }
            )
    due.sort(key=lambda d: (not d["overdue"], -d["risk_score"]))
    return {
        "inspections": rows,
        "total": len(rows),
        "due_zones": due,
        "inspector_load": [
            {
                "user": u,
                "count": len([i for i in store.data["inspections"] if i["inspector_id"] == u["id"]]),
                "findings": len(
                    [
                        v
                        for v in store.data["violations"]
                        if (store.find("inspections", v.get("inspection_id") or "") or {}).get("inspector_id") == u["id"]
                    ]
                ),
            }
            for u in store.data["users"]
            if u["role"] == "INSPECTOR"
        ],
    }


@router.get("/api/inspections/{inspection_id}")
def inspection_detail(inspection_id: str, store=Depends(get_store)):
    i = store.find("inspections", inspection_id)
    if not i:
        raise HTTPException(status_code=404, detail="Inspection not found.")
    violations = [ _decorate(store, v) for v in store.data["violations"] if v.get("inspection_id") == inspection_id]
    return {
        **i,
        "mine": store.mine(i["mine_id"]),
        "zone": store.zone(i["zone_id"]),
        "violations": violations,
        "evidence": [e for e in store.data["evidence"] if e.get("violation_id") in {v["id"] for v in violations}],
    }


@router.post("/api/inspections", status_code=201)
def create_inspection(payload: InspectionCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    """
    Recording a round creates the inspection, then each finding as a violation
    in the same transaction, then re-scores the affected zones. The response
    carries the before/after risk for every touched zone — this is the beat
    where the demo shows the number moving.
    """
    zone = store.zone(payload.zone_id)
    mine = store.mine(payload.mine_id)
    if not zone or not mine:
        raise HTTPException(status_code=400, detail="Unknown mine or zone.")
    if zone["mine_id"] != payload.mine_id:
        raise HTTPException(status_code=400, detail=f"{zone['name']} belongs to a different mine.")
    if payload.overall_rating == "COMPLIANT" and payload.findings:
        raise HTTPException(
            status_code=400,
            detail="This round is marked COMPLIANT but findings are attached. Set the rating to NON_COMPLIANT or remove the findings.",
        )
    if payload.findings and payload.overall_rating == "COMPLIANT":
        raise HTTPException(status_code=400, detail="A compliant round cannot carry violations.")

    with store.lock:
        before = {payload.zone_id: (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("risk_score", 0)}
        factors_before = _zone_factors(store, payload.zone_id)
        inspection = {
            "id": store.next_id("inspections", "INSP"),
            "mine_id": payload.mine_id,
            "zone_id": payload.zone_id,
            "department": payload.department,
            "inspector_id": payload.inspector_id,
            "inspector": (store.user(payload.inspector_id) or {}).get("name", payload.inspector_id),
            "inspection_date": payload.inspection_date or date.today().isoformat(),
            "status": "COMPLETED",
            "observations": payload.observations.strip(),
            "overall_rating": payload.overall_rating,
            "issues_found": 0,
            "violation_ids": [],
            "evidence_count": 0,
        }
        store.data["inspections"].append(inspection)
        inspector = store.user(payload.inspector_id) or {}
        store.log(
            actor.get("id", payload.inspector_id),
            "INSPECTION",
            f"{inspection['id']} recorded for {zone['name']} by {inspector.get('name', '—')} ({payload.department}).",
            inspection["id"],
        )

        created_violations: List[dict] = []
        errors: List[str] = []
        for finding in payload.findings:
            try:
                v = W.create_violation(
                    store,
                    mine_id=payload.mine_id,
                    zone_id=payload.zone_id,
                    category=finding.category,
                    severity=finding.severity,
                    description=finding.description,
                    inspection_id=inspection["id"],
                    department=finding.department or payload.department,
                    notes=finding.notes,
                    assigned_to=finding.assigned_to,
                    due_date=finding.due_date,
                    actor_id=actor.get("id"),
                )
                if finding.evidence_file:
                    W.add_evidence(
                        store,
                        violation_id=v["id"],
                        file_name=finding.evidence_file,
                        note=finding.notes or "Field evidence attached at inspection time.",
                        uploaded_by=actor.get("id", "U-101"),
                    )
                if finding.create_action and finding.assigned_to:
                    W.create_action(
                        store,
                        violation_id=v["id"],
                        description=W.ACTION_TEXT_DEFAULT,
                        assigned_to=finding.assigned_to,
                        due_date=finding.due_date,
                        actor_id=actor.get("id"),
                    )
                created_violations.append(v)
            except W.WorkflowError as exc:
                errors.append(str(exc))

        if payload.evidence_file:
            W.add_evidence(
                store,
                violation_id=created_violations[0]["id"] if created_violations else None,
                file_name=payload.evidence_file,
                note=payload.observations[:200],
                uploaded_by=actor.get("id", "U-101"),
            )
        inspection["evidence_count"] = len([e for e in store.data["evidence"] if e.get("violation_id") in {v["id"] for v in created_violations}])

    after = (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("risk_score", 0)
    factors_after = _zone_factors(store, payload.zone_id)
    return {
        "inspection": inspection,
        "violations": [_decorate(store, v) for v in created_violations],
        "rejected_findings": errors,
        "risk_impact": {
            "zone_id": payload.zone_id,
            "zone_name": zone["name"],
            "before": before.get(payload.zone_id, 0),
            "after": after,
            "delta": round(after - before.get(payload.zone_id, 0), 1),
            "level": (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("risk_level"),
            "factor_delta": _factor_delta(factors_before, factors_after),
            "explanation": _explain_impact(factors_before, factors_after, before.get(payload.zone_id, 0), after),
            "factors": (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("factors", []),
            "drivers": (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("drivers", []),
        },
        "new_alerts": [
            a
            for a in store.data.get("alerts", [])
            if a["scope_id"] == payload.zone_id and a["severity"] in {"CRITICAL", "HIGH"}
        ][:3],
        "ok": not errors,
    }


# ---------------------------------------------------------------- violations
@router.get("/api/violations")
def list_violations(
    store=Depends(get_store),
    mine_id: Optional[str] = None,
    zone_id: Optional[str] = None,
    department: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    evidence: Optional[str] = None,
    sort: str = Query("risk", pattern="^(risk|age|severity|created|due)$"),
    limit: int = Query(200, ge=1, le=1000),
):
    rows = []
    for v in store.data["violations"]:
        if mine_id and v["mine_id"] != mine_id:
            continue
        if zone_id and v["zone_id"] != zone_id:
            continue
        if department and v["department"] != department.upper():
            continue
        if severity and v["severity"] != severity.upper():
            continue
        if status:
            if status.upper() == "OVERDUE":
                row = _decorate(store, v)
                if not row["overdue"]:
                    continue
            elif status.upper() == "OPEN_ANY":
                if v["status"] == "CLOSED":
                    continue
            elif v["status"] != status.upper():
                continue
        if assigned_to == "unassigned" and v.get("assigned_to"):
            continue
        if assigned_to and assigned_to != "unassigned" and v.get("assigned_to") != assigned_to:
            continue
        if evidence == "missing" and v.get("evidence_count", 0):
            continue
        if evidence == "present" and not v.get("evidence_count", 0):
            continue
        if search and search.lower() not in (v["description"] + v["category"] + v["id"]).lower():
            continue
        rows.append(_decorate(store, v))
    key = {
        "risk": lambda r: -r.get("risk_contribution", 0),
        "age": lambda r: -r["age_days"],
        "severity": lambda r: -SEVERITY_WEIGHTS[r["severity"]],
        "created": lambda r: r["created_at"],
        "due": lambda r: r.get("due_date") or "9999",
    }[sort]
    rows.sort(key=key)
    today = date.today()
    counts = {
        s: len([v for v in store.data["violations"] if v["status"] == s])
        for s in store.data["config"]["violation_statuses"]
    }
    counts["OVERDUE"] = len([v for v in rows if v["overdue"] and v["status"] != "CLOSED"])
    return {
        "violations": rows[:limit],
        "total": len(rows),
        "status_counts": counts,
        "filters": {
            "mines": store.data["mines"],
            "zones": store.data["zones"],
            "departments": store.data["config"]["departments"],
            "severities": list(SEVERITY_WEIGHTS.keys()),
            "statuses": store.data["config"]["violation_statuses"],
            "officers": [u for u in store.data["users"] if u["role"] in {"OFFICER", "MANAGER"}],
        },
    }


@router.get("/api/violations/{violation_id}")
def violation_detail(violation_id: str, store=Depends(get_store)):
    v = store.find("violations", violation_id)
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found.")
    row = _decorate(store, v)
    zone = store.zone(v["zone_id"]) or {}
    overrides = [o for o in store.data.get("workflow_overrides", []) if o["violation_id"] == violation_id]
    related = [
        {"id": o["id"], "category": o["category"], "severity": o["severity"], "created_at": o["created_at"], "status": o["status"]}
        for o in store.data["violations"]
        if o["zone_id"] == v["zone_id"] and o["category"] == v["category"] and o["id"] != violation_id
    ]
    return {
        **row,
        "zone": zone,
        "mine": store.mine(v["mine_id"]),
        "timeline": _timeline(store, v),
        "repeat_history": related[:6],
        "overrides": overrides,
        "zone_risk": (store.zone_assessment(v["zone_id"]) or {}).get("risk", {}),
        "relief_if_closed": (
            simulate(store, v["zone_id"], close_violation_ids=[v["id"]], resolve_action_ids=[a["id"] for a in store.data["corrective_actions"] if a["violation_id"] == v["id"]])
            if v["status"] != "CLOSED"
            else None
        ),
    }


def _timeline(store, v: dict) -> List[dict]:
    """Reconstruct the audit trail from records rather than a separate log."""
    events = [
        {"at": v["created_at"], "kind": "CREATED", "label": "Violation recorded", "actor": (store.find("inspections", v.get("inspection_id") or "") or {}).get("inspector", "Inspector")}
    ]
    if v.get("assigned_to"):
        events.append(
            {
                "at": v.get("created_at"),
                "kind": "ASSIGNED",
                "label": f"Assigned to {(store.user(v['assigned_to']) or {}).get('name', '—')}",
                "actor": (store.user(v["assigned_to"]) or {}).get("name", "—"),
            }
        )
    for a in [a for a in store.data["corrective_actions"] if a["violation_id"] == v["id"]]:
        events.append({"at": a["created_at"], "kind": "ACTION", "label": f"Corrective action {a['id']} raised", "actor": a["status"]})
        if a.get("started_at"):
            events.append({"at": a["started_at"], "kind": "PROGRESS", "label": "Work started", "actor": a["status"]})
        if a.get("completed_at"):
            events.append({"at": a["completed_at"], "kind": "SUBMITTED", "label": "Resolution submitted for verification", "actor": (store.user(a["assigned_to"]) or {}).get("name", "—")})
        if a.get("verified_at"):
            events.append(
                {
                    "at": a["verified_at"],
                    "kind": "VERIFIED",
                    "label": f"{'Verified and closed' if a['status'] in {'VERIFIED', 'CLOSED'} else 'Rejected — returned to officer'}",
                    "actor": (store.user(a.get("verified_by") or "") or {}).get("name", "Mine Manager"),
                }
            )
    if v.get("closed_at"):
        events.append({"at": v["closed_at"], "kind": "CLOSED", "label": "Finding closed", "actor": "system"})
    for o in store.data.get("workflow_overrides", []):
        if o["violation_id"] == v["id"]:
            events.append({"at": o["created_at"], "kind": "OVERRIDE", "label": f"Workflow override: {o['from_status']} → {o['to_status']}", "actor": o["actor"]})
    events.sort(key=lambda e: str(e.get("at")))
    return events


@router.post("/api/violations", status_code=201)
def create_violation(payload: ViolationCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    with store.lock:
        before = (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("risk_score", 0)
        factors_before = _zone_factors(store, payload.zone_id)
        try:
            v = W.create_violation(
                store,
                mine_id=payload.mine_id,
                zone_id=payload.zone_id,
                category=payload.category,
                severity=payload.severity,
                description=payload.description,
                inspection_id=payload.inspection_id,
                department=payload.department,
                notes=payload.notes,
                assigned_to=payload.assigned_to,
                due_date=payload.due_date,
                actor_id=actor.get("id"),
            )
        except W.WorkflowError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if payload.evidence_file:
            W.add_evidence(store, violation_id=v["id"], file_name=payload.evidence_file, note=payload.notes, uploaded_by=actor.get("id"))
    after = (store.zone_assessment(payload.zone_id) or {}).get("risk", {}).get("risk_score", 0)
    factors_after = _zone_factors(store, payload.zone_id)
    return {
        "violation": _decorate(store, v),
        "risk_impact": {
            "before": before,
            "after": after,
            "delta": round(after - before, 1),
            "zone_name": (store.zone(payload.zone_id) or {}).get("name", ""),
            "factor_delta": _factor_delta(factors_before, factors_after),
            "explanation": _explain_impact(factors_before, factors_after, before, after),
        },
    }


@router.patch("/api/violations/{violation_id}")
def change_status(violation_id: str, payload: StatusChange, store=Depends(get_store), actor: dict = Depends(get_actor)):
    try:
        v = W.advance_violation(
            store,
            violation_id,
            payload.status,
            actor_id=actor.get("id"),
            note=payload.note,
            override=payload.override,
        )
    except W.WorkflowPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except W.WorkflowError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    zone = store.zone(v["zone_id"]) or {}
    return {
        "violation": _decorate(store, v),
        "zone_risk": (store.zone_assessment(v["zone_id"]) or {}).get("risk", {}),
        "message": f"{v['id']} is now {v['status'].replace('_', ' ')} in {zone.get('short_name', '')}.",
    }


@router.post("/api/violations/{violation_id}/assign")
def assign(violation_id: str, payload: AssignPayload, store=Depends(get_store), actor: dict = Depends(get_actor)):
    try:
        v = W.assign_violation(store, violation_id, officer_id=payload.officer_id, due_date=payload.due_date, actor_id=actor.get("id"))
    except W.WorkflowError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"violation": _decorate(store, v), "zone_risk": (store.zone_assessment(v["zone_id"]) or {}).get("risk", {})}


# ------------------------------------------------------------ corrective work
@router.get("/api/corrective-actions")
def list_actions(
    store=Depends(get_store),
    mine_id: Optional[str] = None,
    zone_id: Optional[str] = None,
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
):
    rows = []
    for a in store.data["corrective_actions"]:
        row = _action_view(store, a)
        if mine_id and a["mine_id"] != mine_id:
            continue
        if zone_id and a.get("zone_id") != zone_id:
            continue
        if assigned_to and a["assigned_to"] != assigned_to:
            continue
        if status:
            s = status.upper()
            if s == "OVERDUE" and not row["is_overdue"]:
                continue
            if s == "PENDING_VERIFICATION" and a["status"] != "SUBMITTED":
                continue
            if s == "ACTIVE" and a["status"] in {"CLOSED", "VERIFIED"}:
                continue
            if s not in {"OVERDUE", "PENDING_VERIFICATION", "ACTIVE"} and a["status"] != s:
                continue
        rows.append(row)
    rows.sort(key=lambda r: (-r["is_overdue"], -r["days_overdue"], r["due_date"] or "9999"))
    today = date.today()
    open_actions = [a for a in store.data["corrective_actions"] if a["status"] not in {"CLOSED", "VERIFIED"}]
    return {
        "actions": rows,
        "total": len(rows),
        "summary": {
            "open": len(open_actions),
            "overdue": len([a for a in rows if a["is_overdue"]]),
            "awaiting_verification": len([a for a in store.data["corrective_actions"] if a["status"] == "SUBMITTED"]),
            "due_soon": len(
                [
                    a
                    for a in open_actions
                    if a.get("due_date") and 0 <= (date.fromisoformat(a["due_date"]) - today).days <= 3
                ]
            ),
            "closed_30d": len(
                [
                    a
                    for a in store.data["corrective_actions"]
                    if a["status"] in {"CLOSED", "VERIFIED"}
                    and a.get("closed_at")
                    and (today - date.fromisoformat(a["closed_at"])).days <= 30
                ]
            ),
        },
        "by_owner": [
            {
                "owner": u,
                "count": len([r for r in rows if r["owner_name"] == u]),
                "overdue": len([r for r in rows if r["owner_name"] == u and r["is_overdue"]]),
            }
            for u in sorted({r["owner_name"] for r in rows})
        ],
    }


@router.post("/api/corrective-actions", status_code=201)
def create_action(payload: ActionCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    try:
        a = W.create_action(
            store,
            violation_id=payload.violation_id,
            description=payload.description,
            assigned_to=payload.assigned_to,
            due_date=payload.due_date,
            actor_id=actor.get("id"),
        )
    except W.WorkflowError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    zone = store.zone(a["zone_id"]) or {}
    vio = store.find("violations", a["violation_id"])
    return {
        "action": _action_view(store, a),
        "violation": _decorate(store, vio) if vio else None,
        "zone_risk": (store.zone_assessment(a["zone_id"]) or {}).get("risk", {}),
        "message": f"{a['id']} created for {(vio or {}).get('id', '')} and assigned to {(store.user(a['assigned_to']) or {}).get('name', '—')}. Due {a['due_date']}.",
    }


@router.patch("/api/corrective-actions/{action_id}")
def update_action(action_id: str, payload: ActionUpdate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    before_score = (store.zone_assessment((store.find("corrective_actions", action_id) or {}).get("zone_id", "")) or {}).get("risk", {}).get("risk_score", 0)
    try:
        a = W.update_action(
            store,
            action_id,
            status=payload.status,
            resolution_notes=payload.resolution_notes,
            verification_notes=payload.verification_notes,
            due_date=payload.due_date,
            assigned_to=payload.assigned_to,
            actor_id=actor.get("id"),
        )
    except W.WorkflowPermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except W.WorkflowError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    v = store.find("violations", a["violation_id"]) or {}
    after_score = (store.zone_assessment(a["zone_id"]) or {}).get("risk", {}).get("risk_score", 0)
    return {
        "action": _action_view(store, a),
        "violation": _decorate(store, v) if v else None,
        "zone_risk": (store.zone_assessment(a["zone_id"]) or {}).get("risk", {}),
        "risk_impact": {
            "before": before_score,
            "after": after_score,
            "delta": round(after_score - before_score, 1),
            "zone_name": (store.zone(a["zone_id"]) or {}).get("name", ""),
        },
        "message": {
            "SUBMITTED": f"{a['id']} submitted for verification. {v.get('id', '')} is now ACTION_SUBMITTED.",
            "VERIFIED": f"{a['id']} verified. {v.get('id', '')} closed and risk recalculated.",
            "REJECTED": f"{a['id']} rejected — returned to {(store.user(a['assigned_to']) or {}).get('name', 'the officer')} with your note.",
        }.get(a["status"], f"{a['id']} updated to {a['status']}. "),
    }


@router.post("/api/evidence", status_code=201)
def add_evidence(payload: EvidenceCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    try:
        ev = W.add_evidence(
            store,
            violation_id=payload.violation_id,
            action_id=payload.action_id,
            file_name=payload.file_name,
            note=payload.note,
            kind=payload.kind,
            uploaded_by=actor.get("id", "U-101"),
        )
    except W.WorkflowError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"evidence": ev}


# ------------------------------------------------------------- what-if tools
@router.post("/api/risk/simulate")
def run_simulation(payload: SimulatePayload, store=Depends(get_store)):
    try:
        return simulate(
            store,
            payload.zone_id,
            close_violation_ids=payload.close_violation_ids,
            resolve_action_ids=payload.resolve_action_ids,
            add_violation=payload.add_violation,
            inspect_now=payload.inspect_now,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # engine contract violation
        raise HTTPException(status_code=400, detail=f"Simulation failed: {exc}") from exc

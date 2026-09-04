"""MINEGUARD AI — documents, reports and administration."""

from __future__ import annotations

import os
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from ..deps import get_actor, get_store, require_role
from ..services import documents as DOCS
from ..services.risk_engine import describe_engine
from ..services import reports as REPORTS

router = APIRouter(tags=["enterprise"])


# ---------------------------------------------------------- document intel
@router.get("/api/documents")
def list_documents(store=Depends(get_store), mine_id: Optional[str] = None, status: Optional[str] = None):
    rows = []
    for d in store.data.get("documents", []):
        if mine_id and d.get("mine_id") != mine_id:
            continue
        if status and d.get("status") != status.upper():
            continue
        users = {u["id"]: u["name"] for u in store.data["users"]}
        rows.append(
            {
                **d,
                "uploader": users.get(d.get("uploaded_by"), d.get("uploaded_by", "—")),
                "mine_name": (store.mine(d.get("mine_id", "")) or {}).get("name", ""),
                "zone_name": (store.zone(d.get("zone_id") or "") or {}).get("short_name"),
                "type_label": d.get("doc_type", "UNCLASSIFIED").replace("_", " ").title(),
            }
        )
    rows.sort(key=lambda r: r["uploaded_at"], reverse=True)
    return {
        "documents": rows,
        "pipeline": ["UPLOAD", "TEXT EXTRACTION / OCR", "CLASSIFICATION", "KEY INFORMATION EXTRACTION", "CROSS-CHECK AGAINST REGISTER", "SUGGESTED REGISTER ENTRIES"],
        "engines": DOCS.available_engines(),
        "stats": {
            "total": len(rows),
            "processed": len([r for r in rows if r["status"] == "PROCESSED"]),
            "failed": len([r for r in rows if r["status"] == "FAILED"]),
            "flags": sum(len(r.get("flags", [])) for r in rows),
        },
    }


@router.post("/api/documents/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    mine_id: str = Form(...),
    zone_id: str = Form(""),
    notes: str = Form(""),
    store=Depends(get_store),
    actor: dict = Depends(get_actor),
):
    if not store.mine(mine_id):
        raise HTTPException(status_code=400, detail="Unknown mine.")
    if zone_id and not store.zone(zone_id):
        raise HTTPException(status_code=400, detail="Unknown zone.")
    allowed = (".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg")
    name = file.filename or "document.pdf"
    if not name.lower().endswith(allowed):
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Accepted: {', '.join(allowed)}.")
    content = await file.read()
    if len(content) > 12_000_000:
        raise HTTPException(status_code=413, detail="File exceeds the 12 MB processing limit.")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    doc = DOCS.store_upload(
        store,
        file_name=name,
        content=content,
        mine_id=mine_id,
        zone_id=zone_id or None,
        uploaded_by=actor.get("id", "U-301"),
        notes=notes,
    )
    return {
        "document": doc,
        "risk_impact": {
            "note": "Document intelligence is deliberately decoupled from scoring: extracted data becomes risk only when it is turned into a register entry.",
        },
    }


@router.post("/api/documents/{doc_id}/reprocess")
def reprocess_document(doc_id: str, store=Depends(get_store), actor: dict = Depends(get_actor)):
    doc = store.find("documents", doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    path = doc.get("stored_path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=409, detail="Source file is not available in this environment — nothing to re-read. Re-upload the original document.")
    result = DOCS.extract(path, doc["file_name"])
    if not result.text.strip():
        doc["status"] = "FAILED"
        doc["flags"] = sorted(set(list(doc.get("flags", [])) + [result.error or "no text"]))
        doc["confidence"] = 0.0
        store.touch()
        return {"document": doc, "message": f"Re-processing failed: {result.error}. The document stays flagged rather than being guessed at."}
    doc["status"] = "PROCESSED"
    doc["ocr_engine"] = result.engine
    doc["confidence"] = DOCS.classify(result.text, doc["file_name"])[1]
    doc_type, _ = DOCS.classify(result.text, doc["file_name"])
    doc["doc_type"] = doc_type
    doc["extracted"] = DOCS.extract_fields(result.text)
    doc["summary"] = DOCS._summary(doc_type, doc["extracted"], None)
    doc["flags"] = DOCS.gap_flags(store, doc)
    store.log(actor.get("id"), "DOCUMENT", f"{doc['file_name']} re-processed with {result.engine}.", doc_id)
    store.touch()
    return {"document": doc, "message": f"Re-processed with {result.engine}: {len(doc['extracted'])} field(s) extracted."}


class LinkPayload(BaseModel):
    zone_id: str = Field(min_length=3)
    create_violations: bool = True


@router.post("/api/documents/{doc_id}/link")
def link_document(doc_id: str, payload: LinkPayload, store=Depends(get_store), actor: dict = Depends(get_actor)):
    """
    Turn a document gap into a register entry. This is what stops document
    intelligence being decorative: a mismatch found in a report becomes a real
    violation that flows through the same workflow and scoring path.
    """
    from ..services import workflow as W

    doc = store.find("documents", doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    zone = store.zone(payload.zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")
    require_role(actor, "MANAGER", "ADMIN", "OFFICER", "INSPECTOR")
    created = []
    if payload.create_violations and doc.get("extracted", {}).get("defects_found"):
        try:
            claimed = int(doc["extracted"]["defects_found"])
        except (TypeError, ValueError):
            claimed = 0
        open_count = len([v for v in store.data["violations"] if v["zone_id"] == zone["id"] and v["status"] != "CLOSED"])
        gap = max(0, claimed - open_count)
        for _ in range(min(gap, 3)):
            try:
                v = W.create_violation(
                    store,
                    mine_id=zone["mine_id"],
                    zone_id=zone["id"],
                    category="Safety Equipment",
                    severity=doc.get("severity_hint") or "MEDIUM",
                    description=(
                        f"Finding present in {doc['file_name']} but absent from the compliance register "
                        f"(document reports {claimed}, register holds {open_count})."
                    ),
                    notes="Raised automatically from document cross-check.",
                    actor_id=actor.get("id"),
                )
            except W.WorkflowError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            created.append(v)
    doc["linked_violations"] = sorted(set(list(doc.get("linked_violations") or []) + [v["id"] for v in created]))
    doc["flags"] = [f for f in doc.get("flags", []) if "only" not in f]
    store.log(actor.get("id"), "DOCUMENT", f"{doc_id} reconciled with the register: {len(created)} violation(s) raised.", doc_id)
    store.touch()
    return {
        "document": doc,
        "created": created,
        "zone_risk": (store.zone_assessment(zone["id"]) or {}).get("risk", {}),
        "message": (
            f"{len(created)} violation(s) raised from the document gap."
            if created
            else "No register gap to close — the document matches what is already recorded."
        ),
    }


# -------------------------------------------------------------------- reports
@router.get("/api/reports")
def report_types(store=Depends(get_store)):
    return {
        "types": REPORTS.REPORT_TYPES,
        "mines": [{"id": m["id"], "name": m["name"]} for m in store.data["mines"]],
        "recent": list(reversed(store.data.get("generated_reports", [])))[:8],
    }


class ReportRequest(BaseModel):
    report_type: str
    mine_id: Optional[str] = None
    zone_id: Optional[str] = None
    days: int = Field(default=30, ge=7, le=90)


@router.post("/api/reports/generate")
def generate_report(payload: ReportRequest, store=Depends(get_store), actor: dict = Depends(get_actor)):
    if payload.report_type not in {r["id"] for r in REPORTS.REPORT_TYPES}:
        raise HTTPException(status_code=400, detail="Unknown report type.")
    needs_mine = payload.report_type in {"MINE_RISK_ASSESSMENT", "MINE_COMPLIANCE_SUMMARY"}
    if needs_mine and not payload.mine_id:
        raise HTTPException(status_code=400, detail="This report requires a mine selection.")
    if payload.mine_id and not store.mine(payload.mine_id):
        raise HTTPException(status_code=404, detail="Mine not found.")
    try:
        report = REPORTS.build_report(
            store,
            payload.report_type,
            mine_id=payload.mine_id,
            zone_id=payload.zone_id,
            days=payload.days,
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    entry = {
        "id": f"REP-{len(store.data.get('generated_reports', [])) + 1:04d}",
        "report_type": payload.report_type,
        "title": report["title"],
        "mine_id": payload.mine_id,
        "days": payload.days,
        "generated_at": report["generated_at"],
        "generated_by": actor.get("name", "System"),
    }
    store.data.setdefault("generated_reports", []).append(entry)
    store.data["generated_reports"] = store.data["generated_reports"][-30:]
    store.persist()
    return {"report": report, "record": entry}


@router.get("/api/reports/preview/{report_type}")
def preview_report(
    report_type: str,
    store=Depends(get_store),
    mine_id: Optional[str] = Query(None),
    days: int = Query(30, ge=7, le=90),
):
    try:
        return REPORTS.build_report(store, report_type, mine_id=mine_id, days=days)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/reports/download/{report_type}")
def download_report(
    report_type: str,
    store=Depends(get_store),
    mine_id: Optional[str] = Query(None),
    days: int = Query(30, ge=7, le=90),
    format: str = Query("md", pattern="^(md|csv|txt)$"),
):
    try:
        report = REPORTS.build_report(store, report_type, mine_id=mine_id, days=days)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    name = f"{report_type.lower()}-{(mine_id or 'enterprise').lower()}-{report['generated_at']}"
    if format == "csv":
        body, media = REPORTS.to_csv(report), "text/csv"
    elif format == "txt":
        body, media = REPORTS.to_markdown(report), "text/plain"
    else:
        body, media = REPORTS.to_markdown(report), "text/markdown"
    return Response(content=body, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}.{format}"'})


# ---------------------------------------------------------------- admin/demo
@router.get("/api/config")
def configuration(store=Depends(get_store)):
    return {
        **store.data["config"],
        "engine": describe_engine(store.engine),
        "as_of": store.data["computed"]["as_of"],
        "generated_at": store.data["computed"]["generated_at"],
        "counts": store.counts(),
        "ocr_engines": DOCS.available_engines(),
        "data_path": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "store.json")),
    }


@router.get("/api/users")
def users(store=Depends(get_store)):
    return {
        "users": [
            {
                **u,
                "open_actions": len([a for a in store.data["corrective_actions"] if a["assigned_to"] == u["id"] and a["status"] not in {"CLOSED", "VERIFIED"}]),
                "overdue_actions": len(
                    [
                        a
                        for a in store.data["corrective_actions"]
                        if a["assigned_to"] == u["id"]
                        and a["status"] not in {"CLOSED", "VERIFIED"}
                        and a.get("due_date")
                        and date.fromisoformat(a["due_date"]) < date.today()
                    ]
                ),
                "violations_owned": len([v for v in store.data["violations"] if v.get("assigned_to") == u["id"] and v["status"] != "CLOSED"]),
                "inspections": len([i for i in store.data["inspections"] if i["inspector_id"] == u["id"]]),
            }
            for u in store.data["users"]
        ]
    }


@router.get("/api/activity")
def activity(store=Depends(get_store), limit: int = Query(50, ge=5, le=200)):
    return {"activity": list(reversed(store.data.get("activity", [])))[:limit]}


@router.post("/api/admin/reset")
def reset_demo(store=Depends(get_store), actor: dict = Depends(get_actor)):
    """Restore the deterministic demo scenario. Safe to press at any point in a talk."""
    require_role(actor, "MANAGER", "ADMIN")
    store.reset()
    return {
        "ok": True,
        "message": "Seed scenario restored. All mines, zones, violations, actions and history are back to the deterministic baseline.",
        "counts": store.counts(),
        "enterprise": store.enterprise,
    }


class ScenarioPayload(BaseModel):
    name: str


@router.post("/api/admin/scenario")
def load_scenario(payload: ScenarioPayload, store=Depends(get_store), actor: dict = Depends(get_actor)):
    """One-click demo scenario: seeds the baseline, then walks the scripted flow."""
    require_role(actor, "MANAGER", "ADMIN")
    if payload.name != "ZONE_B_ESCALATION":
        raise HTTPException(status_code=400, detail="Only ZONE_B_ESCALATION is provided in this prototype.")
    from ..services import workflow as W

    store.reset()
    before = (store.zone_assessment("Z-ALPHA-B") or {}).get("risk", {}).get("risk_score", 0)
    v = W.create_violation(
        store,
        mine_id="MINE-ALPHA",
        zone_id="Z-ALPHA-B",
        category="Safety Equipment",
        severity="HIGH",
        description=(
            "Conveyor CV-2 emergency pull-cord switch inoperative for a third consecutive shift; "
            "previous replacement did not hold."
        ),
        notes="Escalated from the equipment yard round.",
        department="SAFETY",
        actor_id=actor.get("id"),
    )
    after = (store.zone_assessment("Z-ALPHA-B") or {}).get("risk", {}).get("risk_score", 0)
    return {
        "ok": True,
        "scenario": payload.name,
        "violation": v,
        "risk_impact": {"before": before, "after": after, "delta": round(after - before, 1)},
        "zone": store.zone("Z-ALPHA-B"),
        "alerts": [a for a in store.data.get("alerts", []) if a["scope_id"] == "Z-ALPHA-B"][:3],
    }


class OverrideNote(BaseModel):
    reason: str = Field(min_length=15, max_length=600)


@router.get("/api/admin/overrides")
def overrides(store=Depends(get_store)):
    return {"overrides": list(reversed(store.data.get("workflow_overrides", [])))}

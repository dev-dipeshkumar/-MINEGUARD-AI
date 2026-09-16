"""MINEGUARD AI — Governance modules router (PS SIH26024 gap closure).

Exposes the four new modules (production, attendance, contractors,
grievances) and the ML severity classifier. Each module follows the
same conventions as the existing routers:
  * GET endpoints read straight from the store-derived service output
  * POST endpoints end in store.touch() so denormalised scores stay fresh
  * role checks live in deps.require_role where mutations are gated
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..deps import get_actor, get_store, require_role
from ..services import attendance as A
from ..services import contractors as C
from ..services import grievances as G
from ..services import ml_severity as ML
from ..services import production as P
from ..services import scene3d as S3D

router = APIRouter(tags=["governance"])


# ===========================================================================
# PRODUCTION REPORTING
# ===========================================================================
class ProductionCreate(BaseModel):
    mine_id: str
    period_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    target_kt: float
    actual_kt: float
    shifts_worked: int = 26
    overburden_m3: float = 0.0
    strip_ratio: float = 2.8
    remarks: str = ""


@router.get("/api/production")
def list_production(store=Depends(get_store), mine_id: Optional[str] = Query(None), months: int = Query(6, ge=1, le=12)):
    return {"reports": P.list_reports(store, mine_id=mine_id, months=months), "summary": P.portfolio_summary(store)}


@router.get("/api/production/summary")
def production_summary(store=Depends(get_store)):
    return P.portfolio_summary(store)


@router.post("/api/production", status_code=201)
def create_production(payload: ProductionCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    require_role(actor, "MANAGER", "ADMIN")
    try:
        rec = P.create_report(
            store,
            mine_id=payload.mine_id,
            period_month=payload.period_month,
            target_kt=payload.target_kt,
            actual_kt=payload.actual_kt,
            shifts_worked=payload.shifts_worked,
            overburden_m3=payload.overburden_m3,
            strip_ratio=payload.strip_ratio,
            reported_by=actor["id"],
            remarks=payload.remarks,
        )
        return {"report": rec}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ===========================================================================
# ATTENDANCE
# ===========================================================================
class AttendanceCreate(BaseModel):
    mine_id: str
    present: int
    absent: int
    on_leave: int = 0
    contractor_workers: int = 0
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@router.get("/api/attendance")
def list_attendance(store=Depends(get_store), mine_id: Optional[str] = Query(None), days: int = Query(14, ge=1, le=90)):
    return {"records": A.list_records(store, mine_id=mine_id, days=days), "summary": A.summary(store)}


@router.get("/api/attendance/summary")
def attendance_summary(store=Depends(get_store)):
    return A.summary(store)


@router.post("/api/attendance", status_code=201)
def create_attendance(payload: AttendanceCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    require_role(actor, "OFFICER", "MANAGER", "ADMIN")
    try:
        rec = A.create_record(
            store,
            mine_id=payload.mine_id,
            present=payload.present,
            absent=payload.absent,
            on_leave=payload.on_leave,
            contractor_workers=payload.contractor_workers,
            latitude=payload.latitude,
            longitude=payload.longitude,
            verified_by=actor["id"],
        )
        return {"record": rec}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ===========================================================================
# CONTRACTORS
# ===========================================================================
class ContractorCreate(BaseModel):
    name: str = Field(min_length=5, max_length=120)
    service: str
    mine_id: str
    value_inr_lakh: float
    duration_months: int
    pan: str = Field(min_length=10, max_length=10)
    gst: str = Field(min_length=15, max_length=15)
    labour_strength: int


class ContractorStatusUpdate(BaseModel):
    status: Literal["ACTIVE", "AT_RISK", "EXPIRED", "TERMINATED"]
    performance_pct: Optional[float] = None
    compliant: Optional[bool] = None
    audit_status: Optional[Literal["CLEAN", "OBSERVATIONS", "NON_CONFORMANT"]] = None


@router.get("/api/contractors")
def list_contractors(store=Depends(get_store), mine_id: Optional[str] = Query(None), status: Optional[str] = Query(None)):
    return {"contractors": C.list_contractors(store, mine_id=mine_id, status=status), "summary": C.portfolio_summary(store)}


@router.get("/api/contractors/summary")
def contractor_summary(store=Depends(get_store)):
    return C.portfolio_summary(store)


@router.post("/api/contractors", status_code=201)
def create_contractor(payload: ContractorCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    require_role(actor, "MANAGER", "ADMIN")
    try:
        rec = C.create_contractor(
            store,
            name=payload.name,
            service=payload.service,
            mine_id=payload.mine_id,
            value_inr_lakh=payload.value_inr_lakh,
            duration_months=payload.duration_months,
            pan=payload.pan,
            gst=payload.gst,
            labour_strength=payload.labour_strength,
        )
        return {"contractor": rec}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/api/contractors/{contractor_id}")
def update_contractor(contractor_id: str, payload: ContractorStatusUpdate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    require_role(actor, "MANAGER", "ADMIN")
    try:
        rec = C.update_status(
            store,
            contractor_id,
            status=payload.status,
            performance_pct=payload.performance_pct,
            compliant=payload.compliant,
            audit_status=payload.audit_status,
            actor_id=actor["id"],
        )
        return {"contractor": rec}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ===========================================================================
# GRIEVANCES
# ===========================================================================
class GrievanceCreate(BaseModel):
    title: str = Field(min_length=10, max_length=200)
    category: str
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    mine_id: str
    department: Literal["SAFETY", "ENVIRONMENT", "LABOUR"]
    raised_by: str
    channel: Literal["WEB_PORTAL", "WHATSAPP_BOT", "IVR", "FIELD"] = "WEB_PORTAL"
    language: str = "en"


class GrievanceAdvance(BaseModel):
    status: Literal["UNDER_REVIEW", "ASSIGNED", "RESOLVED", "ESCALATED"]
    resolution_note: Optional[str] = None


@router.get("/api/grievances")
def list_grievances(store=Depends(get_store), mine_id: Optional[str] = Query(None), status: Optional[str] = Query(None), severity: Optional[str] = Query(None)):
    return {"grievances": G.list_grievances(store, mine_id=mine_id, status=status, severity=severity), "summary": G.summary(store)}


@router.get("/api/grievances/summary")
def grievance_summary(store=Depends(get_store)):
    return G.summary(store)


@router.post("/api/grievances", status_code=201)
def create_grievance(payload: GrievanceCreate, store=Depends(get_store), actor: dict = Depends(get_actor)):
    try:
        rec = G.create_grievance(
            store,
            title=payload.title,
            category=payload.category,
            severity=payload.severity,
            mine_id=payload.mine_id,
            department=payload.department,
            raised_by=payload.raised_by,
            channel=payload.channel,
            language=payload.language,
            actor_id=actor["id"],
        )
        return {"grievance": rec}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/grievances/{grievance_id}/advance")
def advance_grievance(grievance_id: str, payload: GrievanceAdvance, store=Depends(get_store), actor: dict = Depends(get_actor)):
    require_role(actor, "OFFICER", "MANAGER", "ADMIN")
    try:
        rec = G.advance(store, grievance_id, target=payload.status, resolution_note=payload.resolution_note, actor_id=actor["id"])
        return {"grievance": rec}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ===========================================================================
# ML SEVERITY CLASSIFIER
# ===========================================================================
class SeverityPredict(BaseModel):
    description: str = Field(min_length=5, max_length=2000)


class SeverityPredictBatch(BaseModel):
    descriptions: List[str] = Field(min_length=1, max_length=100)


@router.get("/api/ml/describe")
def ml_describe():
    return ML.engine_descriptor()


@router.post("/api/ml/predict-severity")
def ml_predict(payload: SeverityPredict):
    return ML.predict_severity(payload.description)


@router.post("/api/ml/predict-severity-batch")
def ml_predict_batch(payload: SeverityPredictBatch):
    return {"predictions": ML.predict_batch(payload.descriptions)}


# ===========================================================================
# 3D SCENE — novel immersive mine site view
# ===========================================================================
@router.get("/api/3d/portfolio")
def portfolio_scene(store=Depends(get_store)):
    """Multi-mine portfolio: all 4 mines as islands in a single 3D scene."""
    return S3D.portfolio_scene(store)


@router.get("/api/3d/mine/{mine_id}")
def mine_scene(mine_id: str, store=Depends(get_store)):
    """Per-mine detailed scene with mine-type-specific features."""
    try:
        return S3D.mine_scene(store, mine_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ===========================================================================
# RISK FORECASTER (research-grounded LSTM-style predictor)
# ===========================================================================
from ..services import forecaster as F

@router.get("/api/risk/forecast")
def risk_forecast_all(store=Depends(get_store)):
    """Forecast for every zone — ranked by 7-day delta from current."""
    out = F.forecast_all(store)
    out.sort(key=lambda x: -abs(x.get("delta_from_current", 0)))
    return {"forecasts": out, "as_of": date.today().isoformat()}


@router.get("/api/risk/forecast/{zone_id}")
def risk_forecast(zone_id: str, store=Depends(get_store)):
    """Predict the next 7 days of risk for a zone using a sliding-window MLP.

    Research grounding: Dey 2021 (142 cites) CNN-LSTM for mine hazards;
    Shi 2024 (163 cites) LSTM-Transformer for mine time-series.
    Implementation: sklearn MLPRegressor over a 14-day sliding window —
    no PyTorch dependency, retrains in <2s per zone, cached for 1 hour.
    """
    if not store.zone(zone_id):
        raise HTTPException(status_code=404, detail=f"Unknown zone {zone_id}")
    return F.forecast(store, zone_id)


# ===========================================================================
# CARBON FOOTPRINT MODULE (Ministry of Coal net-zero mandate alignment)
# ===========================================================================
from ..services import carbon as CBN

@router.get("/api/carbon/footprint")
def carbon_footprint(store=Depends(get_store), mine_id: Optional[str] = Query(None)):
    """Compute Scope 1 + 2 emissions per mine using IPCC emission factors."""
    return CBN.portfolio_footprint(store, mine_id=mine_id)


@router.get("/api/carbon/leaderboard")
def carbon_leaderboard(store=Depends(get_store)):
    """Rank mines by carbon intensity (tCO2e per kt of output)."""
    return {"leaderboard": CBN.intensity_leaderboard(store)}


# ===========================================================================
# IoT SENSOR INGESTION + LIVE STREAMING
# ===========================================================================
from ..services import sensors as SEN

class SensorReading(BaseModel):
    sensor_id: str = Field(..., min_length=4, max_length=40)
    mine_id: Optional[str] = None
    zone_id: Optional[str] = None
    type: Literal["METHANE", "CO", "TEMPERATURE", "HUMIDITY", "AIRFLOW", "SEISMIC"]
    value: float
    unit: str = Field(..., min_length=1, max_length=10)
    timestamp: Optional[str] = None  # ISO 8601; if absent, server time
    battery_pct: Optional[float] = None
    device_id: Optional[str] = None

class SensorBatch(BaseModel):
    readings: List[SensorReading] = Field(..., min_length=1, max_length=200)

@router.post("/api/sensors/ingest", status_code=201)
def ingest_sensor_reading(payload: SensorReading, store=Depends(get_store)):
    """Accept a NodeMCU-style JSON payload from a field sensor.

    The payload shape matches the standard NodeMCU ESP8266 format:
        { "sensor_id": "GS-ALP-01", "type": "METHANE", "value": 0.85, "unit": "%" }
    The endpoint is unauthenticated for prototype compatibility — in
    production this would be a token-gated webhook.
    """
    return {"reading": SEN.ingest(store, payload.model_dump())}


@router.post("/api/sensors/ingest-batch", status_code=201)
def ingest_sensor_batch(payload: SensorBatch, store=Depends(get_store)):
    """Batch ingest — for devices that buffer readings locally and sync."""
    out = [SEN.ingest(store, r.model_dump()) for r in payload.readings]
    return {"ingested": len(out), "readings": out}


@router.get("/api/sensors")
def list_sensors(store=Depends(get_store), mine_id: Optional[str] = Query(None), type: Optional[str] = Query(None), limit: int = Query(100, ge=1, le=500)):
    """Latest reading per sensor — drives the 3D scene's gas sensor entities."""
    return {"sensors": SEN.latest_per_sensor(store, mine_id=mine_id, type=type, limit=limit)}


@router.get("/api/sensors/{sensor_id}/history")
def sensor_history(sensor_id: str, store=Depends(get_store), hours: int = Query(24, ge=1, le=168)):
    """History series for a single sensor — used by the 3D scene's chart label."""
    return {"sensor_id": sensor_id, "history": SEN.history_for(store, sensor_id, hours=hours)}

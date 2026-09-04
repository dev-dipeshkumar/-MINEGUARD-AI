"""
MINEGUARD AI — API entry point.

    uvicorn api.main:app --host 0.0.0.0 --port 8000

Layering (see docs/ARCHITECTURE.md):

    routers/        HTTP surface: validation, status codes, serialisation
    services/       domain logic: risk engine, compliance, workflow, alerts,
                    insights, simulation, reports, document intelligence
    store.py        persistence + as-of record assembly (Postgres in prod)
    seed.py         deterministic demo reality

The API never scores and the UI never scores. Both call the same service, which
is what keeps the command centre, the map, the reports and the alerts agreeing
with each other.
"""

from __future__ import annotations

import os
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .routers import enterprise, intelligence, workflow
from .store import store

FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

app = FastAPI(
    title="MINEGUARD AI — Compliance Intelligence API",
    version="1.0.0",
    description=(
        "Enterprise compliance intelligence and early-warning platform for coal mine operations. "
        "Risk scoring is centralised in services/risk_engine.py; every read endpoint returns engine output, "
        "never client-side arithmetic."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # prototype: dev server on another port
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Mineguard-Engine"] = store.engine.mode
    response.headers["X-Mineguard-Compute-Ms"] = f"{(time.perf_counter() - start) * 1000:.0f}"
    return response


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    # Pydantic validators raise ValueError for domain rules (future dates etc.)
    return JSONResponse(status_code=400, content={"detail": str(exc)})


app.include_router(intelligence.router)
app.include_router(workflow.router)
app.include_router(enterprise.router)


@app.get("/api")
def api_root():
    return {
        "product": "MINEGUARD AI",
        "tagline": "Predict compliance risks before they become critical",
        "problem_statement": "SIH26024 — Coal Mine Compliance",
        "engine": {"mode": store.engine.mode, "label": store.engine.label, "phase": store.engine.phase},
        "as_of": store.data["computed"]["as_of"],
        "counts": store.counts(),
        "docs": "/docs",
        "endpoints": [
            "GET  /api/bootstrap",
            "GET  /api/dashboard",
            "GET  /api/mines",
            "GET  /api/mines/{id}",
            "GET  /api/mines/{id}/risk",
            "GET  /api/zones/{id}",
            "GET  /api/zones/{id}/risk",
            "GET  /api/inspections  POST /api/inspections",
            "GET  /api/violations   POST /api/violations   PATCH /api/violations/{id}",
            "POST /api/violations/{id}/assign",
            "GET  /api/corrective-actions  POST /api/corrective-actions  PATCH /api/corrective-actions/{id}",
            "POST /api/evidence",
            "GET  /api/alerts",
            "GET  /api/insights",
            "GET  /api/analytics",
            "POST /api/risk/simulate",
            "GET  /api/documents    POST /api/documents/upload",
            "GET  /api/reports      POST /api/reports/generate",
            "POST /api/admin/reset  POST /api/admin/scenario",
        ],
    }


@app.get("/api/healthz")
def healthz():
    return {"status": "ok", "as_of": store.data["computed"]["as_of"]}


# Static frontend: when a production build exists, the API serves it, so the
# whole product runs on one port. In dev, Vite serves the UI and proxies /api.
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

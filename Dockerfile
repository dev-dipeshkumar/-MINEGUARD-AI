# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# MINEGUARD AI — single-image deploy (used by Render; works on any Docker host)
#
#   docker build -t mineguard-ai .
#   docker run -p 8000:8000 -e PORT=8000 mineguard-ai
#
# Stage 1 compiles the Vite SPA; stage 2 serves it from FastAPI, so the whole
# product is one origin — the client keeps using its relative `/api` base and
# no CORS or environment wiring is needed at runtime. `frontend/dist` never
# enters the repo (see .gitignore); it exists only inside this image.
# ---------------------------------------------------------------------------

# ---- stage 1: frontend build ------------------------------------------------
FROM node:20-alpine AS web
WORKDIR /web
# Dependency layer first: unchanged lockfile => cached npm ci on rebuilds.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --fund=false
COPY frontend/ ./
# `npm run build` is `tsc --noEmit && vite build` — the strict typecheck is part
# of the image build, so a type error fails the deploy instead of shipping.
RUN npm run build

# ---- stage 2: backend + static SPA -----------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000
WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

# The app package, then the compiled SPA where api/main.py expects it
# (FRONTEND_DIST = <repo root>/frontend/dist, mounted at import time).
COPY api/ ./api/
COPY --from=web /web/dist ./frontend/dist

# The JSON store and document uploads are the only writable state
# (api/store.py DATA_PATH, api/services/documents.py UPLOAD_DIR). The directory
# is intentionally left EMPTY: Store.load() seeds the deterministic baseline on
# first boot, so a fresh container is a fresh demo.
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/data/uploads \
    && chown -R app:app /app
USER app
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','10000'), timeout=4)"

CMD ["sh", "-c", "python -m uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-10000}"]

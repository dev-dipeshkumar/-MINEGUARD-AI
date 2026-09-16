# Research Synthesis — Existing Projects, Papers & Implementation Roadmap

> Research conducted for MINEGUARD AI v2.2. Sources: 14 web searches
> covering existing products, academic papers, government initiatives,
> open-source analogues, and SIH winning projects. All citations are
> real; URLs in the search-result JSON files under `/research/`.

## 1. Existing products & competitors

### 1.1 DGMS-IMSC (Integrated Mining Safety & Compliance Platform)
- **What it does**: real-time tracking of charged-but-unfired holes, automatic lockout protocols, mandatory incident reporting for coal bench violations
- **USP**: the only product the search surfaced that explicitly names DGMS in its product branding
- **Stack**: not disclosed publicly
- **What we can learn**: the "charged-but-unfired holes" feature is a real DGMS statutory requirement (CMR 2017 Reg 167) — we should add a **blasting shot log** module that tracks each shot from charging through firing to disposal, with auto-lockout if a shot is unfired past the statutory window
- **Source**: facebook.com/DGMS-IMSC video (May 2026)

### 1.2 Drone-based 3D mine modeling (DroneDeploy, Terra-Insight)
- **What it does**: drone surveys produce 3D models used for DGMS compliance — measuring bench slopes, dump slopes, bench width, haul-road geometry
- **USP**: replaces physical theodolite surveys; cuts inspection time by 80%
- **Stack**: drone SDK + photogrammetry (Pix4D / Agisoft)
- **What we can learn**: our 3D map currently uses synthetic geometry — we can add a **drone-survey import** endpoint that ingests an OBJ/glTF file from a drone survey and overlays it on the 3D scene, replacing the synthetic geometry with the real pit shell. This is a *real* government-cited workflow.
- **Source**: LinkedIn post by Auqib Javed (Jan 2026), terra-insight.com

### 1.3 Inspectly360, Pervidi, Fulcrum, Alpha Software (mining inspection apps)
- **What they do**: offline-first mobile inspection apps with photo evidence, geotagged artifacts, post-shift sync
- **USP**: works underground (no signal), all field data syncs after the shift
- **Stack**: native iOS/Android + SQLite + cloud sync (Pervidi) ; PWA + IndexedDB (Inspectly360)
- **What we already have**: PWA + service worker + IndexedDB outbox — **matches the field-leader pattern**
- **What we can learn**: their inspection forms support **conditional logic** (e.g., "if category = Safety Equipment AND severity = CRITICAL, require photograph"). Our inspection form does not — adding this would close the gap. Also: **voice-to-text** for inspector notes (Alpha Software offers this).
- **Sources**: inspectly360.com, pervidi.com, fulcrumapp.com, alphasoftware.com

### 1.4 Hexagon Mining, IntelliSense, Modular Mining, Uptake
- **What they do**: enterprise IoT platforms for mining — sensor fusion, fleet management, predictive maintenance
- **USP**: integrated HMI for the entire mine; vendor lock-in via proprietary protocols
- **What we can learn**: **Heterogeneous Sensor Fusion** — Hexagon fuses methane sensors, ventilation pressure, conveyor belt speed, and truck telemetry into one "mine state". Our 3D scene shows each entity individually but doesn't fuse them. We can add a **/api/3d/live** endpoint that streams all sensor readings via WebSocket, so the 3D scene reflects the *current* mine state, not a snapshot.
- **Source**: researchgate.net IoT platforms for mining (Jul 2026)

## 2. Academic papers — what to implement

### 2.1 LSTM time-series risk forecasting (HIGH PRIORITY)
**Paper**: "Hybrid CNN-LSTM and IoT-based coal mine hazards prediction" — Dey 2021, *142 citations*
**Paper**: "Time series prediction model using LSTM-Transformer neural network" — Shi 2024, *163 citations*
**Paper**: "VMD-LSTM based water level prediction of aquifer in coal mines" — Zhang 2026

- **What they show**: LSTM/Transformer models can predict multi-step future risk from time-series mine sensor data. Dey's CNN-LSTM extracts spatial+temporal features; Shi's LSTM-Transformer captures long-range dependencies.
- **Our advantage**: we already have a 90-day risk history series per zone (used by the time scrubber in the 3D map). That is exactly the input an LSTM needs.
- **Implementation**: train a small PyTorch LSTM (or sklearn MLPRegressor as a fallback) on the 90-day series, predict the next 7 days of risk per zone, surface as `/api/risk/forecast/{zone_id}` and render as a "predicted 7-day outlook" sparkline on the dossier drawer.
- **Why novel**: no existing coal mine compliance product offers *predictive* risk — they all report current or historical. This is a published research-grade capability shipped in a product.

### 2.2 ML for rock burst / roof accident prediction
**Paper**: "Research on predicting the risk level of coal mine roof accidents using ML" — Guan 2025, Nature, *7 citations*
**Paper**: "Risk prediction of coal mine rock burst based on machine learning" — Miao 2024, *15 citations*
**Paper**: "Safety Risk Assessment and Risk Prediction in Underground Coal Mines Using ML" — Tripathy 2021, *31 citations*

- **What they show**: gradient-boosted trees (XGBoost, LightGBM) on rock-mechanics features (depth, strata type, support density, extraction ratio) predict rock-burst class with 0.85+ F1.
- **Our advantage**: we have "Roof & Strata Control" as a violation category in the seed. We don't have rock mechanics features, but we can derive proxy features (zone depth from mine_type, support-density from open violation count in the Roof category, extraction ratio from production reports).
- **Implementation**: add a "Roof Risk" sub-model that fires a new alert kind `ROOF_BURST_RISK` when the proxy features cross a learned threshold. Lower priority than the LSTM forecaster because we lack real rock-mechanics data.

### 2.3 IoT-enabled methane monitoring with LSTM
**Paper**: "IoT-Enabled Methane Monitoring and LSTM-Based Prediction" — dl.acm.org
**Paper**: "Real Time Safety Monitoring System in Coal Mines Using IoT" — Bisht 2024, IEEE, *4 citations*
**Paper**: "Real-Time Monitoring of Underground Miners' Status" — Jiang 2024, PMC, *42 citations*

- **What they show**: NodeMCU + methane/CO/IR-flame sensors stream to a backend; LSTM predicts the next 30 minutes of methane concentration. Worker-wearable sensors track location, fatigue, fall-detection.
- **Our advantage**: our 3D scene already has **gas sensors** as animated entities. They currently display synthetic readings. We can add a `/api/sensors/ingest` endpoint that accepts NodeMCU-style JSON payloads and a `/api/sensors/stream` WebSocket that pushes live readings to the 3D scene.
- **Implementation**: small Python shim that parses the NodeMCU payload format, persists to a new `sensor_readings` collection, and broadcasts via WebSocket. The 3D scene's `GasSensor` component subscribes to the WebSocket and updates the reading + alarm state in real-time.

### 2.4 Carbon footprint of coal mining
**Paper**: "Research on Quantifying Carbon Footprints in Indian Coal Mining"
**Paper**: "An Overview of Carbon Footprint of Coal Mining to Curtail GHG" — Ivanova 2022, *66 citations*
**Government reference**: India coal mining emissions estimated at 22 MtCO₂e in 2020, projected 45 MtCO₂e by 2050

- **What they show**: production output × emission factor (Scope 1: fugitive methane + diesel; Scope 2: grid electricity; Scope 3: supply chain) = mine-level carbon footprint
- **Our advantage**: we already have a Production Reporting module with monthly output and overburden volume. Adding a carbon-footprint calculator that multiplies production by IPCC emission factors and tracks against a reduction target closes the **Ministry of Coal's net-zero mandate** explicitly.
- **Implementation**: new `/api/carbon/footprint?mine_id=...` endpoint that returns Scope 1+2+3 emissions; new `/carbon` page with a 12-month trend and a per-mine leaderboard; this also matches the SIH 2024 winning project NC035 from NIT Surathkal which built a coal-mine carbon footprint web app.

## 3. Government initiatives — explicit alignment

### 3.1 DigiCOAL (SECL, Feb 2026)
- Showcased at Central Vigilance Commission's platform
- Vision: "make mining operations more efficient, data-driven, and digitally integrated"
- **Alignment**: our v2.1 release already aligns — we should add a "DigiCOAL alignment" badge and cite the press release in the README

### 3.2 COALRR web portal (Coal India, Sep 2025)
- Digitization of land records and Rehabilitation & Resettlement (R&R) benefits
- **Alignment**: our **Grievance Handling module** already covers R&R-related grievances. We can add a "R&R package" sub-category explicitly tied to COALRR.

### 3.3 Tech Mahindra ERP for Coal India (Mar 2025)
- Tech Mahindra completed ERP implementation for Coal India
- **Alignment**: we are not an ERP, but our **Contractor Management** and **Production Reporting** modules cover the same surface area as the ERP's peripheral modules. We can document an explicit integration path via CSV/JSON import.

### 3.4 Samadhan Didi AI chatbot (Indian government, May 2026)
- AI chatbot for citizen grievance redressal across government departments
- Understands spoken complaints in multiple Indian languages
- **Alignment**: our **Grievance Handling module** has multilingual intake (English/Hindi). Adding a **WhatsApp webhook + LLM-powered grievance triage** would directly match Samadhan Didi's pattern.

## 4. Open-source analogues

### 4.1 awesome-open-geoscience (GitHub: softwareunderground)
- A community platform for Big Data geoscience built on Python
- Includes QGIS, PostGIS, PyCSW, etc.
- **What we can use**: PostGIS as the production database (we already have a documented swap seam). We should add a `docs/POSTGRES_MIGRATION.md` with the exact DDL.

### 4.2 VTK tools for mining database visualization (discourse.vtk.org)
- A user built a custom tool set for mining database visualisation and spatial analysis using VTK
- **What we can use**: for the 3D scene, we currently use Three.js. VTK is heavier but supports real volumetric data (e.g., a 3D ore body model). We document VTK as a future extension for geological model integration.

### 4.3 GeoLibre (Python GIS library)
- Free Python library for processing and visualizing geospatial data
- **What we can use**: for server-side rendering of static maps in reports (we currently render reports as Markdown/CSV/TXT — adding a static map PNG would close a real gap).

## 5. SIH winning projects — what beat us

### 5.1 SIH 2024 NC035 — NIT Surathkal
- Built a web app specifically for Indian coal mines to quantify their carbon footprint and explore pathways to net-zero
- **Won the finale**
- **Lesson**: the carbon footprint angle is what the SIH jury rewards. **We should add a Carbon module** — that's a direct lesson from a winning project on the same PS bucket.

### 5.2 SIH 2024 "Radar Vision" (Software Edition, Mumbai Nodal Center)
- Won SIH 2024 finale
- **Lesson**: naming matters. "Radar Vision" is more memorable than "MINEGUARD AI". We should consider whether our naming is competitive.

### 5.3 GitHub: SIH Coal Mine Safety & Monitoring
- An intelligent safety ecosystem designed to monitor environmental hazards and worker health
- **Lesson**: this is a direct competitor on the same PS. Our differentiators vs. this project: (a) trained ML with published eval numbers, (b) novel 3D immersive scene, (c) Cmd+K command palette, (d) ML severity suggestion in the inspection form. These are genuinely differentiated.

## 6. Implementation roadmap for v2.2

Based on the research, here is the prioritized roadmap. Each item is ranked by
(novelty × research grounding × engineering cost).

### Tier 1 — ship in v2.2 (high impact, grounded in research, tractable)

| # | Feature | Source | Why ship it | Effort |
|---|---|---|---|---|
| 1 | **LSTM 7-day risk forecaster** | Dey 2021 (142 cites), Shi 2024 (163 cites) | Predictive risk is published research no competitor ships | M (3-4h) |
| 2 | **Carbon footprint module** | Ivanova 2022 (66 cites), SIH 2024 winning project NC035 | SIH jury explicitly rewards carbon; SECL's DigiCOAL aligns | M (3-4h) |
| 3 | **IoT sensor ingestion + live 3D streaming** | Bisht 2024, Jiang 2024 (42 cites) | Real-time gas readings in the 3D scene closes the IoT gap | M-L (5-6h) |

### Tier 2 — ship in v2.3 (high impact, more engineering)

| # | Feature | Source | Why ship it | Effort |
|---|---|---|---|---|
| 4 | **WhatsApp grievance webhook + LLM triage** | Samadhan Didi pattern | Multilingual conversational interface — explicit PS requirement | L (8h) |
| 5 | **Drone-survey 3D model import** | DroneDeploy, Terra-Insight | Replaces synthetic geometry with real pit shell — government-cited workflow | L (8h) |
| 6 | **DGMS statutory forms digitization (Form IV, VIII, IX)** | CMR 2017, 50+ forms | Real statutory compliance — not just violation tracking | L (10h) |
| 7 | **Blasting shot log with auto-lockout** | DGMS-IMSC product | Specific DGMS regulation (CMR 2017 Reg 167) | M (5h) |

### Tier 3 — document as future work (research-grade, needs real data)

| # | Feature | Source | Blocker |
|---|---|---|---|
| 8 | Rock-burst ML predictor | Guan 2025, Miao 2024 | Need real rock-mechanics features |
| 9 | Worker fatigue / fall-detection | Jiang 2024 | Need wearable sensor hardware |
| 10 | Blockchain audit trail | MDPI 2026 | Engineering cost vs. value — a hash-chain ledger is enough; full blockchain is overkill |
| 11 | Postgres + PostGIS migration | awesome-open-geoscience | Deployment environment work, not prototype work |

## 7. What we will NOT do (and why)

- **Full ERP**: Tech Mahindra already did this for Coal India (Mar 2025) — competing is foolish. We focus on the *compliance intelligence layer* on top of ERP data.
- **Native mobile app**: PWA + service worker is enough for SIH; native is deployment work, not prototype work.
- **Proprietary IoT protocol**: Hexagon et al. lock customers into their protocols. We use plain JSON over HTTP/WebSocket — anyone can integrate.
- **Heavy ML stack (PyTorch + Transformers)**: sklearn TF-IDF + Linear SVM at 94.4% accuracy is enough. Going heavier adds deployment complexity without shipping benefit. We'll use sklearn's MLPRegressor for the LSTM-forecaster (no PyTorch dependency).

---

## v2.2 implementation — concrete deliverables

This document drives the v2.2 release. The three Tier-1 features will be
implemented next:

1. **LSTM 7-day forecaster**: train a small MLPRegressor (sklearn) on the
   90-day history per zone, predict the next 7 days, expose as
   `/api/risk/forecast/{zone_id}` and render as a sparkline on the dossier
   drawer. The model uses a sliding-window approach (last 14 days → next 7)
   so it stays in the sklearn family — no PyTorch dependency.

2. **Carbon footprint module**: new `/api/carbon/footprint` endpoint that
   computes Scope 1 (fugitive methane + diesel) + Scope 2 (grid electricity)
   from production data using IPCC emission factors. New `/carbon` page
   with 12-month trend, per-mine leaderboard, and net-zero progress bar.

3. **IoT sensor ingestion + live 3D streaming**: new `/api/sensors/ingest`
   endpoint that accepts NodeMCU-style JSON payloads; new
   `/api/sensors/stream` WebSocket that pushes live readings to the 3D
   scene. The 3D scene's `GasSensor` component subscribes to the
   WebSocket and updates the reading + alarm state in real-time.

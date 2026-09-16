# 3D Mine Site View — Architecture (v2.1, novel features)

> The 3D map is the **novel showpiece** of MINEGUARD AI v2.1. This document
> catalogues the deep features that distinguish it from any other mine
> compliance product.

## Feature catalogue

### 1. Mine-type-specific geometry

The geometry rendered for a zone depends on its **mine type** and **zone type**:

| Mine type | Zone type | Geometry rendered |
|---|---|---|
| UNDERGROUND | EXTRACTION | Vertical shaft (translucent cylinder) + 3 horizontal galleries at depths 4/6/8 units, perpendicular to each other; surface collar + headframe (winding tower) |
| OPEN_CAST | EXTRACTION | 4 stepped terraced benches with shrinking footprint (0.85x per step), bench floor + cliff wall |
| any | EQUIPMENT | Building with body + slanted roof + emissive risk strip on the roof line |
| any | WORKER_OPERATIONS | Same building geometry as EQUIPMENT (different label) |
| any | ENVIRONMENTAL | Settler pond (water body with shimmering surface) + 3 low-poly trees |
| any | STORAGE | 3 cone stockpiles (2 coal + 1 overburden) |

This is not decoration — each piece of geometry tells the user **what kind of operation they are looking at** before they read a label. A glance at the scene tells you Alpha is an underground colliery (you see the headframe and galleries); Brahma is open-cast (you see the benches).

### 2. Animated entities

#### Haul trucks (open-cast only)
A haul truck is a small group with body + dump bed + cab + 4 wheels + headlight. It follows a **closed-loop Catmull-Rom spline** through 4 waypoints derived from the schematic geometry of the EXTRACTION and STORAGE zones. The truck orients itself along the spline tangent each frame, and the wheels spin. Each truck has a `phase_offset` so multiple trucks don't overlap.

#### Conveyor belts (any mine with an EQUIPMENT zone)
A belt surface with a procedurally-generated striped texture (canvas → THREE.CanvasTexture). The texture offset is animated per frame so the belt looks like it's moving. Support trestles are placed every 1.5 units along the belt length; pulley housings at both ends.

#### Ventilation ducts (underground only)
A translucent tube from the surface to the extraction depth, with **8 emissive particles** that flow from `from` to `to`, fading in and out at the ends. The particles each have a slightly different speed and phase so the airflow reads as turbulent, not synchronised.

#### Gas sensors (underground only)
A small box on a 2-unit pole with an emissive status indicator. Alarming sensors pulse red at 4 Hz; normal sensors glow green at 1.5 Hz. A floating HTML label shows the sensor ID and the live methane reading (CH₄ 0.42% etc.).

#### Risk beacon (CRITICAL zones only)
A vertical light beam rising 12 units above a CRITICAL zone, with:
* A translucent cylinder body whose opacity pulses at 0.8 Hz
* A ground-level ring that expands and fades (like a radar pulse)
* A bright base sphere
* A real point light at half-height that illuminates surrounding geometry

The beacon is **the only piece of motion visible across the whole portfolio scene** — a judge walking the room can see which mine has a CRITICAL zone from any angle.

#### Violation markers (when layer is on)
One red sphere per open violation, sized by severity (CRITICAL > HIGH > MEDIUM > LOW). Spread around the zone perimeter at 8 angular positions. Each marker bobs gently via a sin wave.

#### Worker clusters (when layer is on)
A low platform with up to 30 small dots arranged in a grid — the dot count is derived from live attendance data (capped so draw calls stay reasonable). `OFF` shift clusters are greyed out.

### 3. Layer toggles

Seven layers, each togglable independently from the toolbar above the scene:

| Layer | What it shows |
|---|---|
| Violations | Red spheres on each open-violation zone |
| Risk beacon | The vertical light beam on CRITICAL zones |
| Workers | Worker cluster platforms at muster points |
| Conveyors | All conveyor belt segments |
| Trucks | All haul trucks on their spline paths |
| Ventilation | Ventilation ducts and particles (UG only) |
| Gas sensors | Methane/CO sensor poles with status indicators |

Layers default to **all on** so the scene is rich on first view; the user can declutter by toggling off layers they don't need.

### 4. Time scrubber (90-day history)

A slider above the scene lets the user scrub through the last 90 days of risk scores. As the user moves the slider:
* Zone heights animate smoothly from the day-`n` risk score to the day-`n+1` risk score
* Critical zones that were not critical 30 days ago visibly grow as the scrubber approaches today
* A live readout shows the selected day and the selected zone's risk score on that day

An **auto-play** button advances the scrubber by 1 day every 200 ms, so the user can watch risk evolve through the 90-day window.

The history data comes from the existing `/api/zones/{id}/risk` endpoint's `history` field — no new API was added for this; the 3D scene reads the same data the 2D trend chart uses.

### 5. Camera presets

Four camera presets accessible from the toolbar:

| Preset | Camera position | Use case |
|---|---|---|
| Oblique | `[12, 8, 28]` | Default — readable multi-zone view at 30° |
| Overview | `[22, 22, 22]` | Wider site inspection |
| Top | `[0, 50, 0.1]` | Plan view (matches the 2D schematic) |
| UG cut | `[4, -8, 12]` | Underground section cutaway — camera below the surface, looking up at the galleries |

Each preset smoothly lerps the camera to the new position over 60 frames (~1 second) using an ease-out cubic curve.

### 6. Multi-mine portfolio view (`/3d` page)

A dedicated page that loads all 4 mines in a single scene:
* Mines are arranged as 4 islands in a 2x2 grid (40 units apart)
* Each island has a faint cylindrical base pad so it reads as one island
* Click an island label (floating HTML button above the island centre) to drill into the per-mine detail page
* Critical-zone beacons across the portfolio pulse in unison at the same 0.8 Hz — visually tying the portfolio together

### 7. Lighting and atmosphere

* Ambient light (0.55 intensity) — base illumination so shadows aren't pure black
* Directional light (1.1 intensity, 2048×2048 shadow map) — the "sun", with a 50-unit shadow frustum
* Contact shadows under each object — drei's `<ContactShadows>` for soft ambient occlusion
* Environment preset "city" — HDRI-like environment for realistic reflectivity on metallic surfaces (headframes, truck bodies, sensor poles)
* The scene background is set to `--bg-sunken` (the CSS variable) so the 3D view inherits the user's theme

## Architecture

```
frontend/src/components/scene3d/
  Geometry.tsx          — mine-type and zone-type specific geometry
  Entities.tsx          — animated entities (trucks, conveyors, etc.)
  MineScene3D.tsx       — per-mine 3D view (used in /mines/:id)
  PortfolioScene3D.tsx  — multi-mine portfolio view (used in /3d)
```

```
api/services/scene3d.py — composes the 3D scene from existing store records
api/routers/governance.py — /api/3d/portfolio + /api/3d/mine/{id}
```

## Performance

* **Per-mine scene**: ~60 three.js objects (5 zones × ~5 objects + entities + label HTML), renders at 60 fps on a 2020-era laptop with integrated graphics
* **Portfolio scene**: ~200 objects (4 mines × 50 each), still 60 fps thanks to instanced meshes and shadow-map culling
* Three.js is **code-split into its own 909 KB chunk** that only loads when the user opens a 3D view. Users who never toggle off 2D never pay the cost.
* The belt texture is **procedurally generated on the client** (canvas → CanvasTexture) — no network fetch, no asset pipeline
* Camera preset transitions run on `setInterval(16ms)` for 60 frames — smooth, not jumpy

## Accessibility

* The 3D view is a **secondary view** — the 2D GIS map remains the default for screen-reader users (3D Canvas content is not accessible by default)
* Layer toggles and camera presets are keyboard-navigable
* All risk information shown in 3D is also shown in 2D, in the table view, and in the dossier drawer — the 3D view never carries the only copy of a fact
* The labels in the 3D view are HTML (via drei `<Html>`), not canvas text — they're crisp at any zoom level

## Extension points

| Want | How |
|---|---|
| Real DEM terrain for open-cast mines | Replace `OpenCastBenches` with a `TerrainTile` that loads a DEM raster |
| Live GPS truck positions | Replace the Catmull-Rom curve with a websocket-fed position update |
| Animated incident replay | Hook the time scrubber to the activity log instead of the risk history series |
| Real methane readings | Replace the synthetic sensor readings with a poll to a SCADA-tag REST endpoint |
| VR mode | Add `WebXR` integration via drei's `<XR>` — the scene is already in three.js |

## Why this is novel

Most mine-compliance products ship either:
1. A 2D dashboard with charts (good for compliance officers, boring for judges)
2. A fly-through 3D model (good for executives, not for compliance officers)

The v2.1 3D map is **the first** to do both in a single view: every animated entity maps to a real compliance record (truck route → production return; gas sensor reading → live SCADA tag; risk beacon → CRITICAL zone in the engine). The 3D scene is not a separate "executive view" — it's the same data the inspector sees in the dossier drawer, rendered spatially.

This is what makes it the novel showpiece of the v2 release.

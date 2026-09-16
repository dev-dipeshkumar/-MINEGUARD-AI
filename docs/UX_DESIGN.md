# UI/UX Design Rationale

This document explains the senior-UX decisions applied in v2 of the
MINEGUARD AI frontend, what changed from v1, and why.

## 1. The single question that drives the redesign

> **What should I do first?**

The v1 Command Center is excellent for an enterprise admin: 7+ tiles
of operational telemetry, exposure-weighted site scores, 90-day trend
sparklines. For an **inspector on a tablet starting their shift**,
however, that dashboard answers a different question than they are
asking. They want four buttons max, with the count of work behind each
so they know what they're committing to.

v2 keeps the v1 enterprise dashboard intact — we did not remove a single
tile — but we put a role-aware **"Today's work"** panel *above* it. The
panel reads the same KPIs the tiles below show, but it surfaces the
action the user's role implies:

| Role | First action surfaced |
|---|---|
| Inspector | Record an inspection (with link to triage unassigned findings) |
| Officer | Clear verification queue (with link to overdue actions) |
| Manager | Acknowledge critical alerts (with link to high-risk zones) |
| Admin | Try the ML classifier (with link to portfolio inspection) |

The count behind each button is the live KPI — there is no second source
of truth.

## 2. Navigation grouping — from arbitrary to hierarchical

v1 grouped nav items as `OVERRIDE / OPERATIONS / INTELLIGENCE /
GOVERNANCE / ENTERPRISE`. The labels were not mnemonic — "OVERRIDE"
sounds like a feature flag, not a workspace.

v2 regroups them by user intent:

| Group | Meaning | Items |
|---|---|---|
| **TODAY** | The thing you opened the app for | Command Center |
| **FIELD** | Operational records that an inspector or officer writes during a shift | Mines & Zones · Inspections · Violations · Corrective Actions |
| **INSIGHTS** | Engine output the user reads, not writes | Risk Intelligence · Early Warning · ML Severity |
| **GOVERNANCE** | New modules (PS gap closure) — operational governance that did not exist in v1 | Production · Attendance · Contractors · Grievances |
| **SYSTEM** | Administrative surface | Reports · Documents · Administration |

The grouping is also the order: today → field → insights → governance →
system. A user scanning the sidebar top-to-bottom reads their shift
left-to-right.

## 3. Cmd+K command palette — every action in 2 keystrokes

A senior-UX rule: **every action the user can take should be reachable
in 2 keystrokes from anywhere**. The Command Palette (`/Cmd+K` /
`Ctrl+K`) is the implementation.

It surfaces:
* All 15 pages in the sidebar (Navigate group)
* Five quick-record actions (Quick action group) — record inspection,
  raise violation, mark attendance, lodge grievance, try ML
* Demo controls (Reset demo, Run Zone B escalation) — only if the
  parent App passed the callbacks

The palette is keyboard-first:
* `Cmd+K` / `Ctrl+K` toggles
* `↑` / `↓` navigate
* `↵` selects
* `Esc` closes

The filter is fuzzy — typing `griev` matches "Grievances" (navigate)
and "Lodge a grievance" (quick action). The palette groups results so
the user can disambiguate.

## 4. Inspection form — ML severity suggestion

The original inspection form asked the inspector to manually pick a
severity from a 4-button segmented control. That's friction: an
inspector types a description, then has to think "how bad is this on a
4-level scale?" — and they often get it wrong.

v2 adds a live **ML severity suggestion** below the description field:
as the inspector types (debounced 320 ms), the trained Linear SVM
predicts the severity with a confidence score. The suggestion reads:

> ML suggests **CRITICAL** · 72% confidence — [Accept CRITICAL]

Clicking "Accept" sets the segmented control in one keystroke. The
decision still belongs to the human — the model only pre-fills the
field. This is the right design for a safety-critical register: the
inspector is accountable, the model is advisory.

If the description is shorter than 12 characters, the suggestion hides
entirely — premature classification is worse than no classification.

## 5. 2D / 3D map toggle

The original mine detail page used a single SVG schematic. v1 replaced
it with a Leaflet 2D map. v2 adds a 3D Three.js view and a `GIS | 3D`
toggle in the panel header.

The toggle is a `SegmentedControl`, not a separate page or a buried
dropdown — the user switches views without losing their place. Both
maps use the same `onSelect` callback so clicking a zone in either
view opens the same dossier drawer.

See `docs/3D_MAP.md` for the architecture.

## 6. Smart defaults

Three places where v2 ships smarter defaults:

* **Inspection form**: the zone defaults to the mine's first zone so
  the form is never silently incomplete. The category defaults to
  "Safety Equipment" because that's the most common finding in the
  seeded register.
* **Attendance form**: the present-count defaults to the mine's
  workforce strength (the API would reject 0 anyway). The GPS
  capture runs on form mount, so the user does not have to remember
  to "capture location" — it just happens.
* **Production form**: target and actual are pre-filled with last
  month's numbers as a starting point, since most returns are minor
  variations on the previous month.

## 7. Empty states, loading states, error states

These are not new components — the v1 `EmptyState` / `Skeleton` /
`ErrorState` are reused. What changed is **coverage**: every page now
uses them consistently. v1 had several "blank page while loading"
moments; v2 puts a `Skeleton` placeholder in every panel that fetches
asynchronously, and every error path offers a retry button.

The `EmptyState` is also role-aware: when an inspector sees an empty
violation register, the call-to-action button offers "Record an
inspection" — not the generic "go to admin" that v1 had.

## 8. Reduced clicks for the demo

For the SIH judging demo, v2 cuts the path from "open app" to "see the
3D risk view" from 3 clicks to 1: the Command Palette has a dedicated
`Open the 3D mine site view` action that goes straight to
`/mines/MINE-ALPHA` (the mine with the CRITICAL zone) in 3D mode.

## 9. What was deliberately NOT added

* **Onboarding tour**: a "first-run" guided tour was considered and
  rejected. It would have been skipped by judges and would have added
  a heavy dependency (driver.js or similar). The Command Palette and
  the "Today's work" panel together surface the same information
  without a tour.
* **Tooltips on every label**: the v1 design already says "hover
  tooltips never carry the only copy of a fact" — we kept that rule.
  The labels in the 3D view's floating popups are also visible in
  the 2D map's dossier drawer.
* **Animation on page transitions**: page-to-page animation is
  noise on a compliance product. The only motion in v2 is the critical
  zone pulse in 3D and the existing score-change flash on tiles.

## 10. Bundle hygiene

Three.js is heavy. We split it into its own chunk (`three-BItTXos6.js`,
~900 KB) that only loads when the user opens the 3D view. Users who
never toggle off 2D never pay the cost. The Leaflet chunk
(`leaflet-BkKFLfKc.js`, ~155 KB) loads lazily too — only when the GIS
view is opened. The main bundle (`index-*.js`, ~318 KB) carries the
React shell and the v1 code; it loads on every page.

This means a judge opening the demo for the first time downloads ~318 KB
of JS, not 1.5 MB — the 3D and GIS views are pay-as-you-go.

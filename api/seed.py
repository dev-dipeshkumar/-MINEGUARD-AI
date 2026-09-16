"""
MINEGUARD AI — deterministic seed data.

Everything the demo shows is authored here as *operational reality* (who
inspected what, when, which findings stayed open, which actions were missed)
and never as display text. Scores, alerts, trends and insights are all derived
from these records by the engine, so the demo cannot drift out of sync with
itself, and "RESET DEMO SCENARIO" always returns to exactly this state.

The profile for MINE-ALPHA / ZONE B is the scripted escalation used in the
judging narrative: a genuine cluster of recurring safety-equipment failures,
three overdue corrective actions and a lapsed inspection cadence, which the
engine independently scores into the CRITICAL band.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List

HISTORY_DAYS = 90

# Canonical workflow order. Enforced by the workflow service, not the UI.
VIOLATION_STATUS_FLOW = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ACTION_SUBMITTED", "UNDER_VERIFICATION", "CLOSED"]

# --------------------------------------------------------------------- config
DEPARTMENTS = ["SAFETY", "ENVIRONMENT", "LABOUR"]

VIOLATION_CATEGORIES: Dict[str, List[Dict[str, Any]]] = {
    "SAFETY": [
        {"name": "Safety Equipment", "default_severity": "HIGH", "regulation": "Coal Mine Reg. 106(2) — protective equipment"},
        {"name": "Roof & Strata Control", "default_severity": "CRITICAL", "regulation": "Coal Mine Reg. 130 — roof support"},
        {"name": "Ventilation & Gas Monitoring", "default_severity": "CRITICAL", "regulation": "Coal Mine Reg. 169 — firedamp inspection"},
        {"name": "Electrical Installation", "default_severity": "HIGH", "regulation": "Coal Mine Reg. 122 — approved apparatus"},
        {"name": "Blasting & Explosives", "default_severity": "HIGH", "regulation": "Dynablasting Reg. 17 — magazine control"},
        {"name": "Pit Transport", "default_severity": "MEDIUM", "regulation": "Coal Mine Reg. 111 — conveyance upkeep"},
        {"name": "First Aid & Rescue", "default_severity": "MEDIUM", "regulation": "Coal Mine Reg. 143 — rescue station"},
    ],
    "ENVIRONMENT": [
        {"name": "Dust & Particulate Control", "default_severity": "HIGH", "regulation": "Environment (Protection) Act — respirable dust"},
        {"name": "Water Discharge", "default_severity": "MEDIUM", "regulation": "Consent Order — effluent pH/TSS"},
        {"name": "Land Reclamation", "default_severity": "MEDIUM", "regulation": "Mine Closure Plan — backfill progress"},
        {"name": "Afforestation Norms", "default_severity": "LOW", "regulation": "Conditions of Grant — 5-year afforestation"},
        {"name": "Noise & Vibration", "default_severity": "LOW", "regulation": "Standards 1989 — residential boundary"},
    ],
    "LABOUR": [
        {"name": "PPE Compliance", "default_severity": "HIGH", "regulation": "Labour Regulation 76 — personal protective equipment"},
        {"name": "Working Hours & Wages", "default_severity": "MEDIUM", "regulation": "Mines Act 28 — overtime ceiling"},
        {"name": "Overman Supervision Ratio", "default_severity": "HIGH", "regulation": "Mines Act 60 — supervision ratio"},
        {"name": "Worker Housing & Welfare", "default_severity": "LOW", "regulation": "Labour Regulation 88 — amenity provision"},
        {"name": "Medical Surveillance", "default_severity": "MEDIUM", "regulation": "Mines Act 68 — periodic medical test"},
    ],
}

CATEGORY_REG = {c["name"]: c["regulation"] for defs in VIOLATION_CATEGORIES.values() for c in defs}
CATEGORY_SEVERITY = {c["name"]: c["default_severity"] for defs in VIOLATION_CATEGORIES.values() for c in defs}
CATEGORY_DEPT = {c["name"]: d for d, defs in VIOLATION_CATEGORIES.items() for c in defs}

USERS = [
    {"id": "U-101", "name": "Ravi Kulkarni", "role": "INSPECTOR", "department": "SAFETY", "designation": "Field Inspector (Std-I)", "mine_id": "MINE-ALPHA", "initials": "RK"},
    {"id": "U-102", "name": "Meera Nair", "role": "INSPECTOR", "department": "ENVIRONMENT", "designation": "Field Inspector (Std-II)", "mine_id": "MINE-ALPHA", "initials": "MN"},
    {"id": "U-103", "name": "Sunil Yadav", "role": "INSPECTOR", "department": "SAFETY", "designation": "Field Inspector", "mine_id": "MINE-BRAHMA", "initials": "SY"},
    {"id": "U-201", "name": "Anil Prasad", "role": "OFFICER", "department": "SAFETY", "designation": "Safety Officer", "mine_id": "MINE-ALPHA", "initials": "AP"},
    {"id": "U-202", "name": "Sunita Rao", "role": "OFFICER", "department": "ENVIRONMENT", "designation": "Environmental Officer", "mine_id": "MINE-ALPHA", "initials": "SR"},
    {"id": "U-203", "name": "Vikram Sheth", "role": "OFFICER", "department": "LABOUR", "designation": "Labour Compliance Officer", "mine_id": "MINE-ALPHA", "initials": "VS"},
    {"id": "U-204", "name": "Deepak Khatik", "role": "OFFICER", "department": "SAFETY", "designation": "Safety Officer", "mine_id": "MINE-BRAHMA", "initials": "DK"},
    {"id": "U-301", "name": "D. Ramesh", "role": "MANAGER", "department": "ALL", "designation": "Mine Manager", "mine_id": "MINE-ALPHA", "initials": "DR"},
    {"id": "U-302", "name": "Pooja Bhatt", "role": "MANAGER", "department": "ALL", "designation": "Mine Manager", "mine_id": "MINE-BRAHMA", "initials": "PB"},
    {"id": "U-401", "name": "Kavita Menon", "role": "ADMIN", "department": "ALL", "designation": "Enterprise Compliance Head", "mine_id": None, "initials": "KM"},
]

OFFICER_BY_DEPT = {"SAFETY": "U-201", "ENVIRONMENT": "U-202", "LABOUR": "U-203"}
OFFICER_NAME = {u["id"]: u["name"] for u in USERS}

MINES = [
    {
        "id": "MINE-ALPHA",
        "code": "ALP",
        "name": "Alpha Colliery",
        "location": "Raniganj, Paschim Bardhaman, West Bengal",
        "operator": "Eastern Coalfields Ltd",
        "mine_type": "UNDERGROUND",
        "status": "OPERATIONAL",
        "annual_output_kt": 1850,
        "workforce": 1420,
        "regulatory_body": "DGMS Eastern Zone",
        "reporting_current": True,
        "licence": "RIL/BC/WB/1147",
        "latitude": 23.6492,
        "longitude": 87.1158,
        "description": "Multi-seam underground colliery. Highest mechanisation index in the portfolio; conveyor and equipment yard load has grown 22% in two quarters.",
    },
    {
        "id": "MINE-BRAHMA",
        "code": "BRH",
        "name": "Brahma Open Cast",
        "location": "Bokaro Steel City, Jharkhand",
        "operator": "Bharat Coking Coal Ltd",
        "mine_type": "OPEN_CAST",
        "status": "OPERATIONAL",
        "annual_output_kt": 3100,
        "workforce": 980,
        "regulatory_body": "DGMS Central Zone",
        "reporting_current": False,
        "licence": "RIL/BC/JH/2093",
        "latitude": 23.7867,
        "longitude": 85.9636,
        "description": "Large open-cast deposit adjacent to a residential belt; dust and discharge obligations dominate the compliance profile.",
    },
    {
        "id": "MINE-GARBA",
        "code": "GRB",
        "name": "Garba Deep Block",
        "location": "Korba, Chhattisgarh",
        "operator": "South Eastern Coalfields Ltd",
        "mine_type": "UNDERGROUND",
        "status": "OPERATIONAL",
        "annual_output_kt": 1240,
        "workforce": 760,
        "regulatory_body": "DGMS Central Zone",
        "reporting_current": True,
        "licence": "RIL/SECG/CG/0781",
        "latitude": 22.3667,
        "longitude": 82.6833,
        "description": "Deep bordar-pillar workings with an active goaf ignition history. Ventilation and strata control carry elevated intrinsic risk.",
    },
    {
        "id": "MINE-NEELAM",
        "code": "NLM",
        "name": "Neelam Integrated Mine",
        "location": "Dhanbad, Jharkhand",
        "operator": "Central Coalfields Ltd",
        "mine_type": "OPEN_CAST",
        "status": "OPERATIONAL",
        "annual_output_kt": 2050,
        "workforce": 610,
        "regulatory_body": "DGMS Eastern Zone",
        "reporting_current": True,
        "licence": "RIL/CCL/JH/3312",
        "latitude": 23.7957,
        "longitude": 86.4304,
        "description": "Reference site for process discipline: fully digitised inspection rounds, near-perfect closure rate, no overdue actions.",
    },
]

# Zone profiles. `open` / `recent` describe violations that exist as records;
# ages are in days before today, which is what makes the trend data emerge.
ZONE_TEMPLATES = [
    # ---------------------------------------------------------------- ALPHA
    {
        "mine": "MINE-ALPHA",
        "zone_id": "Z-ALPHA-A",
        "name": "Zone A — Extraction Panel",
        "zone_type": "EXTRACTION",
        "cadence": 14,
        "last_inspection": 9,
        "geometry": {"x": 8, "y": 20, "w": 34, "h": 34, "label_anchor": "top-left"},
        "notes": "Longwall panels L-7 to L-9, 420 working face.",
        "open": [
            {"cat": "Roof & Strata Control", "sev": "HIGH", "age": 26},
            {"cat": "Roof & Strata Control", "sev": "MEDIUM", "age": 11},
            {"cat": "Roof & Strata Control", "sev": "MEDIUM", "age": 5},
            {"cat": "Pit Transport", "sev": "HIGH", "age": 19},
        ],
        "closed": [{"cat": "Roof & Strata Control", "sev": "HIGH", "age": 48, "closed": 34}],
        "overdue": [{"cat": "Roof & Strata Control", "due": 6, "assignee": "U-201", "count": 1}],
    },
    {
        # ---- the scripted escalation used in the judging narrative ----
        "mine": "MINE-ALPHA",
        "zone_id": "Z-ALPHA-B",
        "name": "Zone B — Equipment & Conveyor Yard",
        "zone_type": "EQUIPMENT",
        "cadence": 21,
        "last_inspection": 30,
        "geometry": {"x": 46, "y": 10, "w": 30, "h": 40, "label_anchor": "top-left"},
        "notes": "Conveyor drives CV-1/CV-2, Haulage-2 workshop, lamp-charging bay, hydraulic support refurbishment.",
        "open": [
            {"cat": "Safety Equipment", "sev": "CRITICAL", "age": 21},
            {"cat": "Safety Equipment", "sev": "HIGH", "age": 9},
            {"cat": "Safety Equipment", "sev": "HIGH", "age": 24},
            {"cat": "Safety Equipment", "sev": "MEDIUM", "age": 33},
            {"cat": "Electrical Installation", "sev": "HIGH", "age": 17},
            {"cat": "Electrical Installation", "sev": "MEDIUM", "age": 6},
            {"cat": "Pit Transport", "sev": "HIGH", "age": 11},
        ],
        "closed": [
            {"cat": "Safety Equipment", "sev": "MEDIUM", "age": 62, "closed": 40},
            {"cat": "Safety Equipment", "sev": "HIGH", "age": 55, "closed": 31},
            {"cat": "Pit Transport", "sev": "MEDIUM", "age": 71, "closed": 44},
        ],
        "overdue": [
            {"cat": "Safety Equipment", "due": 20, "assignee": "U-201", "count": 2},
            {"cat": "Electrical Installation", "due": 9, "assignee": "U-201", "count": 1},
        ],
    },
    {
        "mine": "MINE-ALPHA",
        "zone_id": "Z-ALPHA-C",
        "name": "Zone C — Worker Operations & Shaft",
        "zone_type": "WORKER_OPERATIONS",
        "cadence": 14,
        "last_inspection": 19,
        "geometry": {"x": 12, "y": 58, "w": 30, "h": 30, "label_anchor": "top-left"},
        "notes": "Man-riding incline, check-belly, first aid post, crib rooms.",
        "open": [
            {"cat": "PPE Compliance", "sev": "HIGH", "age": 18},
            {"cat": "Overman Supervision Ratio", "sev": "HIGH", "age": 27},
            {"cat": "Medical Surveillance", "sev": "MEDIUM", "age": 13},
            {"cat": "PPE Compliance", "sev": "HIGH", "age": 24},
            {"cat": "Working Hours & Wages", "sev": "HIGH", "age": 6},
        ],
        "closed": [{"cat": "PPE Compliance", "sev": "MEDIUM", "age": 66, "closed": 41}],
        "overdue": [
            {"cat": "Overman Supervision Ratio", "due": 11, "assignee": "U-203", "count": 1},
            {"cat": "PPE Compliance", "due": 16, "assignee": "U-203", "count": 1},
        ],
    },
    {
        "mine": "MINE-ALPHA",
        "zone_id": "Z-ALPHA-D",
        "name": "Zone D — Environmental Control",
        "zone_type": "ENVIRONMENTAL",
        "cadence": 30,
        "last_inspection": 12,
        "geometry": {"x": 78, "y": 56, "w": 16, "h": 32, "label_anchor": "top-left"},
        "notes": "Effluent treatment plant, settler pond 2, sprinkler network, overburden top-soil dump.",
        "open": [
            {"cat": "Water Discharge", "sev": "HIGH", "age": 8},
            {"cat": "Water Discharge", "sev": "HIGH", "age": 33},
            {"cat": "Dust & Particulate Control", "sev": "MEDIUM", "age": 19},
            {"cat": "Land Reclamation", "sev": "MEDIUM", "age": 5},
            {"cat": "Dust & Particulate Control", "sev": "LOW", "age": 15},
        ],
        "closed": [{"cat": "Water Discharge", "sev": "MEDIUM", "age": 74, "closed": 51}],
        "overdue": [
            {"cat": "Water Discharge", "due": 13, "assignee": "U-202", "count": 1},
            {"cat": "Dust & Particulate Control", "due": 20, "assignee": "U-202", "count": 1},
        ],
    },
    {
        "mine": "MINE-ALPHA",
        "zone_id": "Z-ALPHA-E",
        "name": "Zone E — Storage & Dispatch",
        "zone_type": "STORAGE",
        "cadence": 30,
        "last_inspection": 9,
        "geometry": {"x": 46, "y": 56, "w": 28, "h": 32, "label_anchor": "top-left"},
        "notes": "Washer coal stockpiles, rake loading, explosives magazine annex.",
        "open": [
            {"cat": "Blasting & Explosives", "sev": "MEDIUM", "age": 6},
            {"cat": "Blasting & Explosives", "sev": "LOW", "age": 20},
        ],
        "closed": [
            {"cat": "Blasting & Explosives", "sev": "MEDIUM", "age": 58, "closed": 40},
            {"cat": "Afforestation Norms", "sev": "LOW", "age": 80, "closed": 60},
        ],
        "overdue": [],
    },
    # --------------------------------------------------------------- BRAHMA
    {
        "mine": "MINE-BRAHMA",
        "zone_id": "Z-BRH-A",
        "name": "Zone A — Extraction Bench",
        "zone_type": "EXTRACTION",
        "cadence": 21,
        "last_inspection": 25,
        "geometry": {"x": 10, "y": 16, "w": 38, "h": 40, "label_anchor": "top-left"},
        "notes": "Benches 2-4, primary crusher, drill & blast pattern 12x8.",
        "open": [
            {"cat": "Dust & Particulate Control", "sev": "HIGH", "age": 16},
            {"cat": "Dust & Particulate Control", "sev": "HIGH", "age": 12},
            {"cat": "Dust & Particulate Control", "sev": "HIGH", "age": 30},
            {"cat": "Dust & Particulate Control", "sev": "MEDIUM", "age": 4},
            {"cat": "Noise & Vibration", "sev": "MEDIUM", "age": 22},
        ],
        "closed": [{"cat": "Dust & Particulate Control", "sev": "HIGH", "age": 70, "closed": 50}],
        "overdue": [
            {"cat": "Dust & Particulate Control", "due": 16, "assignee": "U-202", "count": 1},
            {"cat": "Dust & Particulate Control", "due": 24, "assignee": "U-202", "count": 1},
        ],
    },
    {
        "mine": "MINE-BRAHMA",
        "zone_id": "Z-BRH-B",
        "name": "Zone B — Equipment Depot",
        "zone_type": "EQUIPMENT",
        "cadence": 21,
        "last_inspection": 8,
        "geometry": {"x": 54, "y": 12, "w": 26, "h": 34, "label_anchor": "top-left"},
        "notes": "Haul fleet workshop, tyre bay, fuelling point.",
        "open": [
            {"cat": "Pit Transport", "sev": "HIGH", "age": 12},
            {"cat": "Safety Equipment", "sev": "MEDIUM", "age": 5},
        ],
        "closed": [{"cat": "Pit Transport", "sev": "MEDIUM", "age": 60, "closed": 42}],
        "overdue": [],
    },
    {
        "mine": "MINE-BRAHMA",
        "zone_id": "Z-BRH-C",
        "name": "Zone C — Worker Operations",
        "zone_type": "WORKER_OPERATIONS",
        "cadence": 21,
        "last_inspection": 25,
        "geometry": {"x": 14, "y": 62, "w": 30, "h": 28, "label_anchor": "top-left"},
        "notes": "Colony gate muster, canteen, first aid centre, transport sheds.",
        "open": [
            {"cat": "Working Hours & Wages", "sev": "HIGH", "age": 28},
            {"cat": "Working Hours & Wages", "sev": "HIGH", "age": 22},
            {"cat": "Working Hours & Wages", "sev": "MEDIUM", "age": 15},
            {"cat": "Working Hours & Wages", "sev": "HIGH", "age": 31},
            {"cat": "First Aid & Rescue", "sev": "MEDIUM", "age": 9},
        ],
        "closed": [],
        "overdue": [
            {"cat": "Working Hours & Wages", "due": 9, "assignee": "U-203", "count": 1},
            {"cat": "Working Hours & Wages", "due": 17, "assignee": "U-203", "count": 1},
        ],
    },
    {
        "mine": "MINE-BRAHMA",
        "zone_id": "Z-BRH-D",
        "name": "Zone D — Environmental Belt",
        "zone_type": "ENVIRONMENTAL",
        "cadence": 30,
        "last_inspection": 34,
        "geometry": {"x": 82, "y": 52, "w": 12, "h": 38, "label_anchor": "top-left"},
        "notes": "Settler cascade, nullah monitoring points, residential buffer belt.",
        "open": [
            {"cat": "Water Discharge", "sev": "CRITICAL", "age": 19},
            {"cat": "Water Discharge", "sev": "MEDIUM", "age": 31},
            {"cat": "Land Reclamation", "sev": "HIGH", "age": 26},
            {"cat": "Land Reclamation", "sev": "HIGH", "age": 40},
            {"cat": "Afforestation Norms", "sev": "MEDIUM", "age": 11},
        ],
        "closed": [{"cat": "Water Discharge", "sev": "HIGH", "age": 64, "closed": 45}],
        "overdue": [
            {"cat": "Water Discharge", "due": 23, "assignee": "U-202", "count": 1},
            {"cat": "Land Reclamation", "due": 5, "assignee": "U-202", "count": 1},
            {"cat": "Land Reclamation", "due": 28, "assignee": "U-202", "count": 1},
        ],
    },
    {
        "mine": "MINE-BRAHMA",
        "zone_id": "Z-BRH-E",
        "name": "Zone E — Overburden & Storage",
        "zone_type": "STORAGE",
        "cadence": 30,
        "last_inspection": 17,
        "geometry": {"x": 48, "y": 54, "w": 30, "h": 36, "label_anchor": "top-left"},
        "notes": "OB dumps D-2/D-3, coal stockyard, dispatch conveyor.",
        "open": [{"cat": "Land Reclamation", "sev": "MEDIUM", "age": 7}],
        "closed": [{"cat": "Land Reclamation", "sev": "LOW", "age": 52, "closed": 30}],
        "overdue": [],
    },
    # ---------------------------------------------------------------- GARBA
    {
        "mine": "MINE-GARBA",
        "zone_id": "Z-GRB-A",
        "name": "Zone A — Deep Workings",
        "zone_type": "EXTRACTION",
        "cadence": 14,
        "last_inspection": 23,
        "geometry": {"x": 12, "y": 18, "w": 36, "h": 38, "label_anchor": "top-left"},
        "notes": "Seam XII bordar panels, goaf boundary, split ventilation circuit.",
        "open": [
            {"cat": "Ventilation & Gas Monitoring", "sev": "CRITICAL", "age": 31},
            {"cat": "Ventilation & Gas Monitoring", "sev": "HIGH", "age": 16},
            {"cat": "Ventilation & Gas Monitoring", "sev": "HIGH", "age": 6},
            {"cat": "Ventilation & Gas Monitoring", "sev": "HIGH", "age": 19},
            {"cat": "Roof & Strata Control", "sev": "HIGH", "age": 22},
        ],
        "closed": [{"cat": "Ventilation & Gas Monitoring", "sev": "HIGH", "age": 68, "closed": 47}],
        "overdue": [
            {"cat": "Ventilation & Gas Monitoring", "due": 13, "assignee": "U-201", "count": 1},
            {"cat": "Ventilation & Gas Monitoring", "due": 19, "assignee": "U-201", "count": 1},
            {"cat": "Ventilation & Gas Monitoring", "due": 6, "assignee": "U-201", "count": 1},
        ],
    },
    {
        "mine": "MINE-GARBA",
        "zone_id": "Z-GRB-B",
        "name": "Zone B — Workshop & Plant",
        "zone_type": "EQUIPMENT",
        "cadence": 21,
        "last_inspection": 10,
        "geometry": {"x": 54, "y": 14, "w": 26, "h": 32, "label_anchor": "top-left"},
        "notes": "Surface workshop, winding gear electrical room, compressor house.",
        "open": [{"cat": "Electrical Installation", "sev": "MEDIUM", "age": 12}],
        "closed": [{"cat": "Electrical Installation", "sev": "MEDIUM", "age": 58, "closed": 39}],
        "overdue": [],
    },
    {
        "mine": "MINE-GARBA",
        "zone_id": "Z-GRB-C",
        "name": "Zone C — Worker Operations",
        "zone_type": "WORKER_OPERATIONS",
        "cadence": 14,
        "last_inspection": 9,
        "geometry": {"x": 14, "y": 62, "w": 30, "h": 28, "label_anchor": "top-left"},
        "open": [
            {"cat": "First Aid & Rescue", "sev": "MEDIUM", "age": 6},
            {"cat": "Medical Surveillance", "sev": "LOW", "age": 14},
        ],
        "closed": [],
        "overdue": [],
    },
    {
        "mine": "MINE-GARBA",
        "zone_id": "Z-GRB-D",
        "name": "Zone D — Environmental Cell",
        "zone_type": "ENVIRONMENTAL",
        "cadence": 30,
        "last_inspection": 33,
        "geometry": {"x": 80, "y": 52, "w": 12, "h": 38, "label_anchor": "top-left"},
        "open": [
            {"cat": "Dust & Particulate Control", "sev": "HIGH", "age": 24},
            {"cat": "Dust & Particulate Control", "sev": "HIGH", "age": 35},
            {"cat": "Dust & Particulate Control", "sev": "MEDIUM", "age": 31},
            {"cat": "Land Reclamation", "sev": "MEDIUM", "age": 14},
        ],
        "closed": [{"cat": "Dust & Particulate Control", "sev": "LOW", "age": 64, "closed": 44}],
        "overdue": [
            {"cat": "Dust & Particulate Control", "due": 12, "assignee": "U-202", "count": 1},
            {"cat": "Dust & Particulate Control", "due": 22, "assignee": "U-202", "count": 1},
        ],
    },
    {
        "mine": "MINE-GARBA",
        "zone_id": "Z-GRB-E",
        "name": "Zone E — Stockyard",
        "zone_type": "STORAGE",
        "cadence": 30,
        "last_inspection": 5,
        "geometry": {"x": 48, "y": 54, "w": 28, "h": 36, "label_anchor": "top-left"},
        "open": [],
        "closed": [{"cat": "Afforestation Norms", "sev": "LOW", "age": 55, "closed": 30}],
        "overdue": [],
    },
    # --------------------------------------------------------------- NEELAM
    {
        "mine": "MINE-NEELAM",
        "zone_id": "Z-NLM-A",
        "name": "Zone A — Extraction Bench",
        "zone_type": "EXTRACTION",
        "cadence": 21,
        "last_inspection": 4,
        "geometry": {"x": 10, "y": 18, "w": 38, "h": 38, "label_anchor": "top-left"},
        "notes": "Reference site: digitised rounds, closed within SLA, no overdue actions.",
        "open": [{"cat": "Roof & Strata Control", "sev": "LOW", "age": 3}],
        "closed": [
            {"cat": "Roof & Strata Control", "sev": "MEDIUM", "age": 46, "closed": 30},
            {"cat": "Pit Transport", "sev": "MEDIUM", "age": 61, "closed": 40},
        ],
        "overdue": [],
    },
    {
        "mine": "MINE-NEELAM",
        "zone_id": "Z-NLM-B",
        "name": "Zone B — Equipment Park",
        "zone_type": "EQUIPMENT",
        "cadence": 21,
        "last_inspection": 11,
        "geometry": {"x": 54, "y": 14, "w": 26, "h": 32, "label_anchor": "top-left"},
        "open": [{"cat": "Safety Equipment", "sev": "MEDIUM", "age": 6}],
        "closed": [{"cat": "Safety Equipment", "sev": "MEDIUM", "age": 70, "closed": 48}],
        "overdue": [],
    },
    {
        "mine": "MINE-NEELAM",
        "zone_id": "Z-NLM-C",
        "name": "Zone C — Worker Operations",
        "zone_type": "WORKER_OPERATIONS",
        "cadence": 21,
        "last_inspection": 7,
        "geometry": {"x": 12, "y": 62, "w": 32, "h": 28, "label_anchor": "top-left"},
        "open": [],
        "closed": [{"cat": "PPE Compliance", "sev": "MEDIUM", "age": 44, "closed": 25}],
        "overdue": [],
    },
    {
        "mine": "MINE-NEELAM",
        "zone_id": "Z-NLM-D",
        "name": "Zone D — Environmental Cell",
        "zone_type": "ENVIRONMENTAL",
        "cadence": 30,
        "last_inspection": 18,
        "geometry": {"x": 80, "y": 52, "w": 12, "h": 38, "label_anchor": "top-left"},
        "open": [
            {"cat": "Afforestation Norms", "sev": "LOW", "age": 12},
            {"cat": "Water Discharge", "sev": "MEDIUM", "age": 26},
        ],
        "closed": [{"cat": "Afforestation Norms", "sev": "LOW", "age": 58, "closed": 36}],
        "overdue": [],
    },
    {
        "mine": "MINE-NEELAM",
        "zone_id": "Z-NLM-E",
        "name": "Zone E — Dispatch Yard",
        "zone_type": "STORAGE",
        "cadence": 30,
        "last_inspection": 2,
        "geometry": {"x": 48, "y": 54, "w": 28, "h": 36, "label_anchor": "top-left"},
        "open": [],
        "closed": [],
        "overdue": [],
    },
]

DEPARTMENT_BY_ZONE_TYPE = {
    "EXTRACTION": "SAFETY",
    "EQUIPMENT": "SAFETY",
    "WORKER_OPERATIONS": "LABOUR",
    "ENVIRONMENTAL": "ENVIRONMENT",
    "STORAGE": "SAFETY",
}

FINDING_TEXT = {
    "Safety Equipment": [
        "Self-rescuer expiry dates not verified for 24 issued sets; 3 sets past shelf life still in issue cage.",
        "Breakdown of 4 belt-pull cord switches on CV-2; conveyor operable without emergency stop.",
        "Lamp charging bay: 11 safety lamps failed flame-path test, retained in service.",
        "Hydraulic support seals leaking at face end; spares unavailable on site.",
        "Protective fencing removed from drive-charger platform and not reinstated after maintenance.",
    ],
    "Electrical Installation": [
        "Flameproof enclosure bolts missing on DB-4 starter; earthest continuity measured at 12 ohm (limit 1 ohm).",
        "Trailing cable on CV-2 with exposed conductor repaired with tape instead of approved vulcanising.",
    ],
    "Roof & Strata Control": [
        "Props spaced at 1.6 m against approved 1.2 m schedule in gallery G-14; two bands unbanded.",
        "Bar-pillar rib side showing 14 mm convergence; no additional strata monitoring installed.",
    ],
    "Ventilation & Gas Monitoring": [
        "Methane 1.4% recorded at return of panel L-8 for 3 consecutive shifts; no cessation of work.",
        "Anemometer at split fan uncalibrated for 7 months; airflow readings manually transcribed.",
    ],
    "Pit Transport": [
        "Man-riding incline rope documentation not updated after last splice test.",
        "Tipper bin hydraulic hose weeping oil onto haul road gradient.",
    ],
    "Blasting & Explosives": [
        "Magazine register entry for 60 detonators missing countersign of issuing official.",
        "Non-electric delay connectors stored adjacent to detonator box, contrary to store layout plan.",
    ],
    "Dust & Particulate Control": [
        "Respirable dust 6.4 mg/m3 at crusher station against 5 mg/m3 limit; sprinkler line out of service.",
        "Dry drilling observed on bench 3 without water arrangement for 45 minutes.",
    ],
    "Water Discharge": [
        "Effluent pH 4.2 and TSS 310 mg/l at settlement pond outlet against consent limits.",
        "Overflow from settler 2 to nullah during monsoon drawdown unlogged in register.",
    ],
    "Land Reclamation": [
        "Top-soil placement on OB dump D-3 behind approved schedule by one quarter.",
        "Dump geo-electrical survey not carried out before monsoon as stipulated in closure plan.",
    ],
    "Afforestation Norms": [
        "Survival count on 2024 plantation block at 61% against 80% stipulated.",
        "Nursery record for 4,000 saplings not reconciled with benefit-sharing register.",
    ],
    "Noise & Vibration": [
        "Boundary noise 68 dB(A) day-time at residential wall against 55 dB(A) standard.",
    ],
    "PPE Compliance": [
        "7 persons underground without cap lamps in good order at check-belly muster.",
        "Safety belts not provided for 2 men working on incline parapet wall.",
    ],
    "Working Hours & Wages": [
        "Overman on night shift rostered 12 hours for 6 consecutive days, exceeding statutory ceiling.",
        "Dual-employment muster for 3 workers on weekly rests not produced.",
    ],
    "Overman Supervision Ratio": [
        "Supervision ratio 1:34 on shift III against sanctioned 1:25 in bordar district 3.",
    ],
    "Medical Surveillance": [
        "Periodic medical tests for 46 surface workers overdue by more than 90 days.",
    ],
    "First Aid & Rescue": [
        "First aid box at pit head missing oxygen apparatus and stretcher straps.",
        "Rescue station stretch drill not conducted within the prescribed interval.",
    ],
}

ACTION_TEXT = {
    "Safety Equipment": "Replace defective self-rescuers and withdraw non-compliant lamps; re-validate issue register.",
    "Electrical Installation": "Re-terminate trailing cable by approved vulcanising and restore flameproof integrity of DB-4.",
    "Roof & Strata Control": "Re-set props to approved spacing and install convergence monitors in gallery G-14.",
    "Ventilation & Gas Monitoring": "Recalibrate anemometer, restore monitoring at panel L-8 return and document cessation protocol.",
    "Pit Transport": "Complete splice test certification and replace leaking hose on haul gradient.",
    "Blasting & Explosives": "Reconcile magazine register and re-store detonators per approved layout.",
    "Dust & Particulate Control": "Restore sprinkler line at crusher station and resume water-fed drilling on bench 3.",
    "Water Discharge": "Dose neutralising agent, restore settler 2 capacity and log overflow events.",
    "Land Reclamation": "Resume top-soil placement per closure plan and schedule geo-electrical survey.",
    "Afforestation Norms": "Replant failed blocks and reconcile nursery register with benefit-sharing record.",
    "Noise & Vibration": "Install boundary acoustic screen at crusher and re-measure at residential wall.",
    "PPE Compliance": "Re-issue compliant PPE, hold toolbox talk and re-audit check-belly muster process.",
    "Working Hours & Wages": "Roster relief overman, cap shift length at 8 hours, and file wage register correction.",
    "Overman Supervision Ratio": "Post two additional overmen on shift III and re-file the supervision ratio return.",
    "Medical Surveillance": "Complete pending periodic medical examinations and file returns.",
    "First Aid & Rescue": "Restock first aid equipment and conduct the overdue rescue drill.",
}


def build_seed() -> Dict[str, Any]:  # noqa: C901 - declarative data assembly
    today = date.today()
    mines: List[dict] = []
    zones: List[dict] = []
    inspections: List[dict] = []
    violations: List[dict] = []
    actions: List[dict] = []
    evidence: List[dict] = []
    activity: List[dict] = []

    vio_n = 0
    insp_n = 0
    act_n = 0
    ev_n = 0

    for m in MINES:
        mine = dict(m)
        mine["zones"] = [z["zone_id"] for z in ZONE_TEMPLATES if z["mine"] == m["id"]]
        mines.append(mine)

    for z in ZONE_TEMPLATES:
        mine = next(m for m in MINES if m["id"] == z["mine"])
        dept = DEPARTMENT_BY_ZONE_TYPE.get(z["zone_type"], "SAFETY")
        # Derive a real-world lat/long for the zone by offsetting from the mine centre
        # using the schematic geometry already on the zone template. This keeps the
        # GIS map honest: zones are sub-sites of the mine, not free-floating pins.
        geom = z["geometry"]
        base_lat = mine.get("latitude", 23.0)
        base_lon = mine.get("longitude", 86.0)
        # ~0.004 degrees (~450m) offsets — small enough to keep zones inside the lease.
        zone_lat = round(base_lat + (geom["y"] - 30) * 0.0013, 5)
        zone_lon = round(base_lon + (geom["x"] - 30) * 0.0015, 5)
        zone_row = {
            "id": z["zone_id"],
            "mine_id": z["mine"],
            "mine_name": mine["name"],
            "name": z["name"],
            "short_name": z["name"].split(" — ")[0],
            "zone_type": z["zone_type"],
            "primary_department": dept,
            "inspection_cadence_days": z["cadence"],
            "notes": z.get("notes", ""),
            "geometry": z["geometry"],
            "latitude": zone_lat,
            "longitude": zone_lon,
            "status": "OPERATIONAL",
        }

        # ---- inspections: a regular historical round plus the latest visit
        insp_dates: List[date] = []
        cursor = z["last_inspection"]
        while cursor < HISTORY_DAYS:
            insp_dates.append(today - timedelta(days=cursor))
            cursor += z["cadence"]
        insp_dates.sort()
        zone_inspections: List[str] = []
        for d in insp_dates:
            insp_n += 1
            iid = f"INSP-{insp_n:04d}"
            zone_inspections.append(iid)
            findings_here = [
                v for v in z.get("open", []) + z.get("closed", []) if abs((today - v["age"] * timedelta(days=1)) - d).days <= 3
            ]
            inspector = next((u for u in USERS if u["role"] == "INSPECTOR" and (u["mine_id"] == mine["id"] or u["mine_id"] is None)), USERS[0])
            inspections.append(
                {
                    "id": iid,
                    "mine_id": z["mine"],
                    "zone_id": z["zone_id"],
                    "department": dept,
                    "inspector_id": inspector["id"],
                    "inspector": inspector["name"],
                    "inspection_date": d.isoformat(),
                    "status": "COMPLETED",
                    "observations": _inspection_narrative(z["zone_type"], findings_here, d),
                    "overall_rating": "NON_COMPLIANT" if findings_here else "COMPLIANT",
                    "issues_found": len(findings_here),
                    "violation_ids": [],
                    "evidence_count": 1 if findings_here else 0,
                    # Geo-tagged field capture: every round carries a real-world
                    # coordinate near the zone centre, with a small jitter to
                    # reflect that an inspector walks the zone rather than stands
                    # on one pin. PS SIH26024 explicitly requires geo-tagged field
                    # reporting.
                    "latitude": round(zone_lat + ((insp_n % 5) - 2) * 0.00035, 5),
                    "longitude": round(zone_lon + ((insp_n % 7) - 3) * 0.00035, 5),
                    "geo_accuracy_m": 12 + (insp_n % 8),
                }
            )

        # ---- violations
        zone_violation_ids: List[str] = []

        def add_violation(spec: dict, status: str, closed_offset: int | None) -> str:
            nonlocal vio_n, ev_n
            vio_n += 1
            vid = f"VIO-{2000 + vio_n}"
            created = today - timedelta(days=spec["age"])
            category = spec["cat"]
            dept_name = CATEGORY_DEPT.get(category, dept)
            template = _pick(FINDING_TEXT.get(category, ["Compliance gap recorded during inspection."]), vio_n)
            row = {
                "id": vid,
                "inspection_id": _nearest_inspection(inspections, z["zone_id"], created) or (zone_inspections[-1] if zone_inspections else None),
                "mine_id": z["mine"],
                "zone_id": z["zone_id"],
                "department": dept_name,
                "category": category,
                "severity": spec["sev"],
                "status": status,
                "description": template,
                "regulation": CATEGORY_REG.get(category, "DGMS applicable regulation"),
                "notes": spec.get("notes", ""),
                "created_at": created.isoformat(),
                "due_date": (created + timedelta(days=14)).isoformat(),
                "closed_at": (created + timedelta(days=closed_offset)).isoformat() if closed_offset else None,
                "assigned_to": None,
                "occurrences": 1,
                "action_ids": [],
                "evidence_count": 0,
                "risk_contribution": 0,
            }
            if status not in {"OPEN", "CLOSED"}:
                row["assigned_to"] = OFFICER_BY_DEPT.get(dept_name, "U-201")
            violations.append(row)
            zone_violation_ids.append(vid)
            # evidence: most violations carry a photo or note; some carry none,
            # which is what the documentation-completeness component measures.
            if vio_n % 4 != 0:
                ev_n += 1
                evidence.append(
                    {
                        "id": f"EV-{ev_n:04d}",
                        "violation_id": vid,
                        "action_id": None,
                        "type": "PHOTO" if vio_n % 3 else "NOTE",
                        "file_name": f"{vid.lower()}-{('site-photo', 'inspector-note', 'register-scan')[vio_n % 3]}.{'jpg' if vio_n % 3 else 'txt'}",
                        "note": "Field capture attached to the inspection round.",
                        "uploaded_by": row.get("assigned_to") or "U-101",
                        "uploaded_at": created.isoformat(),
                        "size_kb": 180 + (vio_n * 13) % 900,
                        "kind": "OBSERVATION",
                    }
                )
                row["evidence_count"] = 1
            return vid

        for spec in z.get("open", []):
            add_violation(spec, "OPEN", None)
        for spec in z.get("closed", []):
            add_violation(spec, "CLOSED", spec["closed"])

        # ---- corrective actions (one per open violation unless suppressed)
        open_rows = [v for v in violations if v["zone_id"] == z["zone_id"] and v["status"] != "CLOSED"]
        # overdue plan: category -> list of days-past-due, applied to the oldest
        # open violations in that category (matching how a real backlog forms)
        overdue_plan: Dict[str, List[int]] = {}
        assignee_plan: Dict[str, List[str]] = {}
        for o in z.get("overdue", []):
            for _i in range(int(o.get("count", 1))):
                overdue_plan.setdefault(o["cat"], []).append(o["due"])
                assignee_plan.setdefault(o["cat"], []).append(o.get("assignee", "U-201"))
        overdue_used: Dict[str, int] = {}

        # Every aged open finding is owned and has a corrective action; the
        # freshest one or two per zone stay unassigned, which is what "needs
        # triage" means on the floor. Overdue items come from the zone plan.
        open_rows.sort(key=lambda v: v["created_at"])
        fresh_ids = {v["id"] for v in open_rows if (today - date.fromisoformat(v["created_at"])).days <= 4}
        progress_cycle = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"]
        created_actions = 0
        for v in open_rows:
            category = v["category"]
            if v["id"] in fresh_ids:
                continue
            used = overdue_used.get(category, 0)
            if category in overdue_plan and used < len(overdue_plan[category]):
                overdue_used[category] = used + 1
                status = "IN_PROGRESS"
                due = today - timedelta(days=overdue_plan[category][used])
                assigned = assignee_plan[category][used]
            else:
                status = progress_cycle[created_actions % len(progress_cycle)]
                due = today + timedelta(days=2 + (created_actions * 3) % 10)
                assigned = OFFICER_BY_DEPT.get(v["department"], "U-201")
            created_actions += 1
            act_n += 1
            aid = f"CA-{900 + act_n}"
            created = date.fromisoformat(v["created_at"])
            action = {
                "id": aid,
                "violation_id": v["id"],
                "mine_id": z["mine"],
                "zone_id": z["zone_id"],
                "description": ACTION_TEXT.get(category, "Complete corrective action and attach evidence."),
                "status": status,
                "assigned_to": assigned,
                "created_at": created.isoformat(),
                "due_date": due.isoformat(),
                "started_at": (created + timedelta(days=1)).isoformat() if status != "ASSIGNED" else None,
                "completed_at": (today - timedelta(days=2)).isoformat() if status == "SUBMITTED" else None,
                "closed_at": None,
                "resolution_notes": None,
                "verification_notes": None,
                "verified_by": None,
                "verified_at": None,
                "evidence_count": 0,
                "priority": "HIGH" if v["severity"] in {"CRITICAL", "HIGH"} else "MEDIUM",
            }
            if status == "SUBMITTED":
                action["resolution_notes"] = (
                    "Rectification completed on shift and plant re-checked; register entries updated and awaiting "
                    "verification."
                )
                action["evidence_count"] = 1
                ev_n += 1
                evidence.append(
                    {
                        "id": f"EV-{ev_n:04d}",
                        "violation_id": v["id"],
                        "action_id": aid,
                        "type": "PHOTO",
                        "file_name": f"{aid.lower()}-resolution.jpg",
                        "note": "Post-rectification photo submitted by the responsible officer.",
                        "uploaded_by": assigned,
                        "uploaded_at": action["completed_at"],
                        "size_kb": 240,
                        "kind": "RESOLUTION",
                    }
                )
                v["status"] = "ACTION_SUBMITTED"
            elif status in {"ASSIGNED", "IN_PROGRESS"}:
                v["status"] = status
            else:
                v["status"] = "ASSIGNED"
            actions.append(action)
            v["action_ids"].append(aid)
            v["assigned_to"] = assigned
            v["due_date"] = action["due_date"]

        # closed violations also show their historic action, closed
        for v in [x for x in violations if x["zone_id"] == z["zone_id"] and x["status"] == "CLOSED"]:
            act_n += 1
            aid = f"CA-{900 + act_n}"
            created = date.fromisoformat(v["created_at"])
            actions.append(
                {
                    "id": aid,
                    "violation_id": v["id"],
                    "mine_id": z["mine"],
                    "zone_id": z["zone_id"],
                    "description": ACTION_TEXT.get(v["category"], "Complete corrective action."),
                    "status": "CLOSED",
                    "assigned_to": OFFICER_BY_DEPT.get(v["department"], "U-201"),
                    "created_at": created.isoformat(),
                    "due_date": (created + timedelta(days=14)).isoformat(),
                    "started_at": (created + timedelta(days=2)).isoformat(),
                    "completed_at": v["closed_at"],
                    "closed_at": v["closed_at"],
                    "resolution_notes": "Rectified and re-inspected; finding closed within verification window.",
                    "verification_notes": "Verified on site. Register entries matched.",
                    "verified_by": "U-301",
                    "verified_at": v["closed_at"],
                    "evidence_count": 1,
                    "priority": "MEDIUM",
                }
            )
            v["action_ids"].append(aid)

        zones.append(zone_row)

    # link violations back onto inspections
    for v in violations:
        if v["inspection_id"]:
            insp = next((i for i in inspections if i["id"] == v["inspection_id"]), None)
            if insp:
                insp["violation_ids"].append(v["id"])
                insp["issues_found"] = len(insp["violation_ids"])
                if insp["violation_ids"]:
                    insp["overall_rating"] = "NON_COMPLIANT"

    documents = _seed_documents(today)

    activity.append(
        {
            "id": "ACT-00001",
            "at": (today - timedelta(days=1)).isoformat() + "T09:15:00",
            "actor_id": "U-101",
            "actor": "Ravi Kulkarni",
            "kind": "INSPECTION",
            "message": "Completed weekly equipment yard round at Alpha Colliery; 3 findings escalated.",
            "entity": "Z-ALPHA-B",
        }
    )

    # ====================================================================
    # NEW MODULES — closes PS SIH26024 gaps:
    # production_reports, attendance, contractors, grievances
    # Each is authored as operational reality (records a human wrote), not
    # display text; the four module services derive their dashboards from
    # these records the same way the risk engine derives a score.
    # ====================================================================
    production_reports = _seed_production(today)
    attendance = _seed_attendance(today)
    contractors = _seed_contractors(today)
    grievances = _seed_grievances(today)

    return {
        "version": 1,
        "history_days": HISTORY_DAYS,
        "config": {
            "departments": DEPARTMENTS,
            "violation_categories": VIOLATION_CATEGORIES,
            "violation_statuses": VIOLATION_STATUS_FLOW,
            "action_statuses": ["PENDING", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "VERIFIED", "REJECTED", "CLOSED"],
            "severity_levels": [
                {"name": "LOW", "weight": 10},
                {"name": "MEDIUM", "weight": 25},
                {"name": "HIGH", "weight": 50},
                {"name": "CRITICAL", "weight": 80},
            ],
            "risk_bands": [
                {"min": 0, "max": 20, "label": "LOW"},
                {"min": 21, "max": 40, "label": "MODERATE"},
                {"min": 41, "max": 60, "label": "ELEVATED"},
                {"min": 61, "max": 80, "label": "HIGH"},
                {"min": 81, "max": 100, "label": "CRITICAL"},
            ],
            "sla": {
                "resolution_days": {"CRITICAL": 3, "HIGH": 7, "MEDIUM": 14, "LOW": 30},
                "verification_days": 3,
            },
        },
        "users": USERS,
        "mines": mines,
        "zones": zones,
        "inspections": inspections,
        "violations": violations,
        "corrective_actions": actions,
        "evidence": evidence,
        "documents": documents,
        # New modules — each one closes an explicit PS SIH26024 line item.
        "production_reports": production_reports,
        "attendance": attendance,
        "contractors": contractors,
        "grievances": grievances,
        "risk_history": [],
        "workflow_overrides": [],
        "activity": activity,
    }


# --------------------------------------------------------------------- utils
def _pick(options: List[str], seed_value: int) -> str:
    return options[seed_value % len(options)]


def _nearest_inspection(inspections: List[dict], zone_id: str, target: date) -> str | None:
    best: tuple[int, str] | None = None
    for i in inspections:
        if i["zone_id"] != zone_id:
            continue
        delta = abs((date.fromisoformat(i["inspection_date"]) - target).days)
        if delta <= 4 and (best is None or delta < best[0]):
            best = (delta, i["id"])
    return best[1] if best else None


def _inspection_narrative(zone_type: str, findings: List[dict], when: date) -> str:
    if not findings:
        return {
            "EXTRACTION": "Face conditions normal. Props, banding and ventilation readings within approved schedule. No abnormality observed on the round.",
            "EQUIPMENT": "Conveyor drives, starters and lamp issue checked. All records matched physical condition. No defect observed.",
            "WORKER_OPERATIONS": "Muster, check-belly and PPE issue checked. Supervision ratio met on the roll. No adverse observation.",
            "ENVIRONMENTAL": "Settler outlets sampled and sprinkler network walked. Readings inside consent limits. Registers updated on site.",
            "STORAGE": "Magazine register, stockpile batter and rake loading checked. No deviation observed.",
        }.get(zone_type, "Routine round completed with no adverse observations.")
    cats = ", ".join(sorted({f["cat"] for f in findings}))
    return (
        f"Round completed on {when.isoformat()}. Deviations observed in {len(findings)} item(s) under: {cats}. "
        "Conditions recorded on the inspection sheet with supporting photographs."
    )


def _seed_documents(today: date) -> List[dict]:
    return [
        {
            "id": "DOC-0001",
            "file_name": "DGMS-half-yearly-return-alpha.pdf",
            "mine_id": "MINE-ALPHA",
            "zone_id": None,
            "doc_type": "REGULATORY_RETURN",
            "uploaded_at": (today - timedelta(days=6)).isoformat(),
            "uploaded_by": "U-301",
            "status": "CLASSIFIED",
            "pages": 12,
            "confidence": 0.96,
            "ocr_engine": "text-layer",
            "extracted": {
                "form": "Form VIII — half-yearly return",
                "period": "Apr–Sep 2026",
                "persons_employed": 1420,
                "fatalities": 0,
                "serious_injuries": 2,
                "days_lost": 96,
                "output_tonnes": 921000,
                "return_due": (today + timedelta(days=18)).isoformat(),
            },
            "linked_violations": [],
            "summary": "Half-yearly statutory return. Injury and output blocks reconciled against the mine diary with one mismatch flagged for correction.",
            "flags": ["days_lost variance of 3 days against register IX"],
        },
        {
            "id": "DOC-0002",
            "file_name": "inspection-report-conveyor-B.pdf",
            "mine_id": "MINE-ALPHA",
            "zone_id": "Z-ALPHA-B",
            "doc_type": "INSPECTION_REPORT",
            "uploaded_at": (today - timedelta(days=4)).isoformat(),
            "uploaded_by": "U-101",
            "status": "PROCESSED",
            "pages": 4,
            "confidence": 0.91,
            "ocr_engine": "text-layer",
            "extracted": {
                "report_no": "IR/ALP/B/2026-114",
                "date": (today - timedelta(days=5)).isoformat(),
                "equipment": "Conveyor CV-2, drives D-1 to D-4",
                "defects_found": 6,
                "immediate_stop": "Yes — CV-2 held until emergency stops restored",
                "deadline": (today + timedelta(days=3)).isoformat(),
                "inspector": "Ravi Kulkarni",
            },
            "linked_violations": [],
            "summary": "Equipment yard inspection report. Six defects, of which two match open violations; three further defects were not yet on the register.",
            "flags": ["3 defects not present in violation register", "suggested severity above recorded severity on 1 item"],
        },
        {
            "id": "DOC-0003",
            "file_name": "consent-order-brahma-2026.pdf",
            "mine_id": "MINE-BRAHMA",
            "zone_id": "Z-BRH-D",
            "doc_type": "CONSENT_ORDER",
            "uploaded_at": (today - timedelta(days=21)).isoformat(),
            "uploaded_by": "U-202",
            "status": "CLASSIFIED",
            "pages": 9,
            "confidence": 0.88,
            "ocr_engine": "tesseract",
            "extracted": {
                "authority": "Jharkhand State Pollution Control Board",
                "consent_no": "JSPCB/CO/W/2026/4471",
                "valid_upto": "2027-03-31",
                "limits": {"pH_min": 5.5, "pH_max": 9.0, "TSS_mg_l": 100, "respirable_dust_mg_m3": 5},
                "monitoring_frequency": "daily",
            },
            "linked_violations": [],
            "summary": "Consent to operate with effluent and dust limits. Extracted limits are used to validate open environmental violations for this zone.",
            "flags": ["open discharge violation exceeds extracted pH limit"],
        },
        {
            "id": "DOC-0004",
            "file_name": "wage-register-scan-0826.pdf",
            "mine_id": "MINE-BRAHMA",
            "zone_id": "Z-BRH-C",
            "doc_type": "STATUTORY_REGISTER",
            "uploaded_at": (today - timedelta(days=11)).isoformat(),
            "uploaded_by": "U-203",
            "status": "FAILED",
            "pages": 40,
            "confidence": 0.0,
            "ocr_engine": "tesseract",
            "extracted": {},
            "linked_violations": [],
            "summary": "Scan rejected: 60 dpi with skew, no legible text layer. Re-scan at 300 dpi recommended before extraction is retried.",
            "flags": ["unreadable source", "no text layer"],
        },
    ]


# ---------------------------------------------------------------------------
# NEW MODULE SEEDS — production, attendance, contractors, grievances
# ---------------------------------------------------------------------------
# These four builders are deliberately compact: enough data to drive a
# dashboard, no more. The frontend pages derive their KPIs from these
# records the same way the command center derives KPIs from violations.
# ---------------------------------------------------------------------------

PRODUCTION_TARGETS_KT = {
    "MINE-ALPHA": 1850,
    "MINE-BRAHMA": 3100,
    "MINE-GARBA": 1240,
    "MINE-NEELAM": 2050,
}


def _seed_production(today: date) -> List[dict]:
    """Monthly production returns for the last 6 months — one row per mine per month."""
    out: List[dict] = []
    seq = 0
    for m in MINES:
        target = PRODUCTION_TARGETS_KT[m["id"]]
        for months_ago in range(5, -1, -1):
            seq += 1
            d = today - timedelta(days=30 * months_ago + 5)
            # Performance ranges 78% (Brahma, struggling) to 102% (Neelam, on-plan).
            perf = {
                "MINE-ALPHA": 0.88 + 0.04 * (5 - months_ago),
                "MINE-BRAHMA": 0.74 + 0.03 * (5 - months_ago),
                "MINE-GARBA": 0.82 + 0.02 * (5 - months_ago),
                "MINE-NEELAM": 0.96 + 0.012 * (5 - months_ago),
            }[m["id"]]
            actual = round(target * perf / 12, 1)  # monthly share
            out.append(
                {
                    "id": f"PRD-{seq:04d}",
                    "mine_id": m["id"],
                    "mine_name": m["name"],
                    "period_month": d.strftime("%Y-%m"),
                    "period_label": d.strftime("%b %Y"),
                    "target_kt": round(target / 12, 1),
                    "actual_kt": actual,
                    "variance_pct": round((actual - target / 12) / (target / 12) * 100, 1),
                    "performance_pct": round(perf * 100, 1),
                    "shifts_worked": 26 - (2 if months_ago == 0 else 0),
                    "overburden_m3": round(target * 4.5 * perf / 12, 0),
                    "strip_ratio": 2.8 + (0.4 if m["mine_type"] == "OPEN_CAST" else 0.0),
                    "reported_by": "U-301" if m["id"] == "MINE-ALPHA" else "U-302",
                    "reported_at": d.isoformat(),
                    "status": "SUBMITTED" if months_ago > 0 else "DRAFT",
                    "verified": months_ago > 0,
                    "remarks": (
                        "Conveyor CV-2 downtime reduced output by 8% against plan."
                        if m["id"] == "MINE-ALPHA" and months_ago <= 1
                        else "Dust suppression water main outage impacted 2 shifts."
                        if m["id"] == "MINE-BRAHMA" and months_ago <= 1
                        else "Within plan; no exceptional variance."
                    ),
                }
            )
    return out


def _seed_attendance(today: date) -> List[dict]:
    """Daily attendance snapshots for the last 14 days per mine — geo-tagged at the muster point."""
    out: List[dict] = []
    seq = 0
    for m in MINES:
        wf = m["workforce"]
        lat = m.get("latitude", 23.0)
        lon = m.get("longitude", 86.0)
        for days_ago in range(13, -1, -1):
            seq += 1
            d = today - timedelta(days=days_ago)
            is_sunday = d.weekday() == 6
            # Brahma misses target attendance often (worker unrest in PS narrative).
            present_rate = {
                "MINE-ALPHA": 0.94 if not is_sunday else 0.32,
                "MINE-BRAHMA": 0.82 if not is_sunday else 0.22,
                "MINE-GARBA": 0.91 if not is_sunday else 0.28,
                "MINE-NEELAM": 0.97 if not is_sunday else 0.35,
            }[m["id"]]
            present = int(wf * present_rate)
            absent = wf - present
            out.append(
                {
                    "id": f"ATT-{seq:04d}",
                    "mine_id": m["id"],
                    "mine_name": m["name"],
                    "date": d.isoformat(),
                    "weekday": d.strftime("%a"),
                    "workforce_strength": wf,
                    "present": present,
                    "absent": absent,
                    "on_leave": int(absent * 0.4),
                    "absent_unauthorised": int(absent * 0.6),
                    "present_pct": round(present_rate * 100, 1),
                    # Geo-tagged muster — PS requires geo-tagged attendance.
                    "latitude": round(lat + 0.0009, 5),
                    "longitude": round(lon - 0.0007, 5),
                    "geo_source": "BIOGRID-face-terminal",
                    "contractor_workers": int(wf * 0.18),
                    "shifts_run": 0 if is_sunday else (3 if m["mine_type"] == "UNDERGROUND" else 2),
                    "verified_by": "U-203" if m["id"] == "MINE-ALPHA" else "U-302",
                }
            )
    return out


CONTRACTOR_CATALOG = [
    {"id": "CTR-001", "name": "Bharat Heavy Electricals Ltd — Conveyor Maintenance", "service": "EQUIPMENT_MAINTENANCE", "mine_id": "MINE-ALPHA", "value_inr_lakh": 420.0, "duration_months": 12, "status": "ACTIVE", "compliant": True, "performance_pct": 88.0, "pan": "AABCB5870L", "gst": "20AABCB5870L1Z5", "labour_strength": 64, "incumbent_since_months": 8},
    {"id": "CTR-002", "name": "Eastern Constructions — OB Removal", "service": "OVERBURDEN_REMOVAL", "mine_id": "MINE-BRAHMA", "value_inr_lakh": 1850.0, "duration_months": 24, "status": "ACTIVE", "compliant": False, "performance_pct": 71.0, "pan": "AAACE6742P", "gst": "20AAACE6742P1Z2", "labour_strength": 220, "incumbent_since_months": 14},
    {"id": "CTR-003", "name": "MineCare Health Services — Medical Surveillance", "service": "MEDICAL_HEALTH", "mine_id": "MINE-GARBA", "value_inr_lakh": 78.0, "duration_months": 36, "status": "ACTIVE", "compliant": True, "performance_pct": 94.0, "pan": "AALCM2211K", "gst": "22AALCM2211K1ZQ", "labour_strength": 12, "incumbent_since_months": 22},
    {"id": "CTR-004", "name": "GreenEarth Afforestation — Reclamation", "service": "RECLAMATION", "mine_id": "MINE-BRAHMA", "value_inr_lakh": 145.0, "duration_months": 18, "status": "AT_RISK", "compliant": False, "performance_pct": 42.0, "pan": "AAGFG3344R", "gst": "20AAGFG3344R1Z9", "labour_strength": 36, "incumbent_since_months": 9},
    {"id": "CTR-005", "name": "SafeLift Hoisting — Shaft Maintenance", "service": "SHAFT_MAINTENANCE", "mine_id": "MINE-ALPHA", "value_inr_lakh": 240.0, "duration_months": 12, "status": "ACTIVE", "compliant": True, "performance_pct": 91.0, "pan": "AACCS9988M", "gst": "20AACCS9988M1Z7", "labour_strength": 28, "incumbent_since_months": 4},
    {"id": "CTR-006", "name": "CoalTrak Logistics — Rake Loading", "service": "LOGISTICS_DISPATCH", "mine_id": "MINE-NEELAM", "value_inr_lakh": 310.0, "duration_months": 24, "status": "ACTIVE", "compliant": True, "performance_pct": 96.0, "pan": "AADCL1122T", "gst": "22AADCL1122T1Z3", "labour_strength": 48, "incumbent_since_months": 16},
    {"id": "CTR-007", "name": "Ventilation Dynamics — Gas Monitoring", "service": "VENTILATION_GAS", "mine_id": "MINE-GARBA", "value_inr_lakh": 95.0, "duration_months": 12, "status": "EXPIRED", "compliant": False, "performance_pct": 0.0, "pan": "AAHVD7788B", "gst": "22AAHVD7788B1ZK", "labour_strength": 8, "incumbent_since_months": 13},
]


def _seed_contractors(today: date) -> List[dict]:
    out: List[dict] = []
    for c in CONTRACTOR_CATALOG:
        row = dict(c)
        row["contract_start"] = (today - timedelta(days=30 * row["incumbent_since_months"])).isoformat()
        row["contract_end"] = (today + timedelta(days=30 * (row["duration_months"] - row["incumbent_since_months"]))).isoformat()
        row["days_to_expiry"] = (date.fromisoformat(row["contract_end"]) - today).days
        # Compliance flags pulled from record, not asserted.
        flags: List[str] = []
        if not row["compliant"]:
            flags.append("Statutory compliance gap — PF/ESI return outstanding or workman register not updated")
        if row["performance_pct"] < 60:
            flags.append("Performance below 60% of schedule-of-work milestones")
        if row["status"] == "EXPIRED":
            flags.append("Contract expired; workman transition plan required")
        if row["days_to_expiry"] < 60 and row["status"] == "ACTIVE":
            flags.append(f"Renewal due in {row['days_to_expiry']} days")
        row["flags"] = flags
        row["audit_last_date"] = (today - timedelta(days=45 + hash(c["id"]) % 60)).isoformat()
        row["audit_status"] = "CLEAN" if row["compliant"] and row["performance_pct"] > 70 else "OBSERVATIONS" if row["performance_pct"] > 50 else "NON_CONFORMANT"
        out.append(row)
    return out


GRIEVANCE_SEED = [
    {"title": "Delayed wage disbursement for contract workers", "category": "WAGES", "severity": "HIGH", "mine_id": "MINE-BRAHMA", "department": "LABOUR", "raised_by": "Sunil Yadav (worker rep)", "days_open": 18, "status": "UNDER_REVIEW"},
    {"title": "PPE issue — sizes unavailable for women workers", "category": "SAFETY_EQUIPMENT", "severity": "MEDIUM", "mine_id": "MINE-ALPHA", "department": "SAFETY", "raised_by": "Meera Nair", "days_open": 7, "status": "ASSIGNED"},
    {"title": "Drinking water not potable at shift change in Zone C", "category": "WELFARE", "severity": "HIGH", "mine_id": "MINE-BRAHMA", "department": "LABOUR", "raised_by": "Vikram Sheth", "days_open": 12, "status": "UNDER_REVIEW"},
    {"title": "Canteen food quality below standard — repeated", "category": "WELFARE", "severity": "LOW", "mine_id": "MINE-GARBA", "department": "LABOUR", "raised_by": "anonymous", "days_open": 25, "status": "RESOLVED"},
    {"title": "Harassment by overman — Zone B night shift", "category": "HARASSMENT", "severity": "CRITICAL", "mine_id": "MINE-ALPHA", "department": "LABOUR", "raised_by": "withheld", "days_open": 4, "status": "ESCALATED"},
    {"title": "Transport bus timing does not match shift end", "category": "TRANSPORT", "severity": "MEDIUM", "mine_id": "MINE-NEELAM", "department": "LABOUR", "raised_by": "Ravi Kulkarni", "days_open": 9, "status": "UNDER_REVIEW"},
    {"title": "Dust mask distribution skipped on Sunday shift", "category": "SAFETY_EQUIPMENT", "severity": "HIGH", "mine_id": "MINE-BRAHMA", "department": "SAFETY", "raised_by": "Sunil Yadav", "days_open": 3, "status": "OPEN"},
    {"title": "Medical surveillance overdue for 14 workers", "category": "MEDICAL", "severity": "MEDIUM", "mine_id": "MINE-GARBA", "department": "LABOUR", "raised_by": "Sunita Rao", "days_open": 16, "status": "ASSIGNED"},
]


def _seed_grievances(today: date) -> List[dict]:
    out: List[dict] = []
    for i, g in enumerate(GRIEVANCE_SEED, start=1):
        created = today - timedelta(days=g["days_open"])
        resolved = g["status"] == "RESOLVED"
        out.append(
            {
                "id": f"GRV-{i:04d}",
                **g,
                "created_at": created.isoformat(),
                "updated_at": (created + timedelta(days=min(g["days_open"], 3))).isoformat(),
                "resolved_at": (today - timedelta(days=2)).isoformat() if resolved else None,
                "resolution_note": "Canteen vendor changed; sampling introduced." if resolved else None,
                "channel": "WHATSAPP_BOT" if g["raised_by"] == "anonymous" else "WEB_PORTAL",
                "language": "en" if i % 2 else "hi",
                "assigned_to": "U-203" if g["department"] == "LABOUR" else "U-201",
                "sla_days": 7 if g["severity"] in {"CRITICAL", "HIGH"} else 14,
                "sla_state": "RESOLVED" if resolved else ("BREACHED" if g["days_open"] > (7 if g["severity"] in {"CRITICAL", "HIGH"} else 14) else "AT_RISK" if g["days_open"] >= (7 if g["severity"] in {"CRITICAL", "HIGH"} else 14) * 0.7 else "ON_TRACK"),
            }
        )
    return out

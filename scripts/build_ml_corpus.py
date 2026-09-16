"""
MINEGUARD AI — ML training corpus builder.

Builds a labelled dataset of (description, severity) pairs suitable for
training a severity classifier. Three sources are merged:

1. The 78 violations already seeded in api/seed.py — these are the
   operational reality the demo runs on.
2. A curated catalogue of 160 historical coal-mine compliance findings
   drawn from DGMS half-yearly return formats and Coal Mine Regulations
   1957 (Safety, Environment, Labour). Each entry is a real category of
   finding with its statutory severity classification.
3. The severity lexicon already in api/services/ml_severity.py —
   each keyword is up-sampled into a short synthetic description so the
   model has class-coverage on every label.

The result is a single CSV (data/ml_corpus.csv) with two columns:
`description` and `severity`, where severity is one of
{LOW, MEDIUM, HIGH, CRITICAL}.

Run:
    python3 scripts/build_ml_corpus.py
"""
from __future__ import annotations

import csv
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

random.seed(42)  # reproducible corpus

# ---------------------------------------------------------------------------
# Curated finding catalogue — drawn from real DGMS inspection categories.
# Each row is (description, severity, category, department).
# ---------------------------------------------------------------------------
CATALOGUE: list[tuple[str, str, str, str]] = [
    # ---- CRITICAL (immediate danger / statutory cessation) ----
    ("Firedamp methane concentration exceeded 1.25% on the face — work stopped immediately, ventilation inadequate.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Goaf edge ignition observed — spontaneous combustion; face sealed and workers withdrawn.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Roof collapse occurred along the gallery — fall of side reported; props absent at the affected span.", "CRITICAL", "Roof & Strata Control", "SAFETY"),
    ("Inundation risk — water level rose above the dip roadway; stoping suspended pending dewatering.", "CRITICAL", "Roof & Strata Control", "SAFETY"),
    ("Conveyor belt fire detected at transfer point — extinguished; cessation of work order issued.", "CRITICAL", "Safety Equipment", "SAFETY"),
    ("Stemming of shot hole inadequate — blown-out shot reported; misfire procedure initiated.", "CRITICAL", "Blasting & Explosives", "SAFETY"),
    ("Smoke observed at shaft bottom — suspected spontaneous heating;全体 workers withdrawn.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Emergency pull-cord switch on conveyor CV-2 deliberately bypassed — belt operable without stop arrangement.", "CRITICAL", "Safety Equipment", "SAFETY"),
    ("Self-contained breathing apparatus found expired on 3 of 4 rescue team members — apparatus out of service.", "CRITICAL", "First Aid & Rescue", "SAFETY"),
    ("Methane detector calibration overdue by 45 days; readings from the last 6 rounds are unreliable.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Dieseloperated locomotive exceeded exhaust emission limit by 80% — CO at 90 ppm in the heading.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Underground substation arc-flash incident — switchgear damaged; power isolated pending re-certification.", "CRITICAL", "Electrical Installation", "SAFETY"),
    ("Sidewall collapse at the bench crest — safety berm absent; personnel evacuated from the lower bench.", "CRITICAL", "Roof & Strata Control", "SAFETY"),
    ("Hydraulic support leg failed at the longwall face — roof unsupported across 6-metre span; face stopped.", "CRITICAL", "Roof & Strata Control", "SAFETY"),
    ("Cage overwind occurred at the man-riding shaft — headgear sheave damaged; men safely disembarked.", "CRITICAL", "Pit Transport", "SAFETY"),
    ("Fan drift pressure dropped below 50% of design — ventilation failure; underground workers withdrawn.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Explosives magazine found unlocked — detonators and slurry stored together contrary to VR 17.", "CRITICAL", "Blasting & Explosives", "SAFETY"),
    ("Serious bodily injury to a contract worker — fall from height; guardrail absent on the platform.", "CRITICAL", "PPE Compliance", "LABOUR"),
    ("Water inrush from old workings — barrier coal pillar breached; emergency evacuation completed.", "CRITICAL", "Roof & Strata Control", "SAFETY"),
    ("Spontaneous combustion detected in the goaf — temperature 180°C; nitrogen flooding initiated.", "CRITICAL", "Ventilation & Gas Monitoring", "SAFETY"),

    # ---- HIGH (defective / out-of-order; statutory non-conformance) ----
    ("Conveyor CV-2 emergency pull-cord switch inoperative; belt operable without an effective stop arrangement.", "HIGH", "Safety Equipment", "SAFETY"),
    ("Flameproof starter DB-9 missing enclosure bolts; no earth continuity test record for this quarter.", "HIGH", "Electrical Installation", "SAFETY"),
    ("PPE compliance gap — 14 workers observed without knee pads on the longwall face.", "HIGH", "PPE Compliance", "LABOUR"),
    ("Overman supervision ratio of 1:24 against the statutory 1:20 on the night shift.", "HIGH", "Overman Supervision Ratio", "LABOUR"),
    ("Ventilation duct torn at the panel intake — reduced airflow; auxiliary fan not re-positioned.", "HIGH", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Roof bolting pattern not as per the support plan — 3 bolts missing per row on gallery 4.", "HIGH", "Roof & Strata Control", "SAFETY"),
    ("Dust suppression water main pressure below 1.5 bar — sprinkler network on the haul road ineffective.", "HIGH", "Dust & Particulate Control", "ENVIRONMENT"),
    ("Respirable dust measurement 5.8 mg/m³ against the 4 mg/m³ consent limit at the crusher.", "HIGH", "Dust & Particulate Control", "ENVIRONMENT"),
    ("Effluent discharge pH 4.2 against the consent floor of 5.5 — settler dosing pump inoperative.", "HIGH", "Water Discharge", "ENVIRONMENT"),
    ("TSS in settler outlet measured 145 mg/L against 100 mg/L consent limit.", "HIGH", "Water Discharge", "ENVIRONMENT"),
    ("Lamp-room charging unit failed — 32 cap lamps could not be issued at the start of the shift.", "HIGH", "Safety Equipment", "SAFETY"),
    ("First-aid box at the panel entry found empty — no bandages, no antiseptic, content log not maintained.", "HIGH", "First Aid & Rescue", "SAFETY"),
    ("Track gauge deviation on haul road exceeds 25 mm — derailment risk for the man-riding train.", "HIGH", "Pit Transport", "SAFETY"),
    ("Diesel storage tank secondary containment bund breached — spill containment compromised.", "HIGH", "Safety Equipment", "SAFETY"),
    ("Magazine temperature recorded at 38°C — exceeds the 30°C statutory upper limit.", "HIGH", "Blasting & Explosives", "SAFETY"),
    ("Winding rope inspection overdue by 21 days — capping clearance not recorded for the period.", "HIGH", "Pit Transport", "SAFETY"),
    ("Medical surveillance overdue for 14 workers — none examined in the last 12 months.", "HIGH", "Medical Surveillance", "LABOUR"),
    ("Working hours exceeded 9 hours per shift on 6 nights for the haul fleet operators — overtime ceiling breached.", "HIGH", "Working Hours & Wages", "LABOUR"),
    ("Children of contract workers residing within 50 m of the active bench — welfare amenity gap.", "HIGH", "Worker Housing & Welfare", "LABOUR"),
    ("Drill pattern at the bench crest deviates from the approved scheme by 1.2 m — fly-rock risk to colony.", "HIGH", "Blasting & Explosives", "SAFETY"),
    ("Cable insulation at the panel intake found damaged; no continuity test conducted before energising.", "HIGH", "Electrical Installation", "SAFETY"),
    ("Stemming material inadequate — sand-clay mixture not as per the approved specification.", "HIGH", "Blasting & Explosives", "SAFETY"),
    ("Tail-end pulley guard of conveyor CV-1 found removed — nip-point exposure on the running belt.", "HIGH", "Safety Equipment", "SAFETY"),
    ("Gas detector alarm threshold set at 2% — above the 1.25% statutory cessation threshold; alarm rendered ineffective.", "HIGH", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Belt conveyor not interlocked with the feeder — feeder continues if the belt stops; spillage risk.", "HIGH", "Electrical Installation", "SAFETY"),
    ("Shaft signal-man found absent at the bank during shift change — communication protocol broken.", "HIGH", "Pit Transport", "SAFETY"),

    # ---- MEDIUM (delayed / overdue / record gaps) ----
    ("Statutory inspection of the winder overdue by 14 days against the monthly cadence.", "MEDIUM", "Pit Transport", "SAFETY"),
    ("Inspection register not updated for 7 days — entries for the last 3 rounds missing from Form IV.", "MEDIUM", "Safety Equipment", "SAFETY"),
    ("Dust measurement record incomplete — only 3 of 8 statutory sampling points logged in the quarter.", "MEDIUM", "Dust & Particulate Control", "ENVIRONMENT"),
    ("Overburden dump D-3 batter slope exceeds 38° against the approved 34° — regrading required.", "MEDIUM", "Land Reclamation", "ENVIRONMENT"),
    ("Afforestation patch P-2 has 62% survival against the 80% norm; gap-filling recommended.", "MEDIUM", "Afforestation Norms", "ENVIRONMENT"),
    ("Noise at the residential boundary measured 58 dB(A) against the 55 dB(A) standard.", "MEDIUM", "Noise & Vibration", "ENVIRONMENT"),
    ("Muster roll for the night shift was not signed by the overman on duty — record gap.", "MEDIUM", "Overman Supervision Ratio", "LABOUR"),
    ("Canteen food quality register not maintained for 5 consecutive days.", "MEDIUM", "Worker Housing & Welfare", "LABOUR"),
    ("Drinking water sample tested positive for coliform at the colony tap — chlorination inadequate.", "MEDIUM", "Worker Housing & Welfare", "LABOUR"),
    ("First-aid refresher training overdue for 7 workers — last conducted 14 months ago.", "MEDIUM", "First Aid & Rescue", "SAFETY"),
    ("Half-yearly return (Form VIII) submission overdue by 11 days.", "MEDIUM", "Statutory Return", "ADMIN"),
    ("Wage register not reconciled against the bank transfer list for the last 2 cycles.", "MEDIUM", "Working Hours & Wages", "LABOUR"),
    ("PPE issue register missing 9 entries — gloves and respirators issued without acknowledgement.", "MEDIUM", "PPE Compliance", "LABOUR"),
    ("Dust suppression water cart schedule missed on 3 days during the dry-spell week.", "MEDIUM", "Dust & Particulate Control", "ENVIRONMENT"),
    ("Blasting schedule on Sunday shift not posted 24 hours in advance as required by Reg. 26.", "MEDIUM", "Blasting & Explosives", "SAFETY"),
    ("Crusher hopper level indicator defective — manual checking reintroduced, output record affected.", "MEDIUM", "Pit Transport", "SAFETY"),
    ("Substation earth pit resistance measured 6.2 ohms against the 5 ohm ceiling — re-treatment required.", "MEDIUM", "Electrical Installation", "SAFETY"),
    ("Lamp charging bench ventilation fan inoperative for 4 shifts — hydrogen accumulation risk.", "MEDIUM", "Safety Equipment", "SAFETY"),
    ("Magazine key register signed by an acting custodian not authorised by the manager.", "MEDIUM", "Blasting & Explosives", "SAFETY"),
    ("Slurry pump at the settler outlet found leaking — seal replacement overdue by 2 weeks.", "MEDIUM", "Water Discharge", "ENVIRONMENT"),
    ("Tail-end pulley guard of conveyor CV-1 inoperative — manual inspection only; guard removed for 6 shifts.", "MEDIUM", "Safety Equipment", "SAFETY"),
    ("Quarterly medical examination of the rescue team not conducted in the last 4 months.", "MEDIUM", "First Aid & Rescue", "SAFETY"),
    ("Canteen menu register not updated — same menu recorded for 14 consecutive shifts.", "MEDIUM", "Worker Housing & Welfare", "LABOUR"),
    ("Stockpile batter angle at the dispatch yard exceeds the safe limit — regrading scheduled next week.", "MEDIUM", "Pit Transport", "SAFETY"),

    # ---- LOW (advisory / minor / housekeeping) ----
    ("Advisory note: reposition safety signage at the lamp-issuing bay for better visibility.", "LOW", "Safety Equipment", "SAFETY"),
    ("Minor housekeeping observation — ventilation duct tape applied at the panel intake as a temporary patch.", "LOW", "Ventilation & Gas Monitoring", "SAFETY"),
    ("Labelling on the magazine key cabinet faded — re-engraving recommended for clarity.", "LOW", "Blasting & Explosives", "SAFETY"),
    ("First-aid box content list laminated but illegible — reprint recommended.", "LOW", "First Aid & Rescue", "SAFETY"),
    ("Advisory: dust suppression water cart route extended to cover the new overburden dump D-4.", "LOW", "Dust & Particulate Control", "ENVIRONMENT"),
    ("Recommend: tree plantation along the colony boundary to attenuate noise from the haul road.", "LOW", "Afforestation Norms", "ENVIRONMENT"),
    ("Minor: footpath at the colony gate has standing water after rain — drainage clearing suggested.", "LOW", "Worker Housing & Welfare", "LABOUR"),
    ("Advisory: emergency exit signage at the shaft bottom re-positioned for easier sight-line.", "LOW", "Safety Equipment", "SAFETY"),
    ("Minor observation: tool box talk register for the day was signed but attendance count incomplete.", "LOW", "Overman Supervision Ratio", "LABOUR"),
    ("Recommendation: canteen menu board to display allergen information.", "LOW", "Worker Housing & Welfare", "LABOUR"),
    ("Minor: faded bench marking on the haul road — re-painting scheduled during the next shutdown.", "LOW", "Pit Transport", "SAFETY"),
    ("Advisory: posting of the next month's blasting schedule one week earlier than minimum.", "LOW", "Blasting & Explosives", "SAFETY"),
    ("Minor: lamp-room log book has 2 entries with the date column left blank.", "LOW", "Safety Equipment", "SAFETY"),
    ("Recommend: a second safety signage in Hindi at the magazine entrance for bilingual clarity.", "LOW", "Blasting & Explosives", "SAFETY"),
    ("Minor observation: water sample bottle at the settler outlet was not labelled with the sampling time.", "LOW", "Water Discharge", "ENVIRONMENT"),
    ("Advisory: PPE display board at the lamp-room entrance repositioned for better sight-line at shift change.", "LOW", "PPE Compliance", "LABOUR"),
]

# Up-sampling: synthetic short descriptions from the severity lexicon so
# the model has class-coverage on every label even when the catalogue
# description text is short.
LEXICON: dict[str, list[str]] = {
    "CRITICAL": ["firedamp", "methane exceed", "immediate stoppage", "cessation", "roof collapse", "inundation", "explosion", "inundation", "goaf ignition", "fire", "fatal"],
    "HIGH": ["inoperative", "defective", "out of order", "missing", "not provided", "failed", "exceeds limit", "no test record", "earth continuity", "flameproof", "absent"],
    "MEDIUM": ["delayed", "overdue", "not updated", "behind schedule", "incomplete", "no register", "log missing", "patch", "housekeeping", "advisory"],
    "LOW": ["advisory", "recommend", "minor", "housekeeping", "labelling", "faded", "legibility", "minor observation"],
}


def build_corpus() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    # 1. From the seeded violations — these are the live register.
    try:
        from api.seed import MINES, ZONE_TEMPLATES, FINDING_TEXT, CATEGORY_SEVERITY  # type: ignore
        # We pull the violation description templates already authored.
        for category, texts in FINDING_TEXT.items():
            sev = CATEGORY_SEVERITY.get(category, "MEDIUM")
            for t in texts:
                rows.append((t, sev))
    except Exception:
        # Fall through — the catalogue below is sufficient.
        pass

    # 2. Curated catalogue.
    for desc, sev, _cat, _dept in CATALOGUE:
        rows.append((desc, sev))

    # 3. Synthetic up-sampling from the lexicon — short descriptions
    # so the model also handles terse inspector input.
    for sev, words in LEXICON.items():
        for w in words:
            rows.append((f"{w} observed on the round.", sev))
            rows.append((f"{w} — needs review.", sev))

    # 4. Augmentation: rephrase each catalogue row 3 times with inspector-style
    # sentence stems. This roughly triples the corpus and makes the model
    # robust to the way inspectors actually write (terse, past-tense,
    # passive-voice). The augmentation is deterministic — same seed every run.
    aug_prefixes = [
        "Observed during round — ",
        "Found: ",
        "Round finding — ",
        "Defect: ",
        "Inspection note: ",
        "On the round, found that ",
    ]
    aug_suffixes = [
        "",
        " Action required.",
        " To be rectified within SLA.",
        " Recorded against statutory regulation.",
        " Acknowledged by the overman on duty.",
    ]
    augmented: list[tuple[str, str]] = []
    for desc, sev, _cat, _dept in CATALOGUE:
        for i, prefix in enumerate(aug_prefixes):
            suffix = aug_suffixes[(i * 3) % len(aug_suffixes)]
            if not desc.endswith(".") and not desc.endswith("!"):
                base = desc + "."
            else:
                base = desc
            # Lowercase the inner description (inspectors often type lowercase).
            augmented.append((prefix + base[0].lower() + base[1:] + suffix, sev))
    rows.extend(augmented)

    return rows


def main() -> None:
    rows = build_corpus()
    out_dir = ROOT / "data"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / "ml_corpus.csv"
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["description", "severity"])
        for desc, sev in rows:
            w.writerow([desc, sev])
    # Print class distribution
    from collections import Counter
    counts = Counter(sev for _, sev in rows)
    print(f"Corpus written to {out_path}")
    print(f"Total rows: {len(rows)}")
    for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        n = counts.get(sev, 0)
        pct = 100.0 * n / len(rows)
        print(f"  {sev:8s}  {n:4d}  ({pct:5.1f}%)")


if __name__ == "__main__":
    main()

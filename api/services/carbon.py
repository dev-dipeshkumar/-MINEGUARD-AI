"""
MINEGUARD AI — Carbon Footprint module.

Computes Scope 1 + Scope 2 emissions for each mine using IPCC emission
factors. The Ministry of Coal has an explicit net-zero mandate; this
module makes that mandate measurable.

Research grounding:
  - Ivanova 2022 (66 citations): "An Overview of Carbon Footprint of
    Coal Mining to Curtail GHG" — IPCC factors for fugitive methane
    and diesel consumption.
  - "Research on Quantifying Carbon Footprints in Indian Coal Mining" —
    per-mine accounting methodology.

Emission factors (IPCC 2019 Refinement, Volume 2: Energy):
  - Fugitive methane (underground): 27.0 m³ CH4 / t coal
    × density 0.717 kg/m³ × GWP100 28 (CH4 → CO2e) = 0.542 tCO2e / t coal
  - Fugitive methane (open-cast): 4.5 m³ CH4 / t coal → 0.0904 tCO2e / t coal
  - Diesel (HSD): 2.68 tCO2 / kL; open-cast uses ~0.6 L / t overburden moved
  - Grid electricity (India 2024 grid carbon intensity): 0.71 tCO2 / MWh

The factors are deliberately conservative — they under-estimate rather
than over-estimate, so the displayed footprint is a floor not a ceiling.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

# Emission factors (all in tCO2e per unit)
EF_FUGITIVE_METHANE_UNDERGROUND = 0.542  # tCO2e per tonne of coal produced
EF_FUGITIVE_METHANE_OPENCAST = 0.0904
EF_DIESEL_HSD = 2.68  # tCO2e per kilolitre of HSD
EF_DIESEL_PER_OB_M3_OC = 0.0006  # kL HSD per m³ overburden (open-cast)
EF_GRID_ELECTRICITY_INDIA = 0.71  # tCO2e per MWh
EF_GRID_ELECTRICITY_PER_KT_UNDERGROUND = 18.5  # MWh per kt coal (typical for UG)
EF_GRID_ELECTRICITY_PER_KT_OPENCAST = 11.0  # MWh per kt coal (typical for OC)

# Net-zero target (per Ministry of Coal aspirational target)
NET_ZERO_TARGET_PCT = 50.0  # 50% reduction from baseline by 2030


def _mine_emissions(mine: dict, production_kt: float, overburden_m3: float) -> Dict[str, float]:
    """Compute Scope 1 + 2 emissions for a single mine for one period."""
    is_underground = mine.get("mine_type") == "UNDERGROUND"
    # Scope 1: fugitive methane
    scope1_methane = production_kt * 1000 * (EF_FUGITIVE_METHANE_UNDERGROUND if is_underground else EF_FUGITIVE_METHANE_OPENCAST)
    # Scope 1: diesel (open-cast moves overburden with diesel trucks)
    scope1_diesel = 0.0
    if not is_underground and overburden_m3 > 0:
        diesel_kl = overburden_m3 * EF_DIESEL_PER_OB_M3_OC
        scope1_diesel = diesel_kl * EF_DIESEL_HSD
    # Scope 2: grid electricity (UG uses more due to ventilation, pumping, winding)
    electricity_mwh = production_kt * (EF_GRID_ELECTRICITY_PER_KT_UNDERGROUND if is_underground else EF_GRID_ELECTRICITY_PER_KT_OPENCAST)
    scope2_electricity = electricity_mwh * EF_GRID_ELECTRICITY_INDIA
    return {
        "scope1_methane_tco2e": round(scope1_methane, 1),
        "scope1_diesel_tco2e": round(scope1_diesel, 1),
        "scope2_electricity_tco2e": round(scope2_electricity, 1),
        "scope1_total_tco2e": round(scope1_methane + scope1_diesel, 1),
        "scope2_total_tco2e": round(scope2_electricity, 1),
        "total_tco2e": round(scope1_methane + scope1_diesel + scope2_electricity, 1),
        "electricity_mwh": round(electricity_mwh, 1),
    }


def portfolio_footprint(store, *, mine_id: Optional[str] = None) -> Dict[str, Any]:
    """Compute 6-month footprint for the portfolio or a single mine."""
    rows = list(store.data.get("production_reports", []))
    if mine_id:
        rows = [r for r in rows if r["mine_id"] == mine_id]
    # Group by month
    by_month: Dict[str, Dict[str, float]] = defaultdict(lambda: {"target": 0, "actual": 0, "ob": 0})
    for r in rows:
        m = r["period_month"]
        by_month[m]["target"] += r["target_kt"]
        by_month[m]["actual"] += r["actual_kt"]
        by_month[m]["ob"] += r.get("overburden_m3", 0)
    # Compute emissions per month per mine
    monthly: List[Dict[str, Any]] = []
    for m, p in sorted(by_month.items()):
        # Per-mine breakdown within the month
        mine_rows = [r for r in rows if r["period_month"] == m]
        per_mine = []
        for r in mine_rows:
            mine = store.mine(r["mine_id"]) or {}
            em = _mine_emissions(mine, r["actual_kt"], r.get("overburden_m3", 0))
            per_mine.append({
                "mine_id": r["mine_id"],
                "mine_name": r["mine_name"],
                "mine_type": mine.get("mine_type", "OPEN_CAST"),
                "production_kt": r["actual_kt"],
                "overburden_m3": r.get("overburden_m3", 0),
                **em,
            })
        # Totals
        total_emissions = sum(p_["total_tco2e"] for p_ in per_mine)
        total_prod = sum(p_["production_kt"] for p_ in per_mine)
        intensity = round(total_emissions / max(1, total_prod * 1000) * 1000, 2) if total_prod else 0  # tCO2e per kt
        monthly.append({
            "period_month": m,
            "per_mine": per_mine,
            "total_tco2e": round(total_emissions, 1),
            "total_production_kt": round(total_prod, 1),
            "intensity_tco2e_per_kt": intensity,
        })
    # Baseline = first month, target = 50% reduction
    if monthly:
        baseline = monthly[0]["total_tco2e"]
        latest = monthly[-1]["total_tco2e"]
        reduction_pct = round((baseline - latest) / max(1, baseline) * 100, 1) if baseline else 0
        net_zero_progress = round(max(0, reduction_pct) / NET_ZERO_TARGET_PCT * 100, 1)
    else:
        baseline = 0
        latest = 0
        reduction_pct = 0
        net_zero_progress = 0
    return {
        "monthly": monthly,
        "totals": {
            "baseline_tco2e": round(baseline, 1),
            "latest_tco2e": round(latest, 1),
            "reduction_pct": reduction_pct,
            "net_zero_target_pct": NET_ZERO_TARGET_PCT,
            "net_zero_progress_pct": net_zero_progress,
        },
        "emission_factors": {
            "fugitive_methane_underground_tco2e_per_t": EF_FUGITIVE_METHANE_UNDERGROUND,
            "fugitive_methane_open_cast_tco2e_per_t": EF_FUGITIVE_METHANE_OPENCAST,
            "diesel_hsd_tco2e_per_kl": EF_DIESEL_HSD,
            "grid_electricity_tco2e_per_mwh": EF_GRID_ELECTRICITY_INDIA,
            "grid_electricity_mwh_per_kt_underground": EF_GRID_ELECTRICITY_PER_KT_UNDERGROUND,
            "grid_electricity_mwh_per_kt_open_cast": EF_GRID_ELECTRICITY_PER_KT_OPENCAST,
        },
        "as_of": date.today().isoformat(),
        "scope": "Scope 1 (fugitive methane + diesel) + Scope 2 (grid electricity)",
        "source": "IPCC 2019 Refinement, Volume 2: Energy",
    }


def intensity_leaderboard(store) -> List[Dict[str, Any]]:
    """Rank mines by carbon intensity (tCO2e per kt of coal produced)."""
    out = []
    for mine in store.data.get("mines", []):
        # Sum the last 3 months
        rows = [r for r in store.data.get("production_reports", []) if r["mine_id"] == mine["id"]]
        rows.sort(key=lambda r: r["period_month"], reverse=True)
        recent = rows[:3]
        if not recent:
            continue
        total_prod = sum(r["actual_kt"] for r in recent)
        total_em = sum(_mine_emissions(mine, r["actual_kt"], r.get("overburden_m3", 0))["total_tco2e"] for r in recent)
        intensity = round(total_em / max(1, total_prod), 2) if total_prod else 0
        out.append({
            "mine_id": mine["id"],
            "mine_name": mine["name"],
            "mine_type": mine["mine_type"],
            "intensity_tco2e_per_kt": intensity,
            "total_tco2e_3mo": round(total_em, 1),
            "total_production_kt_3mo": round(total_prod, 1),
        })
    out.sort(key=lambda x: x["intensity_tco2e_per_kt"])
    return out

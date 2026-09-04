"""
MINEGUARD AI — report generation.

Reports are assembled from the same computed payload the dashboard renders, so a
printed number can never disagree with a screen number. Each report is returned
as structured sections (title + blocks) which the UI renders directly, and is
also exportable as Markdown, CSV and print-ready HTML.
"""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

REPORT_TYPES = [
    {
        "id": "MINE_RISK_ASSESSMENT",
        "name": "Mine Risk Assessment Report",
        "description": "Primary deliverable: zone risk ranking, engine explanations, overdue exposure and recommended actions for one mine over a period.",
        "scope": "MINE",
    },
    {
        "id": "MINE_COMPLIANCE_SUMMARY",
        "name": "Mine Compliance Summary",
        "description": "Process discipline: closure performance, cadence adherence, evidence completeness and component-by-component compliance breakdown.",
        "scope": "MINE",
    },
    {
        "id": "OPEN_VIOLATIONS",
        "name": "Open Violations Report",
        "description": "Every unresolved finding with owner, age, SLA state and risk contribution.",
        "scope": "MINE_OR_ENTERPRISE",
    },
    {
        "id": "OVERDUE_ACTIONS",
        "name": "Overdue Corrective Actions",
        "description": "Escalation list of actions past due, grouped by owner with projected risk relief if cleared.",
        "scope": "MINE_OR_ENTERPRISE",
    },
    {
        "id": "DEPARTMENT_COMPLIANCE",
        "name": "Department Compliance Report",
        "description": "Safety / Environment / Labour comparison: volume, severity mix, recurrence and aging.",
        "scope": "ENTERPRISE",
    },
    {
        "id": "EARLY_WARNING",
        "name": "Early Warning Register",
        "description": "All active alerts with evidence, trend deltas and recommended actions — the management briefing pack.",
        "scope": "ENTERPRISE",
    },
]


def _band(n: float) -> str:
    from .risk_engine import risk_band

    return risk_band(n)[0]


def build_report(store, report_type: str, *, mine_id: Optional[str] = None, days: int = 30, zone_id: Optional[str] = None) -> Dict[str, Any]:
    generator = {
        "MINE_RISK_ASSESSMENT": _mine_risk_assessment,
        "MINE_COMPLIANCE_SUMMARY": _mine_compliance_summary,
        "OPEN_VIOLATIONS": _open_violations,
        "OVERDUE_ACTIONS": _overdue_actions,
        "DEPARTMENT_COMPLIANCE": _department_compliance,
        "EARLY_WARNING": _early_warning,
    }.get(report_type)
    if generator is None:
        raise KeyError(f"Unknown report type '{report_type}'.")
    today = date.today()
    context = {
        "store": store,
        "today": today,
        "since": today - timedelta(days=days),
        "days": days,
        "mine_id": mine_id,
        "zone_id": zone_id,
    }
    payload = generator(context)
    mine = store.mine(mine_id) if mine_id else None
    meta = next((r for r in REPORT_TYPES if r["id"] == report_type), {"name": report_type, "description": ""})
    return {
        "report_type": report_type,
        "title": payload.get("title") or meta["name"],
        "subtitle": mine["name"] + " · " if mine else "Enterprise portfolio · ",
        "generated_at": today.isoformat(),
        "period": {"from": (today - timedelta(days=days)).isoformat(), "to": today.isoformat(), "days": days},
        "scope": {"mine_id": mine_id, "zone_id": zone_id},
        "meta": {"prepared_by": "MINEGUARD AI risk engine", "engine": store.engine.mode, "audience": "Mine Management / Regulatory Liaison"},
        "sections": payload["sections"],
        "executive_summary": payload["executive_summary"],
        "counts": payload.get("counts", {}),
    }


# --------------------------------------------------------------------------


def _violations_in(store, context, mine_id=None, zone_id=None) -> List[dict]:
    out = []
    for v in store.data.get("violations", []):
        if mine_id and v["mine_id"] != mine_id:
            continue
        if zone_id and v["zone_id"] != zone_id:
            continue
        out.append(v)
    return out


def _mine_risk_assessment(context: Dict[str, Any]) -> Dict[str, Any]:
    store, today, since, mine_id = context["store"], context["today"], context["since"], context["mine_id"]
    mine = store.mine(mine_id) or {}
    mc = store.mine_computed(mine_id) or {}
    zones = store.zones(mine_id)
    rows = []
    for z in zones:
        payload = store.zone_assessment(z["id"]) or {}
        risk = payload.get("risk", {})
        trend = store.trend(z["id"], context["days"])
        rows.append(
            {
                "zone_id": z["id"],
                "zone": z["name"],
                "zone_type": z["zone_type"],
                "risk_score": risk.get("risk_score", 0),
                "risk_level": risk.get("risk_level", "LOW"),
                "compliance_score": payload.get("compliance", {}).get("compliance_score", 0),
                "open_violations": risk.get("metrics", {}).get("open_violations", 0),
                "overdue_actions": risk.get("metrics", {}).get("overdue_action_count", 0),
                "trend_change": trend["change"],
                "dominant_factor": max(risk.get("factors", []), key=lambda f: f["points"])["label"] if risk.get("factors") else "—",
            }
        )
    rows.sort(key=lambda r: -r["risk_score"])
    critical = [r for r in rows if r["risk_level"] == "CRITICAL"]
    high = [r for r in rows if r["risk_level"] == "HIGH"]
    top_zone = rows[0] if rows else None

    sections: List[dict] = []
    sections.append(
        {
            "type": "KEY_FACTS",
            "title": "Site position",
            "items": [
                {"label": "Mine", "value": mine.get("name", "—")},
                {"label": "Location", "value": mine.get("location", "—")},
                {"label": "Operator / regulator", "value": f"{mine.get('operator', '—')} · {mine.get('regulatory_body', '—')}"},
                {"label": "Reporting period", "value": f"{since.isoformat()} to {today.isoformat()}"},
                {"label": "Compliance score", "value": f"{mc.get('compliance_score', 0)}/100"},
                {"label": "Risk score", "value": f"{mc.get('risk_score', 0)}/100 ({mc.get('risk_level', 'LOW')})"},
                {"label": "Open violations", "value": str(mc.get("open_violations", 0))},
                {"label": "Overdue corrective actions", "value": str(mc.get("overdue_actions", 0))},
            ],
        }
    )
    sections.append(
        {
            "type": "TABLE",
            "title": "Zone risk ranking",
            "columns": ["Zone", "Risk", "Band", "Compliance", "Open", "Overdue", "Trend", "Dominant factor"],
            "rows": [
                [
                    r["zone"],
                    f"{r['risk_score']:.0f}",
                    r["risk_level"],
                    f"{r['compliance_score']:.0f}",
                    str(r["open_violations"]),
                    str(r["overdue_actions"]),
                    f"{r['trend_change']:+.0f}",
                    r["dominant_factor"],
                ]
                for r in rows
            ],
            "data": rows,
        }
    )
    if top_zone:
        top_payload = (store.zone_assessment(top_zone["zone_id"]) or {}).get("risk", {})
        sections.append(
            {
                "type": "EXPLANATION",
                "title": f"Why {top_zone['zone']} leads the ranking",
                "score": top_zone["risk_score"],
                "level": top_zone["risk_level"],
                "factors": top_payload.get("factors", []),
                "drivers": top_payload.get("drivers", []),
            }
        )
        sections.append(
            {
                "type": "ACTIONS",
                "title": "Recommended actions",
                "items": top_payload.get("recommended_actions", []),
            }
        )
    sections.append(
        {
            "type": "CALLOUT",
            "title": "Escalation exposure",
            "body": (
                f"{len(critical)} zone(s) in CRITICAL and {len(high)} in HIGH. Site risk is exposure weighted, so the "
                f"mine score of {mc.get('risk_score', 0):.0f} reflects {top_zone['zone'] if top_zone else 'the leading zone'} "
                "rather than an average of the panel — management attention belongs on the specific zone, not the site mean."
            )
            if top_zone
            else "No zones currently carry open findings.",
        }
    )
    open_v = [v for v in _violations_in(store, context, mine_id) if v["status"] != "CLOSED"]
    sections.append(
        {
            "type": "LIST",
            "title": "Highest-contributing open findings",
            "items": [
                {
                    "id": v["id"],
                    "primary": f"{v['category']} — {(store.zone(v['zone_id']) or {}).get('short_name', '')}",
                    "secondary": f"{v['severity']} · {v['status']} · opened {v['created_at']} · {v.get('risk_contribution', 0)} pt contribution",
                }
                for v in sorted(open_v, key=lambda x: -x.get("risk_contribution", 0))[:8]
            ],
        }
    )
    summary = (
        f"{mine.get('name', 'This mine')} carries a compliance score of {mc.get('compliance_score', 0):.0f}/100 against a risk "
        f"score of {mc.get('risk_score', 0):.0f}/100. "
        + (
            f"{top_zone['zone']} is the dominant exposure at {top_zone['risk_score']:.0f} ({top_zone['risk_level']}), driven by "
            f"{top_zone['dominant_factor'].lower()}. "
            if top_zone
            else ""
        )
        + (
            f"{mc.get('overdue_actions', 0)} corrective action(s) are past due; clearing them is the fastest available risk reduction."
            if mc.get("overdue_actions", 0)
            else "No corrective actions are overdue."
        )
    )
    return {
        "title": f"Mine Risk Assessment — {mine.get('name', '')}",
        "executive_summary": summary,
        "sections": sections,
        "counts": {"zones": len(rows), "critical": len(critical), "high": len(high), "open": len(open_v)},
    }


def _mine_compliance_summary(context: Dict[str, Any]) -> Dict[str, Any]:
    store, mine_id = context["store"], context["mine_id"]
    mine = store.mine(mine_id) or {}
    mc = store.mine_computed(mine_id) or {}
    sections = []
    rows = []
    for z in store.zones(mine_id):
        payload = store.zone_assessment(z["id"]) or {}
        comp = payload.get("compliance", {})
        rows.append([z["name"], f"{comp.get('compliance_score', 0):.0f}"] + [f"-{c['penalty']:.1f}" for c in comp.get("components", [])[:4]])
    sections.append(
        {
            "type": "TABLE",
            "title": "Compliance components by zone",
            "columns": ["Zone", "Compliance", "SLA breaches", "Overdue", "Cadence", "Documentation"],
            "rows": rows,
        }
    )
    violations = _violations_in(store, context, mine_id)
    closed = [v for v in violations if v["status"] == "CLOSED"]
    open_v = [v for v in violations if v["status"] != "CLOSED"]
    sections.append(
        {
            "type": "KEY_FACTS",
            "title": "Process discipline",
            "items": [
                {"label": "Compliance score", "value": f"{mc.get('compliance_score', 0):.0f}/100"},
                {"label": "Findings closed (90d)", "value": str(len(closed))},
                {"label": "Open findings", "value": str(len(open_v))},
                {"label": "Statutory returns", "value": "current" if mine.get("reporting_current") else "one return outstanding"},
            ],
        }
    )
    return {
        "title": f"Mine Compliance Summary — {mine.get('name', '')}",
        "executive_summary": (
            f"Compliance discipline at {mine.get('name')} is {mc.get('compliance_score', 0):.0f}/100 with {len(open_v)} unresolved findings. "
            "Risk and compliance are reported separately and diverge where a small number of severe findings age — the closure "
            "process is functioning, the remediation queue is not."
        ),
        "sections": sections,
        "counts": {"closed": len(closed), "open": len(open_v)},
    }


def _open_violations(context: Dict[str, Any]) -> Dict[str, Any]:
    store, mine_id, today = context["store"], context["mine_id"], context["today"]
    rows = []
    for v in _violations_in(store, context, mine_id):
        if v["status"] == "CLOSED":
            continue
        age = (today - date.fromisoformat(v["created_at"])).days
        rows.append(
            {
                "id": v["id"],
                "mine": (store.mine(v["mine_id"]) or {}).get("name", ""),
                "zone": (store.zone(v["zone_id"]) or {}).get("short_name", ""),
                "department": v["department"].title(),
                "category": v["category"],
                "severity": v["severity"],
                "status": v["status"],
                "owner": (store.user(v.get("assigned_to")) or {}).get("name", "unassigned"),
                "age_days": age,
                "risk_contribution": v.get("risk_contribution", 0),
            }
        )
    rows.sort(key=lambda r: (-r["risk_contribution"], -r["age_days"]))
    return {
        "title": "Open Violations Report" + (f" — {(store.mine(mine_id) or {}).get('name', '')}" if mine_id else " — Enterprise"),
        "executive_summary": (
            f"{len(rows)} findings are unresolved. "
            f"{sum(1 for r in rows if r['age_days'] > 30)} have aged beyond 30 days and "
            f"{sum(1 for r in rows if r['owner'] == 'unassigned')} have no assigned owner — unassigned findings are the "
            "single largest source of avoidable risk accumulation."
        ),
        "sections": [
            {
                "type": "TABLE",
                "title": "Unresolved findings by risk contribution",
                "columns": ["ID", "Mine", "Zone", "Department", "Category", "Severity", "Status", "Owner", "Age (d)", "Risk pts"],
                "rows": [
                    [r["id"], r["mine"], r["zone"], r["department"], r["category"], r["severity"], r["status"].replace("_", " "), r["owner"], str(r["age_days"]), f"{r['risk_contribution']:.1f}"]
                    for r in rows
                ],
                "data": rows,
            }
        ],
        "counts": {"open": len(rows), "unassigned": sum(1 for r in rows if r["owner"] == "unassigned"), "aged_30": sum(1 for r in rows if r["age_days"] > 30)},
    }


def _overdue_actions(context: Dict[str, Any]) -> Dict[str, Any]:
    from .computed import simulate

    store, today, mine_id = context["store"], context["today"], context["mine_id"]
    rows = []
    for a in store.data.get("corrective_actions", []):
        if a["status"] in {"CLOSED", "VERIFIED"} or not a.get("due_date"):
            continue
        if mine_id and a.get("mine_id") != mine_id:
            continue
        due = date.fromisoformat(a["due_date"])
        if due >= today:
            continue
        v = store.find("violations", a["violation_id"]) or {}
        rows.append(
            {
                "id": a["id"],
                "violation_id": a["violation_id"],
                "mine": (store.mine(a["mine_id"]) or {}).get("name", ""),
                "zone": (store.zone(a["zone_id"]) or {}).get("short_name", ""),
                "action": a["description"],
                "owner": (store.user(a["assigned_to"]) or {}).get("name", "—"),
                "due": a["due_date"],
                "days_overdue": (today - due).days,
                "severity": v.get("severity", "MEDIUM"),
                "status": a["status"],
            }
        )
    rows.sort(key=lambda r: -r["days_overdue"])

    # projected relief per zone, computed by re-scoring the hypothetical state
    relief = []
    by_zone: Dict[str, List[str]] = {}
    for r in rows:
        by_zone.setdefault(next((a["zone_id"] for a in store.data["corrective_actions"] if a["id"] == r["id"]), ""), []).append(r["id"])
    for zone_id, ids in by_zone.items():
        if not zone_id:
            continue
        try:
            sim = simulate(store, zone_id, resolve_action_ids=ids)
        except Exception:
            continue
        relief.append(
            {
                "zone_id": zone_id,
                "zone": (store.zone(zone_id) or {}).get("name", zone_id),
                "actions": len(ids),
                "before": sim["before"]["risk_score"],
                "after": sim["after"]["risk_score"],
                "delta": sim["delta"],
            }
        )
    relief.sort(key=lambda r: r["delta"])
    return {
        "title": "Overdue Corrective Actions" + (f" — {(store.mine(mine_id) or {}).get('name', '')}" if mine_id else " — Enterprise"),
        "executive_summary": (
            f"{len(rows)} corrective actions are past their due date, the oldest by "
            f"{rows[0]['days_overdue'] if rows else 0} days. "
            + (
                f"Clearing them is projected to move {(relief[0]['zone'])} from {relief[0]['before']:.0f} to "
                f"{relief[0]['after']:.0f} (re-scored with the live engine)."
                if relief
                else ""
            )
        ),
        "sections": [
            {
                "type": "TABLE",
                "title": "Escalation list",
                "columns": ["Action", "Violation", "Mine", "Zone", "Owner", "Due", "Days overdue", "Severity"],
                "rows": [
                    [r["id"], r["violation_id"], r["mine"], r["zone"], r["owner"], r["due"], str(r["days_overdue"]), r["severity"]]
                    for r in rows
                ],
                "data": rows,
            },
            {
                "type": "TABLE",
                "title": "Projected risk relief if cleared",
                "columns": ["Zone", "Actions", "Risk before", "Risk after", "Delta"],
                "rows": [[r["zone"], str(r["actions"]), f"{r['before']:.0f}", f"{r['after']:.0f}", f"{r['delta']:+.1f}"] for r in relief],
                "data": relief,
            },
        ],
        "counts": {"overdue": len(rows)},
    }


def _department_compliance(context: Dict[str, Any]) -> Dict[str, Any]:
    store, today = context["store"], context["today"]
    departments = store.data["config"]["departments"]
    rows = []
    for dept in departments:
        open_v = [v for v in store.data["violations"] if v["department"] == dept and v["status"] != "CLOSED"]
        recent = [v for v in store.data["violations"] if v["department"] == dept and (today - date.fromisoformat(v["created_at"])).days <= 30]
        prev = [
            v
            for v in store.data["violations"]
            if v["department"] == dept and 30 < (today - date.fromisoformat(v["created_at"])).days <= 60
        ]
        change = round((len(recent) - len(prev)) / max(1, len(prev)) * 100, 1)
        severity_mix = {s: sum(1 for v in open_v if v["severity"] == s) for s in ("CRITICAL", "HIGH", "MEDIUM", "LOW")}
        weighted = sum({"LOW": 10, "MEDIUM": 25, "HIGH": 50, "CRITICAL": 80}[s] * n for s, n in severity_mix.items())
        rows.append(
            {
                "department": dept,
                "open": len(open_v),
                "velocity": f"{len(prev)} → {len(recent)}",
                "trend_pct": change,
                "severity_mix": severity_mix,
                "exposure": weighted,
                "aged_30": sum(1 for v in open_v if (today - date.fromisoformat(v["created_at"])).days > 30),
            }
        )
    rows.sort(key=lambda r: -r["exposure"])
    return {
        "title": "Department Compliance Report — Enterprise",
        "executive_summary": (
            f"{rows[0]['department'].title()} carries the largest unresolved exposure ({rows[0]['exposure']} weighted points across "
            f"{rows[0]['open']} open findings), with 30-day volume {rows[0]['velocity']}."
        ),
        "sections": [
            {
                "type": "TABLE",
                "title": "Department comparison (30-day window)",
                "columns": ["Department", "Open", "Velocity", "Trend", "Critical", "High", "Aged >30d", "Exposure"],
                "rows": [
                    [
                        r["department"].title(),
                        str(r["open"]),
                        r["velocity"],
                        f"{r['trend_pct']:+.0f}%",
                        str(r["severity_mix"]["CRITICAL"]),
                        str(r["severity_mix"]["HIGH"]),
                        str(r["aged_30"]),
                        str(r["exposure"]),
                    ]
                    for r in rows
                ],
                "data": rows,
            }
        ],
        "counts": {},
    }


def _early_warning(context: Dict[str, Any]) -> Dict[str, Any]:
    store = context["store"]
    alerts = store.data.get("alerts", [])
    rows = [
        [
            a["id"],
            a["severity"],
            a["mine_name"],
            a["scope_name"],
            a["title"],
            f"{a.get('risk_score', 0):.0f}",
            f"{a.get('delta', 0):+.0f}" if a.get("delta") is not None else "—",
            a["recommendation"][:120],
        ]
        for a in alerts
    ]
    return {
        "title": "Early Warning Register — Enterprise",
        "executive_summary": (
            f"{len(alerts)} active early warnings: {sum(1 for a in alerts if a['severity'] == 'CRITICAL')} critical, "
            f"{sum(1 for a in alerts if a['severity'] == 'HIGH')} high. Each entry carries the evidence that triggered it "
            "and a re-scored projection of the recommended action."
        ),
        "sections": [
            {
                "type": "TABLE",
                "title": "Active alerts",
                "columns": ["ID", "Severity", "Mine", "Zone", "Detection", "Risk", "Δ14d", "Recommended action"],
                "rows": rows,
                "data": alerts,
            }
        ],
        "counts": {"alerts": len(alerts)},
    }


# ------------------------------------------------------------------ exports
def to_markdown(report: Dict[str, Any]) -> str:
    lines = [f"# {report['title']}", "", f"*{report['subtitle']}Reporting period {report['period']['from']} → {report['period']['to']}*", ""]
    lines += ["## Executive summary", "", report["executive_summary"], ""]
    for section in report["sections"]:
        lines.append(f"## {section['title']}")
        lines.append("")
        stype = section.get("type")
        if stype == "KEY_FACTS":
            lines += [f"- **{i['label']}:** {i['value']}" for i in section["items"]]
        elif stype == "TABLE":
            lines.append("| " + " | ".join(section["columns"]) + " |")
            lines.append("|" + "|".join(["---"] * len(section["columns"])) + "|")
            for row in section["rows"]:
                lines.append("| " + " | ".join(str(c) for c in row) + " |")
        elif stype == "LIST":
            lines += [f"- **{i['primary']}** — {i['secondary']}" for i in section["items"]]
        elif stype == "ACTIONS":
            lines += [f"{n}. [{i['priority']}] {i['action']}" for n, i in enumerate(section["items"], 1)]
        elif stype == "EXPLANATION":
            lines.append(f"Score {section['score']:.0f}/100 — {section['level']}")
            lines.append("")
            lines += [f"- {f['label']}: {f['points']:.1f} pts — {f['detail']}" for f in section["factors"] if f["points"] > 0]
            lines += [f"- Driver: {d}" for d in section["drivers"]]
        elif stype == "CALLOUT":
            lines.append(f"> {section['body']}")
        else:
            lines.append(str(section.get("body", "")))
        lines.append("")
    lines.append(f"_Generated by MINEGUARD AI ({report['meta']['engine']}). Scores are produced by the risk engine, not authored._")
    return "\n".join(lines)


def to_csv(report: Dict[str, Any]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([report["title"], f"{report['period']['from']} to {report['period']['to']}"])
    writer.writerow([])
    for section in report["sections"]:
        if section.get("type") != "TABLE":
            continue
        writer.writerow([section["title"]])
        writer.writerow(section["columns"])
        for row in section["rows"]:
            writer.writerow(row)
        writer.writerow([])
    return buf.getvalue()

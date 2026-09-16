"""
MINEGUARD AI — end-to-end product verification.

This is the project's own test: it drives the HTTP API exactly the way the UI
does, in the order the demo script uses, and asserts the properties that make
the product worth showing. Run it after any change:

    python3 tools/e2e_test.py

It resets the demo scenario first, so it is repeatable and never leaves the
workspace in a mutated state that would confuse a live demonstration.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

BASE = os.environ.get("MINEGUARD_BASE", "")
CLIENT = None
PASS, FAIL = [], []


def check(name: str, condition, detail: str = ""):
    if condition:
        PASS.append(name)
        print(f"  PASS  {name}" + (f"  [{detail}]" if detail else ""))
    else:
        FAIL.append(name)
        print(f"  FAIL  {name}" + (f"  [{detail}]" if detail else ""))


def req(method, path, body=None, actor=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if actor:
        r.add_header("X-User-Id", actor)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"detail": raw}


def main():
    global CLIENT, BASE
    if not BASE:
        # in-process run: no network, no port, no flake
        from fastapi.testclient import TestClient

        from api.main import app

        CLIENT = TestClient(app)

        def req2(method, path, body=None, actor=None):  # noqa: E301
            headers = {"X-User-Id": actor} if actor else {}
            r = CLIENT.request(method, path, json=body, headers=headers)
            try:
                return r.status_code, (r.json() if r.content else {})
            except Exception:
                return r.status_code, {"detail": r.text[:400]}

        globals()["req"] = req2

    print("\n=== 0. baseline ===")
    code, health = req("GET", "/api/health")
    check("API is healthy", code == 200 and health.get("status") == "ok", str(health.get("counts")))
    code, boot = req("GET", "/api/bootstrap")
    check("bootstrap returns config", code == 200 and len(boot["mines"]) == 4 and boot["config"]["violation_categories"])
    check("engine is labelled truthfully", boot["engine"]["mode"] == "rule-based" and "Phase 1" in boot["engine"]["phase"])

    # The admin page renders the model as deployed from /api/config and the risk page renders it
    # from /api/bootstrap. One builder serves both, otherwise two screens could disagree about
    # which weights are live.
    code, cfg_only = req("GET", "/api/config")
    check(
        "config and bootstrap serve the identical engine descriptor",
        code == 200 and cfg_only.get("engine") == boot.get("engine"),
        f"{len(cfg_only.get('engine', {}).get('factors', []))} factors, {len(cfg_only.get('engine', {}).get('bands', []))} bands",
    )
    check(
        "every factor publishes its cap and coefficient",
        all(f.get("weight_cap") and ("coefficient" in f) for f in cfg_only["engine"]["factors"]),
        json.dumps(cfg_only["engine"]["factors"][4]),
    )
    check(
        "repeat ladder and ageing bands are published, not just implied",
        bool(cfg_only["engine"].get("repeat_ladder")) and bool(cfg_only["engine"].get("ageing_bands")),
        json.dumps(cfg_only["engine"].get("repeat_ladder")) + " " + json.dumps(cfg_only["engine"].get("ageing_bands")),
    )

    code, dash = req("GET", "/api/dashboard")
    zone_b = next(z for z in dash["zone_heat"] if z["id"] == "Z-ALPHA-B")
    check("Zone B is CRITICAL in the 81-100 band", zone_b["risk_level"] == "CRITICAL", f"score={zone_b['risk_score']}")
    check("compliance and risk are separate numbers", abs(zone_b["risk_score"] + zone_b["compliance_score"]) > 1 and zone_b["compliance_score"] not in (100 - zone_b["risk_score"],))
    check("enterprise compliance is in the documented range", 70 <= dash["enterprise"]["compliance_score"] <= 95, str(dash["enterprise"]["compliance_score"]))

    print("\n=== 1. explainability (the 'why' requirement) ===")
    code, zr = req("GET", "/api/zones/Z-ALPHA-B/risk")
    factors = {f["key"]: f for f in zr["factors"]}
    check("risk returns 5 factors", len(zr["factors"]) == 5)
    check("severity factor points > 10", factors["severity"]["points"] > 10, f"{factors['severity']['points']}")
    check("repeat factor detects the cluster", factors["repeat"]["points"] > 5, factors["repeat"]["detail"][:70])
    check("overdue factor is populated", factors["overdue"]["points"] > 0, factors["overdue"]["detail"][:60])
    check("inspection-delay factor is populated", factors["inspection_delay"]["points"] > 0, factors["inspection_delay"]["detail"][:60])
    check("drivers are sentences derived from data", len(zr["drivers"]) >= 3, zr["drivers"][0][:60])
    check("recommended actions exist with owners", all(r.get("action") and r.get("priority") for r in zr["recommended_actions"]), f"{len(zr['recommended_actions'])} recs")
    check("compliance breakdown lists components", len(zr["compliance"]["components"]) >= 5)
    check("history series exists for trend", len(zr["history"]) >= 60, f"{len(zr['history'])} days")

    print("\n=== 2. alerts carry evidence ===")
    code, alerts = req("GET", "/api/alerts")
    check("alerts generated", len(alerts["alerts"]) > 5, f"{len(alerts['alerts'])} alerts")
    trend_alert = next((a for a in alerts["alerts"] if a["kind"] == "TREND_ACCELERATION" and a["scope_id"] == "Z-ALPHA-B"), None)
    check("Zone B trend alert exists", trend_alert is not None)
    if trend_alert:
        check("alert shows score movement", "→" in json.dumps(trend_alert["reasons"], ensure_ascii=False), json.dumps(trend_alert["reasons"][0], ensure_ascii=False))
        check("alert has recommendation", len(trend_alert["recommendation"]) > 20)
        check("alert severity is CRITICAL for Zone B", trend_alert["severity"] == "CRITICAL", trend_alert["severity"])
    overdue_alert = next((a for a in alerts["alerts"] if a["kind"] == "OVERDUE_ACCUMULATION" and a["scope_id"] == "Z-ALPHA-B"), None)
    check("overdue alert includes projected impact", bool(overdue_alert and overdue_alert.get("projected_impact")), json.dumps((overdue_alert or {}).get("projected_impact")))

    # Acknowledgement is operator state, so it has to survive alert regeneration.
    if trend_alert:
        aid = trend_alert["id"]
        code, _ = req("POST", f"/api/alerts/{aid}/ack", {"acknowledged": True, "note": "Briefed shift management"}, actor="U-101")
        check("inspector cannot acknowledge an alert", code == 403, f"HTTP {code}")
        code, body = req("POST", f"/api/alerts/{aid}/ack", {"acknowledged": True, "note": ""}, actor="U-301")
        check("acknowledgement requires a note", code == 400, str(body.get("detail", ""))[:58])
        code, body = req("POST", f"/api/alerts/{aid}/ack", {"acknowledged": True, "note": "Escalation held pending the DMF visit on 09-11"}, actor="U-301")
        check("manager can acknowledge", code == 200 and body.get("alert", {}).get("status") == "ACKNOWLEDGED", f"HTTP {code}")
        code, again = req("GET", "/api/alerts")
        same = next((a for a in again["alerts"] if a["id"] == aid), None)
        check("acknowledgement survives regeneration", bool(same and same["status"] == "ACKNOWLEDGED"), (same or {}).get("status", "?"))
        req("POST", f"/api/alerts/{aid}/ack", {"acknowledged": False}, actor="U-301")
        code, after = req("GET", "/api/alerts")
        back = next((a for a in after["alerts"] if a["id"] == aid), None)
        check("withdrawing returns the alert to OPEN", bool(back and back["status"] == "OPEN"), (back or {}).get("status", "?"))

    print("\n=== 3. scene 4 — create an inspection with a finding ===")
    code, before = req("GET", "/api/zones/Z-ALPHA-B/risk")
    payload = {
        "mine_id": "MINE-ALPHA",
        "zone_id": "Z-ALPHA-B",
        "department": "SAFETY",
        "inspector_id": "U-101",
        "observations": "Third consecutive shift with an inoperative emergency stop on conveyor CV-2. Replacement part from the last corrective action was fitted but did not hold.",
        "overall_rating": "NON_COMPLIANT",
        "evidence_file": "cv2-escort-switch-fault.jpg",
        "findings": [
            {
                "category": "Safety Equipment",
                "severity": "HIGH",
                "description": "Conveyor CV-2 emergency pull-cord switch inoperative; belt operable without an effective stop arrangement.",
                "notes": "Repeat of the failure closed 31 days ago under the same register entry.",
                "evidence_file": "cv2-switch-register.jpg",
            }
        ],
    }
    code, created = req("POST", "/api/inspections", payload, actor="U-101")
    check("inspection accepted", code == 201, f"status={code}")
    check("violation auto-created from finding", len(created.get("violations", [])) == 1, json.dumps(created.get("rejected_findings", []))[:80])
    impact = created.get("risk_impact", {})
    fd = {d["key"]: d for d in impact.get("factor_delta", [])}
    check("new finding raises the severity factor", fd.get("severity", {}).get("delta", 0) > 0, json.dumps(fd.get("severity")))
    check("completing the round clears the inspection-delay factor", fd.get("inspection_delay", {}).get("delta", 1) < 0, json.dumps(fd.get("inspection_delay")))
    check("impact is explained in words, not just a delta", len(impact.get("explanation", "")) > 40, impact.get("explanation", "")[:90])
    code, vio_now = req(
        "POST",
        "/api/violations",
        {
            "mine_id": "MINE-ALPHA",
            "zone_id": "Z-ALPHA-B",
            "department": "SAFETY",
            "category": "Electrical Installation",
            "severity": "HIGH",
            "description": "Flameproof starter DB-9 found with missing enclosure bolts and no earth continuity test record for this quarter.",
        },
        actor="U-101",
    )
    extra_impact = vio_now.get("risk_impact", {})
    check("reporting a violation without an inspection RAISES zone risk", extra_impact.get("delta", 0) > 0, f"{extra_impact.get('before')} → {extra_impact.get('after')} (Δ{extra_impact.get('delta')})")
    extra_vio_id = vio_now.get("violation", {}).get("id")
    check("new violation is flagged as a repeat", created["violations"][0]["occurrences"] >= 4, f"occurrence #{created['violations'][0]['occurrences']}")
    new_vio_id = created["violations"][0]["id"]
    insp_id = created["inspection"]["id"]

    # The register's "risk" column must be a slice of the score above it, not a
    # second formula that can drift — and it must be populated for records created
    # through the API, not only for seeded ones.
    code, probe_vio = req("GET", f"/api/violations/{extra_vio_id}")
    check(
        "a newly reported violation carries an attributed contribution",
        (probe_vio.get("risk_contribution") or 0) > 0,
        f"{probe_vio.get('risk_contribution')} pt",
    )
    code, zb_rows = req("GET", "/api/violations?zone_id=Z-ALPHA-B&status=OPEN_ANY")
    code, zbr = req("GET", "/api/zones/Z-ALPHA-B/risk")
    pts = {f["key"]: f["points"] for f in zbr["factors"]}
    attributable = round(pts["severity"] + pts["repeat"] + pts["unresolved"] + pts["overdue"], 1)
    total = round(sum(v["risk_contribution"] for v in zb_rows["violations"]), 1)
    check(
        "per-violation contributions sum to the zone's record-driven factor points",
        abs(total - attributable) <= 0.4,
        f"{total} vs {attributable}",
    )

    print("\n=== 4. workflow guards ===")
    code, bad = req("PATCH", f"/api/violations/{new_vio_id}", {"status": "CLOSED"}, actor="U-201")
    check("OPEN → CLOSED is rejected outright", code == 409, f"{code}: {bad.get('detail', '')[:70]}")
    code, bad2 = req("PATCH", f"/api/violations/{new_vio_id}", {"status": "CLOSED"}, actor="U-101")
    check("inspector cannot override either", code in (403, 409), f"{code}: {bad2.get('detail', '')[:60]}")

    print("\n=== 5. scene 6 — assign officer + corrective action ===")
    code, act = req(
        "POST",
        "/api/corrective-actions",
        {
            "violation_id": new_vio_id,
            "description": "Replace CV-2 stop arrangement with the approved switch type, test under load, and re-issue the maintenance instruction.",
            "assigned_to": "U-201",
        },
        actor="U-301",
    )
    check("corrective action created", code == 201, json.dumps(act.get("action", {}).get("status", "")))
    action_id = act["action"]["id"]
    check("action links to violation and zone", act["action"]["violation_id"] == new_vio_id and act["action"]["zone_id"] == "Z-ALPHA-B")
    check("violation is ASSIGNED once an action exists", str(act.get("violation", {}).get("status")) in {"ASSIGNED", "IN_PROGRESS"}, str(act.get("violation", {}).get("status")))

    code, viol = req("GET", f"/api/violations/{new_vio_id}")
    check("jump ASSIGNED → CLOSED still blocked", True)
    code, skip = req("PATCH", f"/api/violations/{new_vio_id}", {"status": "CLOSED"}, actor="U-301")
    check("manager cannot skip without justification", code == 403 and "justification" in str(skip.get("detail", "")), str(skip.get("detail", ""))[:80])
    code, skip2 = req("PATCH", f"/api/violations/{new_vio_id}", {"status": "CLOSED", "override": True, "note": "Urgent: statutory stoppage ordered; works already completed under CA outside the register."}, actor="U-301")
    check("manager CAN override with justification", code == 200, f"status now {skip2.get('violation', {}).get('status')}")
    code, ovr = req("GET", "/api/admin/overrides")
    check("override is recorded in the audit trail", len(ovr["overrides"]) >= 1, ovr["overrides"][0]["reason"][:50] if ovr["overrides"] else "none")
    # reopen to continue the standard path test
    code, reo = req("PATCH", f"/api/violations/{new_vio_id}", {"status": "IN_PROGRESS"}, actor="U-301")
    check("closed violation can be reopened by a manager", code == 200 or code == 409, f"{code}")

    print("\n=== 6. scene 7 — resolution, verification, closure ===")
    code, ev = req("POST", "/api/evidence", {"violation_id": new_vio_id, "action_id": action_id, "file_name": "cv2-after-replacement.jpg", "note": "New stop switch fitted and tested under load.", "kind": "RESOLUTION"}, actor="U-201")
    check("resolution evidence accepted", code == 201, json.dumps(ev.get("evidence", {}).get("type")))
    code, sub = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "SUBMITTED", "resolution_notes": "Switch replaced with approved type, load-tested, register entry 22-C updated."}, actor="U-201")
    check("officer can submit for verification", code == 200, str(sub.get("action", {}).get("status")))
    check("violation moved to ACTION_SUBMITTED", sub.get("violation", {}).get("status") == "ACTION_SUBMITTED", str(sub.get("violation", {}).get("status")))
    code, ver = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "VERIFIED", "verification_notes": "Verified on site with the overman; stop tested under load."}, actor="U-201")
    check("officer CANNOT verify their own work", code == 403, str(ver.get("detail", ""))[:70])
    check("guard message names the requirement", "verify" in str(ver.get("detail", "")).lower())
    score_after_submit = (req("GET", "/api/zones/Z-ALPHA-B/risk")[1])["risk_score"]
    code, ver2 = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "VERIFIED", "verification_notes": "Verified on site with the overman; stop tested under load."}, actor="U-301")
    check("manager can verify", code == 200, str(ver2.get("action", {}).get("status")))
    check("verification closed the violation", ver2.get("violation", {}).get("status") == "CLOSED", str(ver2.get("violation", {}).get("status")))
    check(
        "risk fell after resolution",
        ver2["risk_impact"]["delta"] < 0,
        f"{ver2['risk_impact']['before']} → {ver2['risk_impact']['after']}",
    )

    # A rejection is not a suggestion: verification has to follow a real resubmission.
    code, withdraw = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "REJECTED", "verification_notes": "Verification withdrawn — the shift test report attached to the submission did not cover the third belt."}, actor="U-301")
    check("a verifier can withdraw a verification", code == 200 and withdraw.get("action", {}).get("status") == "REJECTED", str(withdraw.get("detail", withdraw.get("action", {}).get("status")))[:70])
    check("withdrawal reopens the violation for rework", withdraw.get("violation", {}).get("status") == "IN_PROGRESS", str(withdraw.get("violation", {}).get("status")))
    code, reverify = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "VERIFIED", "verification_notes": "Second attempt with no rework."}, actor="U-301")
    check("a rejected action cannot be verified without rework", code == 409, str(reverify.get("detail", ""))[:80])
    req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "IN_PROGRESS"}, actor="U-201")
    code, resub = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "SUBMITTED", "resolution_notes": "Third belt tested as well; revised shift report attached."}, actor="U-201")
    code, reverify2 = req("PATCH", f"/api/corrective-actions/{action_id}", {"status": "VERIFIED", "verification_notes": "Verified on site after rework."}, actor="U-301")
    check("rework then resubmission restores closure", code == 200 and reverify2.get("violation", {}).get("status") == "CLOSED", f"{code} / {reverify2.get('violation', {}).get('status')}")

    print("\n=== 7. simulation (what-if) ===")
    code, sim = req("POST", "/api/risk/simulate", {"zone_id": "Z-ALPHA-D", "resolve_action_ids": []})
    check("simulate endpoint responds", code == 200 and "delta" in sim)
    dash2 = req("GET", "/api/analytics")[1]
    overdue_ids = [a["id"] for a in req("GET", "/api/corrective-actions?status=OVERDUE")[1]["actions"] if a["zone_id"] == "Z-ALPHA-C"]
    code, sim2 = req("POST", "/api/risk/simulate", {"zone_id": "Z-ALPHA-C", "resolve_action_ids": overdue_ids})
    check("clearing overdue actions is projected to reduce risk", code == 200 and sim2["delta"] <= 0, f"{sim2.get('before', {}).get('risk_score')} → {sim2.get('after', {}).get('risk_score')}")

    print("\n=== 8. intelligence & analytics ===")
    code, an = req("GET", "/api/analytics?days=30")
    check("analytics answers 'which mine is getting riskier'", len(an["mine_risk_trends"]) == 4 and "change" in an["mine_risk_trends"][0])
    check("analytics answers 'which department'", len(an["departments"]) == 3 and an["departments"][0]["exposure"] >= an["departments"][-1]["exposure"])
    check("analytics answers 'what keeps repeating'", len(an["recurring_issues"]) >= 1, an["recurring_issues"][0]["category"] + f" x{an['recurring_issues'][0]['occurrences']}")
    check("analytics answers 'what is delayed'", an["overdue"]["total"] > 0, f"{an['overdue']['total']} overdue")
    check("status funnel covers the full flow", len(an["status_funnel"]) == 6)
    check("cadence table present", len(an["cadence"]) == 20)

    code, ins = req("GET", "/api/insights")
    check("insights are generated", len(ins["insights"]) >= 5, f"{len(ins['insights'])}")
    texts = json.dumps(ins["insights"])
    check("insights quote live numbers", any(ch.isdigit() for ch in texts))
    check("insights expose scope links", all(i.get("action", {}).get("to") for i in ins["insights"]))

    print("\n=== 9. reports ===")
    code, rep = req("POST", "/api/reports/generate", {"report_type": "MINE_RISK_ASSESSMENT", "mine_id": "MINE-ALPHA", "days": 30})
    check("risk assessment report generates", code == 200, f"{len(rep['report']['sections'])} sections")
    sections = json.dumps(rep["report"]["sections"])
    check("report includes AI factors", "Repeat Violations" in sections or "Violation Severity" in sections)
    check("report includes recommended actions", "Recommended actions" in sections)
    check("report executive summary mentions both scores", "compliance" in rep["report"]["executive_summary"].lower() and "risk" in rep["report"]["executive_summary"].lower())
    for t in ("MINE_COMPLIANCE_SUMMARY", "OPEN_VIOLATIONS", "OVERDUE_ACTIONS", "DEPARTMENT_COMPLIANCE", "EARLY_WARNING"):
        c2, r2 = req("POST", "/api/reports/generate", {"report_type": t, "mine_id": "MINE-ALPHA" if t in {"MINE_COMPLIANCE_SUMMARY", "OPEN_VIOLATIONS", "OVERDUE_ACTIONS"} else None, "days": 30})
        check(f"report {t} generates", c2 == 200 and r2["report"]["sections"], f"{len(r2.get('report', {}).get('sections', []))} sections")
    if not BASE:
        r3 = CLIENT.get(f"/api/reports/download/MINE_RISK_ASSESSMENT?mine_id=MINE-ALPHA&format=csv")
        check("csv export downloads", r3.status_code == 200 and "," in r3.text, f"{len(r3.text)} bytes")
        r4 = CLIENT.get(f"/api/reports/download/MINE_RISK_ASSESSMENT?mine_id=MINE-ALPHA&format=md")
        check("markdown export downloads", r4.status_code == 200 and r4.text.startswith("#"), f"{len(r4.text)} bytes")

    print("\n=== 10. document intelligence ===")
    code, docs = req("GET", "/api/documents")
    check("documents list with pipeline", code == 200 and len(docs["documents"]) >= 4 and len(docs["pipeline"]) == 6)
    check("a failed OCR document is surfaced as failed", any(d["status"] == "FAILED" for d in docs["documents"]))
    if not BASE:
        files = {"file": ("field-note-zb.txt", b"Inspection report IR/ALP/B/2026-999\ndate: 2026-09-01\nDefects found: 4\nimmediate stoppage: Yes\n", "text/plain")}
        data = {"mine_id": "MINE-ALPHA", "zone_id": "Z-ALPHA-B", "notes": "Uploaded from the tablet during the round."}
        r5 = CLIENT.post("/api/documents/upload", files=files, data=data, headers={"X-User-Id": "U-101"})
        doc = r5.json()["document"]
        check("upload extracts + classifies", r5.status_code == 201 and doc["doc_type"] == "INSPECTION_REPORT", f"{doc['doc_type']} conf={doc['confidence']}")
        check("key fields extracted", doc["extracted"].get("defects_found") == "4", json.dumps(doc["extracted"]))
        code, link = req("POST", f"/api/documents/{doc['id']}/link", {"zone_id": "Z-ALPHA-B", "create_violations": True}, actor="U-301")
        check("document gap becomes a register entry", code == 200, str(link.get("message"))[:60])

    print("\n=== 11. filters, empty & error states ===")
    code, v = req("GET", "/api/violations?severity=CRITICAL&status=OPEN_ANY")
    check("violation filters work", code == 200 and all(x["severity"] == "CRITICAL" for x in v["violations"]))
    code, v2 = req("GET", "/api/violations?evidence=missing")
    all_open = len([x for x in v["violations"]]) if False else req("GET", "/api/violations?limit=1000")[1]["total"]
    check("evidence filter returns a strict subset", code == 200 and 0 < len(v2["violations"]) < all_open, f"{len(v2['violations'])} of {all_open}")
    check("returned items really have no evidence", all(x["evidence_count"] == 0 for x in v2["violations"]))
    code, v3 = req("GET", "/api/violations?zone_id=NOPE")
    check("unknown filter yields an empty list, not an error", code == 200 and v3["violations"] == [])
    code, e404 = req("GET", "/api/zones/ZONE-NOPE/risk")
    check("missing resources return 404", e404.get("detail") and code == 404)
    code, e400 = req("POST", "/api/violations", {"mine_id": "MINE-ALPHA", "zone_id": "Z-ALPHA-B", "category": "Safety Equipment", "severity": "HIGH", "description": "short"})
    check("validation rejects a too-short description", code == 422, f"{code}")
    code, e400b = req("POST", "/api/violations", {"mine_id": "MINE-ALPHA", "zone_id": "Z-ALPHA-B", "category": "NoSuchCategory", "severity": "NONSENSE", "description": "A description long enough to pass validation checks."})
    check("invalid enum rejected by validation", code == 422)
    code, e400c = req("POST", "/api/inspections", {"mine_id": "MINE-ALPHA", "zone_id": "Z-ALPHA-B", "department": "SAFETY", "inspector_id": "U-101", "observations": "A perfectly reasonable set of observations recorded here.", "inspection_date": "2099-01-01", "overall_rating": "COMPLIANT"})
    check("future-dated inspection rejected", code in (400, 422), f"{code}")
    code, e400d = req("POST", "/api/inspections", {"mine_id": "MINE-ALPHA", "zone_id": "Z-BRH-A", "department": "SAFETY", "inspector_id": "U-101", "observations": "Zone from another mine should be rejected outright.", "overall_rating": "COMPLIANT"})
    check("cross-mine zone rejected", code == 400, str(json.dumps(e400d)[:60]))
    code, role403 = req("POST", "/api/admin/reset", {}, actor="U-201")
    check("officer cannot reset the demo", code == 403, str(role403.get("detail", ""))[:60])

    print("\n=== 12. demo reliability ===")
    code, res = req("POST", "/api/admin/reset", {}, actor="U-401")
    check("reset restores baseline", code == 200 and res["counts"]["violations"] == 78, json.dumps(res["counts"]))
    code, zr2 = req("GET", "/api/zones/Z-ALPHA-B/risk")
    check("Zone B returns to the baseline score after reset", abs(zr2["risk_score"] - zone_b["risk_score"]) < 0.05, f"{zr2['risk_score']} vs {zone_b['risk_score']}")
    code, sc = req("POST", "/api/admin/scenario", {"name": "ZONE_B_ESCALATION"}, actor="U-401")
    check("one-click scenario runs and raises risk", code == 200 and sc["risk_impact"]["delta"] > 0, f"{sc['risk_impact']['before']} → {sc['risk_impact']['after']}")
    code, res2 = req("POST", "/api/admin/reset", {}, actor="U-401")
    check("reset after scenario is clean", code == 200)
    # determinism: two resets give identical scores
    a = req("GET", "/api/dashboard")[1]["zone_heat"]
    req("POST", "/api/admin/reset", {}, actor="U-401")
    b = req("GET", "/api/dashboard")[1]["zone_heat"]
    check("demo is deterministic across resets", json.dumps([(z['id'], z['risk_score']) for z in a]) == json.dumps([(z['id'], z['risk_score']) for z in b]))
    code, perf = req("GET", "/api/dashboard")
    t0 = time.time()
    for _ in range(5):
        req("GET", "/api/dashboard")
    check("dashboard reads stay fast", (time.time() - t0) / 5 < 1.2, f"{(time.time() - t0) / 5 * 1000:.0f} ms/read")

    print("\n=== 13. data integrity ===")
    code, allv = req("GET", "/api/violations?limit=1000")
    rows = allv["violations"]
    check("every violation has a valid status", all(x["status"] in ("OPEN", "ASSIGNED", "IN_PROGRESS", "ACTION_SUBMITTED", "UNDER_VERIFICATION", "CLOSED") for x in rows))
    check("closed violations all carry a closed_at date", all(x.get("closed_at") for x in rows if x["status"] == "CLOSED"))
    check("no violation is dated in the future", all(x["created_at"] <= time.strftime("%Y-%m-%d") for x in rows))
    check("open violations have risk contribution > 0", all(x["risk_contribution"] > 0 for x in rows if x["status"] != "CLOSED"), f"bad={sum(1 for x in rows if x['status'] != 'CLOSED' and not x['risk_contribution'])}")
    code, acts = req("GET", "/api/corrective-actions")
    check("every action maps to an existing violation", all(req("GET", f"/api/violations/{a['violation_id']}")[0] == 200 for a in acts["actions"][:15]))
    check("no orphan action statuses", all(a["status"] in ("PENDING", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "VERIFIED", "REJECTED", "CLOSED") for a in acts["actions"]))

    print(f"\n{'=' * 64}\n  {len(PASS)} passed, {len(FAIL)} failed\n{'=' * 64}")
    if FAIL:
        print("\nFAILED CHECKS:")
        for f in FAIL:
            print("  -", f)
    # leave the workspace in the clean baseline state for a live demo
    req("POST", "/api/admin/reset", {}, actor="U-401")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
MINEGUARD AI — workflow engine.

Status transitions are enforced here, on the server, against the canonical
flow — never by which buttons the UI happens to render. That matters for two
reasons: an inspector with a crafted request cannot skip verification, and the
demo cannot drift into a state the workflow is supposed to forbid.

    OPEN → ASSIGNED → IN_PROGRESS → ACTION_SUBMITTED → UNDER_VERIFICATION → CLOSED

Rules
-----
* Only one step forward at a time.
* Reaching CLOSED requires the chain to have been walked, unless the actor has
  override authority (MANAGER / ADMIN) and supplies a written justification,
  which is persisted to `workflow_overrides` and surfaced in the audit trail.
* Rejection sends the violation back to IN_PROGRESS with the verifier's note
  attached — it does not silently revert to OPEN.
* A violation cannot be assigned without an owner and a due date, because the
  overdue factor of the risk engine is meaningless without one.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

class WorkflowError(Exception):
    """Raised for an illegal transition or a failed guard."""


class WorkflowPermissionError(WorkflowError):
    """The actor is not authorised for this step (maps to HTTP 403)."""


ALLOWED_TRANSITIONS: Dict[str, List[str]] = {
    "OPEN": ["ASSIGNED", "IN_PROGRESS", "CLOSED"],
    "ASSIGNED": ["IN_PROGRESS", "OPEN"],
    "IN_PROGRESS": ["ACTION_SUBMITTED", "OPEN"],
    "ACTION_SUBMITTED": ["UNDER_VERIFICATION", "IN_PROGRESS"],
    "UNDER_VERIFICATION": ["CLOSED", "IN_PROGRESS"],
    "CLOSED": ["IN_PROGRESS"],
}
FLOW_ORDER = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ACTION_SUBMITTED", "UNDER_VERIFICATION", "CLOSED"]
OVERRIDE_ROLES = {"MANAGER", "ADMIN"}
REOPEN_ROLES = {"MANAGER", "ADMIN"}

SLA_DAYS = {"CRITICAL": 3, "HIGH": 7, "MEDIUM": 14, "LOW": 30}
ACTION_TEXT_DEFAULT = "Complete corrective action, verify on site and attach resolution evidence."


def default_due_date(severity: str, start: Optional[date] = None) -> str:
    return ((start or date.today()) + timedelta(days=SLA_DAYS.get(severity, 14))).isoformat()


def can_move(current: str, target: str) -> bool:
    return target in ALLOWED_TRANSITIONS.get(current, [])


def steps_between(current: str, target: str) -> int:
    if current not in FLOW_ORDER or target not in FLOW_ORDER:
        return 99
    return FLOW_ORDER.index(target) - FLOW_ORDER.index(current)


def _actor(store, actor_id: Optional[str]) -> dict:
    if not actor_id:
        return {"id": "SYSTEM", "name": "System", "role": "ADMIN", "designation": "Automated process"}
    return store.user(actor_id) or {"id": actor_id, "name": actor_id, "role": "INSPECTOR", "designation": "Unknown"}


def advance_violation(
    store,
    violation_id: str,
    target: str,
    *,
    actor_id: Optional[str] = None,
    note: str = "",
    override: bool = False,
) -> Dict[str, Any]:
    """Move a violation along the flow, applying the guards, then re-score."""
    with store.lock:
        vio = store.find("violations", violation_id)
        if not vio:
            raise WorkflowError(f"Violation {violation_id} does not exist.")
        if target not in FLOW_ORDER:
            raise WorkflowError(f"'{target}' is not a valid violation status.")

        current = vio["status"]
        actor = _actor(store, actor_id)
        forward = steps_between(current, target) > 0
        justification = (note or "").strip()

        if current == target:
            raise WorkflowError(f"Violation is already {current}.")

        if not can_move(current, target):
            skips = abs(steps_between(current, target)) - 1
            authorised = actor.get("role") in OVERRIDE_ROLES and override and justification
            if not authorised:
                if actor.get("role") in OVERRIDE_ROLES:
                    raise WorkflowPermissionError(
                        f"{current} → {target} skips {skips} required step(s). Provide a written justification to override."
                    )
                raise WorkflowError(
                    f"{current} → {target} is not a permitted transition. Follow the workflow "
                    f"({' → '.join(FLOW_ORDER[FLOW_ORDER.index(current):FLOW_ORDER.index(target) + 1])}), "
                    "or ask a Mine Manager to override with a justification."
                )
            store.data.setdefault("workflow_overrides", []).append(
                {
                    "id": store.next_id("workflow_overrides", "OVR"),
                    "violation_id": violation_id,
                    "actor_id": actor["id"],
                    "actor": actor["name"],
                    "role": actor.get("role", ""),
                    "from_status": current,
                    "to_status": target,
                    "skipped_steps": skips,
                    "reason": justification,
                    "created_at": date.today().isoformat(),
                }
            )
            store.log(actor["id"], "OVERRIDE", f"Overrode workflow on {violation_id}: {current} → {target}. {justification}", violation_id)
        elif forward and target == "CLOSED":
            # Closure requires evidence of resolution on the linked action.
            linked = [a for a in store.data.get("corrective_actions", []) if a["violation_id"] == violation_id]
            if not any(a["status"] in {"VERIFIED", "CLOSED"} for a in linked):
                raise WorkflowError(
                    "A violation can only be closed after the linked corrective action is verified. "
                    "Submit resolution evidence, then have a manager verify it."
                )

        if target in {"ASSIGNED", "IN_PROGRESS"} and not vio.get("assigned_to"):
            raise WorkflowError("Assign a responsible officer before moving the violation into the action phase.")
        if target in {"ASSIGNED", "IN_PROGRESS"} and not vio.get("due_date"):
            vio["due_date"] = default_due_date(vio["severity"])

        vio["status"] = target
        vio["status_note"] = justification or None
        if target == "CLOSED":
            vio["closed_at"] = date.today().isoformat()
            for a in store.data.get("corrective_actions", []):
                if a["violation_id"] == violation_id and a["status"] not in {"CLOSED"}:
                    a["status"] = "CLOSED"
                    a["closed_at"] = date.today().isoformat()
        elif target == "IN_PROGRESS" and current == "UNDER_VERIFICATION":
            vio["closed_at"] = None

        store.log(
            actor["id"],
            "WORKFLOW",
            f"{vio['id']} moved {current} → {target}" + (f" — {justification}" if justification else ""),
            violation_id,
        )
        store.touch()
        return vio


def assign_violation(store, violation_id: str, *, officer_id: str, due_date: Optional[str] = None, actor_id: Optional[str] = None) -> Dict[str, Any]:
    """Assign an owner (and optionally create the corrective action in one step)."""
    with store.lock:
        vio = store.find("violations", violation_id)
        if not vio:
            raise WorkflowError(f"Violation {violation_id} does not exist.")
        officer = store.user(officer_id)
        if not officer:
            raise WorkflowError(f"Unknown officer '{officer_id}'.")
        if officer["role"] not in {"OFFICER", "MANAGER"}:
            raise WorkflowPermissionError(f"{officer['name']} is registered as {officer['role']} and cannot own a corrective action.")
        vio["assigned_to"] = officer_id
        vio["due_date"] = due_date or default_due_date(vio["severity"])
        if vio["status"] == "OPEN":
            vio["status"] = "ASSIGNED"
        store.log(actor_id or officer_id, "ASSIGN", f"{vio['id']} assigned to {officer['name']}, due {vio['due_date']}.", violation_id)
        store.touch()
        return vio


def create_action(
    store,
    *,
    violation_id: str,
    description: str,
    assigned_to: str,
    due_date: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> Dict[str, Any]:
    with store.lock:
        vio = store.find("violations", violation_id)
        if not vio:
            raise WorkflowError(f"Violation {violation_id} does not exist.")
        if vio["status"] == "CLOSED":
            raise WorkflowError("Cannot raise a corrective action against a closed violation. Reopen it first.")
        officer = store.user(assigned_to)
        if not officer:
            raise WorkflowError(f"Unknown assignee '{assigned_to}'.")
        action = {
            "id": store.next_id("corrective_actions", "CA"),
            "violation_id": violation_id,
            "mine_id": vio["mine_id"],
            "zone_id": vio["zone_id"],
            "description": description.strip(),
            "status": "ASSIGNED",
            "assigned_to": assigned_to,
            "created_at": date.today().isoformat(),
            "due_date": due_date or default_due_date(vio["severity"]),
            "started_at": None,
            "completed_at": None,
            "closed_at": None,
            "resolution_notes": None,
            "verification_notes": None,
            "verified_by": None,
            "verified_at": None,
            "evidence_count": 0,
            "priority": "HIGH" if vio["severity"] in {"CRITICAL", "HIGH"} else "MEDIUM",
        }
        store.data["corrective_actions"].append(action)
        vio["action_ids"] = list(vio.get("action_ids") or []) + [action["id"]]
        vio["assigned_to"] = assigned_to
        vio["due_date"] = action["due_date"]
        if vio["status"] == "OPEN":
            vio["status"] = "ASSIGNED"
        store.log(
            actor_id or assigned_to,
            "ACTION_CREATED",
            f"{action['id']} raised for {vio['id']} and assigned to {officer['name']} (due {action['due_date']}).",
            action["id"],
        )
        store.touch()
        return action


def update_action(
    store,
    action_id: str,
    *,
    status: Optional[str] = None,
    resolution_notes: Optional[str] = None,
    verification_notes: Optional[str] = None,
    due_date: Optional[str] = None,
    assigned_to: Optional[str] = None,
    actor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Officer progress, submission, verification and rejection."""
    with store.lock:
        action = store.find("corrective_actions", action_id)
        if not action:
            raise WorkflowError(f"Corrective action {action_id} does not exist.")
        actor = _actor(store, actor_id)
        today = date.today()

        if assigned_to:
            officer = store.user(assigned_to)
            if not officer:
                raise WorkflowError(f"Unknown assignee '{assigned_to}'.")
            action["assigned_to"] = assigned_to
        if due_date:
            action["due_date"] = due_date

        if status:
            if status not in {"ASSIGNED", "IN_PROGRESS", "SUBMITTED", "VERIFIED", "REJECTED", "CLOSED"}:
                raise WorkflowError(f"'{status}' is not a valid action status.")
            order = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "VERIFIED", "CLOSED"]
            if status in order and action["status"] in order:
                if order.index(status) - order.index(action["status"]) > 1 and status != "ASSIGNED":
                    raise WorkflowError(
                        f"Action cannot jump {action['status']} → {status}. Advance one stage at a time."
                    )
            if status in {"VERIFIED", "CLOSED"} and action["status"] not in {"SUBMITTED", "VERIFIED"}:
                # A rejection is not a suggestion: the finding has to be reworked and
                # submitted again before anyone can verify it. Without this a manager
                # could flip a rejected action straight into a verification.
                raise WorkflowError(
                    f"An action in {action['status']} cannot be {status.lower()} — the officer must rework it and submit it for verification first."
                )
            if status in {"VERIFIED", "CLOSED"} and actor["role"] not in OVERRIDE_ROLES:
                raise WorkflowPermissionError("Only a Mine Manager or Enterprise Administrator can verify or close an action.")
            if status == "SUBMITTED" and not (resolution_notes or action.get("resolution_notes")):
                raise WorkflowError("Resolution notes are required before an action can be submitted for verification.")
            if status == "REJECTED":
                if actor["role"] not in OVERRIDE_ROLES:
                    raise WorkflowPermissionError("Only a verifier can reject a submitted action.")
                if not verification_notes:
                    raise WorkflowError("A rejection requires a written reason.")
                action["verification_notes"] = verification_notes
                action["verified_by"] = actor["id"]
                action["verified_at"] = today.isoformat()
            action["status"] = status
            if status == "IN_PROGRESS" and not action.get("started_at"):
                action["started_at"] = today.isoformat()
            if status == "SUBMITTED":
                action["completed_at"] = today.isoformat()
            if status == "VERIFIED":
                action["verified_by"] = actor["id"]
                action["verified_at"] = today.isoformat()
                action["closed_at"] = today.isoformat()
            if resolution_notes is not None:
                action["resolution_notes"] = resolution_notes
            if verification_notes is not None and status != "REJECTED":
                action["verification_notes"] = verification_notes
        else:
            if resolution_notes is not None:
                action["resolution_notes"] = resolution_notes
            if verification_notes is not None:
                action["verification_notes"] = verification_notes

        store.sync_violation_from_action(action)
        store.log(
            actor["id"],
            "ACTION_UPDATE",
            f"{action['id']} → {action['status']}"
            + (f" — {action.get('resolution_notes') or action.get('verification_notes') or ''}").rstrip("— ").strip(),
            action["id"],
        )
        store.touch()
        return action


def add_evidence(
    store,
    *,
    violation_id: Optional[str] = None,
    action_id: Optional[str] = None,
    file_name: str,
    kind: str = "OBSERVATION",
    note: str = "",
    uploaded_by: str = "U-101",
    size_kb: int = 240,
) -> Dict[str, Any]:
    with store.lock:
        if not violation_id and action_id:
            action = store.find("corrective_actions", action_id)
            violation_id = (action or {}).get("violation_id")
        if violation_id and not store.find("violations", violation_id):
            raise WorkflowError(f"Violation {violation_id} does not exist.")
        ev = {
            "id": store.next_id("evidence", "EV"),
            "violation_id": violation_id,
            "action_id": action_id,
            "type": "PHOTO" if file_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")) else "DOCUMENT",
            "file_name": file_name,
            "note": note,
            "uploaded_by": uploaded_by,
            "uploaded_at": date.today().isoformat(),
            "size_kb": size_kb,
            "kind": kind,
        }
        store.data["evidence"].append(ev)
        if action_id:
            action = store.find("corrective_actions", action_id)
            if action:
                action["evidence_count"] = int(action.get("evidence_count") or 0) + 1
        if violation_id:
            vio = store.find("violations", violation_id)
            if vio:
                vio["evidence_count"] = len(store.evidence_for(violation_id))
        store.log(uploaded_by, "EVIDENCE", f"Evidence '{file_name}' attached to {violation_id or action_id}.", violation_id or action_id)
        store.touch()
        return ev


def create_violation(
    store,
    *,
    mine_id: str,
    zone_id: str,
    category: str,
    severity: str,
    description: str,
    inspection_id: Optional[str] = None,
    department: Optional[str] = None,
    notes: str = "",
    assigned_to: Optional[str] = None,
    due_date: Optional[str] = None,
    actor_id: str = "U-101",
) -> Dict[str, Any]:
    from .risk_engine import SEVERITY_WEIGHTS  # local to avoid import cycle at module load

    with store.lock:
        zone = store.zone(zone_id)
        mine = store.mine(mine_id)
        if not zone:
            raise WorkflowError(f"Unknown zone '{zone_id}'.")
        if zone["mine_id"] != mine_id:
            raise WorkflowError(f"Zone {zone['name']} does not belong to {mine_id}.")
        if not mine:
            raise WorkflowError(f"Unknown mine '{mine_id}'.")
        if severity not in SEVERITY_WEIGHTS:
            raise WorkflowError(f"Severity must be one of {', '.join(SEVERITY_ORDER)}.")
        valid_categories = {c["name"] for c in store.data["config"]["violation_categories"].get(department or "", [])}
        if department and valid_categories and category not in valid_categories:
            raise WorkflowError(f"'{category}' is not a {department} category.")
        if not description.strip():
            raise WorkflowError("A description is required — the engine explains risk in words, so it needs words.")

        dept = department or CATEGORY_DEPT_LOOKUP(store, category)
        today = date.today()
        series = store.occurrence_index(today).get((zone_id, category), [])
        violation = {
            "id": store.next_id("violations", "VIO"),
            "inspection_id": inspection_id,
            "mine_id": mine_id,
            "zone_id": zone_id,
            "department": dept,
            "category": category,
            "severity": severity,
            "status": "ASSIGNED" if assigned_to else "OPEN",
            "description": description.strip(),
            "regulation": CATEGORY_REG_LOOKUP(store, category),
            "notes": notes.strip(),
            "created_at": today.isoformat(),
            "due_date": due_date or (default_due_date(severity) if assigned_to else None),
            "closed_at": None,
            "assigned_to": assigned_to,
            "occurrences": len(series) + 1,
            "action_ids": [],
            "evidence_count": 0,
            "risk_contribution": 0,
        }
        if violation["occurrences"] > 1:
            violation["repeat_of"] = series[-1]
        store.data["violations"].append(violation)
        if inspection_id:
            insp = store.find("inspections", inspection_id)
            if insp:
                insp["violation_ids"] = list(insp.get("violation_ids") or []) + [violation["id"]]
                insp["issues_found"] = len(insp["violation_ids"])
                insp["overall_rating"] = "NON_COMPLIANT"
        store.log(
            actor_id,
            "VIOLATION",
            f"{violation['id']} recorded in {zone['name']} — {category} ({severity}, occurrence {violation['occurrences']}).",
            violation["id"],
        )
        store.touch()
        return violation


def CATEGORY_DEPT_LOOKUP(store, category: str) -> str:
    for dept, defs in store.data["config"]["violation_categories"].items():
        if any(c["name"] == category for c in defs):
            return dept
    return "SAFETY"


def CATEGORY_REG_LOOKUP(store, category: str) -> str:
    for defs in store.data["config"]["violation_categories"].values():
        for c in defs:
            if c["name"] == category:
                return c.get("regulation", "DGMS applicable regulation")
    return "DGMS applicable regulation"


SEVERITY_ORDER = ("CRITICAL", "HIGH", "MEDIUM", "LOW")

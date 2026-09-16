"""MINEGUARD AI — API dependency wiring."""

from __future__ import annotations

from typing import Optional

from fastapi import Header, HTTPException

from .store import store as DB


def get_store():
    return DB


def get_actor(x_user_id: Optional[str] = Header(default=None)) -> dict:
    """
    Lightweight identity for the prototype. There is no authentication layer by
    design (see the brief: "do not build unnecessary authentication first"), but
    authorisation rules are real: the role attached to this header decides who
    may verify, override or reassign, and it is checked server-side.
    """
    if not x_user_id:
        return {"id": "U-401", "name": "Kavita Menon", "role": "ADMIN", "designation": "Enterprise Compliance Head", "mine_id": None, "initials": "KM"}
    user = DB.user(x_user_id)
    if not user:
        raise HTTPException(status_code=401, detail=f"Unknown actor '{x_user_id}'.")
    return user


def require_role(user: dict, *roles: str) -> None:
    if roles and user.get("role") not in roles:
        raise HTTPException(
            status_code=403,
            detail=f"This action requires one of: {', '.join(roles)}. You are acting as {user.get('role')}.",
        )

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal
import uuid
from datetime import datetime

from app.services.confluence_service import ConfluenceService

router = APIRouter()

# In-memory store for now — replace with PostgreSQL in next phase
_proposals: dict[str, dict] = {}


class CreateProposalRequest(BaseModel):
    action: Literal["archive", "merge", "restructure", "update_owner", "add_summary", "retag"]
    source_page_id: str
    source_page_title: str
    target_page_id: str | None = None
    target_page_title: str | None = None
    rationale: str
    diff: str | None = None


class ReviewProposalRequest(BaseModel):
    status: Literal["approved", "rejected"]
    reviewed_by: str
    note: str | None = None


@router.get("/")
async def list_proposals(status: str | None = None):
    proposals = list(_proposals.values())
    if status:
        proposals = [p for p in proposals if p["status"] == status]
    return {"proposals": proposals, "total": len(proposals)}


@router.post("/")
async def create_proposal(body: CreateProposalRequest):
    proposal_id = str(uuid.uuid4())
    proposal = {
        "id": proposal_id,
        **body.model_dump(),
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "reviewed_at": None,
        "reviewed_by": None,
    }
    _proposals[proposal_id] = proposal
    return proposal


@router.patch("/{proposal_id}/review")
async def review_proposal(proposal_id: str, body: ReviewProposalRequest):
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = _proposals[proposal_id]
    if proposal["status"] != "pending":
        raise HTTPException(status_code=400, detail="Proposal already reviewed")

    proposal["status"] = body.status
    proposal["reviewed_by"] = body.reviewed_by
    proposal["reviewed_at"] = datetime.utcnow().isoformat()
    if body.note:
        proposal["note"] = body.note

    return proposal


@router.get("/{proposal_id}")
async def get_proposal(proposal_id: str):
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return _proposals[proposal_id]


class ApplyProposalRequest(BaseModel):
    confluence_base_url: str
    email: str
    api_token: str
    applied_by: str = "Dashboard User"


@router.post("/{proposal_id}/apply")
async def apply_proposal(proposal_id: str, body: ApplyProposalRequest):
    """
    Apply an approved proposal to Confluence via the REST API.
    Requires the user to supply Confluence credentials (never stored server-side).
    """
    if proposal_id not in _proposals:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = _proposals[proposal_id]
    if proposal["status"] not in ("approved", "pending"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot apply a proposal with status '{proposal['status']}'",
        )

    svc = ConfluenceService(
        base_url=body.confluence_base_url,
        api_token=body.api_token,
        email=body.email,
    )

    action = proposal.get("action")

    try:
        if action == "archive":
            await svc.archive_page(proposal["source_page_id"])
        else:
            new_content = proposal.get("new_content")
            if not new_content:
                raise HTTPException(
                    status_code=400,
                    detail="This proposal has no generated content to apply. Use /api/edit/generate first.",
                )
            page_version = proposal.get("page_version", 1)
            await svc.update_page(
                page_id=proposal["source_page_id"],
                title=proposal["source_page_title"],
                body=new_content,
                current_version=page_version,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Confluence API error: {exc}",
        )

    proposal["status"] = "applied"
    proposal["applied_at"] = datetime.utcnow().isoformat()
    proposal["applied_by"] = body.applied_by

    return {"success": True, "message": "Changes applied to Confluence successfully.", "proposal": proposal}

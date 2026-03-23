from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal
import uuid
from datetime import datetime

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

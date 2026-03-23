from fastapi import APIRouter

router = APIRouter()

# Placeholder — will pull from PostgreSQL audit table
@router.get("/")
async def list_audit_entries():
    return {"entries": [], "total": 0}

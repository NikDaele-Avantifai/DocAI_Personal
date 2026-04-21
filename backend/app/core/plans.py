from dataclasses import dataclass


@dataclass
class PlanLimits:
    analyses_per_month: int | None      # None = unlimited
    chat_per_month: int | None
    rename_per_month: int | None
    duplication_scans_per_month: int | None
    max_spaces: int | None
    max_users: int | None
    # Feature flags
    compliance_tagging: bool
    jira_integration: bool
    dedicated_support: bool
    sla: bool


PLAN_LIMITS: dict[str, PlanLimits] = {
    "trial": PlanLimits(
        analyses_per_month=20,
        chat_per_month=10,
        rename_per_month=50,
        duplication_scans_per_month=1,
        max_spaces=2,
        max_users=3,
        compliance_tagging=False,
        jira_integration=False,
        dedicated_support=False,
        sla=False,
    ),
    "starter": PlanLimits(
        analyses_per_month=100,
        chat_per_month=50,
        rename_per_month=200,
        duplication_scans_per_month=4,
        max_spaces=2,
        max_users=3,
        compliance_tagging=False,
        jira_integration=False,
        dedicated_support=False,
        sla=False,
    ),
    "growth": PlanLimits(
        analyses_per_month=500,
        chat_per_month=300,
        rename_per_month=1000,
        duplication_scans_per_month=20,
        max_spaces=5,
        max_users=10,
        compliance_tagging=True,
        jira_integration=True,
        dedicated_support=False,
        sla=False,
    ),
    "scale": PlanLimits(
        analyses_per_month=None,
        chat_per_month=None,
        rename_per_month=None,
        duplication_scans_per_month=None,
        max_spaces=None,
        max_users=25,
        compliance_tagging=True,
        jira_integration=True,
        dedicated_support=True,
        sla=True,
    ),
    "expired": PlanLimits(
        analyses_per_month=0,
        chat_per_month=0,
        rename_per_month=0,
        duplication_scans_per_month=0,
        max_spaces=0,
        max_users=0,
        compliance_tagging=False,
        jira_integration=False,
        dedicated_support=False,
        sla=False,
    ),
}


def get_limits(plan: str) -> PlanLimits:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["expired"])

"""
Step 7 integration test: anchor_html → _validate_and_clean pipeline.

Verifies the precision guarantee introduced in Step 3:
  - Issues with a valid blockId + verbatim exactContent → survive
  - Issues with a bogus blockId → dropped  (dropped_unknown_block)
  - Issues with fabricated exactContent on a real blockId → dropped (dropped_unverified_quote)
  - general-issue with null blockId → survive (no block validation)
  - location is built from blockId in block:{id} format
  - PHASE_MAP covers all taxonomy categories, ALL_PHASES is complete

Does NOT call the Anthropic API (Claude response mocked as plain dict).
Does NOT require a database connection.
"""

import pytest

from app.services.block_anchor import anchor_html
from app.models.analysis_settings import AnalysisSettings
from app.api.routes.analyze import _validate_and_clean, PHASE_MAP, ALL_PHASES, ISSUE_TAXONOMY


# ── Fixture HTML ──────────────────────────────────────────────────────────────

STORAGE_HTML = """
<h2>Deployment Guide</h2>
<p>Last updated: January 2023. This document describes the production deployment process.</p>
<ul>
  <li>Deploy to staging first</li>
  <li>Run smoke tests before promoting</li>
</ul>
<p>Owner: TBD — needs to be assigned before next release.</p>
"""


def make_settings(**overrides) -> AnalysisSettings:
    return AnalysisSettings(**{**AnalysisSettings().model_dump(), **overrides})


def run_validate(issues: list[dict], settings: AnalysisSettings | None = None) -> list[dict]:
    doc = anchor_html(STORAGE_HTML)
    raw = {"issues": issues, "summary": "test", "is_healthy": False, "resolved_issues": []}
    result = _validate_and_clean(raw, settings or make_settings(), doc.block_map)
    return result["issues"]


# ── Validation gate tests ──────────────────────────────────────────────────────

class TestValidationGate:
    def setup_method(self):
        self.doc = anchor_html(STORAGE_HTML)
        self.p_blocks = [b for b in self.doc.blocks if b.element_type == "p"]
        # The first <p> contains "January 2023"
        self.stale_block = next(b for b in self.p_blocks if "January 2023" in b.text)

    def test_valid_issue_survives(self):
        issues = run_validate([{
            "type": "text-issue", "category": "stale", "severity": "medium",
            "title": "Stale date", "explanation": "Outdated",
            "blockId": self.stale_block.id, "exactContent": "January 2023",
            "suggestedFix": "June 2026", "affectedElement": "paragraph", "confidence": 0.9,
        }])
        assert len(issues) == 1
        assert issues[0]["blockId"] == self.stale_block.id

    def test_bogus_blockid_dropped(self):
        issues = run_validate([{
            "type": "text-issue", "category": "stale", "severity": "high",
            "title": "Bogus block", "explanation": "This block id does not exist",
            "blockId": "b9999", "exactContent": "some text", "confidence": 0.9,
        }])
        assert issues == []

    def test_fabricated_quote_dropped(self):
        issues = run_validate([{
            "type": "text-issue", "category": "outdated_reference", "severity": "high",
            "title": "Fabricated", "explanation": "Text not in block",
            "blockId": self.stale_block.id,
            "exactContent": "this phrase does not appear in that block xyz abc",
            "confidence": 0.9,
        }])
        assert issues == []

    def test_general_issue_no_blockid_survives(self):
        issues = run_validate([{
            "type": "general-issue", "category": "unowned", "severity": "high",
            "title": "No owner", "explanation": "Page has no owner",
            "blockId": None, "exactContent": None, "confidence": 0.9,
        }])
        assert len(issues) == 1

    def test_location_built_from_blockid(self):
        issues = run_validate([{
            "type": "text-issue", "category": "stale", "severity": "medium",
            "title": "Stale date", "explanation": "Outdated",
            "blockId": self.stale_block.id, "exactContent": "January 2023", "confidence": 0.9,
        }])
        assert len(issues) == 1
        loc = issues[0].get("location") or {}
        assert loc.get("section") == f"block:{self.stale_block.id}"
        assert loc.get("quote") == "January 2023"

    def test_mixed_response_only_valid_survives(self):
        """Valid + bogus blockId + fabricated quote → only valid one passes."""
        issues = run_validate([
            {   # valid
                "type": "text-issue", "category": "stale", "severity": "medium",
                "title": "Stale date", "explanation": "Outdated",
                "blockId": self.stale_block.id, "exactContent": "January 2023", "confidence": 0.9,
            },
            {   # bogus blockId → dropped
                "type": "text-issue", "category": "broken_link", "severity": "high",
                "title": "Nonexistent block", "explanation": "Bad id",
                "blockId": "b9999", "exactContent": "anything", "confidence": 0.9,
            },
            {   # fabricated quote → dropped
                "type": "text-issue", "category": "outdated_reference", "severity": "high",
                "title": "Made up quote", "explanation": "Not real",
                "blockId": self.stale_block.id,
                "exactContent": "completely fabricated text xyz abc 999",
                "confidence": 0.9,
            },
        ])
        assert len(issues) == 1
        assert issues[0]["title"] == "Stale date"

    def test_text_issue_with_no_blockid_skips_block_validation(self):
        """Legacy text-issue with null blockId passes through without block validation."""
        issues = run_validate([{
            "type": "text-issue", "category": "stale", "severity": "low",
            "title": "Legacy", "explanation": "No block anchor",
            "blockId": None, "exactContent": "January 2023", "confidence": 0.9,
        }])
        assert len(issues) == 1


# ── Phase map tests ───────────────────────────────────────────────────────────

class TestPhasesRun:
    def test_phase_map_covers_all_taxonomy(self):
        for category in ISSUE_TAXONOMY:
            assert category in PHASE_MAP, f"{category} not in PHASE_MAP"

    def test_all_phases_complete(self):
        assert set(ALL_PHASES) == {"structure", "content", "compliance", "hygiene"}

    def test_phases_derived_from_enabled_subset(self):
        settings = make_settings(enabled_issue_types=["stale", "unstructured"])
        phases = sorted({PHASE_MAP[c] for c in settings.enabled_issue_types if c in PHASE_MAP})
        assert phases == ["content", "structure"]

    def test_all_enabled_gives_all_phases(self):
        settings = make_settings()
        phases = sorted({PHASE_MAP[c] for c in settings.enabled_issue_types if c in PHASE_MAP})
        assert set(phases) == set(ALL_PHASES)


# ── Determinism tests ─────────────────────────────────────────────────────────

class TestAnchorDeterminism:
    def test_repeated_calls_give_identical_ids(self):
        doc1 = anchor_html(STORAGE_HTML)
        doc2 = anchor_html(STORAGE_HTML)
        assert [b.id for b in doc1.blocks] == [b.id for b in doc2.blocks]

    def test_already_anchored_is_stable(self):
        doc1 = anchor_html(STORAGE_HTML)
        doc2 = anchor_html(doc1.anchored_html)
        assert [b.id for b in doc1.blocks] == [b.id for b in doc2.blocks]
        assert doc1.anchored_html == doc2.anchored_html

"""
Unit tests for the _hoist_homepage helper in sync_service.

Tests the pure function in isolation — no database, no Confluence API.
Covers the cases from the spec:
  - homepage with children → children hoisted, homepage dropped
  - homepage_id=None → tree unchanged
  - homepage with no children → empty homepage node removed (unless tree becomes empty)
  - homepage is only root with no children → kept (guard against empty tree)
  - homepage_id not at root level → tree unchanged (no mis-hit on sub-pages)
  - homepage in the middle of multiple roots → only that node is hoisted
"""

import pytest
from app.services.sync_service import _hoist_homepage


def node(id: str, title: str = "", children: list | None = None) -> dict:
    return {"id": id, "title": title or id, "children": children or []}


class TestHoistHomepage:
    def test_hoists_children_and_drops_homepage(self):
        A = node("A")
        B = node("B")
        H = node("H", children=[A, B])
        X = node("X")
        roots = [H, X]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["A", "B", "X"]

    def test_homepage_id_none_returns_unchanged(self):
        roots = [node("H", children=[node("A")]), node("X")]
        result = _hoist_homepage(roots, None)
        assert result is roots

    def test_homepage_not_found_at_root_returns_unchanged(self):
        roots = [node("H", children=[node("A")]), node("X")]
        # "A" is a child of H, not a root — should not be hoisted
        result = _hoist_homepage(roots, "A")
        assert [n["id"] for n in result] == ["H", "X"]

    def test_homepage_empty_children_dropped(self):
        H = node("H", children=[])
        X = node("X")
        roots = [H, X]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["X"]

    def test_homepage_only_root_no_children_kept(self):
        # Guard: hoisting would produce empty list → keep original
        H = node("H", children=[])
        roots = [H]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["H"]

    def test_homepage_only_root_with_children_hoisted(self):
        A = node("A")
        B = node("B")
        H = node("H", children=[A, B])
        roots = [H]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["A", "B"]

    def test_homepage_at_first_position(self):
        A = node("A")
        H = node("H", children=[A])
        X = node("X")
        Y = node("Y")
        roots = [H, X, Y]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["A", "X", "Y"]

    def test_homepage_in_middle_position(self):
        A = node("A")
        H = node("H", children=[A])
        X = node("X")
        Y = node("Y")
        roots = [X, H, Y]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["X", "A", "Y"]

    def test_homepage_at_last_position(self):
        A = node("A")
        H = node("H", children=[A])
        X = node("X")
        roots = [X, H]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["X", "A"]

    def test_children_order_preserved(self):
        C1 = node("C1")
        C2 = node("C2")
        C3 = node("C3")
        H = node("H", children=[C1, C2, C3])
        roots = [H]
        result = _hoist_homepage(roots, "H")
        assert [n["id"] for n in result] == ["C1", "C2", "C3"]

    def test_string_coercion_of_id(self):
        # homepage_id might be stored as str; node id might also be str or int
        A = node("A")
        H = {"id": 12345, "title": "Homepage", "children": [A]}
        X = node("X")
        roots = [H, X]
        # homepage_id as string should still match
        result = _hoist_homepage(roots, "12345")
        assert [n["id"] for n in result] == ["A", "X"]

    def test_empty_roots_with_homepage_id(self):
        # Edge: no roots at all → unchanged (empty)
        result = _hoist_homepage([], "H")
        assert result == []

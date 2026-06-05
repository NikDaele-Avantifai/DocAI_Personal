"""
Tests for block_anchor.anchor_html.

Covers:
  - Document-order ID assignment
  - Round-trip text preservation
  - Idempotency (calling twice yields identical IDs and HTML)
  - Innermost-only rule (no ID nested inside another ID'd element)
  - Block-level text replacement helper used by edit.py (Step 3b)
"""

import re
import pytest
from lxml import html as lhtml

from app.services.block_anchor import anchor_html, strip_block_ids, ADDRESSABLE_TAGS, _BLOCK_ID_ATTR


# ── Fixture ───────────────────────────────────────────────────────────────────

FIXTURE_HTML = """
<h2>Section Title</h2>
<p>A paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
<ul>
  <li>Item one</li>
  <li>Item two</li>
</ul>
<blockquote>A quoted block.</blockquote>
<table>
  <tr>
    <td><p>Cell with nested paragraph</p></td>
    <td>Plain cell text</td>
  </tr>
  <tr>
    <th>Header cell</th>
    <td>Another cell</td>
  </tr>
</table>
"""


# ── Helper ────────────────────────────────────────────────────────────────────

def all_block_ids(anchored_html: str) -> list[tuple[str, str]]:
    """Return [(tag, data-block-id), ...] in document order."""
    root = lhtml.fragment_fromstring(anchored_html, create_parent="div")
    result = []
    for el in root.iter():
        if isinstance(el.tag, str) and _BLOCK_ID_ATTR in el.attrib:
            result.append((el.tag.lower(), el.get(_BLOCK_ID_ATTR)))
    return result


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestAnchorHtml:
    def test_ids_assigned_in_document_order(self):
        doc = anchor_html(FIXTURE_HTML)
        ids = [b.id for b in doc.blocks]
        # IDs must be sequential starting at b0
        assert ids == [f"b{i}" for i in range(len(ids))]

    def test_element_types_correct(self):
        doc = anchor_html(FIXTURE_HTML)
        types = [b.element_type for b in doc.blocks]
        # Expected order: h2, p, li, li, blockquote, p (inside td), td, th, td
        assert "h2" in types
        assert "p" in types
        assert "li" in types
        assert "blockquote" in types

    def test_round_trip_preserves_visible_text(self):
        doc = anchor_html(FIXTURE_HTML)
        # The concatenation of block texts must cover all visible text from the fixture
        combined_block_text = " ".join(b.text for b in doc.blocks)
        assert "Section Title" in combined_block_text
        assert "bold" in combined_block_text
        assert "Item one" in combined_block_text
        assert "Item two" in combined_block_text
        assert "A quoted block." in combined_block_text
        assert "Cell with nested paragraph" in combined_block_text
        assert "Plain cell text" in combined_block_text
        assert "Header cell" in combined_block_text

    def test_block_map_matches_blocks_list(self):
        doc = anchor_html(FIXTURE_HTML)
        assert len(doc.block_map) == len(doc.blocks)
        for block in doc.blocks:
            assert doc.block_map[block.id] is block

    def test_idempotent_html(self):
        doc1 = anchor_html(FIXTURE_HTML)
        doc2 = anchor_html(doc1.anchored_html)
        # IDs must be identical
        assert [b.id for b in doc1.blocks] == [b.id for b in doc2.blocks]
        # Texts must be identical
        assert [b.text for b in doc1.blocks] == [b.text for b in doc2.blocks]
        # Block count must be identical
        assert len(doc1.blocks) == len(doc2.blocks)

    def test_idempotent_no_duplicate_attributes(self):
        doc1 = anchor_html(FIXTURE_HTML)
        doc2 = anchor_html(doc1.anchored_html)
        # Count occurrences of data-block-id in the HTML
        count1 = doc1.anchored_html.count(_BLOCK_ID_ATTR)
        count2 = doc2.anchored_html.count(_BLOCK_ID_ATTR)
        assert count1 == count2, "Second call must not add extra data-block-id attributes"

    def test_innermost_only_no_nested_ids(self):
        """
        The fixture has a <td> containing a <p>.  Only the <p> must get an ID,
        not the <td>.  No ID may ever be an ancestor of another ID.
        """
        doc = anchor_html(FIXTURE_HTML)
        root = lhtml.fragment_fromstring(doc.anchored_html, create_parent="div")

        for el in root.iter():
            if not isinstance(el.tag, str):
                continue
            if _BLOCK_ID_ATTR not in el.attrib:
                continue
            # No descendant of this element should also carry a data-block-id
            for desc in el.iterdescendants():
                assert _BLOCK_ID_ATTR not in (desc.attrib or {}), (
                    f"ID nested within ID: {el.tag}[{el.get(_BLOCK_ID_ATTR)}] "
                    f"contains {desc.tag}[{desc.get(_BLOCK_ID_ATTR)}]"
                )

    def test_nested_td_p_assigns_to_p_not_td(self):
        html = "<table><tr><td><p>inner</p></td></tr></table>"
        doc = anchor_html(html)
        block_ids = all_block_ids(doc.anchored_html)
        tags_with_id = [tag for tag, _ in block_ids]
        # p must get the ID, td must not
        assert "p" in tags_with_id
        assert "td" not in tags_with_id

    def test_plain_td_gets_id(self):
        html = "<table><tr><td>plain text</td></tr></table>"
        doc = anchor_html(html)
        block_ids = all_block_ids(doc.anchored_html)
        tags_with_id = [tag for tag, _ in block_ids]
        # td has no inner addressable elements — it should get an ID
        assert "td" in tags_with_id

    def test_empty_html_returns_empty(self):
        doc = anchor_html("")
        assert doc.anchored_html == ""
        assert doc.blocks == []
        assert doc.block_map == {}

    def test_block_text_normalized(self):
        html = "<p>  Multiple   spaces   here  </p>"
        doc = anchor_html(html)
        assert len(doc.blocks) == 1
        assert doc.blocks[0].text == "Multiple spaces here"

    def test_inline_markup_text_stripped(self):
        html = "<p>Some <strong>bold</strong> and <em>italic</em> text.</p>"
        doc = anchor_html(html)
        assert len(doc.blocks) == 1
        # text_content() strips tags, normalized removes extra spaces
        assert doc.blocks[0].text == "Some bold and italic text."

    def test_non_addressable_containers_skipped(self):
        """div, ul, ol, table, tr, pre must not receive IDs."""
        html = "<div><ul><li>item</li></ul></div>"
        doc = anchor_html(html)
        block_ids = all_block_ids(doc.anchored_html)
        tags_with_id = {tag for tag, _ in block_ids}
        assert "div" not in tags_with_id
        assert "ul" not in tags_with_id


# ── Step 3b: block-level replacement helper ───────────────────────────────────
# Tests for the _replace_in_element logic used in edit.py snippet mode.

def _do_block_replace(storage_html: str, block_id: str, search: str, replacement: str) -> tuple[str, bool]:
    """
    Simulate edit.py's blockId-aware replacement:
      1. anchor_html → find element → replace → strip IDs → serialize → wiki
    Returns (modified_html_fragment, replaced: bool).
    """
    from app.services.block_anchor import anchor_html, strip_block_ids
    from lxml import html as lhtml

    doc = anchor_html(storage_html)
    root = lhtml.fragment_fromstring(doc.anchored_html, create_parent="div")
    els = root.xpath(f'//*[@{_BLOCK_ID_ATTR}="{block_id}"]')
    if not els:
        return storage_html, False

    el = els[0]
    replaced = _replace_in_lxml_el(el, search, replacement)
    strip_block_ids(root)

    parts = [root.text or ""]
    for child in root:
        parts.append(lhtml.tostring(child, encoding="unicode", method="html"))
    return "".join(parts), replaced


def _replace_in_lxml_el(el, search: str, replacement: str) -> bool:
    """Minimal replacement helper (mirrors edit.py logic)."""
    def try_replace(s: str):
        if search in s:
            return s.replace(search, replacement, 1), True
        normed = s.replace(" ", " ")
        normed_search = search.replace(" ", " ")
        if normed_search in normed:
            return normed.replace(normed_search, replacement, 1), True
        return s, False

    if el.text:
        new_text, ok = try_replace(el.text)
        if ok:
            el.text = new_text
            return True
    for child in el:
        if child.text:
            new_text, ok = try_replace(child.text)
            if ok:
                child.text = new_text
                return True
        if _replace_in_lxml_el(child, search, replacement):
            return True
        if child.tail:
            new_tail, ok = try_replace(child.tail)
            if ok:
                child.tail = new_tail
                return True
    # Whitespace-normalized fallback
    full = el.text_content()
    norm_full = re.sub(r"\s+", " ", full).strip()
    norm_search = re.sub(r"\s+", " ", search).strip()
    if norm_search in norm_full:
        for child in list(el):
            el.remove(child)
        el.text = norm_full.replace(norm_search, replacement, 1)
        return True
    return False


class TestCdataMacro:
    """anchor_html must survive Confluence code-block macros with CDATA bodies."""

    MACRO_HTML = (
        "<p>Before the code block.</p>"
        '<ac:structured-macro ac:name="code" ac:schema-version="1">'
        '<ac:parameter ac:name="language">python</ac:parameter>'
        "<ac:plain-text-body>"
        "<![CDATA[def hello():\n    print('world')\n]]>"
        "</ac:plain-text-body>"
        "</ac:structured-macro>"
        "<p>After the code block.</p>"
    )

    def test_cdata_markers_preserved(self):
        doc = anchor_html(self.MACRO_HTML)
        assert "<![CDATA[" in doc.anchored_html
        assert "]]>" in doc.anchored_html

    def test_cdata_content_preserved(self):
        doc = anchor_html(self.MACRO_HTML)
        assert "def hello():" in doc.anchored_html
        assert "print('world')" in doc.anchored_html

    def test_macro_structure_preserved(self):
        doc = anchor_html(self.MACRO_HTML)
        # Tag name with colon — lxml may lowercase but must keep the element
        assert "structured-macro" in doc.anchored_html

    def test_only_paragraphs_get_ids(self):
        doc = anchor_html(self.MACRO_HTML)
        # Exactly the two <p> elements — the macro is not addressable
        assert len(doc.blocks) == 2
        assert all(b.element_type == "p" for b in doc.blocks)

    def test_macro_block_has_no_id(self):
        doc = anchor_html(self.MACRO_HTML)
        # No data-block-id on non-addressable macro elements
        assert doc.anchored_html.count(_BLOCK_ID_ATTR) == 2  # one per <p>

    def test_idempotent_with_cdata(self):
        doc1 = anchor_html(self.MACRO_HTML)
        doc2 = anchor_html(doc1.anchored_html)
        assert [b.id for b in doc1.blocks] == [b.id for b in doc2.blocks]
        assert doc1.anchored_html.count(_BLOCK_ID_ATTR) == doc2.anchored_html.count(_BLOCK_ID_ATTR)
        # CDATA must still be intact after second pass
        assert "<![CDATA[" in doc2.anchored_html

    def test_paragraph_texts_correct(self):
        doc = anchor_html(self.MACRO_HTML)
        texts = [b.text for b in doc.blocks]
        assert "Before the code block." in texts
        assert "After the code block." in texts


class TestBlockReplacement:
    def test_valid_blockid_verbatim_quote_replaces(self):
        html = "<p>Last updated: 2023-01-01</p>"
        doc = anchor_html(html)
        bid = doc.blocks[0].id
        assert doc.blocks[0].text == "Last updated: 2023-01-01"

        modified, ok = _do_block_replace(html, bid, "2023-01-01", "2026-06-05")
        assert ok
        assert "2026-06-05" in modified
        assert "2023-01-01" not in modified

    def test_missing_blockid_returns_original(self):
        html = "<p>Some text</p>"
        modified, ok = _do_block_replace(html, "b999", "Some text", "Other text")
        assert not ok
        assert modified == html

    def test_search_not_in_block_returns_false(self):
        html = "<p>First block</p><p>Second block</p>"
        doc = anchor_html(html)
        # Try to replace text from block b1 using block b0's id
        modified, ok = _do_block_replace(html, doc.blocks[0].id, "Second block", "Fixed")
        assert not ok

    def test_block_ids_stripped_from_output(self):
        html = "<p>Some text to fix</p>"
        doc = anchor_html(html)
        bid = doc.blocks[0].id
        modified, ok = _do_block_replace(html, bid, "Some text to fix", "Fixed text")
        assert ok
        assert _BLOCK_ID_ATTR not in modified

    def test_nbsp_normalization(self):
        html = "<p>value here</p>"
        doc = anchor_html(html)
        bid = doc.blocks[0].id
        # exactContent uses regular space; block has NBSP
        modified, ok = _do_block_replace(html, bid, "value here", "new value")
        assert ok
        assert "new value" in modified

    def test_legacy_path_no_blockid(self):
        """Without blockId, the caller falls back to a simple str.replace on plain text."""
        # Simulate the legacy path: strip tags, replace, verify
        import re as _re
        html = "<p>old date 2023</p>"
        # Minimal wiki conversion: strip tags
        wiki = _re.sub(r"<[^>]+>", "", html)
        assert "old date 2023" in wiki
        result = wiki.replace("old date 2023", "new date 2026", 1)
        assert "new date 2026" in result

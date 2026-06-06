"""
Block anchoring service.

anchor_html(storage_html) injects a stable `data-block-id="b{n}"` attribute onto
every *innermost* addressable block element in Confluence storage HTML, producing
an AnchoredDoc that is the single source of truth for both the model prompt and
frontend rendering.

Addressable block elements (get IDs):
    p, h1-h6, li, blockquote, td, th

Innermost-only rule:
    If a block element contains another addressable block (e.g. a <td> that contains
    a <p>), only the INNER element gets an ID.  The outer element never receives an
    ID alongside a nested one, so IDs are never doubly-nested.

Idempotent:
    Calling anchor_html on already-anchored HTML preserves existing IDs exactly and
    adds no new IDs.  Counter only advances for elements without an existing ID.

Sequential:
    IDs are b0, b1, b2 … in document order (depth-first, left-to-right).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from lxml import etree
from lxml import html as lhtml

ADDRESSABLE_TAGS: frozenset[str] = frozenset(
    {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "td", "th"}
)

_BLOCK_ID_ATTR = "data-block-id"

# CDATA sections in Confluence storage HTML are XML constructs; lxml's HTML parser
# would silently drop them.  We stash each one as a safe placeholder before parsing
# and restore it after serialization.
_CDATA_RE = re.compile(r"<!\[CDATA\[.*?\]\]>", re.DOTALL)


# ── Public types ──────────────────────────────────────────────────────────────

@dataclass
class Block:
    id: str
    element_type: str
    text: str   # normalized visible text (collapsed whitespace, stripped)


@dataclass
class AnchoredDoc:
    anchored_html: str
    blocks: list[Block]
    block_map: dict[str, Block]


# ── Internals ──────────────────────────────────────────────────────────────────

def _gather_text(node: etree._Element, out: list[str]) -> None:
    """
    Recursively collect text nodes with proper boundary handling:
    - <br> elements produce a space separator (matching browser line-break rendering)
    - A space is inserted around each element's content so words cannot merge
      across tag boundaries (e.g. "and<strong>request</strong>" → "and request").
    Extra spaces are collapsed by the caller via re.sub(r"\\s+", " ", ...).
    """
    if not isinstance(node.tag, str):
        return
    tag = node.tag.lower()
    if tag == "br":
        out.append(" ")
        return
    # Surround element content with spaces — collapsed away if already present,
    # but prevents word-merging when the HTML author omits boundary whitespace.
    out.append(" ")
    if node.text:
        out.append(node.text)
    for child in node:
        _gather_text(child, out)
        if child.tail:
            out.append(child.tail)
    out.append(" ")


def _normalize_text(el: etree._Element) -> str:
    """
    Extract block text matching browser textContent semantics:
    - <br> becomes a space separator (not silence)
    - spaces at element boundaries prevent word-merging across tags
    - whitespace runs collapse to a single space; result is trimmed

    Contract: block.text == collapse_ws(DOMParser.parseFromString(blockHtml)
              .body.textContent) — the same string the frontend searches with indexOf.
    """
    parts: list[str] = []
    _gather_text(el, parts)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _has_addressable_descendant(el: etree._Element) -> bool:
    return any(
        isinstance(d.tag, str) and d.tag.lower() in ADDRESSABLE_TAGS
        for d in el.iterdescendants()
    )


def _assign_ids(
    el: etree._Element,
    counter: list[int],
    blocks: list[Block],
) -> None:
    """
    Depth-first walk.  When we find an innermost addressable block (addressable
    tag with no addressable descendants), assign or read its ID and record the
    Block.  Then stop recursing into that element's subtree.

    For non-addressable containers (div, table, ul, etc.) or addressable elements
    that CONTAIN other addressable elements, we recurse into children instead.
    """
    if not isinstance(el.tag, str):   # skip comments, PIs, etc.
        return

    tag = el.tag.lower()

    if tag in ADDRESSABLE_TAGS and not _has_addressable_descendant(el):
        # Innermost addressable block
        if _BLOCK_ID_ATTR not in el.attrib:
            bid = f"b{counter[0]}"
            el.set(_BLOCK_ID_ATTR, bid)
            counter[0] += 1
        else:
            bid = el.get(_BLOCK_ID_ATTR)  # idempotent: keep existing id

        blocks.append(Block(id=bid, element_type=tag, text=_normalize_text(el)))
        return  # do NOT recurse — subtree is captured as a single block

    # Container or outer addressable with inner addressable descendants → recurse
    for child in el:
        _assign_ids(child, counter, blocks)


def _serialize(root: etree._Element) -> str:
    """
    Serialize the children of the wrapper div back to an HTML string, preserving
    leading text and inter-element tails.
    """
    parts: list[str] = [root.text or ""]
    for child in root:
        parts.append(lhtml.tostring(child, encoding="unicode", method="html"))
    return "".join(parts)


# ── Public API ────────────────────────────────────────────────────────────────

def anchor_html(storage_html: str) -> AnchoredDoc:
    """
    Parse Confluence storage HTML, inject `data-block-id` onto every innermost
    addressable block element, and return an AnchoredDoc.

    Guarantees:
    - Round-trip fidelity: only `data-block-id` attributes are added; all content,
      children, order, and inline markup are otherwise preserved.
    - Idempotent: re-anchoring already-anchored HTML yields identical output.
    - Sequential: IDs are b0, b1, b2 … in document order.
    - Innermost-only: no ID is ever nested within another ID'd element.
    """
    if not storage_html or not storage_html.strip():
        return AnchoredDoc(anchored_html=storage_html or "", blocks=[], block_map={})

    # ── Stash CDATA sections ──────────────────────────────────────────────────
    # lxml's HTML parser does not understand XML CDATA markers and will discard
    # them.  Replace each occurrence with a plain-text placeholder before parsing,
    # then restore after serialization.  Placeholders are alphanumeric-only so
    # lxml never HTML-escapes them.
    _cdata_store: list[str] = []

    def _stash(m: re.Match) -> str:  # type: ignore[type-arg]
        idx = len(_cdata_store)
        _cdata_store.append(m.group(0))
        return f"PHCDATA{idx}PHEND"

    safe_html = _CDATA_RE.sub(_stash, storage_html)

    # Wrap in a neutral div so fragment_fromstring always returns one root element.
    root: etree._Element = lhtml.fragment_fromstring(safe_html, create_parent="div")

    # If partially anchored, start counter after the highest existing numeric ID
    # so we never reuse an ID.
    existing: list[int] = []
    for el in root.iter():
        if isinstance(el.tag, str):
            bid = (el.attrib or {}).get(_BLOCK_ID_ATTR, "")
            if bid.startswith("b"):
                try:
                    existing.append(int(bid[1:]))
                except ValueError:
                    pass

    counter = [max(existing) + 1 if existing else 0]
    blocks: list[Block] = []

    for child in root:
        _assign_ids(child, counter, blocks)

    anchored_html = _serialize(root)

    # ── Restore CDATA sections ────────────────────────────────────────────────
    for idx, cdata in enumerate(_cdata_store):
        anchored_html = anchored_html.replace(f"PHCDATA{idx}PHEND", cdata)

    block_map = {b.id: b for b in blocks}
    return AnchoredDoc(anchored_html=anchored_html, blocks=blocks, block_map=block_map)


def strip_block_ids(root: etree._Element) -> None:
    """Remove all data-block-id attributes from an lxml tree in-place."""
    for el in root.iter():
        if isinstance(el.tag, str) and _BLOCK_ID_ATTR in (el.attrib or {}):
            del el.attrib[_BLOCK_ID_ATTR]

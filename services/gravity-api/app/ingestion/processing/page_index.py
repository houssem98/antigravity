"""
PageIndex — Hierarchical Document Tree Structure
==================================================
Implements the Mafin 2.5 approach (98.7% FinanceBench accuracy).

Instead of flat chunks, preserves the document as a navigable tree:
  Document → Section → Subsection → Paragraph → Sentence → Table

Each node carries its full breadcrumb path, page range, and link to the
corresponding ChunkOutput. The LLM navigates the tree like a ToC rather
than computing vector similarity over random chunks.

Key innovation: `get_context_window(node_id)` expands a retrieved chunk
to include its parent section + adjacent siblings — the "small-to-big"
retrieval pattern that wins 65% of benchmarks over baseline chunking.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger()


# ── Node Types ────────────────────────────────────────────────────────────────

NODE_TYPE_RANK = {
    "document": 0,
    "section": 1,
    "subsection": 2,
    "paragraph": 3,
    "sentence": 4,
    "table": 3,    # tables treated at paragraph depth
}


@dataclass
class PageIndexNode:
    """A single node in the document tree."""
    node_id: str
    node_type: str          # document | section | subsection | paragraph | sentence | table
    title: str              # Heading text or auto-generated label
    text: str               # Content (empty for branch nodes, full text for leaves)
    depth: int              # 0=doc, 1=section, 2=subsection, 3=paragraph/table, 4=sentence
    page_start: int | None = None
    page_end: int | None = None
    parent_id: str | None = None
    children: list[str] = field(default_factory=list)  # child node_ids
    path: str = ""          # Breadcrumb: "10-K > Item 7 MD&A > Revenue > Para 3"
    metadata: dict = field(default_factory=dict)
    chunk_id: str | None = None  # Links to ChunkOutput.id for embedding lookup
    position: int = 0       # Sequential position within parent


# ── PageIndex ─────────────────────────────────────────────────────────────────

class PageIndex:
    """
    Full hierarchical index for a single document.

    Build from chunker output:
        index = PageIndex()
        index.build_from_chunks(chunks, doc_metadata)

    Navigate:
        path = index.get_path(node_id)
        context = index.get_context_window(node_id, expand=True)
        sections = index.get_section_nodes()
    """

    def __init__(self):
        self.nodes: dict[str, PageIndexNode] = {}
        self.root_id: str | None = None
        self.document_id: str = ""
        self.ticker: str = ""
        self.filing_type: str = ""
        self.filing_date: str = ""

    # ── Build ─────────────────────────────────────────────────────────────────

    def build_from_chunks(self, chunks: list, metadata: dict) -> "PageIndex":
        """
        Construct the tree from a list of ChunkOutput objects.

        ChunkOutput levels:
          0 = RAPTOR summary
          1 = Section
          2 = Paragraph  (primary retrieval unit)
          3 = Sentence
          4 = Table

        Wires parent/child links using chunk.parent_chunk_id and chunk.section_name.
        """
        self.document_id = metadata.get("document_id", str(uuid.uuid4()))
        self.ticker = metadata.get("ticker", "")
        self.filing_type = metadata.get("filing_type", "")
        self.filing_date = metadata.get("filing_date", "")

        # Create document root node
        root_id = f"root_{self.document_id}"
        root = PageIndexNode(
            node_id=root_id,
            node_type="document",
            title=metadata.get("title", f"{self.ticker} {self.filing_type} {self.filing_date}"),
            text="",
            depth=0,
            metadata=metadata,
        )
        self.nodes[root_id] = root
        self.root_id = root_id

        # Group chunks by section name → build section nodes
        section_nodes: dict[str, str] = {}  # section_name → node_id

        for chunk in sorted(chunks, key=lambda c: c.position):
            level = chunk.level

            if level == 1:
                # Section node
                sec_node_id = f"sec_{chunk.id}"
                section_nodes[chunk.section_name] = sec_node_id
                node = PageIndexNode(
                    node_id=sec_node_id,
                    node_type="section",
                    title=chunk.section_name or "Section",
                    text=chunk.text[:500],  # brief summary for navigation
                    depth=1,
                    page_start=chunk.page_number,
                    parent_id=root_id,
                    path=f"{root.title} > {chunk.section_name}",
                    metadata=chunk.metadata,
                    chunk_id=chunk.id,
                    position=chunk.position,
                )
                self.nodes[sec_node_id] = node
                root.children.append(sec_node_id)

            elif level == 2:
                # Paragraph node
                parent_sec_id = section_nodes.get(chunk.section_name, root_id)
                parent_node = self.nodes.get(parent_sec_id, root)
                node_id = f"para_{chunk.id}"
                position_label = f"Para {chunk.position + 1}"
                node = PageIndexNode(
                    node_id=node_id,
                    node_type="paragraph",
                    title=position_label,
                    text=chunk.text,
                    depth=2,
                    page_start=chunk.page_number,
                    parent_id=parent_sec_id,
                    path=f"{parent_node.path} > {position_label}",
                    metadata=chunk.metadata,
                    chunk_id=chunk.id,
                    position=chunk.position,
                )
                self.nodes[node_id] = node
                parent_node.children.append(node_id)

            elif level == 3:
                # Sentence node — find parent paragraph by chunk.parent_chunk_id
                parent_para_id = None
                if chunk.parent_chunk_id:
                    parent_para_id = f"para_{chunk.parent_chunk_id}"
                if not parent_para_id or parent_para_id not in self.nodes:
                    parent_para_id = section_nodes.get(chunk.section_name, root_id)
                parent_node = self.nodes.get(parent_para_id, root)
                node_id = f"sent_{chunk.id}"
                node = PageIndexNode(
                    node_id=node_id,
                    node_type="sentence",
                    title=f"Sent {chunk.position + 1}",
                    text=chunk.text,
                    depth=3,
                    page_start=chunk.page_number,
                    parent_id=parent_para_id,
                    path=f"{parent_node.path} > Sent {chunk.position + 1}",
                    metadata=chunk.metadata,
                    chunk_id=chunk.id,
                    position=chunk.position,
                )
                self.nodes[node_id] = node
                parent_node.children.append(node_id)

            elif level == 4:
                # Table node — attach to most relevant section
                parent_sec_id = section_nodes.get(chunk.section_name, root_id)
                parent_node = self.nodes.get(parent_sec_id, root)
                table_type = chunk.metadata.get("table_type", "Table")
                node_id = f"table_{chunk.id}"
                node = PageIndexNode(
                    node_id=node_id,
                    node_type="table",
                    title=table_type,
                    text=chunk.text,
                    depth=2,
                    page_start=chunk.page_number,
                    parent_id=parent_sec_id,
                    path=f"{parent_node.path} > {table_type}",
                    metadata=chunk.metadata,
                    chunk_id=chunk.id,
                    position=chunk.position,
                )
                self.nodes[node_id] = node
                parent_node.children.append(node_id)

        logger.info(
            "page_index_built",
            document_id=self.document_id,
            total_nodes=len(self.nodes),
            sections=len(section_nodes),
        )
        return self

    # ── Navigation ────────────────────────────────────────────────────────────

    def get_path(self, node_id: str) -> str:
        """Return full breadcrumb path for a node."""
        node = self.nodes.get(node_id)
        if not node:
            return ""
        return node.path

    def get_context_window(self, node_id: str, expand: bool = True) -> list[PageIndexNode]:
        """
        Return the node + expanded context for retrieval.

        With expand=True (default):
          - The node itself
          - Its parent section/paragraph
          - Up to 2 adjacent siblings (preceding + following)

        This implements "small-to-big" retrieval: retrieve a precise
        sentence/paragraph, but send the surrounding context to the LLM.
        """
        node = self.nodes.get(node_id)
        if not node:
            return []

        result_ids: list[str] = [node_id]

        if not expand:
            return [self.nodes[nid] for nid in result_ids if nid in self.nodes]

        # Add parent
        if node.parent_id and node.parent_id in self.nodes:
            if node.parent_id not in result_ids:
                result_ids.insert(0, node.parent_id)
            parent = self.nodes[node.parent_id]
            # Add siblings (adjacent children of parent)
            siblings = parent.children
            if node_id in siblings:
                idx = siblings.index(node_id)
                if idx > 0:
                    prev_sib = siblings[idx - 1]
                    if prev_sib not in result_ids:
                        result_ids.append(prev_sib)
                if idx < len(siblings) - 1:
                    next_sib = siblings[idx + 1]
                    if next_sib not in result_ids:
                        result_ids.append(next_sib)

        # Add grandparent (section level) for deep nodes
        if node.depth >= 3 and node.parent_id:
            parent = self.nodes.get(node.parent_id)
            if parent and parent.parent_id and parent.parent_id not in result_ids:
                result_ids.insert(0, parent.parent_id)

        return [self.nodes[nid] for nid in result_ids if nid in self.nodes]

    def navigate_to_answer(self, query_hint: str) -> list[str]:
        """
        Heuristic ToC navigation: return section node_ids most likely to
        contain the answer, ranked by keyword overlap with section titles.

        Fast (<1ms) — no LLM needed.
        """
        query_lower = query_hint.lower()
        scores: list[tuple[float, str]] = []

        for node in self.nodes.values():
            if node.node_type not in ("section", "subsection"):
                continue
            title_lower = node.title.lower()
            # Score: proportion of query words found in title
            words = [w for w in query_lower.split() if len(w) > 3]
            if not words:
                continue
            overlap = sum(1 for w in words if w in title_lower)
            score = overlap / len(words)
            if score > 0:
                scores.append((score, node.node_id))

        scores.sort(reverse=True)
        return [nid for _, nid in scores[:5]]

    # ── Accessors ─────────────────────────────────────────────────────────────

    def get_section_nodes(self) -> list[PageIndexNode]:
        """Return all section-level (depth=1) nodes."""
        return [n for n in self.nodes.values() if n.node_type == "section"]

    def get_leaf_nodes(self) -> list[PageIndexNode]:
        """Return all leaf nodes (paragraph, sentence, table) with chunk_ids."""
        return [
            n for n in self.nodes.values()
            if n.node_type in ("paragraph", "sentence", "table") and n.chunk_id
        ]

    def get_node_by_chunk_id(self, chunk_id: str) -> PageIndexNode | None:
        """Look up a PageIndexNode by its linked ChunkOutput.id."""
        for node in self.nodes.values():
            if node.chunk_id == chunk_id:
                return node
        return None

    # ── Serialization ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "document_id": self.document_id,
            "ticker": self.ticker,
            "filing_type": self.filing_type,
            "filing_date": self.filing_date,
            "root_id": self.root_id,
            "nodes": {
                nid: {
                    "node_id": n.node_id,
                    "node_type": n.node_type,
                    "title": n.title,
                    "text": n.text[:1000],  # Truncate for storage
                    "depth": n.depth,
                    "page_start": n.page_start,
                    "page_end": n.page_end,
                    "parent_id": n.parent_id,
                    "children": n.children,
                    "path": n.path,
                    "metadata": n.metadata,
                    "chunk_id": n.chunk_id,
                    "position": n.position,
                }
                for nid, n in self.nodes.items()
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PageIndex":
        index = cls()
        index.document_id = data.get("document_id", "")
        index.ticker = data.get("ticker", "")
        index.filing_type = data.get("filing_type", "")
        index.filing_date = data.get("filing_date", "")
        index.root_id = data.get("root_id")
        for nid, nd in data.get("nodes", {}).items():
            index.nodes[nid] = PageIndexNode(
                node_id=nd["node_id"],
                node_type=nd["node_type"],
                title=nd["title"],
                text=nd["text"],
                depth=nd["depth"],
                page_start=nd.get("page_start"),
                page_end=nd.get("page_end"),
                parent_id=nd.get("parent_id"),
                children=nd.get("children", []),
                path=nd.get("path", ""),
                metadata=nd.get("metadata", {}),
                chunk_id=nd.get("chunk_id"),
                position=nd.get("position", 0),
            )
        return index

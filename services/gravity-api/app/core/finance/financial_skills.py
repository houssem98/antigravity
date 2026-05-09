"""
Gravity Search — Financial Skills Loader

Loads institutional-grade financial analysis skills from the Claude for Financial
Services plugin repository (financial-services-main/). These SKILL.md files contain
expert methodology for comps analysis, DCF modeling, earnings reviews, etc.

The loader:
  1. Scans all SKILL.md files at startup
  2. Indexes them by category and keyword
  3. Provides get_relevant_skills(query, intent) for runtime injection into
     agent system prompts (Writer, Planner)
  4. Loads named agent system prompts for workflow-level guidance

This bridges Anthropic's reference templates into Antigravity's agent pipeline
without requiring the Claude plugin runtime.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from functools import lru_cache

import structlog

logger = structlog.get_logger()

# ── Root path to the financial-services-main plugins directory ──────────

_REPO_ROOT = Path(__file__).resolve().parents[5]  # services/gravity-api/app/core/finance → antigravity/
_PLUGINS_DIR = _REPO_ROOT / "financial-services-main" / "plugins"
_AGENTS_DIR = _PLUGINS_DIR / "agent-plugins"
_VERTICALS_DIR = _PLUGINS_DIR / "vertical-plugins"


# ── Skill Categories ───────────────────────────────────────────────────

@dataclass
class FinancialSkill:
    """A loaded skill with metadata parsed from its SKILL.md frontmatter."""
    name: str                       # e.g. "comps-analysis"
    vertical: str                   # e.g. "financial-analysis", "equity-research"
    description: str                # from frontmatter
    content: str                    # full SKILL.md body (after frontmatter)
    content_truncated: str          # first ~2000 chars for prompt injection
    path: Path
    keywords: list[str] = field(default_factory=list)  # derived search keywords


@dataclass
class AgentPrompt:
    """A loaded agent system prompt."""
    name: str                       # e.g. "market-researcher"
    description: str                # from frontmatter
    content: str                    # full agent prompt body
    skills_used: list[str] = field(default_factory=list)


# ── Keyword mappings for intent → skill matching ───────────────────────

SKILL_KEYWORDS: dict[str, list[str]] = {
    # financial-analysis
    "comps-analysis":       ["comps", "comparable", "peer", "valuation", "trading multiples", "ev/ebitda", "p/e ratio", "peer group"],
    "dcf-model":            ["dcf", "discounted cash flow", "wacc", "terminal value", "intrinsic value", "present value", "free cash flow valuation"],
    "lbo-model":            ["lbo", "leveraged buyout", "buyout", "leverage", "debt financing", "pe acquisition"],
    "3-statement-model":    ["3-statement", "three statement", "income statement", "balance sheet", "cash flow statement", "financial model"],
    "competitive-analysis": ["competitive", "competition", "market share", "positioning", "competitive landscape", "moat"],
    "audit-xls":            ["audit", "excel audit", "formula trace", "model review", "hardcode"],
    "clean-data-xls":       ["clean data", "normalize", "tabular data", "data cleaning"],

    # equity-research
    "earnings-analysis":    ["earnings", "quarterly results", "eps", "revenue beat", "earnings call", "10-q", "quarterly update"],
    "earnings-preview":     ["earnings preview", "pre-earnings", "consensus estimate", "whisper number"],
    "initiating-coverage":  ["initiation", "initiating coverage", "coverage initiation", "new coverage", "first look"],
    "model-update":         ["model update", "estimate revision", "forecast update"],
    "morning-note":         ["morning note", "morning meeting", "trade idea", "daily brief"],
    "sector-overview":      ["sector", "industry overview", "market size", "industry analysis", "sector primer", "thematic"],
    "thesis-tracker":       ["investment thesis", "thesis", "catalyst", "thesis tracker", "conviction"],
    "catalyst-calendar":    ["catalyst", "upcoming events", "earnings date", "fda date", "catalyst calendar"],
    "idea-generation":      ["stock screen", "idea generation", "screening", "idea shortlist", "stock pick"],

    # investment-banking
    "buyer-list":           ["buyer list", "potential acquirer", "strategic buyer", "financial sponsor"],
    "cim-builder":          ["cim", "confidential information memorandum", "information memo"],
    "merger-model":         ["merger model", "m&a", "accretion dilution", "merger", "acquisition analysis"],
    "pitch-deck":           ["pitch deck", "pitch book", "client presentation", "pitchbook"],
    "teaser":               ["teaser", "blind profile", "anonymous profile"],
    "deal-tracker":         ["deal tracker", "deal pipeline", "deal status", "live deals"],
    "strip-profile":        ["one-pager", "company profile", "strip profile", "company overview"],
    "process-letter":       ["process letter", "bid instructions", "bid process"],

    # private-equity
    "ic-memo":              ["ic memo", "investment committee", "investment memo", "committee memo"],
    "returns-analysis":     ["irr", "moic", "returns analysis", "return sensitivity", "fund returns"],
    "unit-economics":       ["unit economics", "ltv", "cac", "arr", "net retention", "cohort"],
    "deal-screening":       ["deal screen", "deal evaluation", "pass/fail", "screening criteria"],
    "deal-sourcing":        ["deal sourcing", "pipeline sourcing", "founder outreach", "crm"],
    "dd-checklist":         ["due diligence", "diligence checklist", "dd checklist", "workstream"],
    "portfolio-monitoring": ["portfolio monitoring", "portco", "portfolio kpi", "portfolio review"],
    "value-creation-plan":  ["value creation", "100-day plan", "ebitda bridge", "post-close"],
    "ai-readiness":         ["ai readiness", "ai assessment", "tech readiness"],

    # wealth-management
    "client-review":        ["client review", "client meeting", "performance review", "ria"],
    "financial-plan":       ["financial plan", "retirement", "estate plan", "cash flow projection"],
    "portfolio-rebalance":  ["rebalance", "drift analysis", "allocation", "tax-aware rebalancing"],
    "tax-loss-harvesting":  ["tax loss", "tlh", "wash sale", "harvesting"],

    # fund-admin
    "gl-recon":             ["gl reconciliation", "general ledger", "reconciliation", "breaks"],
    "break-trace":          ["break trace", "root cause", "break analysis"],
    "variance-commentary":  ["variance", "budget vs actual", "variance commentary"],
    "roll-forward":         ["roll forward", "roll-forward", "period close"],
    "nav-tieout":           ["nav", "net asset value", "nav tie-out", "fund accounting"],
}


# ── Loader Class ───────────────────────────────────────────────────────

class FinancialSkillsLoader:
    """
    Loads and indexes financial skills from the financial-services-main repository.

    Usage:
        loader = get_skills_loader()
        skills = loader.get_relevant_skills("Build comps for FAANG mega-caps")
        # Returns list of FinancialSkill objects with comps-analysis, competitive-analysis
    """

    def __init__(self):
        self._skills: dict[str, FinancialSkill] = {}
        self._agent_prompts: dict[str, AgentPrompt] = {}
        self._loaded = False

    def load(self) -> None:
        """Scan and load all skills and agent prompts."""
        if self._loaded:
            return

        self._load_vertical_skills()
        self._load_agent_prompts()
        self._loaded = True

        logger.info(
            "financial_skills_loaded",
            skill_count=len(self._skills),
            agent_count=len(self._agent_prompts),
            verticals=list(set(s.vertical for s in self._skills.values())),
        )

    def _load_vertical_skills(self) -> None:
        """Load SKILL.md files from vertical-plugins/."""
        if not _VERTICALS_DIR.exists():
            logger.warning("financial_skills_dir_missing", path=str(_VERTICALS_DIR))
            return

        for vertical_dir in _VERTICALS_DIR.iterdir():
            if not vertical_dir.is_dir():
                continue
            vertical_name = vertical_dir.name
            skills_dir = vertical_dir / "skills"
            if not skills_dir.exists():
                continue

            for skill_dir in skills_dir.iterdir():
                if not skill_dir.is_dir():
                    continue
                skill_file = skill_dir / "SKILL.md"
                if not skill_file.exists():
                    continue

                try:
                    raw = skill_file.read_text(encoding="utf-8")
                    name, description, body = self._parse_frontmatter(raw, skill_dir.name)

                    self._skills[name] = FinancialSkill(
                        name=name,
                        vertical=vertical_name,
                        description=description,
                        content=body,
                        content_truncated=body[:2000],
                        path=skill_file,
                        keywords=SKILL_KEYWORDS.get(name, []),
                    )
                except Exception as e:
                    logger.warning("skill_load_failed", path=str(skill_file), error=str(e))

    def _load_agent_prompts(self) -> None:
        """Load agent system prompts from agent-plugins/."""
        if not _AGENTS_DIR.exists():
            return

        for agent_dir in _AGENTS_DIR.iterdir():
            if not agent_dir.is_dir():
                continue
            agents_subdir = agent_dir / "agents"
            if not agents_subdir.exists():
                continue

            for md_file in agents_subdir.glob("*.md"):
                try:
                    raw = md_file.read_text(encoding="utf-8")
                    name, description, body = self._parse_frontmatter(raw, md_file.stem)

                    # Extract "Skills this agent uses" section
                    skills_match = re.search(r"Skills this agent uses\s*\n\n(.+)", body)
                    skills_used = []
                    if skills_match:
                        skills_used = [
                            s.strip().strip("`")
                            for s in skills_match.group(1).split("·")
                        ]

                    self._agent_prompts[name] = AgentPrompt(
                        name=name,
                        description=description,
                        content=body,
                        skills_used=skills_used,
                    )
                except Exception as e:
                    logger.warning("agent_prompt_load_failed", path=str(md_file), error=str(e))

    @staticmethod
    def _parse_frontmatter(raw: str, fallback_name: str) -> tuple[str, str, str]:
        """Parse YAML frontmatter from a skill/agent markdown file.

        Returns (name, description, body_without_frontmatter).
        """
        name = fallback_name
        description = ""
        body = raw

        fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", raw, re.DOTALL)
        if fm_match:
            frontmatter = fm_match.group(1)
            body = raw[fm_match.end():]

            # Extract name
            name_match = re.search(r"^name:\s*(.+)$", frontmatter, re.MULTILINE)
            if name_match:
                name = name_match.group(1).strip()

            # Extract description (may be multi-line with | or > YAML syntax)
            desc_match = re.search(
                r"^description:\s*\|?\s*\n((?:\s{2,}.+\n)+)", frontmatter, re.MULTILINE
            )
            if desc_match:
                description = " ".join(
                    line.strip() for line in desc_match.group(1).strip().split("\n")
                )
            else:
                desc_match = re.search(r"^description:\s*(.+)$", frontmatter, re.MULTILINE)
                if desc_match:
                    description = desc_match.group(1).strip()

        return name, description, body

    # ── Query Interface ──────────────────────────────────────────────

    def get_relevant_skills(
        self,
        query: str,
        intent: str | None = None,
        max_skills: int = 3,
    ) -> list[FinancialSkill]:
        """
        Find the most relevant financial skills for a query.

        Uses keyword matching against the query text and optional intent classification.
        Returns at most `max_skills` skills, ordered by relevance score.
        """
        self.load()

        query_lower = query.lower()
        scored: list[tuple[float, FinancialSkill]] = []

        for skill in self._skills.values():
            score = 0.0

            # Keyword matching
            for keyword in skill.keywords:
                if keyword in query_lower:
                    # Longer keyword matches are more specific → higher score
                    score += len(keyword.split()) * 2.0

            # Intent-based boost
            if intent:
                intent_lower = intent.lower()
                if skill.vertical in intent_lower:
                    score += 3.0
                if skill.name in intent_lower:
                    score += 5.0

            # Direct name match
            if skill.name.replace("-", " ") in query_lower:
                score += 10.0

            if score > 0:
                scored.append((score, skill))

        # Sort by score descending, take top N
        scored.sort(key=lambda x: x[0], reverse=True)
        return [skill for _, skill in scored[:max_skills]]

    def get_skill_by_name(self, name: str) -> FinancialSkill | None:
        """Get a specific skill by its exact name."""
        self.load()
        return self._skills.get(name)

    def get_agent_prompt(self, name: str) -> AgentPrompt | None:
        """Get a specific agent system prompt by name."""
        self.load()
        return self._agent_prompts.get(name)

    def get_skills_for_agent(self, agent_name: str) -> list[FinancialSkill]:
        """Get all skills used by a named agent."""
        self.load()
        agent = self._agent_prompts.get(agent_name)
        if not agent:
            return []
        return [
            self._skills[sn]
            for sn in agent.skills_used
            if sn in self._skills
        ]

    def get_all_skill_names(self) -> list[str]:
        """List all available skill names."""
        self.load()
        return sorted(self._skills.keys())

    def build_skill_context(
        self,
        query: str,
        intent: str | None = None,
        max_chars: int = 4000,
    ) -> str:
        """
        Build a skill context block ready for injection into an LLM system prompt.

        Returns a formatted string with relevant skill methodology, or empty string
        if no skills match.
        """
        skills = self.get_relevant_skills(query, intent)
        if not skills:
            return ""

        parts = [
            "\n## Financial Analysis Methodology (from institutional reference library)\n"
        ]
        remaining = max_chars - len(parts[0])

        for skill in skills:
            header = f"\n### {skill.name.replace('-', ' ').title()} ({skill.vertical})\n"
            # Use truncated content to stay within budget
            content = skill.content_truncated
            if len(header) + len(content) > remaining:
                content = content[:max(0, remaining - len(header) - 50)]
                if content:
                    content += "\n[... truncated — full methodology available]\n"
            if not content:
                break
            parts.append(header + content)
            remaining -= len(header) + len(content)

        return "".join(parts) if len(parts) > 1 else ""

    def build_agent_workflow_context(
        self,
        query: str,
        agent_name: str | None = None,
    ) -> str:
        """
        Build workflow-level context from a named agent prompt.

        If agent_name is not provided, tries to infer the best-matching agent
        based on query keywords.
        """
        self.load()

        if not agent_name:
            agent_name = self._infer_agent(query)
        if not agent_name:
            return ""

        agent = self._agent_prompts.get(agent_name)
        if not agent:
            return ""

        return (
            f"\n## Workflow Reference: {agent.name.replace('-', ' ').title()}\n"
            f"{agent.description}\n\n"
            f"{agent.content[:2000]}\n"
        )

    def _infer_agent(self, query: str) -> str | None:
        """Infer the best-matching agent based on query keywords."""
        query_lower = query.lower()

        agent_keywords = {
            "market-researcher": ["sector", "industry", "market overview", "primer", "landscape", "thematic"],
            "earnings-reviewer": ["earnings", "quarterly", "eps", "revenue beat", "earnings call"],
            "pitch-agent":       ["pitch", "pitch deck", "comps", "precedent", "lbo"],
            "model-builder":     ["model", "dcf", "3-statement", "financial model"],
            "gl-reconciler":     ["reconcil", "gl", "general ledger", "breaks"],
            "meeting-prep-agent": ["meeting prep", "briefing", "client meeting"],
            "kyc-screener":      ["kyc", "onboarding", "screening"],
            "valuation-reviewer": ["valuation review", "gp package", "lp reporting"],
        }

        best_agent = None
        best_score = 0.0
        for agent_name, keywords in agent_keywords.items():
            score = sum(2.0 for kw in keywords if kw in query_lower)
            if score > best_score:
                best_score = score
                best_agent = agent_name

        return best_agent if best_score > 0 else None


# ── Singleton ──────────────────────────────────────────────────────────

_loader_instance: FinancialSkillsLoader | None = None


def get_skills_loader() -> FinancialSkillsLoader:
    """Get the singleton FinancialSkillsLoader instance."""
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = FinancialSkillsLoader()
    return _loader_instance

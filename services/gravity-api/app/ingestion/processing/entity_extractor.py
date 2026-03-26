"""
Gravity Search — Financial Entity Extractor
Two-tier NER: SpaCy (fast) + optional Gemini Flash enrichment (ticker resolution).

Extracts: companies, people, financial metrics, dates, themes.
"""

import re
import structlog

logger = structlog.get_logger()

# Common financial themes/topics to detect
FINANCIAL_THEMES = [
    "tariff risk", "trade war", "supply chain", "ai investment", "artificial intelligence",
    "cloud computing", "margin guidance", "revenue guidance", "capital expenditure", "capex",
    "restructuring", "layoffs", "workforce reduction", "acquisition", "merger", "ipo",
    "share buyback", "dividend", "interest rate", "inflation", "recession", "gdp",
    "semiconductor shortage", "data center", "autonomous vehicles", "electric vehicle",
    "cybersecurity", "regulatory risk", "antitrust", "geopolitical risk",
]

THEME_PATTERNS = [
    re.compile(rf"\b{re.escape(theme)}\b", re.IGNORECASE)
    for theme in FINANCIAL_THEMES
]


class EntityExtractor:
    """
    Extracts named entities from financial document text.

    Usage:
        extractor = EntityExtractor(llm_client=google_client)
        entities = await extractor.extract(text)
        # Returns: {companies, people, metrics, events, dates, themes}
    """

    def __init__(self, llm_client=None):
        self.llm = llm_client  # Optional Gemini Flash for ticker resolution
        self._nlp = None  # Lazy-loaded SpaCy model

    def _load_nlp(self):
        """Lazy-load SpaCy model on first call."""
        if self._nlp is None:
            try:
                import spacy
                self._nlp = spacy.load("en_core_web_sm")
                logger.info("spacy_model_loaded", model="en_core_web_sm")
            except OSError:
                logger.warning(
                    "spacy_model_missing",
                    msg="Run: python -m spacy download en_core_web_sm",
                )
                self._nlp = None
            except ImportError:
                logger.warning("spacy_not_installed")
                self._nlp = None

    async def extract(self, text: str) -> dict:
        """
        Extract all entity types from document text.

        Args:
            text: Document text (can be long; first 15K chars are processed)

        Returns:
            {
              "companies": [{"name": str, "ticker": str}],
              "people": [{"name": str, "title": str}],
              "metrics": [{"text": str, "label": str}],
              "events": [{"text": str}],
              "dates": [{"text": str}],
              "themes": [str],
            }
        """
        # Limit text to avoid OOM with very large documents
        sample = text[:15000]

        entities = {
            "companies": [],
            "people": [],
            "metrics": [],
            "events": [],
            "dates": [],
            "themes": [],
        }

        # ── SpaCy NER ────────────────────────────────────────────────────
        self._load_nlp()
        if self._nlp:
            try:
                doc = self._nlp(sample)
                seen_orgs = set()
                seen_persons = set()

                for ent in doc.ents:
                    if ent.label_ == "ORG" and ent.text not in seen_orgs:
                        seen_orgs.add(ent.text)
                        entities["companies"].append({"name": ent.text, "ticker": ""})
                    elif ent.label_ == "PERSON" and ent.text not in seen_persons:
                        seen_persons.add(ent.text)
                        entities["people"].append({"name": ent.text, "title": ""})
                    elif ent.label_ in ("MONEY", "PERCENT", "CARDINAL") and ent.text:
                        entities["metrics"].append({"text": ent.text, "label": ent.label_})
                    elif ent.label_ == "DATE" and ent.text:
                        entities["dates"].append({"text": ent.text})
                    elif ent.label_ == "EVENT" and ent.text:
                        entities["events"].append({"text": ent.text})

            except Exception as e:
                logger.warning("spacy_extraction_failed", error=str(e))

        # ── Theme Detection (regex) ───────────────────────────────────────
        found_themes = []
        for i, pattern in enumerate(THEME_PATTERNS):
            if pattern.search(sample):
                found_themes.append(FINANCIAL_THEMES[i])
        entities["themes"] = list(set(found_themes))

        # ── LLM Enrichment: Ticker Resolution ────────────────────────────
        if self.llm and entities["companies"]:
            try:
                entities = await self._enrich_with_llm(sample[:2000], entities)
            except Exception as e:
                logger.warning("llm_enrichment_failed", error=str(e))

        logger.info(
            "entities_extracted",
            companies=len(entities["companies"]),
            people=len(entities["people"]),
            themes=len(entities["themes"]),
        )
        return entities

    async def _enrich_with_llm(self, text: str, entities: dict) -> dict:
        """
        Use Gemini Flash to resolve company names to tickers.
        Only called when we have companies without tickers.
        """
        from app.llm.base import LLMConfig, LLMMessage
        import json

        company_names = [c["name"] for c in entities["companies"][:10] if not c.get("ticker")]
        if not company_names:
            return entities

        prompt = f"""For each company name, provide the stock ticker symbol if publicly traded.
Companies: {', '.join(company_names)}

Respond ONLY with JSON: {{"resolutions": [{{"name": "Apple Inc", "ticker": "AAPL"}}, ...]}}
If not publicly traded or unknown, use empty string for ticker."""

        response = await self.llm.generate(
            messages=[LLMMessage(role="user", content=prompt)],
            config=LLMConfig(temperature=0.0, max_tokens=300, json_mode=True),
        )

        try:
            data = json.loads(response.content)
            resolutions = {r["name"]: r.get("ticker", "") for r in data.get("resolutions", [])}

            # Apply resolutions
            for company in entities["companies"]:
                if not company["ticker"] and company["name"] in resolutions:
                    company["ticker"] = resolutions[company["name"]]
        except Exception:
            pass

        return entities

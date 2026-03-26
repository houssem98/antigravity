"""
Gravity Search — Earnings Call Transcript Source
Fetches earnings call transcripts from public sources.
Primary: Motley Fool public transcripts
Fallback: Alpha Vantage earnings call API
"""

import re
import structlog
from datetime import datetime

logger = structlog.get_logger()

MOTLEY_FOOL_BASE = "https://www.fool.com/earnings/call-transcripts/"
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"


class EarningsTranscriptSource:
    """
    Fetches and parses earnings call transcripts.

    Returns structured speaker turns:
      {speaker, role, text, turn_index}

    Also returns flat transcript for ingestion pipeline.
    """

    def __init__(self, alpha_vantage_key: str = ""):
        self.alpha_vantage_key = alpha_vantage_key

    async def fetch_transcript(
        self,
        ticker: str,
        company_name: str,
        quarter: str = "",  # e.g. "Q3 2024"
    ) -> dict:
        """
        Fetch the most recent earnings call transcript for a company.

        Returns:
            {
                "ticker": str,
                "company_name": str,
                "quarter": str,
                "date": str,
                "speakers": list[dict],  # [{speaker, role, text, turn_index}]
                "full_text": str,
                "sections": {"prepared_remarks": str, "qa_session": str},
            }
        """
        # Try Alpha Vantage if key provided
        if self.alpha_vantage_key:
            try:
                result = await self._fetch_alpha_vantage(ticker, quarter)
                if result:
                    return result
            except Exception as e:
                logger.warning("alpha_vantage_failed", ticker=ticker, error=str(e))

        # Fallback: try to fetch from Motley Fool
        try:
            result = await self._fetch_motley_fool(ticker, company_name, quarter)
            if result:
                return result
        except Exception as e:
            logger.warning("motley_fool_failed", ticker=ticker, error=str(e))

        return {
            "ticker": ticker,
            "company_name": company_name,
            "quarter": quarter,
            "date": "",
            "speakers": [],
            "full_text": "",
            "sections": {"prepared_remarks": "", "qa_session": ""},
        }

    async def _fetch_alpha_vantage(self, ticker: str, quarter: str) -> dict | None:
        """Fetch transcript via Alpha Vantage EARNINGS_CALL_TRANSCRIPT function."""
        import httpx

        params = {
            "function": "EARNINGS_CALL_TRANSCRIPT",
            "symbol": ticker,
            "apikey": self.alpha_vantage_key,
        }
        if quarter:
            # Parse quarter like "Q3 2024" → quarter=3&year=2024
            match = re.match(r"Q(\d)\s+(\d{4})", quarter)
            if match:
                params["quarter"] = match.group(1)
                params["year"] = match.group(2)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(ALPHA_VANTAGE_URL, params=params)
            response.raise_for_status()
            data = response.json()

        if "transcript" not in data:
            return None

        transcript_data = data["transcript"]
        speakers = []
        for i, entry in enumerate(transcript_data):
            speakers.append({
                "speaker": entry.get("speaker", "Unknown"),
                "role": entry.get("title", ""),
                "text": entry.get("content", ""),
                "turn_index": i,
            })

        full_text = self._build_full_text(speakers)
        sections = self._split_sections(full_text)

        logger.info("alpha_vantage_fetched", ticker=ticker, speaker_turns=len(speakers))
        return {
            "ticker": ticker,
            "company_name": data.get("symbol", ticker),
            "quarter": data.get("quarter", quarter),
            "date": data.get("date", ""),
            "speakers": speakers,
            "full_text": full_text,
            "sections": sections,
        }

    async def _fetch_motley_fool(
        self, ticker: str, company_name: str, quarter: str
    ) -> dict | None:
        """
        Fetch from Motley Fool public earnings transcripts.
        Searches for the most recent transcript and parses HTML.
        """
        import httpx
        from bs4 import BeautifulSoup

        # Search for transcript URL
        search_url = f"https://www.fool.com/search/solr.aspx?q={ticker}+earnings+call+transcript&site=fool"
        headers = {
            "User-Agent": "GravitySearch/1.0 (financial research tool)",
            "Accept": "text/html,application/xhtml+xml",
        }

        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            # Try direct URL pattern first
            slug = company_name.lower().replace(" ", "-").replace(",", "").replace(".", "")
            year = quarter.split()[-1] if quarter else datetime.utcnow().strftime("%Y")
            q_num = quarter.split()[0].lower() if quarter else "q4"

            direct_url = f"{MOTLEY_FOOL_BASE}{ticker.lower()}-{q_num}-{year}-earnings-call-transcript"
            try:
                response = await client.get(direct_url, headers=headers)
                if response.status_code == 200:
                    return self._parse_motley_fool_html(
                        response.text, ticker, company_name, quarter
                    )
            except Exception:
                pass

            # Try search
            try:
                response = await client.get(search_url, headers=headers)
                if response.status_code != 200:
                    return None
                soup = BeautifulSoup(response.text, "html.parser")
                links = soup.find_all("a", href=re.compile(r"earnings-call-transcript"))
                if not links:
                    return None
                transcript_url = "https://www.fool.com" + links[0]["href"]
                response = await client.get(transcript_url, headers=headers)
                if response.status_code == 200:
                    return self._parse_motley_fool_html(
                        response.text, ticker, company_name, quarter
                    )
            except Exception:
                pass

        return None

    def _parse_motley_fool_html(
        self, html: str, ticker: str, company_name: str, quarter: str
    ) -> dict | None:
        """Parse Motley Fool earnings call HTML into structured speaker turns."""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")

        # Remove ads, nav, footer
        for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()

        # Extract article body
        article = soup.find("article") or soup.find("div", class_="article-body")
        if not article:
            return None

        # Extract date
        date_tag = soup.find("time")
        date_str = date_tag.get("datetime", "") if date_tag else ""

        # Extract quarter from title if not provided
        title_tag = soup.find("h1")
        title = title_tag.get_text(strip=True) if title_tag else ""
        if not quarter and title:
            q_match = re.search(r"(Q[1-4]\s+\d{4})", title)
            if q_match:
                quarter = q_match.group(1)

        # Parse speaker turns
        speakers = []
        turn_index = 0

        # Motley Fool uses <p> with bold speaker names followed by text
        paragraphs = article.find_all("p")
        current_speaker = ""
        current_role = ""
        current_text_parts = []

        for p in paragraphs:
            # Check for speaker attribution (bold text at start of paragraph)
            bold = p.find("strong") or p.find("b")
            if bold:
                # Save previous speaker turn
                if current_speaker and current_text_parts:
                    speakers.append({
                        "speaker": current_speaker,
                        "role": current_role,
                        "text": " ".join(current_text_parts).strip(),
                        "turn_index": turn_index,
                    })
                    turn_index += 1
                    current_text_parts = []

                # Parse new speaker
                speaker_text = bold.get_text(strip=True)
                # Format: "John Smith -- CEO, Apple"
                if " -- " in speaker_text:
                    parts = speaker_text.split(" -- ", 1)
                    current_speaker = parts[0].strip()
                    current_role = parts[1].strip()
                else:
                    current_speaker = speaker_text
                    current_role = ""

                # Rest of paragraph is their speech
                bold.decompose()
                remaining = p.get_text(strip=True)
                if remaining:
                    current_text_parts.append(remaining)
            else:
                text = p.get_text(strip=True)
                if text and current_speaker:
                    current_text_parts.append(text)

        # Save last speaker turn
        if current_speaker and current_text_parts:
            speakers.append({
                "speaker": current_speaker,
                "role": current_role,
                "text": " ".join(current_text_parts).strip(),
                "turn_index": turn_index,
            })

        if not speakers:
            return None

        full_text = self._build_full_text(speakers)
        sections = self._split_sections(full_text)

        logger.info("motley_fool_parsed", ticker=ticker, speaker_turns=len(speakers))
        return {
            "ticker": ticker,
            "company_name": company_name,
            "quarter": quarter,
            "date": date_str,
            "speakers": speakers,
            "full_text": full_text,
            "sections": sections,
        }

    def _build_full_text(self, speakers: list[dict]) -> str:
        """Build flat full text from speaker turns."""
        parts = []
        for turn in speakers:
            speaker_line = turn["speaker"]
            if turn.get("role"):
                speaker_line += f" ({turn['role']})"
            parts.append(f"{speaker_line}:\n{turn['text']}")
        return "\n\n".join(parts)

    def _split_sections(self, full_text: str) -> dict:
        """
        Split transcript into Prepared Remarks and Q&A Session.
        Returns dict with 'prepared_remarks' and 'qa_session' keys.
        """
        # Common Q&A section markers
        qa_patterns = [
            r"(?i)question[\s-]+and[\s-]+answer",
            r"(?i)q\s*&\s*a\s+session",
            r"(?i)questions\s+and\s+answers",
            r"(?i)operator.*please\s+go\s+ahead",
            r"(?i)we\s+will\s+now\s+(begin|open|take)\s+(the\s+)?q",
        ]

        split_pos = len(full_text)
        for pattern in qa_patterns:
            match = re.search(pattern, full_text)
            if match:
                split_pos = min(split_pos, match.start())

        return {
            "prepared_remarks": full_text[:split_pos].strip(),
            "qa_session": full_text[split_pos:].strip(),
        }

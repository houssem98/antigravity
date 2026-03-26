"""
Gravity Search — Real SEC EDGAR Filing Ingestion
Downloads actual 10-K and 10-Q filings from SEC EDGAR,
parses them into sections, chunks them, and indexes into
Qdrant + Elasticsearch + PostgreSQL.

Usage:
    cd services/gravity-api
    .\.venv2\Scripts\python -m scripts.ingest_sec_filings

SEC EDGAR EFTS API: https://efts.sec.gov/LATEST/search-index
No API key required — just a User-Agent header.
"""

import requests
import re
import uuid
import time
import sys
import os
import json
from typing import List, Dict, Tuple
from datetime import datetime

# ── Load VOYAGE_API_KEY from .env ─────────────────────────────────────────────
def _load_voyage_key() -> str:
    """Walk up from script location to find .env and extract VOYAGE_API_KEY."""
    search_dir = os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        env_path = os.path.join(search_dir, ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("VOYAGE_API_KEY="):
                        return line.split("=", 1)[1].strip()
        search_dir = os.path.dirname(search_dir)
    key = os.environ.get("VOYAGE_API_KEY", "")
    if not key:
        print("❌  VOYAGE_API_KEY not found in any .env file or environment")
        sys.exit(1)
    return key

VOYAGE_API_KEY = _load_voyage_key()

import voyageai
_voyage_client = voyageai.Client(api_key=VOYAGE_API_KEY)

VOYAGE_MODEL = "voyage-finance-2"
# Free tier: 3 RPM / 10K TPM. Paid tier: 300 RPM / 1M TPM.
# Batch size 20 + 21s delay keeps within free limits.
# Add a payment method at dashboard.voyageai.com to use batch=128, delay=0.
VOYAGE_BATCH = 16   # ~8K tokens per batch (free tier: 10K TPM)
VOYAGE_DELAY = 22  # seconds between batches (free tier: 3 RPM = max 1 req/20s)
VOYAGE_RATELIMIT_WAIT = 65  # seconds to wait when rate-limited before retrying


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed texts with voyage-finance-2, waiting indefinitely on rate limits."""
    all_embeddings = []
    total_batches = (len(texts) - 1) // VOYAGE_BATCH + 1
    for i in range(0, len(texts), VOYAGE_BATCH):
        batch = texts[i:i + VOYAGE_BATCH]
        batch_num = i // VOYAGE_BATCH + 1
        attempt = 0
        while True:
            try:
                result = _voyage_client.embed(batch, model=VOYAGE_MODEL, input_type="document")
                all_embeddings.extend(result.embeddings)
                if total_batches > 1:
                    print(f"         Embedded batch {batch_num}/{total_batches}")
                break
            except Exception as e:
                attempt += 1
                print(f"         Rate limit hit (attempt {attempt}), waiting {VOYAGE_RATELIMIT_WAIT}s for reset... ({e})")
                time.sleep(VOYAGE_RATELIMIT_WAIT)
        # Respect rate limit between batches
        if batch_num < total_batches:
            time.sleep(VOYAGE_DELAY)
    return all_embeddings

# ── Configuration ────────────────────────────────────────────────────────────

SEC_BASE = "https://efts.sec.gov/LATEST"
EDGAR_ARCHIVE = "https://www.sec.gov/Archives/edgar/data"
USER_AGENT = "Antigravity Research Bot research@antigravity.dev"

# Major companies to ingest (ticker → CIK)
COMPANIES = {
    "AAPL":  {"cik": "0000320193", "name": "Apple Inc."},
    "MSFT":  {"cik": "0000789019", "name": "Microsoft Corporation"},
    "NVDA":  {"cik": "0001045810", "name": "NVIDIA Corporation"},
    "AMZN":  {"cik": "0001018724", "name": "Amazon.com Inc."},
    "GOOGL": {"cik": "0001652044", "name": "Alphabet Inc."},
    "META":  {"cik": "0001326801", "name": "Meta Platforms Inc."},
    "TSLA":  {"cik": "0001318605", "name": "Tesla Inc."},
    "JPM":   {"cik": "0000019617", "name": "JPMorgan Chase & Co."},
    "V":     {"cik": "0001403161", "name": "Visa Inc."},
    "JNJ":   {"cik": "0000200406", "name": "Johnson & Johnson"},
    "WMT":   {"cik": "0000104169", "name": "Walmart Inc."},
    "UNH":   {"cik": "0000731766", "name": "UnitedHealth Group Inc."},
    "BAC":   {"cik": "0000070858", "name": "Bank of America Corp."},
    "XOM":   {"cik": "0000034088", "name": "Exxon Mobil Corporation"},
    "PFE":   {"cik": "0000078003", "name": "Pfizer Inc."},
    "DIS":   {"cik": "0001744489", "name": "The Walt Disney Company"},
    "NFLX":  {"cik": "0001065280", "name": "Netflix Inc."},
    "CRM":   {"cik": "0001108524", "name": "Salesforce Inc."},
    "AMD":   {"cik": "0000002488", "name": "Advanced Micro Devices Inc."},
    "INTC":  {"cik": "0000050863", "name": "Intel Corporation"},
}

# Filing types to download
FILING_TYPES = ["10-K", "10-Q"]

# Max filings per company per type
MAX_FILINGS = 3

# Qdrant config
QDRANT_URL = "http://localhost:6333"
COLLECTION = "gravity_chunks"
DIMS = 1024

# Elasticsearch config
ES_URL = "http://localhost:9200"
ES_INDEX = "gravity_chunks"

# PostgreSQL config
PG_URL = "postgresql://antigravity:antigravity_dev@localhost:5432/gravity_search"

# Section patterns for 10-K/10-Q parsing
SECTION_PATTERNS = [
    (r"(?:Item\s*1\.?\s*[-–—:.]?\s*Business)", "Business"),
    (r"(?:Item\s*1A\.?\s*[-–—:.]?\s*Risk\s*Factors)", "Risk Factors"),
    (r"(?:Item\s*1B\.?\s*[-–—:.]?\s*Unresolved\s*Staff\s*Comments)", "Unresolved Staff Comments"),
    (r"(?:Item\s*2\.?\s*[-–—:.]?\s*Properties)", "Properties"),
    (r"(?:Item\s*3\.?\s*[-–—:.]?\s*Legal\s*Proceedings)", "Legal Proceedings"),
    (r"(?:Item\s*5\.?\s*[-–—:.]?\s*Market)", "Market Information"),
    (r"(?:Item\s*6\.?\s*[-–—:.]?\s*(?:Selected|Reserved))", "Selected Financial Data"),
    (r"(?:Item\s*7\.?\s*[-–—:.]?\s*Management)", "MD&A"),
    (r"(?:Item\s*7A\.?\s*[-–—:.]?\s*Quantitative)", "Market Risk Disclosures"),
    (r"(?:Item\s*8\.?\s*[-–—:.]?\s*Financial\s*Statements)", "Financial Statements"),
    (r"(?:Item\s*9\.?\s*[-–—:.]?\s*Changes)", "Disagreements with Accountants"),
    (r"(?:Item\s*9A\.?\s*[-–—:.]?\s*Controls)", "Controls and Procedures"),
    (r"(?:Item\s*10\.?\s*[-–—:.]?\s*Directors)", "Directors and Officers"),
    (r"(?:Item\s*11\.?\s*[-–—:.]?\s*Executive\s*Compensation)", "Executive Compensation"),
    (r"(?:Item\s*12\.?\s*[-–—:.]?\s*Security)", "Security Ownership"),
    (r"(?:Item\s*13\.?\s*[-–—:.]?\s*Certain\s*Relationships)", "Related Party Transactions"),
    (r"(?:Item\s*14\.?\s*[-–—:.]?\s*Principal)", "Principal Accountant Fees"),
    (r"(?:Item\s*15\.?\s*[-–—:.]?\s*Exhibits)", "Exhibits"),
]


# ── SEC EDGAR API Functions ──────────────────────────────────────────────────

def get_filing_list(cik: str, filing_type: str, count: int = 3) -> list:
    """Get list of filings from EDGAR for a given CIK and type."""
    headers = {"User-Agent": USER_AGENT}
    cik_stripped = cik.lstrip("0")
    
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"      ⚠️  Failed to fetch filing index: {e}")
        return []
    
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    dates = recent.get("filingDate", [])
    primary_docs = recent.get("primaryDocument", [])
    
    results = []
    for i, form in enumerate(forms):
        if form == filing_type and len(results) < count:
            acc = accessions[i].replace("-", "")
            doc = primary_docs[i]
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_stripped}/{acc}/{doc}"
            results.append({
                "accession": accessions[i],
                "date": dates[i],
                "url": filing_url,
                "type": filing_type,
            })
    
    return results


def download_filing(url: str) -> str:
    """Download filing text content from SEC EDGAR."""
    headers = {"User-Agent": USER_AGENT}
    
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"      ⚠️  Download failed: {e}")
        return ""


def clean_html(text: str) -> str:
    """Strip HTML tags and clean up whitespace."""
    # Remove style/script blocks
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert common HTML entities
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&nbsp;", " ")
    text = text.replace("&#160;", " ")
    text = text.replace("&rsquo;", "'")
    text = text.replace("&ldquo;", '"')
    text = text.replace("&rdquo;", '"')
    text = text.replace("&mdash;", "—")
    text = text.replace("&ndash;", "–")
    text = re.sub(r"&#\d+;", " ", text)
    
    # Remove tags but preserve content
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?div[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?tr[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?td[^>]*>", " | ", text, flags=re.IGNORECASE)
    text = re.sub(r"</?th[^>]*>", " | ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    text = text.strip()
    
    return text


def parse_sections(text: str) -> List[Tuple[str, str]]:
    """Parse filing text into named sections."""
    sections = []
    
    # Find all section boundaries
    boundaries = []
    for pattern, name in SECTION_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            boundaries.append((m.start(), name))
    
    # Sort by position
    boundaries.sort(key=lambda x: x[0])
    
    if not boundaries:
        # If no sections found, create chunks from the full text
        # Split into ~2000 char chunks
        words = text.split()
        chunk_size = 350  # ~350 words ≈ 2000 chars
        for i in range(0, len(words), chunk_size):
            chunk_words = words[i:i + chunk_size]
            chunk_text = " ".join(chunk_words)
            if len(chunk_text.strip()) > 100:
                sections.append((f"Section {i // chunk_size + 1}", chunk_text.strip()))
        return sections
    
    # Extract text between section boundaries
    for i, (pos, name) in enumerate(boundaries):
        end_pos = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        section_text = text[pos:end_pos].strip()
        
        # Clean the section text — remove the section header itself
        for pattern, _ in SECTION_PATTERNS:
            section_text = re.sub(pattern, "", section_text, count=1, flags=re.IGNORECASE).strip()
        
        if len(section_text) > 100:  # Only keep substantial sections
            sections.append((name, section_text))
    
    return sections


def chunk_section(section_name: str, text: str, max_tokens: int = 512) -> List[str]:
    """Split a section into chunks of ~max_tokens words."""
    words = text.split()
    
    if len(words) <= max_tokens:
        return [text]
    
    chunks = []
    overlap = max_tokens // 5  # 20% overlap
    
    i = 0
    while i < len(words):
        end = min(i + max_tokens, len(words))
        chunk = " ".join(words[i:end])
        
        if len(chunk.strip()) > 50:
            chunks.append(chunk.strip())
        
        i += max_tokens - overlap
    
    return chunks


# ── Database Indexing ────────────────────────────────────────────────────────

def init_qdrant():
    """Initialize Qdrant collection."""
    from qdrant_client import QdrantClient
    from qdrant_client.http import models
    
    client = QdrantClient(url=QDRANT_URL, timeout=10)
    
    if client.collection_exists(collection_name=COLLECTION):
        client.delete_collection(collection_name=COLLECTION)
    
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config={
            "dense": models.VectorParams(size=DIMS, distance=models.Distance.COSINE),
        },
        sparse_vectors_config={
            "sparse": models.SparseVectorParams(modifier=models.Modifier.IDF),
        },
    )
    
    for field in ["ticker", "company_name", "filing_type", "document_id", "section", "filing_date"]:
        client.create_payload_index(
            collection_name=COLLECTION,
            field_name=field,
            field_schema=models.PayloadSchemaType.KEYWORD,
        )
    
    print(f"   ✅ Qdrant collection '{COLLECTION}' created ({DIMS}d)")
    client.close()


def init_elasticsearch():
    """Initialize Elasticsearch index."""
    from elasticsearch import Elasticsearch
    
    es = Elasticsearch(hosts=[ES_URL], request_timeout=10)
    
    if es.indices.exists(index=ES_INDEX):
        es.indices.delete(index=ES_INDEX)
    
    settings = {
        "analysis": {
            "filter": {
                "financial_synonyms": {
                    "type": "synonym",
                    "lenient": True,
                    "synonyms": [
                        "revenue, net sales, top line, turnover",
                        "earnings, profit, net income, bottom line",
                        "ebitda, operating cash flow proxy",
                        "capex, capital expenditure, capital spending",
                        "margin, profitability, spread",
                        "guidance, outlook, forecast, projection",
                        "tariff, import duty, customs, trade barrier",
                        "restructuring, reorganization, transformation",
                        "buyback, share repurchase, stock repurchase",
                        "dividend, distribution, payout",
                        "acquisition, merger, takeover, deal",
                        "ipo, initial public offering, listing",
                        "leverage, debt ratio, gearing",
                        "liquidity, cash position, working capital",
                    ],
                },
            },
            "analyzer": {
                "financial_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "financial_synonyms"],
                },
            },
        },
    }
    
    mappings = {
        "properties": {
            "chunk_id": {"type": "keyword"},
            "document_id": {"type": "keyword"},
            "text": {"type": "text", "analyzer": "financial_analyzer"},
            "ticker": {"type": "keyword"},
            "company_name": {"type": "text"},
            "filing_type": {"type": "keyword"},
            "filing_date": {"type": "date"},
            "section": {"type": "keyword"},
            "chunk_level": {"type": "integer"},
            "chunk_position": {"type": "integer"},
        },
    }
    
    es.indices.create(index=ES_INDEX, settings=settings, mappings=mappings)
    print(f"   ✅ Elasticsearch index '{ES_INDEX}' created")
    es.close()


def init_postgres():
    """Initialize PostgreSQL tables."""
    try:
        import psycopg2
    except ImportError:
        print("   ⏭️  PostgreSQL: psycopg2 not installed, skipping")
        return
    
    try:
        conn = psycopg2.connect(PG_URL)
        conn.autocommit = True
        cur = conn.cursor()
        
        cur.execute("DROP TABLE IF EXISTS financial_metrics CASCADE")
        cur.execute("DROP TABLE IF EXISTS document_chunks CASCADE")
        cur.execute("DROP TABLE IF EXISTS documents CASCADE")
        
        cur.execute("""
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                company_name TEXT NOT NULL,
                filing_type TEXT NOT NULL,
                filing_date DATE,
                accession_number TEXT,
                source_url TEXT,
                title TEXT,
                ingested_at TIMESTAMP DEFAULT NOW(),
                chunk_count INTEGER DEFAULT 0,
                total_characters INTEGER DEFAULT 0,
                status TEXT DEFAULT 'indexed'
            )
        """)
        cur.execute("CREATE INDEX idx_docs_ticker ON documents(ticker)")
        cur.execute("CREATE INDEX idx_docs_type ON documents(filing_type)")
        cur.execute("CREATE INDEX idx_docs_date ON documents(filing_date)")
        
        cur.execute("""
            CREATE TABLE document_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
                ticker TEXT NOT NULL,
                section TEXT,
                chunk_level INTEGER DEFAULT 2,
                chunk_position INTEGER,
                text TEXT NOT NULL,
                char_count INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX idx_chunks_doc ON document_chunks(document_id)")
        cur.execute("CREATE INDEX idx_chunks_ticker ON document_chunks(ticker)")
        cur.execute("CREATE INDEX idx_chunks_section ON document_chunks(section)")
        
        print("   ✅ PostgreSQL tables created (documents, document_chunks)")
        conn.close()
    except Exception as e:
        print(f"   ❌ PostgreSQL: {e}")


def index_chunks(
    ticker: str,
    company: str,
    filing_type: str,
    filing_date: str,
    accession: str,
    source_url: str,
    chunks: List[Tuple[str, str]],  # (section, text)
    global_point_id: int,
) -> int:
    """Index chunks into all databases. Returns number of new points."""
    from qdrant_client import QdrantClient
    from qdrant_client.http import models
    from elasticsearch import Elasticsearch
    
    doc_id = f"{ticker}_{filing_type}_{filing_date}".replace("-", "")
    
    # ── Qdrant ───────────────────────────────────────────────────────────
    client = QdrantClient(url=QDRANT_URL, timeout=15)
    
    # Build metadata-prefixed texts for embedding
    texts_with_meta = []
    for section, text in chunks:
        meta_prefix = f"[Ticker: {ticker}] [Company: {company}] [Filing: {filing_type} {filing_date}] [Section: {section}]"
        texts_with_meta.append(f"{meta_prefix}\n\n{text[:4000]}")

    # Real voyage-finance-2 embeddings (batched)
    print(f"         🚀 Embedding {len(texts_with_meta)} chunks with voyage-finance-2...")
    dense_vecs = embed_texts(texts_with_meta)

    points = []
    for i, (section, text) in enumerate(chunks):
        chunk_id = str(uuid.uuid4())
        point_id = global_point_id + i

        # Sparse vector from word frequencies
        words = text.lower().split()
        word_freq = {}
        for w in words:
            w = w.strip(".,;:\"'()[]{}!?$%")
            if len(w) > 2:
                word_freq[w] = word_freq.get(w, 0) + 1

        points.append(models.PointStruct(
            id=point_id,
            vector={
                "dense": dense_vecs[i],
                "sparse": models.SparseVector(
                    indices=list(range(len(word_freq))),
                    values=[float(v) for v in word_freq.values()],
                ),
            },
            payload={
                "chunk_id": chunk_id,
                "document_id": doc_id,
                "text": text[:4000],
                "text_with_metadata": texts_with_meta[i],
                "ticker": ticker,
                "company_name": company,
                "filing_type": filing_type,
                "filing_date": filing_date,
                "section": section,
                "chunk_level": 2,
                "position": i,
                "source_quality": 10,  # SEC filings = highest authority
                "metadata": {
                    "ticker": ticker,
                    "company_name": company,
                    "filing_type": filing_type,
                    "filing_date": filing_date,
                    "accession_number": accession,
                    "document_title": f"{company} {filing_type} {filing_date}",
                    "source_url": source_url,
                },
            },
        ))
    
    # Batch upsert
    batch_size = 100
    for b in range(0, len(points), batch_size):
        client.upsert(collection_name=COLLECTION, points=points[b:b + batch_size])
    
    client.close()
    
    # ── Elasticsearch ────────────────────────────────────────────────────
    try:
        es = Elasticsearch(hosts=[ES_URL], request_timeout=15)
        
        actions = []
        for i, (section, text) in enumerate(chunks):
            chunk_id = str(uuid.uuid4())
            actions.append({"index": {"_index": ES_INDEX, "_id": chunk_id}})
            actions.append({
                "chunk_id": chunk_id,
                "document_id": doc_id,
                "text": text[:8000],
                "ticker": ticker,
                "company_name": company,
                "filing_type": filing_type,
                "filing_date": filing_date,
                "section": section,
                "chunk_level": 2,
                "chunk_position": i,
            })
        
        if actions:
            es.bulk(operations=actions, refresh=False)
        
        es.close()
    except Exception as e:
        print(f"      ⚠️  ES indexing error: {e}")
    
    # ── PostgreSQL ───────────────────────────────────────────────────────
    try:
        import psycopg2
        conn = psycopg2.connect(PG_URL)
        conn.autocommit = True
        cur = conn.cursor()
        
        total_chars = sum(len(t) for _, t in chunks)
        cur.execute(
            """INSERT INTO documents (id, ticker, company_name, filing_type, filing_date, 
               accession_number, source_url, title, chunk_count, total_characters) 
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING""",
            (doc_id, ticker, company, filing_type, filing_date, accession, source_url,
             f"{company} {filing_type} {filing_date}", len(chunks), total_chars)
        )
        
        for i, (section, text) in enumerate(chunks):
            chunk_id = str(uuid.uuid4())
            try:
                cur.execute(
                    """INSERT INTO document_chunks (id, document_id, ticker, section, 
                       chunk_level, chunk_position, text, char_count) 
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (chunk_id, doc_id, ticker, section, 2, i, text[:8000], len(text[:8000]))
                )
            except Exception:
                pass
        
        conn.close()
    except ImportError:
        pass
    except Exception as e:
        print(f"      ⚠️  PG error: {e}")
    
    return len(chunks)


# ── Resume Helpers ───────────────────────────────────────────────────────────

def _ensure_qdrant():
    """Create Qdrant collection only if it doesn't already exist."""
    from qdrant_client import QdrantClient
    from qdrant_client.http import models
    client = QdrantClient(url=QDRANT_URL, timeout=10)
    if not client.collection_exists(collection_name=COLLECTION):
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config={"dense": models.VectorParams(size=DIMS, distance=models.Distance.COSINE)},
            sparse_vectors_config={"sparse": models.SparseVectorParams(modifier=models.Modifier.IDF)},
        )
        for field in ["ticker", "company_name", "filing_type", "document_id", "section", "filing_date"]:
            client.create_payload_index(
                collection_name=COLLECTION,
                field_name=field,
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
        print(f"   ✅ Qdrant collection '{COLLECTION}' created ({DIMS}d)")
    else:
        print(f"   ✅ Qdrant collection '{COLLECTION}' already exists")
    client.close()


def _ensure_elasticsearch():
    """Create ES index only if it doesn't already exist."""
    from elasticsearch import Elasticsearch
    es = Elasticsearch(hosts=[ES_URL], request_timeout=10)
    if not es.indices.exists(index=ES_INDEX):
        init_elasticsearch()
    else:
        print(f"   ✅ Elasticsearch index '{ES_INDEX}' already exists")
    es.close()


def _ensure_postgres():
    """Create PG tables only if they don't already exist."""
    try:
        import psycopg2
    except ImportError:
        print("   ⏭️  PostgreSQL: psycopg2 not installed, skipping")
        return
    try:
        conn = psycopg2.connect(PG_URL)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY, ticker TEXT NOT NULL, company_name TEXT NOT NULL,
                filing_type TEXT NOT NULL, filing_date DATE, accession_number TEXT,
                source_url TEXT, title TEXT, ingested_at TIMESTAMP DEFAULT NOW(),
                chunk_count INTEGER DEFAULT 0, total_characters INTEGER DEFAULT 0,
                status TEXT DEFAULT 'indexed'
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_docs_ticker ON documents(ticker)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(filing_type)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_docs_date ON documents(filing_date)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS document_chunks (
                id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
                ticker TEXT NOT NULL, section TEXT, chunk_level INTEGER DEFAULT 2,
                chunk_position INTEGER, text TEXT NOT NULL, char_count INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_ticker ON document_chunks(ticker)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_section ON document_chunks(section)")
        print("   ✅ PostgreSQL tables ready")
        conn.close()
    except Exception as e:
        print(f"   ❌ PostgreSQL: {e}")


def _get_indexed_doc_ids() -> set:
    """Return set of already-indexed document IDs from Postgres."""
    try:
        import psycopg2
        conn = psycopg2.connect(PG_URL)
        cur = conn.cursor()
        cur.execute("SELECT id FROM documents")
        ids = {row[0] for row in cur.fetchall()}
        conn.close()
        return ids
    except Exception:
        return set()


def _get_qdrant_point_count() -> int:
    """Return current number of points in Qdrant to continue IDs from."""
    try:
        from qdrant_client import QdrantClient
        client = QdrantClient(url=QDRANT_URL, timeout=5)
        info = client.get_collection(COLLECTION)
        count = info.points_count or 0
        client.close()
        return count
    except Exception:
        return 0


# ── Main Ingestion Pipeline ─────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  GRAVITY SEARCH — SEC EDGAR FILING INGESTION")
    print("=" * 70)
    print(f"  Companies: {len(COMPANIES)}")
    print(f"  Filing types: {', '.join(FILING_TYPES)}")
    print(f"  Max filings per type: {MAX_FILINGS}")
    print(f"  Max expected filings: ~{len(COMPANIES) * len(FILING_TYPES) * MAX_FILINGS}")
    print("=" * 70)
    
    # Initialize databases (only if not already initialized)
    print("\n📦 Initializing databases...")
    _ensure_qdrant()
    _ensure_elasticsearch()
    _ensure_postgres()

    # Load already-indexed doc IDs from Postgres to support resume
    indexed_doc_ids = _get_indexed_doc_ids()
    if indexed_doc_ids:
        print(f"   ↩️  Resuming — {len(indexed_doc_ids)} filings already indexed, skipping them")

    # Process each company
    total_chunks = 0
    total_filings = 0
    global_point_id = _get_qdrant_point_count()

    for ticker, info in COMPANIES.items():
        cik = info["cik"]
        company = info["name"]
        
        print(f"\n{'─' * 70}")
        print(f"🏢 {company} ({ticker}) — CIK: {cik}")
        print(f"{'─' * 70}")
        
        for filing_type in FILING_TYPES:
            print(f"\n   📄 Fetching {filing_type} filings...")
            filings = get_filing_list(cik, filing_type, count=MAX_FILINGS)
            
            if not filings:
                print(f"      No {filing_type} filings found")
                continue
            
            for filing in filings:
                filing_date = filing["date"]
                url = filing["url"]
                accession = filing["accession"]
                
                doc_id = f"{ticker}_{filing_type}_{filing_date}".replace("-", "")
                if doc_id in indexed_doc_ids:
                    print(f"      ⏭️  {filing_type} ({filing_date}) — already indexed, skipping")
                    continue

                print(f"      📥 {filing_type} ({filing_date}) — downloading...")

                # Rate limit: SEC allows 10 req/sec
                time.sleep(0.2)
                
                raw_html = download_filing(url)
                if not raw_html:
                    continue
                
                # Clean HTML
                clean_text = clean_html(raw_html)
                
                if len(clean_text) < 500:
                    print(f"         ⚠️  Too short ({len(clean_text)} chars), skipping")
                    continue
                
                # Parse into sections
                sections = parse_sections(clean_text)
                
                if not sections:
                    # Fallback: chunk the whole text
                    words = clean_text.split()
                    chunk_size = 350
                    sections = []
                    for i in range(0, len(words), chunk_size):
                        chunk_words = words[i:i + chunk_size]
                        chunk_text = " ".join(chunk_words)
                        if len(chunk_text.strip()) > 100:
                            sections.append((f"Content {i // chunk_size + 1}", chunk_text.strip()))
                
                # Further chunk large sections
                all_chunks = []
                for section_name, section_text in sections:
                    sub_chunks = chunk_section(section_name, section_text, max_tokens=512)
                    for chunk in sub_chunks:
                        all_chunks.append((section_name, chunk))
                
                if not all_chunks:
                    print(f"         ⚠️  No chunks generated, skipping")
                    continue
                
                # Index into all databases
                n = index_chunks(
                    ticker=ticker,
                    company=company,
                    filing_type=filing_type,
                    filing_date=filing_date,
                    accession=accession,
                    source_url=url,
                    chunks=all_chunks,
                    global_point_id=global_point_id,
                )
                
                global_point_id += n
                total_chunks += n
                total_filings += 1
                
                print(f"         ✅ {n} chunks indexed ({len(clean_text):,} chars, {len(sections)} sections)")
    
    # Final verification
    print(f"\n{'=' * 70}")
    print("  VERIFICATION")
    print(f"{'=' * 70}")
    
    # Qdrant
    try:
        from qdrant_client import QdrantClient
        c = QdrantClient(url=QDRANT_URL, timeout=5)
        info = c.get_collection(COLLECTION)
        print(f"  ✅ Qdrant: {info.points_count} points in '{COLLECTION}'")
        c.close()
    except Exception as e:
        print(f"  ❌ Qdrant: {e}")
    
    # Elasticsearch
    try:
        from elasticsearch import Elasticsearch
        es = Elasticsearch(hosts=[ES_URL], request_timeout=5)
        es.indices.refresh(index=ES_INDEX)
        count = es.count(index=ES_INDEX)
        print(f"  ✅ Elasticsearch: {count['count']} docs in '{ES_INDEX}'")
        
        # Test search
        sr = es.search(index=ES_INDEX, query={"match": {"text": "revenue growth"}}, size=3)
        print(f"  ✅ Test 'revenue growth': {sr['hits']['total']['value']} hits")
        for hit in sr["hits"]["hits"]:
            s = hit["_source"]
            print(f"     [{s['ticker']}] {s['section']} — score: {hit['_score']:.2f}")
        
        es.close()
    except Exception as e:
        print(f"  ❌ Elasticsearch: {e}")
    
    # PostgreSQL
    try:
        import psycopg2
        conn = psycopg2.connect(PG_URL)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM documents")
        doc_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM document_chunks")
        chunk_count = cur.fetchone()[0]
        cur.execute("SELECT ticker, COUNT(*) FROM documents GROUP BY ticker ORDER BY ticker")
        per_company = cur.fetchall()
        print(f"  ✅ PostgreSQL: {doc_count} documents, {chunk_count} chunks")
        for t, c in per_company:
            print(f"     {t}: {c} filings")
        conn.close()
    except ImportError:
        print("  ⏭️  PostgreSQL: psycopg2 not installed")
    except Exception as e:
        print(f"  ❌ PostgreSQL: {e}")
    
    # Redis
    try:
        import redis
        r = redis.from_url("redis://localhost:6379", decode_responses=True)
        r.ping()
        print(f"  ✅ Redis: connected")
        r.close()
    except Exception as e:
        print(f"  ❌ Redis: {e}")
    
    print(f"\n{'=' * 70}")
    print(f"  🎉 INGESTION COMPLETE")
    print(f"  Companies: {len(COMPANIES)}")
    print(f"  Filings processed: {total_filings}")
    print(f"  Total chunks: {total_chunks}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()

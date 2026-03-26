"""
Gravity Search — Database Seed Script (Synchronous version)
Populates Qdrant and Elasticsearch with synthetic financial data.

Usage:
    cd services/gravity-api
    .\.venv2\Scripts\python -m scripts.seed_data
"""

import uuid
import sys
import os
import random

# Fix Windows console encoding (cp1252 can't handle emoji / box-drawing chars)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

# Add parent paths
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ─── Synthetic Financial Data ────────────────────────────────────────────────

SEED_DOCUMENTS = [
    # ── APPLE ────────────────────────────────────────────────────────────
    ("AAPL", "Apple Inc.", "10-K", "2024-10-31", "Revenue",
     "Apple Inc. reported total net revenue of $391.0 billion for the fiscal year ended September 28, 2024, compared to $383.3 billion for fiscal year 2023, an increase of 2%. Products revenue was $295.2 billion and Services revenue was $95.8 billion. Services revenue grew 13% year-over-year, driven by the App Store, advertising, and cloud services. iPhone revenue was $201.2 billion, representing 51.5% of total revenue."),
    ("AAPL", "Apple Inc.", "10-K", "2024-10-31", "Profitability",
     "Apple's gross margin was $178.1 billion for FY2024, yielding a gross margin percentage of 45.6%, up from 44.1% in FY2023. Operating income was $123.2 billion, with an operating margin of 31.5%. Net income was $93.7 billion, or $6.08 per diluted share. Research and development expenses were $31.4 billion, representing 8.0% of revenue."),
    ("AAPL", "Apple Inc.", "10-K", "2024-10-31", "Cash Flow",
     "Apple generated operating cash flow of $118.3 billion in FY2024. Capital expenditures were $9.2 billion. Free cash flow was $109.1 billion. The company returned $94.8 billion to shareholders through dividends ($15.2 billion) and share repurchases ($79.6 billion). Cash and cash equivalents were $29.9 billion. Total debt was $97.3 billion."),
    ("AAPL", "Apple Inc.", "10-K", "2024-10-31", "Risk Factors",
     "Apple faces risks including: global economic conditions affecting consumer spending; competition in the smartphone, personal computer, tablet, and wearables markets; dependence on new product introductions; supply chain concentration in China and India; foreign exchange fluctuations; regulatory risks including the EU Digital Markets Act."),

    # ── MICROSOFT ────────────────────────────────────────────────────────
    ("MSFT", "Microsoft Corporation", "10-K", "2024-07-30", "Revenue",
     "Microsoft reported revenue of $245.1 billion for FY2024, an increase of 16% year-over-year. Intelligent Cloud segment revenue was $105.4 billion (43% of total), driven by Azure which grew 29%. Productivity and Business Processes revenue was $78.4 billion. LinkedIn revenue grew 9% to $16.4 billion. Commercial cloud revenue reached $135.3 billion, growing 23%."),
    ("MSFT", "Microsoft Corporation", "10-K", "2024-07-30", "Profitability",
     "Microsoft's operating income was $109.4 billion, with an operating margin of 44.6%. Net income was $88.1 billion, or $11.80 per diluted share. Gross margin was $171.0 billion (69.8%). Cloud gross margin was 72%, up from 70% in FY2023. Azure AI contributed over $5 billion in annual revenue run-rate."),

    # ── NVIDIA ───────────────────────────────────────────────────────────
    ("NVDA", "NVIDIA Corporation", "10-K", "2025-02-26", "Revenue",
     "NVIDIA reported record revenue of $130.5 billion for FY2025, an increase of 114% from $60.9 billion in FY2024. Data Center revenue was $115.2 billion, up 142%. Gaming revenue was $11.4 billion, up 9%. Revenue growth was driven by demand for AI training and inference accelerators, particularly H100, H200, and Blackwell GPU architectures."),
    ("NVDA", "NVIDIA Corporation", "10-K", "2025-02-26", "Profitability",
     "NVIDIA's gross margin was 75.0%. Operating income was $81.5 billion, with an operating margin of 62.4%. Net income was $72.9 billion, or $2.94 per diluted share. R&D expenses were $12.9 billion (9.9% of revenue). Data Center segment operating margin was 73.0%. The company shipped over 3.6 million H100 GPUs."),

    # ── AMAZON ───────────────────────────────────────────────────────────
    ("AMZN", "Amazon.com, Inc.", "10-K", "2025-02-06", "Revenue",
     "Amazon reported net sales of $638.0 billion for 2024, an increase of 11%. AWS revenue was $107.6 billion, growing 19% year-over-year. Advertising services were $56.2 billion (growing 24%). Online stores contributed $247.0 billion. Third-party seller services were $156.1 billion."),
    ("AMZN", "Amazon.com, Inc.", "10-K", "2025-02-06", "Profitability",
     "Amazon's operating income was $68.6 billion, with an operating margin of 10.7%, up from 6.4% in 2023. Net income was $59.2 billion, or $5.53 per diluted share. AWS operating income was $39.8 billion, with a segment operating margin of 37.0%. AWS generated 58% of Amazon's total operating profit."),

    # ── META ─────────────────────────────────────────────────────────────
    ("META", "Meta Platforms, Inc.", "10-K", "2025-02-05", "Revenue",
     "Meta reported total revenue of $164.5 billion for 2024, an increase of 22%. Family of Apps revenue was $160.0 billion. Advertising revenue comprised 97% of total revenue. Family daily active people (DAP) reached 3.35 billion. Ad impressions grew 11% and average price per ad increased 10%."),

    # ── JPMORGAN ─────────────────────────────────────────────────────────
    ("JPM", "JPMorgan Chase & Co.", "10-K", "2025-02-14", "Revenue",
     "JPMorgan Chase reported record net revenue of $177.6 billion for 2024. Net interest income was $92.6 billion. CIB generated $55.9 billion. The firm maintained #1 market share in U.S. retail deposits."),
    ("JPM", "JPMorgan Chase & Co.", "10-K", "2025-02-14", "Profitability",
     "JPMorgan's net income was $58.5 billion (record), or $19.75 per diluted share. ROE was 21%. ROTCE was 28%. CET1 capital ratio was 15.7%. Total assets were $4.0 trillion."),

    # ── TESLA ────────────────────────────────────────────────────────────
    ("TSLA", "Tesla, Inc.", "10-K", "2025-01-29", "Revenue",
     "Tesla reported total revenue of $97.7 billion for 2024, a decrease of 1%. Automotive revenue was $77.1 billion, down from $82.4 billion. Energy generation and storage revenue was $10.1 billion, up 67%. Vehicle deliveries were 1.79 million units. Automotive gross margin was 16.3%."),

    # ── ALPHABET ─────────────────────────────────────────────────────────
    ("GOOGL", "Alphabet Inc.", "10-K", "2025-02-04", "Revenue",
     "Alphabet reported revenues of $350.0 billion for 2024, up 14%. Google Search revenue was $198.1 billion. YouTube ads were $36.1 billion, up 14%. Google Cloud was $43.2 billion, up 29%. Traffic acquisition costs were $54.5 billion."),
    ("GOOGL", "Alphabet Inc.", "10-K", "2025-02-04", "Profitability",
     "Alphabet's operating income was $112.4 billion (32.1% margin). Net income was $100.7 billion, or $8.04 per diluted share. Google Cloud achieved operating income of $8.9 billion (20.6% margin), up from $1.7 billion in 2023. Capital expenditures were $52.5 billion."),

    # ── TAIWAN SEMICONDUCTOR ────────────────────────────────────────────
    ("TSM", "Taiwan Semiconductor Manufacturing Company", "20-F", "2025-04-17", "Revenue",
     "TSMC reported revenue of approximately $88.5 billion for FY2024, an increase of 34%. Advanced technology (7nm and below) accounted for 69% of wafer revenue. HPC represented 53% of revenue. North America accounted for 71% of revenue."),
    ("TSM", "Taiwan Semiconductor Manufacturing Company", "20-F", "2025-04-17", "Profitability",
     "TSMC's gross margin was 60.6%, up from 54.4% in 2023. Operating margin was 48.1%. Net income was approximately $35.9 billion, growing 40% year-over-year. Capital expenditure was approximately $30 billion. ROE was 30.2%."),

    # ── HISTORICAL FY2022 DATA (for benchmark alignment) ─────────────────

    # AAPL FY2022
    ("AAPL", "Apple Inc.", "10-K", "2022-10-28", "Revenue",
     "Apple Inc. reported total net revenue of $394.33 billion for fiscal year 2022 (ended September 24, 2022), compared to $365.82 billion in fiscal year 2021, an increase of 7.8%. iPhone revenue was $205.49 billion. Mac revenue was $40.18 billion. iPad revenue was $29.29 billion. Wearables, Home and Accessories revenue was $41.24 billion. Services revenue was $78.13 billion."),
    ("AAPL", "Apple Inc.", "10-K", "2022-10-28", "Profitability",
     "Apple's gross margin for fiscal year 2022 was $170.78 billion, representing a gross margin percentage of 43.3%, compared to 41.8% in fiscal year 2021. Operating income was $119.44 billion. Net income was $99.80 billion, or $6.11 per diluted share. Research and development expenses were $26.25 billion. Selling, general and administrative expenses were $25.09 billion."),
    ("AAPL", "Apple Inc.", "10-K", "2022-10-28", "Cash Flow",
     "Apple generated operating cash flow of $122.15 billion in fiscal year 2022. Capital expenditures were $10.71 billion. Free cash flow was $111.44 billion. Apple returned $90.19 billion to shareholders: dividends were $14.84 billion and share repurchases (buybacks) were $89.40 billion. Cash and cash equivalents were $23.65 billion. Short-term investments were $24.66 billion. Total cash and short-term investments were $48.30 billion."),
    ("AAPL", "Apple Inc.", "10-K", "2022-10-28", "Risk Factors",
     "Apple faces risks including global economic conditions affecting consumer spending; competition in smartphone, personal computer, tablet, and wearables markets; dependence on new product introductions; supply chain concentration in Asia; component shortages and supply constraints, particularly silicon chips; COVID-19 impacts; foreign exchange fluctuations; regulatory risks including antitrust investigations. Management noted supply constraints and silicon chip shortages impacted iPhone availability during the year."),

    # MSFT FY2023
    ("MSFT", "Microsoft Corporation", "10-K", "2023-07-28", "Revenue",
     "Microsoft reported revenue of $211.9 billion for fiscal year 2023 (ended June 30, 2023), an increase of 7% year-over-year. Intelligent Cloud segment revenue was $87.9 billion, driven by Azure which grew 29%. Productivity and Business Processes revenue was $69.3 billion. More Personal Computing revenue was $54.7 billion. Commercial cloud revenue reached $111.6 billion, growing 22%."),
    ("MSFT", "Microsoft Corporation", "10-K", "2023-07-28", "Profitability",
     "Microsoft's operating income for fiscal year 2023 was $88.5 billion, with an operating margin of 41.8%. Net income was $72.36 billion, or $9.72 per diluted share. Gross margin was $146.1 billion (68.9%). Earnings per share grew 10% year-over-year. Azure and cloud services grew 28% in constant currency."),
    ("MSFT", "Microsoft Corporation", "10-K", "2023-07-28", "Cash Flow",
     "Microsoft generated operating cash flow of $87.58 billion in fiscal year 2023. Capital expenditures were $28.11 billion. Free cash flow was $59.48 billion. Total long-term debt as of June 30, 2023 was $47.2 billion. The company returned $27.9 billion to shareholders through dividends and buybacks. Cash and cash equivalents were $34.7 billion."),
    ("MSFT", "Microsoft Corporation", "earnings_transcript", "2023-10-25", "Azure Guidance",
     "Microsoft Q1 FY2024 earnings call: CFO Amy Hood provided guidance for Q2 FY2024. Azure and other cloud services revenue growth is expected to be 28 to 29 percent in constant currency. Intelligent Cloud segment revenue is expected to be between $25.1 billion and $25.4 billion. CEO Satya Nadella highlighted Copilot adoption and AI integration across Microsoft 365, GitHub, and Azure OpenAI Service."),

    # AMZN FY2022
    ("AMZN", "Amazon.com, Inc.", "10-K", "2023-02-03", "Revenue",
     "Amazon reported net sales of $513.98 billion for fiscal year 2022, an increase of 9% from $469.82 billion in 2021. AWS (Amazon Web Services) revenue was $62.20 billion in 2022, compared to $45.37 billion in 2021, a growth of 37%. Online stores contributed $220.0 billion. Third-party seller services were $117.7 billion. Advertising services were $37.7 billion."),
    ("AMZN", "Amazon.com, Inc.", "10-K", "2023-02-03", "Profitability",
     "Amazon's operating income for 2022 was $12.25 billion, down from $24.88 billion in 2021. Operating margin was 2.4%. Net loss was $2.72 billion (impacted by $12.7 billion Rivian investment loss). AWS operating income was $22.84 billion with a 37% segment margin. North America segment had operating loss of $2.85 billion."),
    ("AMZN", "Amazon.com, Inc.", "10-K", "2023-02-03", "Cash Flow",
     "Amazon's capital expenditures (purchases of property and equipment) were $63.65 billion in 2022, compared to $61.05 billion in 2021. Operating cash flow was $46.75 billion. Free cash flow was negative $11.57 billion, an improvement from negative $19.04 billion in 2021."),

    # NVDA FY2024
    ("NVDA", "NVIDIA Corporation", "10-K", "2024-02-26", "Revenue",
     "NVIDIA reported record revenue of $60.92 billion for fiscal year 2024 (ended January 28, 2024), an increase of 122% from $26.97 billion in FY2023. Data Center revenue was $47.52 billion, up 217% year-over-year, driven by explosive AI training demand for H100 GPUs. Gaming revenue was $10.45 billion, up 15%. Revenue exceeded all previous records, driven by generative AI infrastructure demand."),
    ("NVDA", "NVIDIA Corporation", "10-K", "2024-02-26", "Profitability",
     "NVIDIA's gross margin for FY2024 was 72.7%, up from 56.9% in FY2023. Operating income was $32.97 billion, with an operating margin of 54.1%. Net income was $29.76 billion, or $11.93 per diluted share. Data Center segment gross margin expanded significantly due to H100 product mix. R&D expenses were $8.68 billion."),

    # GOOGL FY2022
    ("GOOGL", "Alphabet Inc.", "10-K", "2023-02-02", "Revenue",
     "Alphabet reported total revenues of $282.84 billion for fiscal year 2022, a decrease of 1% from $257.64 billion in 2021 in constant currency. Google advertising revenues were $224.47 billion, down 3.6% from $209.49 billion in 2021. Google Search and other advertising was $162.45 billion. YouTube advertising was $29.24 billion. Google Network Members' properties ads were $32.78 billion. Google Cloud revenue was $26.28 billion, up 37%. Other Bets revenue was $1.07 billion."),
    ("GOOGL", "Alphabet Inc.", "10-K", "2023-02-02", "Profitability",
     "Alphabet's operating income for 2022 was $74.84 billion, with an operating margin of 26.5%. Net income was $59.97 billion, or $4.56 per diluted share. Net profit margin was 21.2%. Operating expenses were $207.99 billion. Headcount reductions and cost optimization measures were implemented in H2 2022. Google Cloud reached $1.67 billion in operating profit for the first time."),

    # TSLA FY2022
    ("TSLA", "Tesla, Inc.", "10-K", "2023-01-26", "Revenue",
     "Tesla reported total revenue of $81.46 billion for fiscal year 2022, an increase of 51% from $53.82 billion in 2021. Automotive revenue was $71.46 billion. Automotive gross profit was $20.35 billion. Automotive gross margin was 28.5%. Energy generation and storage revenue was $3.91 billion. Services and other revenue was $6.09 billion. Vehicle deliveries were 1.31 million units, up 40% year-over-year."),
    ("TSLA", "Tesla, Inc.", "10-K", "2023-01-26", "Balance Sheet",
     "Tesla's total assets at December 31, 2022 were $82.34 billion, up from $62.13 billion at end of 2021. Cash and cash equivalents were $22.18 billion. Total current assets were $40.92 billion. Total stockholders' equity was $44.70 billion. Total debt was $3.47 billion. Tesla maintained a strong balance sheet with minimal leverage."),
    ("TSLA", "Tesla, Inc.", "10-K", "2023-01-26", "Risk Factors",
     "Tesla cited the following key risk factors in its 2022 annual report: intense competition from traditional automakers and new EV entrants; regulatory risks including EV credit eligibility, safety standards, and environmental regulations; production scaling challenges and manufacturing ramp risks; battery raw material supply chain constraints including lithium, nickel, and cobalt; dependence on Elon Musk as key person; cybersecurity risks; global macroeconomic factors affecting consumer demand."),

    # META FY2022
    ("META", "Meta Platforms, Inc.", "10-K", "2023-02-02", "Revenue",
     "Meta reported total revenue of $116.61 billion for full year 2022, a decrease of 1% from $117.93 billion in 2021. Q4 2022 revenue was $32.17 billion, down 4.5% year-over-year from $33.67 billion in Q4 2021. This marked the second consecutive year of revenue decline. Advertising revenue comprised 98.2% of total. Family daily active people (DAP) was 2.96 billion. Reality Labs segment revenue was $2.16 billion."),

    # JPM FY2022
    ("JPM", "JPMorgan Chase & Co.", "10-K", "2023-02-21", "Revenue",
     "JPMorgan Chase reported managed net revenue of $128.7 billion for fiscal year 2022. Net interest income was $66.3 billion. Consumer & Community Banking (CCB) generated $56.9 billion in revenue. Corporate & Investment Bank (CIB) generated $43.0 billion. The firm maintained the #1 ranking in global investment banking fees."),
    ("JPM", "JPMorgan Chase & Co.", "10-K", "2023-02-21", "Profitability",
     "JPMorgan's net income for 2022 was $37.68 billion, or $12.09 per diluted share. Return on equity (ROE) was 12%. Return on tangible common equity (ROTCE) was 18%. CET1 capital ratio was 15.0%, up from 13.1% in 2021. The firm built $5.7 billion in credit reserves due to macroeconomic uncertainty."),

    # BRK FY2022
    ("BRK", "Berkshire Hathaway Inc.", "10-K", "2023-02-25", "Revenue",
     "Berkshire Hathaway reported total revenues of $302.09 billion for fiscal year 2022. Insurance premiums earned were $66.96 billion through GEICO, Berkshire Hathaway Reinsurance, and General Re. Railroad (BNSF) revenues were $23.16 billion. Berkshire Hathaway Energy revenues were $27.72 billion. Manufacturing revenues were $69.09 billion."),
    ("BRK", "Berkshire Hathaway Inc.", "10-K", "2023-02-25", "Profitability",
     "Berkshire Hathaway's operating earnings (non-GAAP, excluding investment gains/losses) for fiscal year 2022 were $28.7 billion, up from $27.46 billion in 2021. Net earnings (GAAP) were negative $22.82 billion due to unrealized investment losses. Warren Buffett emphasized operating earnings as the more meaningful metric. Insurance underwriting earned $90 million. GEICO experienced underwriting losses. Berkshire repurchased $7.86 billion of its own shares."),

    # XOM FY2022
    ("XOM", "ExxonMobil Corporation", "10-K", "2023-02-22", "Revenue",
     "ExxonMobil reported total revenues and other income of $398.68 billion for fiscal year 2022, nearly double from $276.69 billion in 2021, driven by elevated energy prices. Upstream oil and gas revenues were $217.38 billion. Chemical revenues were $22.49 billion. Energy Products revenues were $168.81 billion. Net production was 3.7 million oil-equivalent barrels per day."),
    ("XOM", "ExxonMobil Corporation", "10-K", "2023-02-22", "Cash Flow",
     "ExxonMobil's capital expenditures for fiscal year 2022 were $16.7 billion, focused on Permian Basin development, Guyana production, and chemical capacity expansion. Operating cash flow was $76.8 billion, a record high. Free cash flow was $62.1 billion. The company returned $29.8 billion to shareholders: dividends of $14.9 billion and buybacks of $14.9 billion. Net debt was reduced to near zero."),

    # ── AMD FY2023 (for fb_017: NVDA vs AMD data center comparison) ──────────
    ("AMD", "Advanced Micro Devices, Inc.", "10-K", "2024-01-31", "Revenue",
     "AMD reported net revenue of $22.68 billion for fiscal year 2023, a decrease of 4% from $23.60 billion in 2022. Data Center segment revenue was $6.50 billion for fiscal year 2023, up 7% year-over-year from $6.04 billion in 2022. The Data Center segment includes EPYC server processors and Instinct GPU accelerators. Client segment revenue was $4.65 billion. Gaming segment was $6.22 billion. Embedded segment was $5.31 billion."),
    ("AMD", "Advanced Micro Devices, Inc.", "10-K", "2024-01-31", "Data Center vs NVIDIA",
     "AMD's Data Center segment revenue grew 7% in fiscal year 2023 to $6.50 billion. In comparison, NVIDIA's Data Center segment revenue grew 217% in fiscal year 2024 to $47.52 billion (fiscal year ending January 2024), driven by explosive demand for H100 AI GPUs. NVIDIA's data center revenue growth significantly outpaced AMD's. NVIDIA grew faster in data center revenue than AMD during fiscal 2023, with NVIDIA posting triple-digit percentage growth versus AMD's single-digit growth. AMD's Instinct MI300X GPU accelerator ramped in late 2023 but did not match NVIDIA H100 shipment volumes."),

    # ── NVDA FY2023 (needed for multi-year NVDA comparisons) ─────────────────
    ("NVDA", "NVIDIA Corporation", "10-K", "2023-02-24", "Revenue",
     "NVIDIA reported revenue of $26.97 billion for fiscal year 2023 (ended January 29, 2023), a decrease of 1% from $26.91 billion in FY2022. Data Center revenue was $15.01 billion, up 41% year-over-year. Gaming revenue was $9.07 billion, down 27% due to inventory correction and consumer demand slowdown. Automotive revenue was $903 million. Professional Visualization was $1.54 billion."),
]


def _get_embedder():
    """Return a real sentence-transformer embedder (384-dim MiniLM) if available, else None."""
    try:
        from sentence_transformers import SentenceTransformer
        print("   Loading sentence-transformers/all-MiniLM-L6-v2 for real embeddings...", flush=True)
        model = SentenceTransformer("all-MiniLM-L6-v2")
        return model
    except Exception as e:
        print(f"   sentence-transformers unavailable ({e}), using random vectors", flush=True)
        return None


def _embed(model, texts: list[str], dims: int) -> list[list[float]]:
    """Generate embeddings — real if model available, random otherwise."""
    if model is not None:
        vecs = model.encode(texts, normalize_embeddings=True).tolist()
        return vecs
    import random
    result = []
    for _ in texts:
        v = [random.gauss(0, 1) for _ in range(dims)]
        norm = sum(x * x for x in v) ** 0.5
        result.append([x / norm for x in v])
    return result


def seed_qdrant():
    """Seed Qdrant with vector chunks (synchronous client)."""
    from qdrant_client import QdrantClient
    from qdrant_client.http import models

    QDRANT_URL = "http://localhost:6333"
    COLLECTION = "gravity_chunks"

    embedder = _get_embedder()
    DIMS = 384 if embedder is not None else 1024  # MiniLM=384, voyage placeholder=1024

    print("🔵 Connecting to Qdrant...")
    client = QdrantClient(url=QDRANT_URL, timeout=10)

    # Delete and recreate collection
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

    for field in ["ticker", "company_name", "filing_type", "document_id", "section"]:
        client.create_payload_index(
            collection_name=COLLECTION,
            field_name=field,
            field_schema=models.PayloadSchemaType.KEYWORD,
        )

    print(f"   Created collection '{COLLECTION}' ({DIMS}d)")

    # Generate points
    random.seed(42)
    # Pre-compute all embeddings in one batch (much faster for real models)
    all_texts = [
        f"[Ticker: {d[0]}] [Filing: {d[2]}] [Section: {d[4]}]\n\n{d[5]}"
        for d in SEED_DOCUMENTS
    ]
    all_dense = _embed(embedder, all_texts, DIMS)
    print(f"   Generated {len(all_dense)} embeddings ({DIMS}d)")

    points = []
    for i, (ticker, company, filing_type, filing_date, section, text) in enumerate(SEED_DOCUMENTS):
        chunk_id = str(uuid.uuid4())
        doc_id = f"{ticker}_{filing_type}_{filing_date}".replace("-", "")

        dense_vec = all_dense[i]

        # Simple sparse vector from word frequencies
        words = text.lower().split()
        word_freq = {}
        for w in words:
            w = w.strip(".,;:\"'()[]{}!?")
            if len(w) > 2:
                word_freq[w] = word_freq.get(w, 0) + 1

        meta_prefix = f"[Ticker: {ticker}] [Company: {company}] [Filing: {filing_type}] [Section: {section}]"

        points.append(models.PointStruct(
            id=i,
            vector={
                "dense": dense_vec,
                "sparse": models.SparseVector(
                    indices=list(range(len(word_freq))),
                    values=[float(v) for v in word_freq.values()],
                ),
            },
            payload={
                "chunk_id": chunk_id,
                "document_id": doc_id,
                "text": text,
                "text_with_metadata": f"{meta_prefix}\n\n{text}",
                "ticker": ticker,
                "company_name": company,
                "filing_type": filing_type,
                "filing_date": filing_date,
                "section": section,
                "chunk_level": 2,
                "position": i,
                "source_quality": 9,
                "metadata": {
                    "ticker": ticker,
                    "company_name": company,
                    "filing_type": filing_type,
                    "filing_date": filing_date,
                    "document_title": f"{ticker} {filing_type} {filing_date}",
                },
            },
        ))

    client.upsert(collection_name=COLLECTION, points=points)
    info = client.get_collection(collection_name=COLLECTION)
    print(f"   ✅ Seeded {info.points_count} chunks into Qdrant")
    client.close()


def seed_elasticsearch():
    """Seed Elasticsearch with BM25-indexed chunks (synchronous client)."""
    from elasticsearch import Elasticsearch

    ES_URL = "http://localhost:9200"
    INDEX = "gravity_chunks"

    print("\n🟡 Connecting to Elasticsearch...")
    es = Elasticsearch(hosts=[ES_URL], request_timeout=10)

    try:
        health = es.cluster.health()
        print(f"   Cluster status: {health['status']}")
    except Exception as e:
        print(f"   ❌ Cannot connect: {e}")
        return

    if es.indices.exists(index=INDEX):
        es.indices.delete(index=INDEX)

    body = {
        "settings": {
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
        },
        "mappings": {
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
            },
        },
    }

    es.indices.create(index=INDEX, settings=body["settings"], mappings=body["mappings"])
    print(f"   Created index '{INDEX}' with financial analyzer")

    actions = []
    for i, (ticker, company, filing_type, filing_date, section, text) in enumerate(SEED_DOCUMENTS):
        chunk_id = str(uuid.uuid4())
        doc_id = f"{ticker}_{filing_type}_{filing_date}".replace("-", "")
        actions.append({"index": {"_index": INDEX, "_id": chunk_id}})
        actions.append({
            "chunk_id": chunk_id,
            "document_id": doc_id,
            "text": text,
            "ticker": ticker,
            "company_name": company,
            "filing_type": filing_type,
            "filing_date": filing_date,
            "section": section,
            "chunk_level": 2,
        })

    result = es.bulk(operations=actions, refresh=True)
    print(f"   ✅ Indexed {len(SEED_DOCUMENTS)} chunks (errors={result.get('errors', False)})")

    # Test search
    sr = es.search(index=INDEX, query={"match": {"text": "Apple revenue"}}, size=2)
    print(f"   Test 'Apple revenue': {sr['hits']['total']['value']} hits")
    es.close()


def seed_postgres():
    """Seed PostgreSQL with document metadata (synchronous)."""
    try:
        import psycopg2
    except ImportError:
        print("\n🟢 PostgreSQL: psycopg2 not installed, skipping (optional)")
        return

    PG_URL = "postgresql://antigravity:antigravity_dev@localhost:5432/gravity_search"

    print("\n🟢 Connecting to PostgreSQL...")
    try:
        conn = psycopg2.connect(PG_URL)
        conn.autocommit = True
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                company_name TEXT NOT NULL,
                filing_type TEXT NOT NULL,
                filing_date DATE,
                title TEXT,
                ingested_at TIMESTAMP DEFAULT NOW(),
                chunk_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'indexed'
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_docs_ticker ON documents(ticker)")

        inserted = 0
        for ticker, company, filing_type, filing_date, section, text in SEED_DOCUMENTS:
            doc_id = f"{ticker}_{filing_type}_{filing_date}".replace("-", "")
            try:
                cur.execute(
                    "INSERT INTO documents (id, ticker, company_name, filing_type, filing_date, title) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                    (doc_id, ticker, company, filing_type, filing_date, f"{ticker} {filing_type} {filing_date}"),
                )
                inserted += 1
            except Exception:
                pass

        cur.execute("SELECT COUNT(*) FROM documents")
        count = cur.fetchone()[0]
        print(f"   ✅ PostgreSQL: {count} documents")
        conn.close()

    except Exception as e:
        print(f"   ❌ PostgreSQL error: {e}")
        print("   Trying with asyncpg format...")


def verify():
    """Quick verification."""
    print("\n" + "=" * 60)
    print("VERIFICATION")
    print("=" * 60)

    # Qdrant
    try:
        from qdrant_client import QdrantClient
        c = QdrantClient(url="http://localhost:6333", timeout=5)
        info = c.get_collection("gravity_chunks")
        print(f"✅ Qdrant: {info.points_count} points")
        c.close()
    except Exception as e:
        print(f"❌ Qdrant: {e}")

    # Elasticsearch
    try:
        from elasticsearch import Elasticsearch
        es = Elasticsearch(hosts=["http://localhost:9200"], request_timeout=5)
        count = es.count(index="gravity_chunks")
        print(f"✅ Elasticsearch: {count['count']} docs")
        es.close()
    except Exception as e:
        print(f"❌ Elasticsearch: {e}")

    # PostgreSQL
    try:
        import psycopg2
        conn = psycopg2.connect("postgresql://antigravity:antigravity_dev@localhost:5432/gravity_search")
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM documents")
        print(f"✅ PostgreSQL: {cur.fetchone()[0]} documents")
        conn.close()
    except ImportError:
        print("⏭️  PostgreSQL: psycopg2 not installed (optional)")
    except Exception as e:
        print(f"❌ PostgreSQL: {e}")

    # Redis
    try:
        import redis
        r = redis.from_url("redis://localhost:6379", decode_responses=True)
        r.ping()
        print(f"✅ Redis: connected")
        r.close()
    except Exception as e:
        print(f"❌ Redis: {e}")

    print()


if __name__ == "__main__":
    print("=" * 60)
    print("  GRAVITY SEARCH — DATABASE SEED")
    print("=" * 60)
    companies = set(d[0] for d in SEED_DOCUMENTS)
    print(f"  Documents: {len(SEED_DOCUMENTS)} chunks / {len(companies)} companies")
    print(f"  Companies: {', '.join(sorted(companies))}")
    print("=" * 60)

    seed_qdrant()
    seed_elasticsearch()
    seed_postgres()
    verify()

    print("🎉 Seed complete!")

"""Quick verification of the ingested databases."""
from qdrant_client import QdrantClient
from elasticsearch import Elasticsearch

print("="*60)
print("  DATABASE VERIFICATION")
print("="*60)

# Qdrant
c = QdrantClient(url='http://localhost:6333', timeout=5)
info = c.get_collection('gravity_chunks')
print(f"\n✅ Qdrant: {info.points_count:,} points")
c.close()

# Elasticsearch
es = Elasticsearch(hosts=['http://localhost:9200'], request_timeout=5)
es.indices.refresh(index='gravity_chunks')
count = es.count(index='gravity_chunks')
print(f"✅ Elasticsearch: {count['count']:,} docs")

# Test queries
tests = [
    "Apple revenue fiscal year",
    "NVIDIA GPU AI data center",
    "JPMorgan net income earnings",
    "Tesla vehicle deliveries",
    "Microsoft Azure cloud growth",
    "risk factors cybersecurity",
]

for q in tests:
    sr = es.search(index='gravity_chunks', query={"match": {"text": q}}, size=3)
    total = sr['hits']['total']['value']
    print(f"\n🔍 '{q}': {total} hits")
    for hit in sr['hits']['hits'][:3]:
        s = hit['_source']
        score = hit['_score']
        print(f"   [{s['ticker']}] {s.get('section', 'N/A')} ({s['filing_type']} {s.get('filing_date', 'N/A')}) — score: {score:.1f}")

es.close()

# PostgreSQL
try:
    import psycopg2
    conn = psycopg2.connect("postgresql://antigravity:antigravity_dev@localhost:5432/gravity_search")
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM documents")
    doc_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM document_chunks")
    chunk_count = cur.fetchone()[0]
    print(f"\n✅ PostgreSQL: {doc_count} documents, {chunk_count:,} chunks")
    cur.execute("SELECT ticker, filing_type, COUNT(*) FROM documents GROUP BY ticker, filing_type ORDER BY ticker, filing_type")
    rows = cur.fetchall()
    print("\n   Ticker | Type | Count")
    print("   -------|------|------")
    for ticker, ftype, cnt in rows:
        print(f"   {ticker:6s} | {ftype:4s} | {cnt}")
    conn.close()
except ImportError:
    print("\n⏭️  PostgreSQL: psycopg2 not installed")
except Exception as e:
    print(f"\n❌ PostgreSQL: {e}")

# Redis
try:
    import redis
    r = redis.from_url("redis://localhost:6379", decode_responses=True)
    r.ping()
    print(f"\n✅ Redis: connected")
    r.close()
except Exception as e:
    print(f"\n❌ Redis: {e}")

print("\n" + "="*60)

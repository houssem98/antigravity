"""
Gravity Search — Cypher Query Templates for the Nexus Knowledge Graph
All Neo4j Cypher queries are centralized here for maintainability.
Use MERGE for idempotency — safe to run multiple times without duplicates.
"""

# ── Node Upsert Queries ─────────────────────────────────────────────────────

UPSERT_COMPANY = """
MERGE (c:Company {ticker: $ticker})
SET c.name = $name,
    c.sector = $sector,
    c.industry = $industry,
    c.country = $country,
    c.market_cap = $market_cap,
    c.updated_at = datetime()
RETURN c.ticker AS ticker
"""

UPSERT_FILING = """
MERGE (f:Filing {id: $filing_id})
SET f.title = $title,
    f.filing_type = $filing_type,
    f.filing_date = date($filing_date),
    f.fiscal_year = $fiscal_year,
    f.fiscal_quarter = $fiscal_quarter,
    f.source_url = $source_url,
    f.updated_at = datetime()
WITH f
MATCH (c:Company {ticker: $ticker})
MERGE (c)-[:FILED]->(f)
RETURN f.id AS id
"""

UPSERT_PERSON = """
MERGE (p:Person {name: $name})
SET p.title = $title,
    p.updated_at = datetime()
RETURN p.name AS name
"""

UPSERT_THEME = """
MERGE (t:Theme {name: $theme})
ON CREATE SET t.frequency = 1
ON MATCH SET t.frequency = t.frequency + 1
RETURN t.name AS name
"""

UPSERT_EVENT = """
MERGE (e:Event {id: $event_id})
SET e.name = $name,
    e.event_type = $event_type,
    e.event_date = date($event_date),
    e.updated_at = datetime()
RETURN e.id AS id
"""

# ── Relationship Queries ────────────────────────────────────────────────────

LINK_PERSON_TO_COMPANY = """
MATCH (p:Person {name: $person_name})
MATCH (c:Company {ticker: $ticker})
MERGE (p)-[r:EXECUTIVE_AT]->(c)
SET r.title = $title, r.updated_at = datetime()
"""

LINK_THEME_TO_FILING = """
MATCH (t:Theme {name: $theme})
MATCH (f:Filing {id: $filing_id})
MERGE (t)-[:MENTIONED_IN]->(f)
"""

LINK_EVENT_TO_COMPANY = """
MATCH (e:Event {id: $event_id})
MATCH (c:Company {ticker: $ticker})
MERGE (c)-[:HOSTED]->(e)
"""

LINK_COMPANIES_SUPPLY_CHAIN = """
MATCH (supplier:Company {ticker: $supplier_ticker})
MATCH (customer:Company {ticker: $customer_ticker})
MERGE (supplier)-[r:SUPPLIES_TO]->(customer)
SET r.updated_at = datetime()
"""

# ── Retrieval / Read Queries ────────────────────────────────────────────────

GET_COMPANY_FULL = """
MATCH (c:Company {ticker: $ticker})
OPTIONAL MATCH (c)-[:FILED]->(f:Filing)
OPTIONAL MATCH (p:Person)-[:EXECUTIVE_AT]->(c)
RETURN c,
       collect(DISTINCT f {.id, .title, .filing_type, .filing_date}) AS filings,
       collect(DISTINCT p {.name, .title}) AS executives
"""

GET_COMPANY_FILINGS = """
MATCH (c:Company {ticker: $ticker})-[:FILED]->(f:Filing)
RETURN f.id AS id, f.title AS title, f.filing_type AS type, f.filing_date AS date
ORDER BY f.filing_date DESC
LIMIT $limit
"""

GET_COMPANY_SUPPLY_CHAIN = """
MATCH (c:Company {ticker: $ticker})-[:SUPPLIES_TO|SUPPLIED_BY*1..2]-(related:Company)
RETURN DISTINCT related.name AS name, related.ticker AS ticker, related.sector AS sector
LIMIT $limit
"""

GET_THEME_COMPANIES = """
MATCH (t:Theme {name: $theme})-[:MENTIONED_IN]->(f:Filing)<-[:FILED]-(c:Company)
RETURN c.name AS company, c.ticker AS ticker, f.filing_type AS type,
       f.filing_date AS date, f.id AS filing_id
ORDER BY f.filing_date DESC
LIMIT $limit
"""

GET_COMPANY_EXECUTIVES = """
MATCH (p:Person)-[r:EXECUTIVE_AT]->(c:Company {ticker: $ticker})
RETURN p.name AS name, r.title AS title
"""

SEARCH_COMPANIES_BY_NAME = """
MATCH (c:Company)
WHERE toLower(c.name) CONTAINS toLower($query)
   OR toLower(c.ticker) CONTAINS toLower($query)
RETURN c.ticker AS ticker, c.name AS name, c.sector AS sector,
       c.industry AS industry, c.market_cap AS market_cap
ORDER BY c.market_cap DESC
LIMIT $limit
"""

GET_ENTITY_RELATIONSHIPS = """
MATCH p=(start)-[*1..$depth]-(end)
WHERE (start.ticker = $entity_id OR start.name = $entity_id)
  AND start <> end
RETURN start.ticker AS src_ticker, start.name AS src_name,
       end.ticker AS tgt_ticker, end.name AS tgt_name,
       [r IN relationships(p) | type(r)] AS rel_path,
       length(p) AS hops
ORDER BY hops
LIMIT $limit
"""

# ── Financial Metric Queries ────────────────────────────────────────────────

UPSERT_FINANCIAL_METRIC = """
MERGE (m:FinancialMetric {id: $metric_id})
SET m.metric = $metric,
    m.value = $value,
    m.currency = $currency,
    m.unit = $unit,
    m.period = $period,
    m.updated_at = datetime()
RETURN m.id AS id
"""

LINK_METRIC_TO_COMPANY = """
MATCH (m:FinancialMetric {id: $metric_id})
MATCH (c:Company {ticker: $ticker})
MERGE (c)-[:REPORTED]->(m)
"""

LINK_METRIC_TO_FILING = """
MATCH (m:FinancialMetric {id: $metric_id})
MATCH (f:Filing {id: $filing_id})
MERGE (m)-[:EXTRACTED_FROM]->(f)
"""

GET_COMPANY_METRICS = """
MATCH (c:Company {ticker: $ticker})-[:REPORTED]->(m:FinancialMetric)
RETURN m.metric AS metric, m.value AS value, m.currency AS currency,
       m.unit AS unit, m.period AS period, m.id AS id
ORDER BY m.period DESC
LIMIT $limit
"""

# ── Analyst Queries ─────────────────────────────────────────────────────────

UPSERT_ANALYST = """
MERGE (a:Analyst {name: $name, firm: $firm})
SET a.updated_at = datetime()
RETURN a.name AS name
"""

LINK_ANALYST_TO_COMPANY = """
MATCH (a:Analyst {name: $name, firm: $firm})
MATCH (c:Company {ticker: $ticker})
MERGE (a)-[:COVERS]->(c)
"""

GET_ANALYST_COVERAGE = """
MATCH (a:Analyst)-[:COVERS]->(c:Company {ticker: $ticker})
RETURN a.name AS analyst, a.firm AS firm
LIMIT $limit
"""

GET_COMPANY_COMPETITORS = """
MATCH (c:Company {ticker: $ticker})-[:COMPETES_WITH]-(rival:Company)
RETURN rival.name AS name, rival.ticker AS ticker, rival.sector AS sector
LIMIT $limit
"""


"""
Gravity Search - Entity & Knowledge Graph Routes
"""
from typing import Optional
import structlog
from fastapi import APIRouter, HTTPException, Query, Depends, Response
from app.db.neo4j import neo4j_driver

from app.api.middleware.auth import require_auth
from app.api.middleware.rate_limit import check_rate_limit

logger = structlog.get_logger()
router = APIRouter()


@router.get("/entities/{entity_id}")
async def get_entity(
    entity_id: str,
    response: Response,
    auth: dict = Depends(require_auth)
):
    """Get entity details from the Nexus Knowledge Graph."""
    try:
        # Rate limit check
        headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
        for k, v in headers.items():
            response.headers[k] = v

        with neo4j_driver.session() as session:
            result = session.run(
                """
                MATCH (c:Company)
                WHERE c.ticker = $id OR c.isin = $id OR c.cik = $id
                OPTIONAL MATCH (c)-[:HAS_FILING]->(f:Filing)
                WITH c, count(f) AS filing_count
                RETURN c.ticker AS ticker, c.name AS name, c.isin AS isin,
                       c.sector AS sector, c.industry AS industry,
                       c.country AS country, c.market_cap AS market_cap, filing_count
                LIMIT 1
                """,
                id=entity_id,
            )
            record = result.single()
        if not record:
            raise HTTPException(status_code=404, detail=f"Entity not found: {entity_id}")
        return {"id": entity_id, **dict(record)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("entity_lookup_error", entity_id=entity_id, error=str(e))
        raise HTTPException(status_code=500, detail="Knowledge graph query failed")


@router.get("/entities")
async def search_entities(
    response: Response,
    q: str = Query(...),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    auth: dict = Depends(require_auth)
):
    """Full-text entity search across the Knowledge Graph."""
    try:
        # Rate limit check
        headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
        for k, v in headers.items():
            response.headers[k] = v

        with neo4j_driver.session() as session:
            if entity_type == "person":
                cypher = (
                    "MATCH (p:Person) WHERE toLower(p.name) CONTAINS toLower($q) "
                    "RETURN 'person' AS type, p.name AS name, p.title AS detail, "
                    "p.company AS context, null AS ticker LIMIT $limit"
                )
            else:
                cypher = (
                    "MATCH (c:Company) WHERE toLower(c.name) CONTAINS toLower($q) "
                    "OR toLower(c.ticker) CONTAINS toLower($q) "
                    "RETURN 'company' AS type, c.name AS name, c.sector AS detail, "
                    "c.industry AS context, c.ticker AS ticker "
                    "ORDER BY c.market_cap DESC LIMIT $limit"
                )
            records = session.run(cypher, q=q, limit=limit).data()
        return {"query": q, "entity_type": entity_type or "company", "results": records}
    except Exception as e:
        logger.error("entity_search_error", q=q, error=str(e))
        raise HTTPException(status_code=500, detail="Entity search failed")


@router.get("/graph/traverse")
async def traverse_graph(
    response: Response,
    entity_id: str = Query(...),
    relationship: str = Query(""),
    depth: int = Query(1, ge=1, le=3),
    limit: int = Query(20, ge=1, le=100),
    auth: dict = Depends(require_auth)
):
    """Traverse Knowledge Graph relationships from a starting entity."""
    try:
        # Rate limit check
        headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
        for k, v in headers.items():
            response.headers[k] = v

        with neo4j_driver.session() as session:
            if relationship:
                cypher = (
                    f"MATCH p=(start)-[:{relationship.upper()}*1..{depth}]->(end) "
                    "WHERE start.ticker=$entity_id OR start.name=$entity_id "
                    "RETURN start.ticker AS src_ticker, start.name AS src_name, "
                    "end.ticker AS tgt_ticker, end.name AS tgt_name, "
                    "[r IN relationships(p) | type(r)] AS rel_path, length(p) AS hops LIMIT $limit"
                )
            else:
                cypher = (
                    f"MATCH p=(start)-[*1..{depth}]-(end) "
                    "WHERE (start.ticker=$entity_id OR start.name=$entity_id) AND start<>end "
                    "RETURN start.ticker AS src_ticker, start.name AS src_name, "
                    "end.ticker AS tgt_ticker, end.name AS tgt_name, "
                    "[r IN relationships(p) | type(r)] AS rel_path, length(p) AS hops "
                    "ORDER BY hops LIMIT $limit"
                )
            records = session.run(cypher, entity_id=entity_id, limit=limit).data()
        return {
            "entity_id": entity_id, "relationship": relationship or "ALL",
            "depth": depth, "nodes_found": len(records),
            "edges": [
                {"source": {"ticker": r["src_ticker"], "name": r["src_name"]},
                 "target": {"ticker": r["tgt_ticker"], "name": r["tgt_name"]},
                 "path": r["rel_path"], "hops": r["hops"]}
                for r in records
            ],
        }
    except Exception as e:
        logger.error("graph_traverse_error", entity_id=entity_id, error=str(e))
        raise HTTPException(status_code=500, detail="Graph traversal failed")

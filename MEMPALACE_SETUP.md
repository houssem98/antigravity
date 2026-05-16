# MemPalace Integration

Three-layer local-first AI memory system for gravity-api.

## Setup

### 1. Palace Initialization (Done)

```bash
mempalace init ~/.mempalace/antigravity --no-llm
```

Palace location: `~/.mempalace/antigravity`

### 2. Mine Codebase (In Progress)

**Background task started to mine antigravity/**

```bash
export MEMPALACE_PATH=~/.mempalace/antigravity
mempalace mine /path/to/antigravity --wing antigravity
mempalace mine ~/.claude/projects --mode convos --wing claude-sessions
```

This extracts code patterns, conversations, and context into searchable drawers.

### 3. Wire Gravity API Integration (Done)

`services/gravity-api/app/memory/mempalace_client.py` — async wrapper for:
- Semantic search across codebase + queries
- Store query/answer pairs for future context
- Scoped retrieval (filter by wing/room)

Usage in search pipeline:

```python
from app.memory.mempalace_client import MemPalaceClient

palace = MemPalaceClient()

# Search for RAG patterns
results = await palace.search("how does fusion work", limit=3, wing="antigravity")

# Store query for future context
await palace.store_query(
    query="What is DCF valuation?",
    answer="DCF is...",
    sources=["sec_filing_123"],
    category="finance"
)
```

### 4. MCP Server (Done)

`mcp.json` configures mempalace-mcp server for Claude Code. Enables 29 palace tools:
- `palace:search` — semantic search
- `palace:add` — store content
- `palace:split` — organize into rooms
- `palace:status` — check indexing progress

Connect in Claude Code settings:
```json
{
  "mcpServers": {
    "mempalace": {
      "command": "mempalace-mcp",
      "args": ["--palace", "~/.mempalace/antigravity"]
    }
  }
}
```

## Usage Patterns

### Conversation Memory (Runtime)

After each gravity-api search, store results:

```python
# In search_pipeline.py after answer generation
await palace.store_query(
    query=user_query,
    answer=generated_answer,
    sources=[s.id for s in sources],
    category=query_category
)
```

On next similar query, prime context:

```python
memory_hits = await palace.search(query, limit=3)
# Inject into system prompt or initial context
```

### Codebase Context (Dev)

When working on new features:

```bash
mempalace search "how does Qdrant index work"
mempalace search "what's the Neo4j schema"
```

Returns matching code snippets, comments, architecture notes.

### Session Continuity (Auto-Save)

Claude Code hook auto-saves conversations:

```bash
mempalace mine ~/.claude/projects --mode convos --wing ${PROJECT_NAME}
```

Preserves context across 30-day sessions.

## Architecture

```
Codebase + Queries
     ↓
  MemPalace Palace (~/.mempalace/antigravity)
     ├─ Wing: "antigravity" (code)
     ├─ Wing: "gravity-api" (queries)
     └─ Wing: "claude-sessions" (conversations)
          ↓ (semantic search via ChromaDB)
     [Results: text, metadata, score]
          ↓
  gravity-api (context injection)
       ↓
  Search Pipeline (LLM router)
       ↓
  User Response
```

## Status

- ✅ Palace initialized
- 🔄 Mining codebase (background task)
- ✅ gravity-api integration ready
- ✅ MCP server configured
- ⏳ First seeding with queries

## Next Steps

1. Wait for mining to complete: `mempalace status --palace ~/.mempalace/antigravity`
2. Wire `palace.search()` into search_pipeline.py context building
3. Add `palace.store_query()` hook after answer generation
4. Test with similar queries across sessions

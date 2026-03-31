# mcp-brain-tools

An MCP server that gives AI agents persistent memory with built-in freshness tracking and spaced repetition. Backed by Elasticsearch.

Unlike simple key-value memory stores, mcp-brain-tools tracks how old each piece of knowledge is, flags what needs review, and lets agents verify information to keep it fresh — inspired by how spaced repetition helps humans retain knowledge.

## Features

- **Spaced repetition freshness** — each entity has a review interval that doubles on verification (capped at 365 days). Confidence labels (fresh/normal/aging/stale/archival) tell agents what to trust.
- **Progressive search** — queries return fresh results first, automatically widening to include older data only when needed.
- **Observations as entities** — each observation gets its own freshness lifecycle, so "build is broken" (1-day review) and "founded in 2015" (365-day review) age independently.
- **Memory zones** — isolate knowledge by project, team, or domain.
- **AI-powered filtering** — optional Groq integration scores search results by relevance.
- **DRY by design** — tool descriptions guide agents not to store what's already in code, git, or docs.

## Setup

### Prerequisites

- Node.js >= 18
- Docker (for Elasticsearch) or a remote Elasticsearch instance

### Install and build

```bash
npm install
npm run build
```

### Start Elasticsearch

```bash
npm run es:start
```

Or point to your own instance via `ES_NODE` environment variable.

### Configure your MCP client

Add to your Claude Code, Claude Desktop, or other MCP client config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/mcp-brain-tools/dist/index.js"],
      "env": {
        "ES_NODE": "http://localhost:9200",
        "GROQ_API_KEY": "your-key-here"
      }
    }
  }
}
```

`GROQ_API_KEY` is optional — enables AI-powered search filtering and zone relevance scoring.

## How it works

### Entities and observations

Entities represent anything worth remembering — people, projects, decisions, facts. Each entity has:

- A **name** and **type**
- **Spaced repetition fields**: `verifiedAt`, `reviewInterval`, `nextReviewAt`
- A **confidence label** computed from freshness: `1 - (daysSinceVerified / reviewInterval)`

Observations are stored as separate entities linked via `is_observation_of` relations. Each observation has its own review cadence:

```
Entity: "iaptic-server" (type: Project, reviewInterval: 30 days)
  <- "iaptic-server: uses TypeScript" (reviewInterval: 180 days)
  <- "iaptic-server: migration in progress" (reviewInterval: 7 days)
```

### Freshness lifecycle

1. **Entity created** — `confidence: "fresh"`, default review in 7 days
2. **Review date passes** — `confidence: "aging"`, `needsReview: true`
3. **Agent verifies** (via `verify_entity`) — interval doubles, confidence resets to fresh
4. **Long overdue** — `confidence: "stale"` then `"archival"`, excluded from default search

### Progressive search

When searching, the server uses three passes:

1. `freshness >= 0` — fresh and normal entities
2. `freshness >= -2` — adds aging and stale
3. No filter — adds archival

This keeps results clean while ensuring nothing is permanently lost.

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_entities` | Create entities with optional observations and reviewInterval |
| `update_entities` | Update existing entities |
| `delete_entities` | Delete entities (with optional cascade) |
| `add_observations` | Add observations as separate entities with own freshness |
| `verify_entity` | Confirm entity is still accurate, extend review interval |
| `search_nodes` | Search with progressive freshness filtering |
| `open_nodes` | Get specific entities by name with freshness metadata |
| `get_recent` | Get recently accessed entities |
| `create_relations` | Create relationships between entities |
| `delete_relations` | Remove relationships |
| `inspect_knowledge_graph` | AI-powered entity retrieval with tentative answers |
| `inspect_files` | AI-powered file content inspection |
| `list_zones` | List memory zones (with AI relevance scoring) |
| `create_zone` / `delete_zone` | Manage memory zones |
| `copy_entities` / `move_entities` | Transfer entities between zones |
| `merge_zones` | Merge zones with conflict resolution |
| `zone_stats` | Get entity/relation counts for a zone |
| `mark_important` | Boost entity relevance score |
| `get_time_utc` | Get current UTC time |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ES_NODE` | `http://localhost:9200` | Elasticsearch URL |
| `ES_USERNAME` | — | Elasticsearch username |
| `ES_PASSWORD` | — | Elasticsearch password |
| `GROQ_API_KEY` | — | Groq API key for AI filtering |
| `GROQ_MODELS` | `openai/gpt-oss-120b,llama-3.3-70b-versatile` | Comma-separated model list |
| `KG_INDEX_PREFIX` | `knowledge-graph` | Elasticsearch index prefix |
| `KG_DEFAULT_ZONE` | `default` | Default memory zone |
| `DEBUG` | `false` | Enable debug logging |

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode
npm run test:jest      # Run Jest tests
npm run es:start       # Start Elasticsearch
npm run es:stop        # Stop Elasticsearch
npm run es:reset       # Wipe data and restart
npm run import         # Import from JSON
npm run export         # Export to JSON
```

## License

MIT

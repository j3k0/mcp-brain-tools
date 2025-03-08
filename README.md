# Elasticsearch Knowledge Graph for MCP

A scalable knowledge graph implementation for Model Context Protocol (MCP) using Elasticsearch as the backend. This implementation is designed to replace the previous JSON file-based approach with a more scalable, performant solution.

## Key Features

- **Scalable Storage**: Elasticsearch provides distributed, scalable storage for knowledge graph entities and relations
- **Advanced Search**: Full-text search with fuzzy matching and relevancy ranking
- **Memory-like Behavior**: Tracks access patterns to prioritize recently viewed and important entities
- **Import/Export Tools**: Easy migration from existing JSON-based knowledge graphs
- **Rich Query API**: Advanced querying capabilities not possible with the previous implementation
- **Admin Tools**: Management CLI for inspecting and maintaining the knowledge graph
- **Complete CRUD Operations**: Full create, read, update, and delete capabilities for entities and relations
- **Elasticsearch Query Support**: Native support for Elasticsearch query DSL for advanced search capabilities
- **Multi-Zone Architecture**: Separate memory zones for organizing domain-specific knowledge
- **Cross-Zone Relations**: Relations between entities in different memory zones

## Architecture

The knowledge graph system consists of:

1. **Elasticsearch Cluster**: Core data store for entities and relations
2. **Knowledge Graph Library**: TypeScript interface to Elasticsearch with all core operations
3. **MCP Server**: Protocol-compliant server for AI models to interact with the knowledge graph
4. **Admin CLI**: Command-line tools for maintenance and management
5. **Import/Export Tools**: Utilities for data migration and backup
6. **Multiple Memory Zones**: Ability to partition knowledge into separate zones/indices

## Getting Started

### Prerequisites

- Node.js 18+
- Docker and Docker Compose

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mcp-servers/mcp-servers.git
   cd mcp-servers/memory
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Elasticsearch cluster:
   ```bash
   npm run es:start
   ```

4. Build the project:
   ```bash
   npm run build
   ```

### Migration from JSON

If you have an existing JSON-based knowledge graph, you can import it:

```bash
node dist/admin-cli.js init
node dist/admin-cli.js import memory.json
```

### Running the MCP Server

Start the MCP server that connects to Elasticsearch:

```bash
npm start
```

## Configuration

The system can be configured via environment variables:

- `ES_NODE`: Elasticsearch node URL (default: `http://localhost:9200`)
- `ES_USERNAME`: Elasticsearch username (if authentication is enabled)
- `ES_PASSWORD`: Elasticsearch password (if authentication is enabled)
- `MEMORY_FILE_PATH`: Path to memory JSON file (for import/export)
- `KG_DEFAULT_ZONE`: Default memory zone to use (default: `default`)
- `KG_INDEX_PREFIX`: Prefix for Elasticsearch indices (default: `knowledge-graph`)

## Admin CLI Commands

The admin CLI provides tools for managing the knowledge graph:

```bash
# Initialize Elasticsearch index
node dist/admin-cli.js init

# Import data from JSON file to a specific zone
node dist/admin-cli.js import memory.json [zone]

# Export data from a specific zone to JSON file
node dist/admin-cli.js export backup.json [zone]

# Backup all zones and relations
node dist/admin-cli.js backup full-backup.json

# Restore from a full backup
node dist/admin-cli.js restore full-backup.json [--yes]

# Show statistics about all zones or a specific zone
node dist/admin-cli.js stats [zone]

# Search the knowledge graph with optional zone parameter
node dist/admin-cli.js search "search query" [zone]

# Show details about a specific entity
node dist/admin-cli.js entity "John Smith" [zone]

# Show relations for a specific entity
node dist/admin-cli.js relations "John Smith" [zone]

# List all memory zones
node dist/admin-cli.js zones list

# Add a new memory zone
node dist/admin-cli.js zones add projectX "Project X knowledge zone"

# Delete a memory zone
node dist/admin-cli.js zones delete projectX [--yes]

# Show statistics for a specific zone
node dist/admin-cli.js zones stats projectX

# Reset all zones or a specific zone
node dist/admin-cli.js reset [zone] [--yes]

# Show help
node dist/admin-cli.js help
```

## Memory Zones

The knowledge graph supports multiple memory zones to organize domain-specific knowledge. This allows you to:

1. **Partition Knowledge**: Separate data into different domains (projects, departments, etc.)
2. **Improve Query Performance**: Search within specific zones for faster and more relevant results
3. **Maintain Context**: Keep context-specific information isolated but connected

### Working with Zones

```bash
# Create a new zone
node dist/admin-cli.js zones add projectX "Project X knowledge zone"

# List all zones
node dist/admin-cli.js zones list

# Import data into a specific zone
node dist/admin-cli.js import project-data.json projectX

# Search within a specific zone
node dist/admin-cli.js search "feature" projectX
```

### Cross-Zone Relations

Entities in different zones can be related to each other. When creating a relation, you can specify the zones for both entities:

```json
{
  "type": "relation",
  "from": "Project Feature",
  "fromZone": "projectX",
  "to": "General Concept",
  "toZone": "default",
  "relationType": "implements"
}
```

### Automation Support

For scripting and automation, you can use the `--yes` or `-y` flag to skip confirmation prompts:

```bash
# Reset without confirmation
node dist/admin-cli.js reset --yes

# Delete a zone without confirmation
node dist/admin-cli.js zones delete projectX --yes

# Restore from backup without confirmation
node dist/admin-cli.js restore backup.json --yes
```

### Search Examples

The Elasticsearch-backed knowledge graph provides powerful search capabilities:

```bash
# Basic search
node dist/admin-cli.js search "cordova plugin"

# Search in a specific zone
node dist/admin-cli.js search "feature" projectX

# Fuzzy search (will find "subscription" even with typo)
node dist/admin-cli.js search "subscrption"

# Person search
node dist/admin-cli.js search "Jean"
```

Search results include:
- Relevancy scoring
- Highlighted matches showing where the terms were found
- Entity types and observation counts
- Sorted by most relevant first

## MCP Server Tools

The MCP server exposes the following tools for interacting with the knowledge graph:

### Entity Operations

| Tool | Description |
|------|-------------|
| `create_entities` | Create one or more entities in the knowledge graph |
| `update_entities` | Update properties of existing entities |
| `delete_entities` | Delete one or more entities from the knowledge graph |
| `add_observations` | Add observations to an existing entity |
| `mark_important` | Mark an entity as important or not |

### Relation Operations

| Tool | Description |
|------|-------------|
| `create_relations` | Create relations between entities |
| `delete_relations` | Delete relations between entities |

### Query Operations

| Tool | Description |
|------|-------------|
| `search_nodes` | Search for entities using Elasticsearch query capabilities |
| `open_nodes` | Get details about specific entities by name |
| `get_recent` | Get recently accessed entities |

Each tool can include an optional `memory_zone` parameter to specify which zone to operate on.

## Relevancy Ranking

The knowledge graph implements a sophisticated relevancy ranking system that considers:

1. **Text Relevance**: How well entities match the search query
2. **Recency**: Prioritizes recently accessed entities
3. **Importance**: Entities marked as important receive higher ranking
4. **Usage Frequency**: Entities accessed more frequently rank higher

This approach simulates memory-like behavior where important, recent, and frequently accessed information is prioritized.

## Benefits Over JSON Implementation

- **Scalability**: Handles millions of entities efficiently
- **Performance**: Optimized for fast queries even with large datasets
- **Rich Queries**: Advanced search capabilities like fuzzy matching and relevancy ranking
- **Resiliency**: Better handling of concurrent operations
- **Observability**: Built-in monitoring and diagnostics
- **Complete CRUD**: Full lifecycle management for entities and relations

## License

MIT

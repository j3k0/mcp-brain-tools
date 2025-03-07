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

## Architecture

The knowledge graph system consists of:

1. **Elasticsearch Cluster**: Core data store for entities and relations
2. **Knowledge Graph Library**: TypeScript interface to Elasticsearch with all core operations
3. **MCP Server**: Protocol-compliant server for AI models to interact with the knowledge graph
4. **Admin CLI**: Command-line tools for maintenance and management
5. **Import/Export Tools**: Utilities for data migration and backup

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

## Admin CLI Commands

The admin CLI provides tools for managing the knowledge graph:

```bash
# Initialize Elasticsearch index
node dist/admin-cli.js init

# Import data from JSON file
node dist/admin-cli.js import memory.json

# Export data to JSON file
node dist/admin-cli.js export backup.json

# Show statistics about the knowledge graph
node dist/admin-cli.js stats

# Search the knowledge graph with fuzzy matching and relevancy ranking
node dist/admin-cli.js search "search query"

# Show details about a specific entity
node dist/admin-cli.js entity "John Smith"

# Reset knowledge graph (delete all data)
node dist/admin-cli.js reset

# Show help
node dist/admin-cli.js help
```

### Search Examples

The Elasticsearch-backed knowledge graph provides powerful search capabilities:

```bash
# Basic search
node dist/admin-cli.js search "cordova plugin"

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

### Tool Examples

```json
// Create entities
{ 
  "entities": [
    {
      "name": "John Smith",
      "entityType": "Person",
      "observations": ["Software Engineer", "Works at Acme Corp"],
      "isImportant": true
    }
  ]
}

// Update entities
{
  "entities": [
    {
      "name": "John Smith",
      "entityType": "Engineer",
      "isImportant": false
    }
  ]
}

// Delete entities
{
  "names": ["Outdated Entity"]
}

// Create relations
{
  "relations": [
    {
      "from": "John Smith",
      "to": "Acme Corp",
      "relationType": "works at"
    }
  ]
}

// Delete relations
{
  "relations": [
    {
      "from": "John Smith",
      "to": "Previous Company",
      "relationType": "worked at"
    }
  ]
}

// Search nodes - Basic
{
  "query": "software engineer",
  "entityTypes": ["Person"],
  "sortBy": "relevance"
}
```

### Advanced Elasticsearch Query Capabilities

The `search_nodes` tool leverages Elasticsearch's powerful query capabilities. While the tool provides a simple interface for basic searches, it also fully supports Elasticsearch's query syntax for advanced usage. Here are some query approaches:

#### Text-Based Queries

The `query` parameter accepts the same text formats as Elasticsearch's Query String Query:

```json
// Multi-term search with operators
{
  "query": "software AND (java OR python) NOT intern",
  "sortBy": "relevance"
}

// Wildcard searches
{
  "query": "prog*er go*ang",
  "entityTypes": ["Person"]
}

// Fuzzy matching
{
  "query": "programer~1 arcitecture~2"
}

// Proximity searches
{
  "query": "\"machine learning\"~3"
}

// Boosting terms
{
  "query": "software^2 engineer frontend^0.5"
}
```

#### Field-Specific Searches

For targeted field searches, you can specify fields in the query:

```json
// Search in specific fields
{
  "query": "name:John AND entityType:Person",
  "sortBy": "recent"
}

// Search observations only
{
  "query": "observations:\"machine learning expert\""
}
```

#### Complex Sorting

The tool supports sophisticated sorting strategies:

```json
// Sort by recency
{
  "query": "engineer",
  "sortBy": "recent"
}

// Sort by importance
{
  "query": "engineer",
  "sortBy": "importance"
}
```

#### Elasticsearch Query DSL Support

For power users familiar with Elasticsearch, the internal implementation translates your query into Elasticsearch Query DSL, supporting:

- Multi-match queries with field boosting
- Function score queries using:
  - Recency decay functions
  - Field value factors for read count
  - Boolean filters for importance flag
- Term and terms queries for entity type filtering
- Highlighting with custom tagging

The full power of Elasticsearch's relevance scoring based on TF/IDF and BM25 algorithms is available for more complex search needs.

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

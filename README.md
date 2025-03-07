# Elasticsearch Knowledge Graph for MCP

A scalable knowledge graph implementation for Model Context Protocol (MCP) using Elasticsearch as the backend. This implementation is designed to replace the previous JSON file-based approach with a more scalable, performant solution.

## Key Features

- **Scalable Storage**: Elasticsearch provides distributed, scalable storage for knowledge graph entities and relations
- **Advanced Search**: Full-text search with fuzzy matching and relevancy ranking
- **Memory-like Behavior**: Tracks access patterns to prioritize recently viewed and important entities
- **Import/Export Tools**: Easy migration from existing JSON-based knowledge graphs
- **Rich Query API**: Advanced querying capabilities not possible with the previous implementation
- **Admin Tools**: Management CLI for inspecting and maintaining the knowledge graph

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
npm run import memory.json
```

### Running the MCP Server

Start the MCP server that connects to Elasticsearch:

```bash
npm run start
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

# Show details about a specific entity
node dist/admin-cli.js entity "John Smith"

# Reset knowledge graph (delete all data)
node dist/admin-cli.js reset
```

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

## License

MIT

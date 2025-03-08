# Knowledge Graph Migration Plan: JSON to Elasticsearch

## Project Overview
We're migrating our knowledge graph "memory" from a single JSON file to Elasticsearch to address scaling issues, improve search capabilities, and provide better relevancy algorithms.

## Architecture Components
1. **Elasticsearch Backend**: Core data store for our knowledge graph
2. **Knowledge Graph Library**: TypeScript library for ES interaction
3. **MCP Server**: Server that exposes our knowledge graph via MCP
4. **CLI Tools**: Query CLI and Admin CLI for management
5. **Docker Configuration**: Easy deployment setup

## Phase 1: Infrastructure Setup
- [x] Create Docker Compose configuration for Elasticsearch
- [x] Set up Elasticsearch with proper indexes and mappings
- [ ] Implement index lifecycle management
- [ ] Configure security settings (optional)

## Phase 2: Knowledge Graph Library Development
- [x] Define core entity and relation types
- [x] Implement entity CRUD operations
- [x] Implement relation CRUD operations
- [x] Develop search algorithms with fuzzy matching
- [x] Add relevancy scoring based on lastRead/lastWrite/importance
- [x] Create batching/bulk operations for efficiency
- [ ] Add observability and logging

## Phase 3: Migration Tooling
- [x] Develop import tool (JSON to Elasticsearch)
- [x] Create export/backup tool (Elasticsearch to JSON)
- [ ] Build validation tools to verify data consistency
- [ ] Design incremental migration strategy

## Phase 4: CLI and Server Integration
- [x] Update MCP server to use ES-based library
- [ ] Create query CLI based on ES library
- [x] Create admin CLI with management commands
- [x] Ensure backward compatibility with existing interfaces
- [x] Add new query capabilities not possible with JSON

## Phase 5: Testing and Deployment
- [x] Create unit tests for core functionality
- [ ] Develop integration tests
- [ ] Measure performance metrics
- [ ] Document deployment procedures
- [x] Create user guides for new features

## Implementation Priorities
1. **Core Infrastructure**: Docker + ES setup ✅
2. **Basic Library**: Entity/relation storage and retrieval ✅
3. **Migration Tools**: Import/export functionality ✅
4. **Enhanced Search**: Fuzzy search and relevancy ✅
5. **CLI/Server**: Updated interfaces ✅
6. **Build Stability**: Fixed TypeScript issues ✅
7. **Complete CRUD**: Added update and delete operations ✅

## Next Steps
- [x] Fix TypeScript linter errors in current implementation (Completed with relaxed TypeScript configuration)
- [x] Add complete CRUD operations (update and delete for entities and relations)
- [x] Document the new features and migration process
- [ ] Refine the type system to be more strict once we have a stable working version
- [ ] Add proper error handling
- [ ] Create a query CLI

## Multi-Zone Feature Fixes

### Critical Issues to Address
- [ ] **Cross-Zone Search Issue**: Fix search function to properly filter by zone
  - Update search implementation to add mandatory zone filters at the query level
  - Ensure zone parameter is respected in all search operations
  - Add validation to verify zone filtering is working properly

- [ ] **Entity Retrieval Zone Isolation**: Ensure entities are properly isolated by zone
  - Update getEntity to strictly enforce zone boundaries
  - Modify open_nodes to respect zone parameters and only retrieve entities from the specified zone
  - Add zone validation to confirm operations don't cross zone boundaries

- [ ] **Fix Empty Recent Results**: Update get_recent to be zone-aware
  - Modify getRecentEntities to filter by zone
  - Ensure all lastRead/lastWrite tracking respects zone boundaries
  - Add zone parameter to recency tracking functions

### Implementation Tasks
- [ ] **Update search method in KnowledgeGraphClient**:
  ```typescript
  // Add mandatory zone filter to all entity queries
  query.bool.must.push({
    term: {
      zone: actualZone
    }
  });
  ```

- [ ] **Fix getEntity and related methods**:
  ```typescript
  // Ensure zone filtering in entity retrieval
  const response = await this.client.search({
    index: indexName,
    body: {
      query: {
        bool: {
          must: [
            { term: { name: name } },
            { term: { zone: actualZone } }
          ]
        }
      }
    }
  });
  ```

- [ ] **Update getRecentEntities method**:
  ```typescript
  // Add zone filtering to recent entities query
  const response = await this.client.search({
    index: indexName,
    body: {
      query: {
        bool: {
          must: [
            { term: { type: 'entity' } },
            { term: { zone: actualZone } }
          ]
        }
      },
      sort: [
        { lastRead: { order: 'desc' } }
      ],
      size: limit
    }
  });
  ```

- [ ] **Create comprehensive test suite for zone functionality**:
  - Test zone isolation for entity creation and retrieval
  - Test zone-specific search operations
  - Test cross-zone relations
  - Test zone filtering in get_recent operations

- [ ] **Review and update all client-facing API endpoints**:
  - Ensure all MCP tools properly handle the zone parameter
  - Add validation to ensure zone parameters are properly used
  - Add warning logs when operations might cross zone boundaries

### Validation Plan
- [ ] Create test script to verify zone isolation
- [ ] Add test cases for all reported issues
- [ ] Implement automated tests for zone boundary enforcement
- [ ] Document zone behavior clearly

## Future Enhancements
- Real-time analytics dashboard
- Enhanced visualization capabilities
- Multi-tenant support
- Advanced security features
- Auto-clustering of related entities 
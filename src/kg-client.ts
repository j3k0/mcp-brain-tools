// WARNING: no console.log in this file, it will break MCP server. Use console.error instead

import { Client } from '@elastic/elasticsearch';
import {
  KG_INDEX_CONFIG,
  KG_INDEX_PREFIX,
  KG_RELATIONS_INDEX,
  KG_METADATA_INDEX,
  getIndexName,
  ESEntity,
  ESRelation,
  ESHighlightResponse,
  ESSearchParams,
  ESSearchResponse
} from './es-types.js';

// Zone metadata document structure
interface ZoneMetadata {
  name: string;
  description?: string;
  createdAt: string;
  lastModified: string;
  config?: Record<string, any>;
}

/**
 * Knowledge Graph Client
 * 
 * Core library for interacting with the Elasticsearch-backed knowledge graph
 */
export class KnowledgeGraphClient {
  private client: Client;
  private initialized: boolean = false;
  private defaultZone: string;
  
  // Cache of initialized indices to avoid repeated checks
  private initializedIndices: Set<string> = new Set();

  /**
   * Create a new KnowledgeGraphClient
   * @param options Connection options
   */
  constructor(private options: { 
    node: string;
    auth?: { username: string; password: string };
    defaultZone?: string;
  }) {
    this.client = new Client({
      node: options.node,
      auth: options.auth,
    });
    this.defaultZone = options.defaultZone || 'default';
  }

  private getIndexForZone(zone?: string): string {
    return getIndexName(zone || this.defaultZone);
  }

  /**
   * Initialize the knowledge graph (create index if needed)
   */
  async initialize(zone?: string): Promise<void> {
    if (!this.initialized) {
      this.client = new Client({
        node: this.options.node,
        auth: this.options.auth,
      });
      this.initialized = true;
      
      // Initialize the metadata index if it doesn't exist yet
      const metadataIndexExists = await this.client.indices.exists({ 
        index: KG_METADATA_INDEX 
      });
      
      if (!metadataIndexExists) {
        await this.client.indices.create({
          index: KG_METADATA_INDEX,
          mappings: {
            properties: {
              name: { type: 'keyword' },
              description: { type: 'text' },
              createdAt: { type: 'date' },
              lastModified: { type: 'date' },
              config: { type: 'object', enabled: false }
            }
          }
        });
        console.error(`Created metadata index: ${KG_METADATA_INDEX}`);
        
        // Add default zone metadata
        await this.saveZoneMetadata('default', 'Default knowledge zone');
      }
      
      // Initialize the relations index if it doesn't exist yet
      const relationsIndexExists = await this.client.indices.exists({ 
        index: KG_RELATIONS_INDEX 
      });
      
      if (!relationsIndexExists) {
        await this.client.indices.create({
          index: KG_RELATIONS_INDEX,
          ...KG_INDEX_CONFIG
        });
        console.error(`Created relations index: ${KG_RELATIONS_INDEX}`);
      }
    }
    
    // Continue with zone-specific index initialization
    const indexName = this.getIndexForZone(zone);
    
    // If we've already initialized this index, skip
    if (this.initializedIndices.has(indexName)) {
      return;
    }

    const indexExists = await this.client.indices.exists({ index: indexName });
    
    if (!indexExists) {
      await this.client.indices.create({
        index: indexName,
        ...KG_INDEX_CONFIG
      });
      console.error(`Created index: ${indexName}`);
    }
    
    this.initializedIndices.add(indexName);
  }

  /**
   * Create or update an entity
   * @param entity Entity to create or update
   * @param zone Optional memory zone name, uses defaultZone if not specified
   */
  async saveEntity(
    entity: Omit<ESEntity, 'type' | 'readCount' | 'lastRead' | 'lastWrite' | 'zone'>, 
    zone?: string
  ): Promise<ESEntity> {
    // Validate entity name is not empty
    if (!entity.name || entity.name.trim() === '') {
      throw new Error('Entity name cannot be empty');
    }
    
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);

    const now = new Date().toISOString();
    const existingEntity = await this.getEntity(entity.name, actualZone);
    
    const newEntity: ESEntity = {
      type: 'entity',
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations || [],
      // If entity exists, preserve its readCount and lastRead, but update lastWrite
      readCount: existingEntity?.readCount ?? 0,
      lastRead: existingEntity?.lastRead ?? now,
      lastWrite: now,
      relevanceScore: entity.relevanceScore ?? (existingEntity?.relevanceScore ?? 1.0),
      zone: actualZone
    };

    const indexName = this.getIndexForZone(actualZone);
    await this.client.index({
      index: indexName,
      id: `entity:${entity.name}`,
      document: newEntity,
      refresh: true // Make sure it's immediately available for search
    });

    return newEntity;
  }

  /**
   * Get an entity by name without updating lastRead timestamp
   * @param name Entity name
   * @param zone Optional memory zone name, uses defaultZone if not specified
   */
  async getEntityWithoutUpdatingLastRead(name: string, zone?: string): Promise<ESEntity | null> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);

    try {
      const indexName = this.getIndexForZone(actualZone);
      const id = `entity:${name}`;
      
      // Try direct get by ID first
      try {
        const response = await this.client.get({
          index: indexName,
          id: id
        });
        
        if (response && response._source) {
          return response._source as ESEntity;
        }
      } catch (error) {
        // If not found by ID, try search
        if (error.statusCode === 404) {
          // Fall through to search
        } else {
          throw error;
        }
      }
      
      // If direct get fails, use search with explicit zone filter
      const response = await this.client.search({
        index: indexName,
        body: {
          query: {
            bool: {
              must: [
                // Use term query for exact name matching
                { term: { name: name } },
                { term: { type: 'entity' } },
                { term: { zone: actualZone } }
              ]
            }
          },
          size: 1
        }
      });
      
      const typedResponse = response as unknown as ESSearchResponse<ESEntity>;
      
      if (typedResponse.hits.total.value === 0) {
        return null;
      }
      
      return typedResponse.hits.hits[0]._source;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get an entity by name and update lastRead timestamp and readCount
   * @param name Entity name
   * @param zone Optional memory zone name, uses defaultZone if not specified
   */
  async getEntity(name: string, zone?: string): Promise<ESEntity | null> {
    const actualZone = zone || this.defaultZone;
    const entity = await this.getEntityWithoutUpdatingLastRead(name, actualZone);
    
    if (!entity) {
      return null;
    }
    
    // Update lastRead and readCount
    const now = new Date().toISOString();
    const indexName = this.getIndexForZone(actualZone);
    
    // Search for the entity by name and zone to get the _id
    const searchResponse = await this.client.search({
      index: indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { name: name } },
              { term: { type: 'entity' } },
              { term: { zone: actualZone } }
            ]
          }
        },
        size: 1
      }
    });
    
    const typedResponse = searchResponse as unknown as ESSearchResponse<ESEntity>;
    
    if (typedResponse.hits.total.value === 0) {
      // This shouldn't happen since we already found the entity
      console.error(`Entity ${name} in zone ${actualZone} not found during update`);
      return entity;
    }
    
    const docId = typedResponse.hits.hits[0]._id;
    
    await this.client.update({
      index: indexName,
      id: docId,
      doc: {
        lastRead: now,
        readCount: entity.readCount + 1
      },
      refresh: true
    });
    
    return {
      ...entity,
      lastRead: now,
      readCount: entity.readCount + 1
    };
  }

  /**
   * Delete an entity by name
   * @param name Entity name
   * @param zone Optional memory zone name, uses defaultZone if not specified
   * @param options Optional configuration options
   * @param options.cascadeRelations Whether to delete relations involving this entity (default: true)
   */
  async deleteEntity(
    name: string, 
    zone?: string,
    options?: {
      cascadeRelations?: boolean;
    }
  ): Promise<boolean> {
    // Validate entity name is not empty
    if (!name || name.trim() === '') {
      throw new Error('Entity name cannot be empty');
    }
    
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);
    
    // Default to true for cascading relation deletion
    const cascadeRelations = options?.cascadeRelations !== false;
    
    try {
      // First, check if the entity exists
      const entity = await this.getEntityWithoutUpdatingLastRead(name, actualZone);
      if (!entity) {
        return false;
      }
      
      const indexName = this.getIndexForZone(actualZone);
      
      // Delete relations involving this entity if cascading is enabled
      if (cascadeRelations) {
        console.error(`Cascading relations for entity ${name} in zone ${actualZone}`);
        
        // First, delete relations within the same zone
        await this.client.deleteByQuery({
          index: indexName,
          body: {
            query: {
              bool: {
                must: [
                  { term: { type: 'relation' } },
                  {
                    bool: {
                      should: [
                        { term: { from: name } },
                        { term: { to: name } }
                      ]
                    }
                  }
                ]
              }
            }
          },
          refresh: true
        });
        
        // Then, delete cross-zone relations where this entity is involved
        // These are stored in the KG_RELATIONS_INDEX
        await this.client.deleteByQuery({
          index: KG_RELATIONS_INDEX,
          body: {
            query: {
              bool: {
                must: [
                  {
                    bool: {
                      should: [
                        {
                          bool: {
                            must: [
                              { term: { from: name } },
                              { term: { fromZone: actualZone } }
                            ]
                          }
                        },
                        {
                          bool: {
                            must: [
                              { term: { to: name } },
                              { term: { toZone: actualZone } }
                            ]
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          },
          refresh: true
        });
      } else {
        console.error(`Skipping relation cascade for entity ${name} in zone ${actualZone}`);
      }
      
      // Delete the entity
      await this.client.delete({
        index: indexName,
        id: `entity:${name}`,
        refresh: true
      });
      
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create or update a relation between entities
   * @param relation Relation to create or update
   * @param fromZone Optional zone for the source entity, uses defaultZone if not specified
   * @param toZone Optional zone for the target entity, uses defaultZone if not specified
   * @param options Optional configuration options
   * @param options.autoCreateMissingEntities Whether to automatically create missing entities (default: true)
   */
  async saveRelation(
    relation: Omit<ESRelation, 'type' | 'fromZone' | 'toZone'>,
    fromZone?: string,
    toZone?: string,
    options?: {
      autoCreateMissingEntities?: boolean;
    }
  ): Promise<ESRelation> {
    await this.initialize();
    
    // Default to true for backwards compatibility
    const autoCreateMissingEntities = options?.autoCreateMissingEntities ?? true;
    
    const actualFromZone = fromZone || this.defaultZone;
    const actualToZone = toZone || this.defaultZone;
    
    // Check if both entities exist
    const fromEntity = await this.getEntityWithoutUpdatingLastRead(relation.from, actualFromZone);
    const toEntity = await this.getEntityWithoutUpdatingLastRead(relation.to, actualToZone);
    
    // If either entity doesn't exist
    if (!fromEntity || !toEntity) {
      // If auto-creation is disabled, throw an error
      if (!autoCreateMissingEntities) {
        const missingEntities = [];
        if (!fromEntity) {
          missingEntities.push(`'${relation.from}' in zone '${actualFromZone}'`);
        }
        if (!toEntity) {
          missingEntities.push(`'${relation.to}' in zone '${actualToZone}'`);
        }
        
        throw new Error(`Cannot create relation: Missing entities ${missingEntities.join(' and ')}`);
      }
      
      // Otherwise, auto-create the missing entities
      if (!fromEntity) {
        console.error(`Auto-creating missing entity: ${relation.from} in zone ${actualFromZone}`);
        const newEntity = {
          type: 'entity',
          name: relation.from,
          entityType: 'unknown',
          observations: [],
          readCount: 0,
          lastRead: new Date().toISOString(),
          lastWrite: new Date().toISOString(),
          relevanceScore: 1.0,
          zone: actualFromZone
        };
        
        const fromIndexName = this.getIndexForZone(actualFromZone);
        await this.client.index({
          index: fromIndexName,
          id: `entity:${relation.from}`,
          document: newEntity,
          refresh: true
        });
      }
      
      if (!toEntity) {
        console.error(`Auto-creating missing entity: ${relation.to} in zone ${actualToZone}`);
        const newEntity = {
          type: 'entity',
          name: relation.to,
          entityType: 'unknown',
          observations: [],
          readCount: 0,
          lastRead: new Date().toISOString(),
          lastWrite: new Date().toISOString(),
          relevanceScore: 1.0,
          zone: actualToZone
        };
        
        const toIndexName = this.getIndexForZone(actualToZone);
        await this.client.index({
          index: toIndexName,
          id: `entity:${relation.to}`,
          document: newEntity,
          refresh: true
        });
      }
    }
    
    // Create the relation
    const newRelation: ESRelation = {
      type: 'relation',
      from: relation.from,
      fromZone: actualFromZone,
      to: relation.to,
      toZone: actualToZone,
      relationType: relation.relationType
    };
    
    const id = `relation:${actualFromZone}:${relation.from}:${relation.relationType}:${actualToZone}:${relation.to}`;
    
    await this.client.index({
      index: KG_RELATIONS_INDEX,
      id,
      document: newRelation,
      refresh: true
    });
    
    return newRelation;
  }

  /**
   * Delete a relation between entities
   * @param from Source entity name
   * @param to Target entity name
   * @param relationType Relation type
   * @param fromZone Optional zone for the source entity, uses defaultZone if not specified
   * @param toZone Optional zone for the target entity, uses defaultZone if not specified
   */
  async deleteRelation(
    from: string, 
    to: string, 
    relationType: string, 
    fromZone?: string, 
    toZone?: string
  ): Promise<boolean> {
    await this.initialize();
    
    const actualFromZone = fromZone || this.defaultZone;
    const actualToZone = toZone || this.defaultZone;
    
    try {
      const relationId = `relation:${actualFromZone}:${from}:${relationType}:${actualToZone}:${to}`;
      
      await this.client.delete({
        index: KG_RELATIONS_INDEX,
        id: relationId,
        refresh: true
      });
      
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Search for entities and relations in the knowledge graph
   * @param params Search parameters
   */
  async search(params: ESSearchParams & { zone?: string }): Promise<ESHighlightResponse<ESEntity | ESRelation>> {
    const actualZone = params.zone || this.defaultZone;
    await this.initialize(actualZone);
    
    const indexName = this.getIndexForZone(actualZone);
    
    // Special handling for wildcard query
    if (params.query === '*') {
      console.error(`Performing wildcard search in zone: ${actualZone}, index: ${indexName}`);
      
      try {
        // Use match_all query for wildcard
        const response = await this.client.search({
          index: indexName,
          body: {
            query: {
              match_all: {}
            },
            sort: [{ lastRead: { order: 'desc' } }],
            size: params.limit || 10,
            from: params.offset || 0
          }
        });
        
        console.error(`Wildcard search results: ${JSON.stringify(response.hits)}`);
        
        return response as unknown as ESHighlightResponse<ESEntity | ESRelation>;
      } catch (error) {
        console.error(`Error in wildcard search: ${error.message}`);
        throw error;
      }
    }
    
    // Special handling for exact entity name search
    if (params.query && !params.query.includes(' ')) {
      console.error(`Performing exact entity name search for "${params.query}" in zone: ${actualZone}, index: ${indexName}`);
      
      try {
        // Use match query for exact entity name
        const response = await this.client.search({
          index: indexName,
          body: {
            query: {
              match: {
                name: params.query
              }
            },
            sort: [{ lastRead: { order: 'desc' } }],
            size: params.limit || 10,
            from: params.offset || 0
          }
        });
        
        console.error(`Exact entity name search results: ${JSON.stringify(response.hits)}`);
        
        return response as unknown as ESHighlightResponse<ESEntity | ESRelation>;
      } catch (error) {
        console.error(`Error in exact entity name search: ${error.message}`);
        throw error;
      }
    }
    
    // Build search query for non-wildcard searches
    const query: any = {
      bool: {
        must: []
      }
    };
    
    // Process the query to handle boolean operators or fuzzy search notation
    if (params.query.includes(' AND ') || 
        params.query.includes(' OR ') || 
        params.query.includes(' NOT ') ||
        params.query.includes('~')) {
      // Use Elasticsearch's query_string query for boolean operators and fuzzy search
      query.bool.must.push({
        query_string: {
          query: params.query,
          fields: ['name^3', 'entityType^2', 'observations', 'relationType^2'],
          default_operator: 'AND',
          // Enable fuzzy matching by default
          fuzziness: 'AUTO',
          // Allow fuzzy matching on all terms unless explicitly disabled
          fuzzy_max_expansions: 50,
          // Support phrase slop for proximity searches
          phrase_slop: 2
        }
      });
      
      console.error(`Using query_string for advanced query: ${params.query}`);
    } else {
      // Use multi_match for simple queries without boolean operators
      query.bool.must.push({
        multi_match: {
          query: params.query,
          fields: ['name^3', 'entityType^2', 'observations', 'relationType^2'],
          // Enable fuzzy matching by default
          fuzziness: 'AUTO'
        }
      });
      
      console.error(`Using multi_match for simple query: ${params.query}`);
    }
    
    // Add entityType filter if specified
    if (params.entityTypes && params.entityTypes.length > 0) {
      // Use a more flexible filter with "should" (equivalent to OR) to match any of the entity types
      const entityTypeFilters = params.entityTypes.map(type => ({
        match: {
          entityType: {
            query: type,
            operator: "and"
          }
        }
      }));
      
      query.bool.must.push({
        bool: {
          should: entityTypeFilters,
          minimum_should_match: 1
        }
      });
      
      console.error(`Applied entity type filters: ${JSON.stringify(entityTypeFilters)}`);
    }
    
    // Log validation to ensure zone filter is being applied
    console.error(`Searching in zone: ${actualZone}, index: ${indexName}, query: ${JSON.stringify(query)}`);
    
    // Set up sort order
    let sort: any[] = [];
    if (params.sortBy === 'recent') {
      sort = [{ lastRead: { order: 'desc' } }];
    } else if (params.sortBy === 'importance') {
      sort = [
        { isImportant: { order: 'desc' } },
        { relevanceScore: { order: 'desc' } }
      ];
    } else {
      // Default is by relevance (using _score)
      sort = [{ _score: { order: 'desc' } }];
    }
    
    try {
      // Execute search
      const response = await this.client.search({
        index: indexName,
        body: {
          query,
          sort,
          highlight: {
            fields: {
              name: {},
              observations: {},
              entityType: {}
            }
          },
          size: params.limit || 10,
          from: params.offset || 0
        }
      });
      
      console.error(`Search results: ${JSON.stringify(response.hits)}`);
      
      return response as unknown as ESHighlightResponse<ESEntity | ESRelation>;
    } catch (error) {
      console.error(`Error in search: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all entities related to a given entity, up to a certain depth
   * @param name Entity name
   * @param maxDepth Maximum traversal depth
   * @param zone Optional memory zone name, uses defaultZone if not specified
   */
  async getRelatedEntities(
    name: string, 
    maxDepth: number = 1, 
    zone?: string
  ): Promise<{
    entities: ESEntity[],
    relations: ESRelation[]
  }> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);

    // Start with the root entity
    const rootEntity = await this.getEntity(name, actualZone);
    if (!rootEntity) {
      return { entities: [], relations: [] };
    }

    // Keep track of entities and relations we've found
    const entitiesMap = new Map<string, ESEntity>();
    entitiesMap.set(`${actualZone}:${rootEntity.name}`, rootEntity);
    
    const relationsMap = new Map<string, ESRelation>();
    const visitedEntities = new Set<string>();
    
    // Queue of entities to process, with their depth
    const queue: Array<{ entity: ESEntity, zone: string, depth: number }> = [
      { entity: rootEntity, zone: actualZone, depth: 0 }
    ];
    
    while (queue.length > 0) {
      const { entity, zone: entityZone, depth } = queue.shift()!;
      const entityKey = `${entityZone}:${entity.name}`;
      
      // Skip if we've already processed this entity or if we've reached max depth
      if (visitedEntities.has(entityKey) || depth >= maxDepth) {
        continue;
      }
      
      visitedEntities.add(entityKey);
      
      // Find all relations involving this entity
      const fromResponse = await this.client.search({
        index: KG_RELATIONS_INDEX,
        body: {
          query: {
            bool: {
              must: [
                { term: { from: entity.name } },
                { term: { fromZone: entityZone } }
              ]
            }
          },
          size: 1000
        }
      });
      
      const toResponse = await this.client.search({
        index: KG_RELATIONS_INDEX,
        body: {
          query: {
            bool: {
              must: [
                { term: { to: entity.name } },
                { term: { toZone: entityZone } }
              ]
            }
          },
          size: 1000
        }
      });
      
      // Process relations where this entity is the source
      const fromHits = (fromResponse as unknown as ESSearchResponse<ESRelation>).hits.hits;
      for (const hit of fromHits) {
        const relation = hit._source;
        const relationKey = `${relation.fromZone}:${relation.from}|${relation.relationType}|${relation.toZone}:${relation.to}`;
        
        // Skip if we've already processed this relation
        if (relationsMap.has(relationKey)) {
          continue;
        }
        
        relationsMap.set(relationKey, relation);
        
        // Process the target entity
        const otherEntityKey = `${relation.toZone}:${relation.to}`;
        if (!entitiesMap.has(otherEntityKey)) {
          // Fetch the other entity
          const otherEntity = await this.getEntity(relation.to, relation.toZone);
          
          if (otherEntity) {
            entitiesMap.set(otherEntityKey, otherEntity);
            
            // Add the other entity to the queue if we haven't reached max depth
            if (depth < maxDepth - 1) {
              queue.push({ entity: otherEntity, zone: relation.toZone, depth: depth + 1 });
            }
          }
        }
      }
      
      // Process relations where this entity is the target
      const toHits = (toResponse as unknown as ESSearchResponse<ESRelation>).hits.hits;
      for (const hit of toHits) {
        const relation = hit._source;
        const relationKey = `${relation.fromZone}:${relation.from}|${relation.relationType}|${relation.toZone}:${relation.to}`;
        
        // Skip if we've already processed this relation
        if (relationsMap.has(relationKey)) {
          continue;
        }
        
        relationsMap.set(relationKey, relation);
        
        // Process the source entity
        const otherEntityKey = `${relation.fromZone}:${relation.from}`;
        if (!entitiesMap.has(otherEntityKey)) {
          // Fetch the other entity
          const otherEntity = await this.getEntity(relation.from, relation.fromZone);
          
          if (otherEntity) {
            entitiesMap.set(otherEntityKey, otherEntity);
            
            // Add the other entity to the queue if we haven't reached max depth
            if (depth < maxDepth - 1) {
              queue.push({ entity: otherEntity, zone: relation.fromZone, depth: depth + 1 });
            }
          }
        }
      }
    }
    
    return {
      entities: Array.from(entitiesMap.values()),
      relations: Array.from(relationsMap.values())
    };
  }

  /**
   * Import data into the knowledge graph
   * @param data Array of entities and relations to import
   * @param zone Optional memory zone for entities, uses defaultZone if not specified
   */
  async importData(
    data: Array<ESEntity | ESRelation>, 
    zone?: string
  ): Promise<{
    entitiesAdded: number;
    relationsAdded: number;
    invalidRelations?: Array<{relation: ESRelation, reason: string}>;
  }> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);
    
    let entitiesAdded = 0;
    let relationsAdded = 0;
    const invalidRelations: Array<{relation: ESRelation, reason: string}> = [];
    
    // Process entities first, since relations depend on them
    const entities = data.filter(item => item.type === 'entity') as ESEntity[];
    const entityOperations: any[] = [];
    
    for (const entity of entities) {
      // Add zone information if not already present
      const entityWithZone = {
        ...entity,
        zone: entity.zone || actualZone
      };
      
      const id = `entity:${entity.name}`;
      entityOperations.push({ index: { _index: this.getIndexForZone(actualZone), _id: id } });
      entityOperations.push(entityWithZone);
      entitiesAdded++;
    }
    
    if (entityOperations.length > 0) {
      await this.client.bulk({
        operations: entityOperations,
        refresh: true
      });
    }
    
    // Now process relations
    const relations = data.filter(item => item.type === 'relation') as ESRelation[];
    const relationOperations: any[] = [];
    
    for (const relation of relations) {
      // For backward compatibility, handle both old and new relation formats
      const r = relation as any; // Type assertion to avoid property access errors
      
      if ('fromZone' in r && 'toZone' in r) {
        // New format - already has fromZone and toZone
        // Verify that both entities exist
        const fromEntity = await this.getEntityWithoutUpdatingLastRead(r.from, r.fromZone);
        const toEntity = await this.getEntityWithoutUpdatingLastRead(r.to, r.toZone);
        
        if (!fromEntity) {
          invalidRelations.push({
            relation,
            reason: `Source entity '${r.from}' in zone '${r.fromZone}' does not exist`
          });
          continue;
        }
        
        if (!toEntity) {
          invalidRelations.push({
            relation,
            reason: `Target entity '${r.to}' in zone '${r.toZone}' does not exist`
          });
          continue;
        }
        
        const id = `relation:${r.fromZone}:${r.from}:${r.relationType}:${r.toZone}:${r.to}`;
        relationOperations.push({ index: { _index: KG_RELATIONS_INDEX, _id: id } });
        relationOperations.push(relation);
        relationsAdded++;
      } else {
        // Old format - needs to be converted
        // For backward compatibility, assume both entities are in the specified zone
        const fromZone = actualZone;
        const toZone = actualZone;
        
        // Verify that both entities exist
        const fromEntity = await this.getEntityWithoutUpdatingLastRead(r.from, fromZone);
        const toEntity = await this.getEntityWithoutUpdatingLastRead(r.to, toZone);
        
        if (!fromEntity) {
          invalidRelations.push({
            relation,
            reason: `Source entity '${r.from}' in zone '${fromZone}' does not exist`
          });
          continue;
        }
        
        if (!toEntity) {
          invalidRelations.push({
            relation,
            reason: `Target entity '${r.to}' in zone '${toZone}' does not exist`
          });
          continue;
        }
        
        // Convert to new format
        const newRelation: ESRelation = {
          type: 'relation',
          from: r.from,
          fromZone,
          to: r.to,
          toZone,
          relationType: r.relationType
        };
        
        const id = `relation:${fromZone}:${r.from}:${r.relationType}:${toZone}:${r.to}`;
        relationOperations.push({ index: { _index: KG_RELATIONS_INDEX, _id: id } });
        relationOperations.push(newRelation);
        relationsAdded++;
      }
    }
    
    if (relationOperations.length > 0) {
      await this.client.bulk({
        operations: relationOperations,
        refresh: true
      });
    }
    
    return {
      entitiesAdded,
      relationsAdded,
      invalidRelations: invalidRelations.length ? invalidRelations : undefined
    };
  }

  /**
   * Export all data from a knowledge graph
   * @param zone Optional memory zone for entities, uses defaultZone if not specified
   */
  async exportData(zone?: string): Promise<Array<ESEntity | ESRelation>> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);
    
    // Fetch all entities from the specified zone
    const indexName = this.getIndexForZone(actualZone);
    const entityResponse = await this.client.search({
      index: indexName,
      body: {
        query: { term: { type: 'entity' } },
        size: 10000
      }
    });
    
    const entities = entityResponse.hits.hits.map(hit => hit._source) as ESEntity[];
    
    // Fetch all relations involving entities in this zone
    const relationResponse = await this.client.search({
      index: KG_RELATIONS_INDEX,
      body: {
        query: {
          bool: {
            should: [
              { term: { fromZone: actualZone } },
              { term: { toZone: actualZone } }
            ],
            minimum_should_match: 1
          }
        },
        size: 10000
      }
    });
    
    const relations = relationResponse.hits.hits.map(hit => hit._source) as ESRelation[];
    
    // Combine entities and relations
    return [...entities, ...relations];
  }

  /**
   * Get all relations involving a set of entities
   * @param entityNames Array of entity names
   * @param zone Optional memory zone for all entities, uses defaultZone if not specified
   */
  async getRelationsForEntities(
    entityNames: string[],
    zone?: string
  ): Promise<{
    relations: ESRelation[]
  }> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);
    
    if (entityNames.length === 0) {
      return { relations: [] };
    }
    
    // Find all relations where any of these entities are involved
    // We need to search for both directions - as source and as target
    const fromQuery = entityNames.map(name => ({
      bool: {
        must: [
          { term: { from: name } },
          { term: { fromZone: actualZone } }
        ]
      }
    }));
    
    const toQuery = entityNames.map(name => ({
      bool: {
        must: [
          { term: { to: name } },
          { term: { toZone: actualZone } }
        ]
      }
    }));
    
    const response = await this.client.search({
      index: KG_RELATIONS_INDEX,
      body: {
        query: {
          bool: {
            should: [...fromQuery, ...toQuery],
            minimum_should_match: 1
          }
        },
        size: 1000
      }
    });
    
    const relations = (response as unknown as ESSearchResponse<ESRelation>)
      .hits.hits
      .map(hit => hit._source);
    
    return { relations };
  }

  /**
   * Save or update zone metadata
   * @param name Zone name
   * @param description Optional description
   * @param config Optional configuration
   */
  private async saveZoneMetadata(
    name: string,
    description?: string,
    config?: Record<string, any>
  ): Promise<void> {
    await this.initialize();
    
    const now = new Date().toISOString();
    
    // Check if zone metadata exists
    let existing: ZoneMetadata | null = null;
    try {
      const response = await this.client.get({
        index: KG_METADATA_INDEX,
        id: `zone:${name}`
      });
      existing = response._source as ZoneMetadata;
    } catch (error) {
      // Zone doesn't exist yet
    }
    
    const metadata: ZoneMetadata = {
      name,
      description: description || existing?.description,
      createdAt: existing?.createdAt || now,
      lastModified: now,
      config: config || existing?.config
    };
    
    await this.client.index({
      index: KG_METADATA_INDEX,
      id: `zone:${name}`,
      document: metadata,
      refresh: true
    });
  }

  /**
   * List all available memory zones
   */
  async listMemoryZones(): Promise<ZoneMetadata[]> {
    await this.initialize();
    
    try {
      // First try getting zones from metadata
      const response = await this.client.search({
        index: KG_METADATA_INDEX,
        body: {
          query: { match_all: {} },
          size: 1000
        }
      });
      
      const zones = response.hits.hits.map(hit => hit._source as ZoneMetadata);
      
      if (zones.length > 0) {
        return zones;
      }
    } catch (error) {
      console.warn('Error getting zones from metadata, falling back to index detection:', error);
    }
    
    // Fallback to listing indices (for backward compatibility)
    const indicesResponse = await this.client.indices.get({
      index: `${KG_INDEX_PREFIX}@*`
    });
    
    // Extract zone names from index names
    const zoneNames = Object.keys(indicesResponse)
      .filter(indexName => indexName.startsWith(`${KG_INDEX_PREFIX}@`))
      .map(indexName => indexName.substring(KG_INDEX_PREFIX.length + 1)); // +1 for the @ symbol
    
    // Convert to metadata format
    const now = new Date().toISOString();
    const zones = zoneNames.map(name => ({
      name,
      createdAt: now,
      lastModified: now
    }));
    
    // Save detected zones to metadata for future
    for (const zone of zones) {
      await this.saveZoneMetadata(zone.name, `Zone detected from index: ${getIndexName(zone.name)}`);
    }
      
    return zones;
  }
  
  /**
   * Add a new memory zone (creates the index if it doesn't exist)
   * @param zone Zone name to add
   * @param description Optional description of the zone
   * @param config Optional configuration for the zone
   */
  async addMemoryZone(
    zone: string, 
    description?: string,
    config?: Record<string, any>
  ): Promise<boolean> {
    if (!zone || zone === 'default') {
      throw new Error('Invalid zone name. Cannot be empty or "default".');
    }
    
    // Initialize the index for this zone
    await this.initialize(zone);
    
    // Add to metadata
    await this.saveZoneMetadata(zone, description, config);
    
    return true;
  }
  
  /**
   * Get metadata for a specific zone
   * @param zone Zone name
   */
  async getZoneMetadata(zone: string): Promise<ZoneMetadata | null> {
    await this.initialize();
    
    try {
      const response = await this.client.get({
        index: KG_METADATA_INDEX,
        id: `zone:${zone}`
      });
      return response._source as ZoneMetadata;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Delete a memory zone and all its data
   * @param zone Zone name to delete
   */
  async deleteMemoryZone(zone: string): Promise<boolean> {
    if (zone === 'default') {
      throw new Error('Cannot delete the default zone.');
    }
    
    await this.initialize();
    
    try {
      const indexName = this.getIndexForZone(zone);
      
      // Delete the index
      await this.client.indices.delete({
        index: indexName
      });
      
      // Delete from metadata
      await this.client.delete({
        index: KG_METADATA_INDEX,
        id: `zone:${zone}`
      });
      
      // Remove from initialized indices cache
      this.initializedIndices.delete(indexName);
      
      // Clean up relations for this zone
      await this.client.deleteByQuery({
        index: KG_RELATIONS_INDEX,
        body: {
          query: {
            bool: {
              should: [
                { term: { fromZone: zone } },
                { term: { toZone: zone } }
              ],
              minimum_should_match: 1
            }
          }
        },
        refresh: true
      });
      
      return true;
    } catch (error) {
      console.error(`Error deleting zone ${zone}:`, error);
      return false;
    }
  }
  
  /**
   * Get statistics for a memory zone
   * @param zone Zone name, uses defaultZone if not specified
   */
  async getMemoryZoneStats(zone?: string): Promise<{
    zone: string;
    entityCount: number;
    relationCount: number;
    entityTypes: Record<string, number>;
    relationTypes: Record<string, number>;
  }> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);
    
    const indexName = this.getIndexForZone(actualZone);
    
    // Get total counts
    const countResponse = await this.client.count({
      index: indexName,
      body: {
        query: {
          term: { type: 'entity' }
        }
      }
    });
    const entityCount = countResponse.count;
    
    const relationCountResponse = await this.client.count({
      index: indexName,
      body: {
        query: {
          term: { type: 'relation' }
        }
      }
    });
    const relationCount = relationCountResponse.count;
    
    // Get entity type distribution
    const entityTypesResponse = await this.client.search({
      index: indexName,
      body: {
        size: 0,
        query: {
          term: { type: 'entity' }
        },
        aggs: {
          entity_types: {
            terms: {
              field: 'entityType',
              size: 100
            }
          }
        }
      }
    });
    
    const entityTypes: Record<string, number> = {};
    const entityTypeAggs = entityTypesResponse.aggregations as any;
    const entityTypeBuckets = entityTypeAggs?.entity_types?.buckets || [];
    entityTypeBuckets.forEach((bucket: any) => {
      entityTypes[bucket.key] = bucket.doc_count;
    });
    
    // Get relation type distribution
    const relationTypesResponse = await this.client.search({
      index: indexName,
      body: {
        size: 0,
        query: {
          term: { type: 'relation' }
        },
        aggs: {
          relation_types: {
            terms: {
              field: 'relationType',
              size: 100
            }
          }
        }
      }
    });
    
    const relationTypes: Record<string, number> = {};
    const relationTypeAggs = relationTypesResponse.aggregations as any;
    const relationTypeBuckets = relationTypeAggs?.relation_types?.buckets || [];
    relationTypeBuckets.forEach((bucket: any) => {
      relationTypes[bucket.key] = bucket.doc_count;
    });
    
    return {
      zone: actualZone,
      entityCount,
      relationCount,
      entityTypes,
      relationTypes
    };
  }

  /**
   * Export all knowledge graph data, optionally limiting to specific zones
   * @param zones Optional array of zone names to export, exports all zones if not specified
   */
  async exportAllData(zones?: string[]): Promise<{
    entities: ESEntity[],
    relations: ESRelation[],
    zones: ZoneMetadata[]
  }> {
    await this.initialize();
    
    // Get all zones or filter to specified zones
    const allZones = await this.listMemoryZones();
    const zonesToExport = zones 
      ? allZones.filter(zone => zones.includes(zone.name))
      : allZones;
    
    if (zonesToExport.length === 0) {
      return { entities: [], relations: [], zones: [] };
    }
    
    // Collect all entities from each zone
    const entities: ESEntity[] = [];
    for (const zone of zonesToExport) {
      const zoneData = await this.exportData(zone.name);
      const zoneEntities = zoneData.filter(item => item.type === 'entity') as ESEntity[];
      entities.push(...zoneEntities);
    }
    
    // Get all relations
    let relations: ESRelation[] = [];
    if (zones) {
      // If specific zones are specified, only get relations involving those zones
      const relationResponse = await this.client.search({
        index: KG_RELATIONS_INDEX,
        body: {
          query: {
            bool: {
              should: [
                ...zonesToExport.map(zone => ({ term: { fromZone: zone.name } })),
                ...zonesToExport.map(zone => ({ term: { toZone: zone.name } }))
              ],
              minimum_should_match: 1
            }
          },
          size: 10000
        }
      });
      
      relations = relationResponse.hits.hits.map(hit => hit._source) as ESRelation[];
    } else {
      // If no zones specified, get all relations
      const relationResponse = await this.client.search({
        index: KG_RELATIONS_INDEX,
        body: {
          query: { match_all: {} },
          size: 10000
        }
      });
      
      relations = relationResponse.hits.hits.map(hit => hit._source) as ESRelation[];
    }
    
    return {
      entities,
      relations,
      zones: zonesToExport
    };
  }
  
  /**
   * Import data into the knowledge graph, recreating zones as needed
   * @param data Export data containing entities, relations, and zone metadata
   */
  async importAllData(data: {
    entities: ESEntity[],
    relations: ESRelation[],
    zones: ZoneMetadata[]
  }): Promise<{
    zonesAdded: number;
    entitiesAdded: number;
    relationsAdded: number;
  }> {
    await this.initialize();
    
    let zonesAdded = 0;
    let entitiesAdded = 0;
    let relationsAdded = 0;
    
    // First create all zones
    for (const zone of data.zones) {
      if (zone.name !== 'default') {
        await this.addMemoryZone(zone.name, zone.description, zone.config);
        zonesAdded++;
      }
    }
    
    // Import entities by zone
    const entitiesByZone: Record<string, ESEntity[]> = {};
    for (const entity of data.entities) {
      const zone = entity.zone || 'default';
      if (!entitiesByZone[zone]) {
        entitiesByZone[zone] = [];
      }
      entitiesByZone[zone].push(entity);
    }
    
    // Import entities for each zone
    for (const [zone, entities] of Object.entries(entitiesByZone)) {
      const result = await this.importData(entities, zone);
      entitiesAdded += result.entitiesAdded;
    }
    
    // Import all relations
    if (data.relations.length > 0) {
      const result = await this.importData(data.relations);
      relationsAdded = result.relationsAdded;
    }
    
    return {
      zonesAdded,
      entitiesAdded,
      relationsAdded
    };
  }

  /**
   * Add observations to an existing entity
   * @param name Entity name
   * @param observations Array of observation strings to add
   * @param zone Optional memory zone name, uses defaultZone if not specified
   * @returns The updated entity
   */
  async addObservations(name: string, observations: string[], zone?: string): Promise<ESEntity> {
    const actualZone = zone || this.defaultZone;
    
    // Get existing entity
    const entity = await this.getEntity(name, actualZone);
    if (!entity) {
      throw new Error(`Entity "${name}" not found in zone "${actualZone}"`);
    }
    
    // Add new observations to the existing ones
    const updatedObservations = [
      ...entity.observations,
      ...observations
    ];
    
    // Update the entity
    const updatedEntity = await this.saveEntity({
      name: entity.name,
      entityType: entity.entityType,
      observations: updatedObservations,
      relevanceScore: entity.relevanceScore
    }, actualZone);
    
    return updatedEntity;
  }

  /**
   * Mark an entity as important or not important
   * @param name Entity name
   * @param important Whether the entity is important
   * @param zone Optional memory zone name, uses defaultZone if not specified
   * @param options Optional configuration options
   * @param options.autoCreateMissingEntities Whether to automatically create missing entities (default: false)
   * @returns The updated entity
   */
  async markImportant(
    name: string, 
    important: boolean, 
    zone?: string,
    options?: {
      autoCreateMissingEntities?: boolean;
    }
  ): Promise<ESEntity> {
    const actualZone = zone || this.defaultZone;
    
    // Default to false for auto-creation (different from saveRelation)
    const autoCreateMissingEntities = options?.autoCreateMissingEntities ?? false;
    
    // Get existing entity
    let entity = await this.getEntity(name, actualZone);
    
    // If entity doesn't exist
    if (!entity) {
      if (autoCreateMissingEntities) {
        // Auto-create the entity with unknown type
        entity = await this.saveEntity({
          name: name,
          entityType: 'unknown',
          observations: [],
          relevanceScore: 1.0
        }, actualZone);
      } else {
        throw new Error(`Entity "${name}" not found in zone "${actualZone}"`);
      }
    }
    
    // Calculate the new relevance score
    // If marking as important, multiply by 10
    // If removing importance, divide by 10
    const baseRelevanceScore = entity.relevanceScore || 1.0;
    const newRelevanceScore = important 
      ? Math.max(10, baseRelevanceScore * 10) // Minimum 10 when marking as important
      : baseRelevanceScore / 10;
    
    // Update entity with new relevance score
    const updatedEntity = await this.saveEntity({
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations,
      relevanceScore: newRelevanceScore
    }, actualZone);
    
    return updatedEntity;
  }

  /**
   * Get recent entities
   * @param limit Maximum number of entities to return
   * @param includeObservations Whether to include observations
   * @param zone Optional memory zone name, uses defaultZone if not specified
   * @returns Array of recent entities
   */
  async getRecentEntities(limit: number, includeObservations: boolean, zone?: string): Promise<ESEntity[]> {
    const actualZone = zone || this.defaultZone;
    
    // Search with empty query but sort by recency
    const searchParams: ESSearchParams = {
      query: "*", // Use wildcard instead of empty query to match all documents
      limit: limit,
      sortBy: 'recent', // Sort by recency
      includeObservations
    };
    
    // Add zone if specified
    if (actualZone) {
      (searchParams as any).zone = actualZone;
    }
    
    const results = await this.search(searchParams);
    
    // Filter to only include entities
    return results.hits.hits
      .filter((hit: any) => hit._source.type === 'entity')
      .map((hit: any) => hit._source);
  }

  /**
   * Copy entities from one zone to another
   * @param entityNames Array of entity names to copy
   * @param sourceZone Source zone to copy from
   * @param targetZone Target zone to copy to
   * @param options Optional configuration
   * @param options.copyRelations Whether to copy relations involving these entities (default: true)
   * @param options.overwrite Whether to overwrite entities if they already exist in target zone (default: false)
   * @returns Result of the copy operation
   */
  async copyEntitiesBetweenZones(
    entityNames: string[],
    sourceZone: string,
    targetZone: string,
    options?: {
      copyRelations?: boolean;
      overwrite?: boolean;
    }
  ): Promise<{
    entitiesCopied: string[];
    entitiesSkipped: { name: string; reason: string }[];
    relationsCopied: number;
  }> {
    if (sourceZone === targetZone) {
      throw new Error('Source and target zones must be different');
    }
    
    // Default options
    const copyRelations = options?.copyRelations !== false;
    const overwrite = options?.overwrite === true;
    
    await this.initialize(sourceZone);
    await this.initialize(targetZone);
    
    const result = {
      entitiesCopied: [] as string[],
      entitiesSkipped: [] as { name: string; reason: string }[],
      relationsCopied: 0
    };
    
    // Get entities from source zone
    for (const name of entityNames) {
      // Get the entity from source zone
      const entity = await this.getEntityWithoutUpdatingLastRead(name, sourceZone);
      if (!entity) {
        result.entitiesSkipped.push({ 
          name, 
          reason: `Entity not found in source zone '${sourceZone}'` 
        });
        continue;
      }
      
      // Check if entity exists in target zone
      const existingEntity = await this.getEntityWithoutUpdatingLastRead(name, targetZone);
      if (existingEntity && !overwrite) {
        result.entitiesSkipped.push({ 
          name, 
          reason: `Entity already exists in target zone '${targetZone}' and overwrite is disabled` 
        });
        continue;
      }
      
      // Copy the entity to target zone
      const { ...entityCopy } = entity;
      delete entityCopy.zone; // Zone will be set by saveEntity
      
      try {
        await this.saveEntity(entityCopy, targetZone);
        result.entitiesCopied.push(name);
      } catch (error) {
        result.entitiesSkipped.push({ 
          name, 
          reason: `Error copying entity: ${(error as Error).message}` 
        });
        continue;
      }
    }
    
    // Copy relations if requested
    if (copyRelations && result.entitiesCopied.length > 0) {
      // Get all relations for these entities in source zone
      const { relations } = await this.getRelationsForEntities(result.entitiesCopied, sourceZone);
      
      // Filter to only include relations where both entities were copied
      // or relations between copied entities and entities that already exist in target zone
      const relationsToCreate: ESRelation[] = [];
      
      for (const relation of relations) {
        let fromExists = result.entitiesCopied.includes(relation.from);
        let toExists = result.entitiesCopied.includes(relation.to);
        
        // If one side of the relation wasn't copied, check if it exists in target zone
        if (!fromExists) {
          const fromEntityInTarget = await this.getEntityWithoutUpdatingLastRead(relation.from, targetZone);
          fromExists = !!fromEntityInTarget;
        }
        
        if (!toExists) {
          const toEntityInTarget = await this.getEntityWithoutUpdatingLastRead(relation.to, targetZone);
          toExists = !!toEntityInTarget;
        }
        
        // Only create relations where both sides exist
        if (fromExists && toExists) {
          relationsToCreate.push(relation);
        }
      }
      
      // Save the filtered relations
      for (const relation of relationsToCreate) {
        try {
          await this.saveRelation({
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType
          }, targetZone, targetZone);
          
          result.relationsCopied++;
        } catch (error) {
          console.error(`Error copying relation from ${relation.from} to ${relation.to}: ${(error as Error).message}`);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Move entities from one zone to another (copy + delete from source)
   * @param entityNames Array of entity names to move
   * @param sourceZone Source zone to move from
   * @param targetZone Target zone to move to
   * @param options Optional configuration
   * @param options.moveRelations Whether to move relations involving these entities (default: true)
   * @param options.overwrite Whether to overwrite entities if they already exist in target zone (default: false)
   * @returns Result of the move operation
   */
  async moveEntitiesBetweenZones(
    entityNames: string[],
    sourceZone: string,
    targetZone: string,
    options?: {
      moveRelations?: boolean;
      overwrite?: boolean;
    }
  ): Promise<{
    entitiesMoved: string[];
    entitiesSkipped: { name: string; reason: string }[];
    relationsMoved: number;
  }> {
    if (sourceZone === targetZone) {
      throw new Error('Source and target zones must be different');
    }
    
    // Default options
    const moveRelations = options?.moveRelations !== false;
    
    // First copy the entities
    const copyResult = await this.copyEntitiesBetweenZones(
      entityNames,
      sourceZone,
      targetZone,
      {
        copyRelations: moveRelations,
        overwrite: options?.overwrite
      }
    );
    
    const result = {
      entitiesMoved: [] as string[],
      entitiesSkipped: copyResult.entitiesSkipped,
      relationsMoved: copyResult.relationsCopied
    };
    
    // Delete copied entities from source zone
    for (const name of copyResult.entitiesCopied) {
      try {
        // Don't cascade relations when deleting from source, as we've already copied them
        await this.deleteEntity(name, sourceZone, { cascadeRelations: false });
        result.entitiesMoved.push(name);
      } catch (error) {
        // If deletion fails, add to skipped list but keep the entity in the moved list
        // since it was successfully copied
        result.entitiesSkipped.push({ 
          name, 
          reason: `Entity was copied but could not be deleted from source: ${(error as Error).message}` 
        });
      }
    }
    
    return result;
  }
  
  /**
   * Merge two or more zones into a target zone
   * @param sourceZones Array of source zone names to merge from 
   * @param targetZone Target zone to merge into
   * @param options Optional configuration
   * @param options.deleteSourceZones Whether to delete source zones after merging (default: false)
   * @param options.overwriteConflicts How to handle entity name conflicts (default: 'skip')
   * @returns Result of the merge operation
   */
  async mergeZones(
    sourceZones: string[],
    targetZone: string,
    options?: {
      deleteSourceZones?: boolean;
      overwriteConflicts?: 'skip' | 'overwrite' | 'rename';
    }
  ): Promise<{
    mergedZones: string[];
    failedZones: { zone: string; reason: string }[];
    entitiesCopied: number;
    entitiesSkipped: number;
    relationsCopied: number;
  }> {
    // Validate parameters
    if (sourceZones.includes(targetZone)) {
      throw new Error('Target zone cannot be included in source zones');
    }
    
    if (sourceZones.length === 0) {
      throw new Error('At least one source zone must be specified');
    }
    
    // Default options
    const deleteSourceZones = options?.deleteSourceZones === true;
    const overwriteConflicts = options?.overwriteConflicts || 'skip';
    
    // Initialize target zone
    await this.initialize(targetZone);
    
    const result = {
      mergedZones: [] as string[],
      failedZones: [] as { zone: string; reason: string }[],
      entitiesCopied: 0,
      entitiesSkipped: 0,
      relationsCopied: 0
    };
    
    // Process each source zone
    for (const sourceZone of sourceZones) {
      try {
        // Get all entities from source zone
        const allEntities = await this.searchEntities({
          query: '*',
          limit: 10000,
          zone: sourceZone
        });
        
        if (allEntities.length === 0) {
          result.failedZones.push({
            zone: sourceZone,
            reason: 'Zone has no entities'
          });
          continue;
        }
        
        // Extract entity names
        const entityNames = allEntities.map(entity => entity.name);
        
        // Process according to conflict resolution strategy
        if (overwriteConflicts === 'rename') {
          // For 'rename' strategy, we need to check each entity and rename if necessary
          for (const entity of allEntities) {
            const existingEntity = await this.getEntityWithoutUpdatingLastRead(entity.name, targetZone);
            
            if (existingEntity) {
              // Entity exists in target zone, generate a new name
              const newName = `${entity.name}_from_${sourceZone}`;
              
              // Create a copy with the new name
              const entityCopy = { ...entity, name: newName };
              delete entityCopy.zone; // Zone will be set by saveEntity
              
              try {
                await this.saveEntity(entityCopy, targetZone);
                result.entitiesCopied++;
              } catch (error) {
                result.entitiesSkipped++;
                console.error(`Error copying entity ${entity.name} with new name ${newName}: ${(error as Error).message}`);
              }
            } else {
              // Entity doesn't exist, copy as is
              const entityCopy = { ...entity };
              delete entityCopy.zone; // Zone will be set by saveEntity
              
              try {
                await this.saveEntity(entityCopy, targetZone);
                result.entitiesCopied++;
              } catch (error) {
                result.entitiesSkipped++;
                console.error(`Error copying entity ${entity.name}: ${(error as Error).message}`);
              }
            }
          }
          
          // Now copy relations, adjusting for renamed entities
          const { relations } = await this.getRelationsForEntities(entityNames, sourceZone);
          
          for (const relation of relations) {
            try {
              // Check if entities were renamed
              let fromName = relation.from;
              let toName = relation.to;
              
              const fromEntityInTarget = await this.getEntityWithoutUpdatingLastRead(fromName, targetZone);
              if (!fromEntityInTarget) {
                // Check if it was renamed
                const renamedFromName = `${fromName}_from_${sourceZone}`;
                const renamedFromEntityInTarget = await this.getEntityWithoutUpdatingLastRead(renamedFromName, targetZone);
                if (renamedFromEntityInTarget) {
                  fromName = renamedFromName;
                }
              }
              
              const toEntityInTarget = await this.getEntityWithoutUpdatingLastRead(toName, targetZone);
              if (!toEntityInTarget) {
                // Check if it was renamed
                const renamedToName = `${toName}_from_${sourceZone}`;
                const renamedToEntityInTarget = await this.getEntityWithoutUpdatingLastRead(renamedToName, targetZone);
                if (renamedToEntityInTarget) {
                  toName = renamedToName;
                }
              }
              
              // Only create relation if both entities exist
              if (await this.getEntityWithoutUpdatingLastRead(fromName, targetZone) && 
                  await this.getEntityWithoutUpdatingLastRead(toName, targetZone)) {
                await this.saveRelation({
                  from: fromName,
                  to: toName,
                  relationType: relation.relationType
                }, targetZone, targetZone);
                
                result.relationsCopied++;
              }
            } catch (error) {
              console.error(`Error copying relation from ${relation.from} to ${relation.to}: ${(error as Error).message}`);
            }
          }
        } else {
          // For 'skip' or 'overwrite' strategy, use copyEntitiesBetweenZones
          const copyResult = await this.copyEntitiesBetweenZones(
            entityNames,
            sourceZone,
            targetZone,
            {
              copyRelations: true,
              overwrite: overwriteConflicts === 'overwrite'
            }
          );
          
          result.entitiesCopied += copyResult.entitiesCopied.length;
          result.entitiesSkipped += copyResult.entitiesSkipped.length;
          result.relationsCopied += copyResult.relationsCopied;
        }
        
        // Mark as successfully merged
        result.mergedZones.push(sourceZone);
        
        // Delete source zone if requested
        if (deleteSourceZones) {
          await this.deleteMemoryZone(sourceZone);
        }
      } catch (error) {
        result.failedZones.push({
          zone: sourceZone,
          reason: (error as Error).message
        });
      }
    }
    
    return result;
  }

  /**
   * Search for entities by name or other attributes
   * @param params Search parameters
   * @returns Array of matching entities
   */
  async searchEntities(params: {
    query: string;
    entityTypes?: string[];
    limit?: number;
    includeObservations?: boolean;
    zone?: string;
  }): Promise<ESEntity[]> {
    // Use existing search method with appropriate parameters
    const searchResponse = await this.search({
      query: params.query,
      entityTypes: params.entityTypes,
      limit: params.limit,
      offset: 0,
      zone: params.zone
    });
    
    // Extract entities from the search response
    const entities: ESEntity[] = [];
    if (searchResponse && searchResponse.hits && searchResponse.hits.hits) {
      for (const hit of searchResponse.hits.hits) {
        if (hit._source && hit._source.type === 'entity') {
          entities.push(hit._source as ESEntity);
        }
      }
    }
    
    return entities;
  }
} 
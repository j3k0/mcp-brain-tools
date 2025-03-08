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
        console.log(`Created metadata index: ${KG_METADATA_INDEX}`);
        
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
        console.log(`Created relations index: ${KG_RELATIONS_INDEX}`);
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
      console.log(`Created index: ${indexName}`);
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
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);

    const now = new Date().toISOString();
    const existingEntity = await this.getEntity(entity.name, actualZone);
    
    const newEntity: ESEntity = {
      type: 'entity',
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations || [],
      isImportant: entity.isImportant ?? false,
      // If entity exists, preserve its readCount and lastRead, but update lastWrite
      readCount: existingEntity?.readCount ?? 0,
      lastRead: existingEntity?.lastRead ?? now,
      lastWrite: now,
      // Initialize relevanceScore to 1.0 for new entities, or preserve the existing score
      relevanceScore: existingEntity?.relevanceScore ?? 1.0,
      // Add zone information
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
      const response = await this.client.get({
        index: indexName,
        id: `entity:${name}`,
      });
      
      return response._source as ESEntity;
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
    
    await this.client.update({
      index: indexName,
      id: `entity:${name}`,
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
   */
  async deleteEntity(name: string, zone?: string): Promise<boolean> {
    const actualZone = zone || this.defaultZone;
    await this.initialize(actualZone);
    
    try {
      // First, check if the entity exists
      const entity = await this.getEntityWithoutUpdatingLastRead(name, actualZone);
      if (!entity) {
        return false;
      }
      
      const indexName = this.getIndexForZone(actualZone);
      
      // Delete any relations involving this entity
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
   */
  async saveRelation(
    relation: Omit<ESRelation, 'type' | 'fromZone' | 'toZone'>,
    fromZone?: string,
    toZone?: string
  ): Promise<ESRelation> {
    await this.initialize();
    
    const actualFromZone = fromZone || this.defaultZone;
    const actualToZone = toZone || this.defaultZone;
    
    // Check if both entities exist, if not, create them
    const fromEntity = await this.getEntityWithoutUpdatingLastRead(relation.from, actualFromZone);
    if (!fromEntity) {
      await this.saveEntity({ 
        name: relation.from, 
        entityType: 'unknown', 
        observations: [],
        isImportant: false,
        relevanceScore: 1.0
      }, actualFromZone);
    }
    
    const toEntity = await this.getEntityWithoutUpdatingLastRead(relation.to, actualToZone);
    if (!toEntity) {
      await this.saveEntity({ 
        name: relation.to, 
        entityType: 'unknown', 
        observations: [],
        isImportant: false,
        relevanceScore: 1.0
      }, actualToZone);
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
   * Search for entities or relations
   * @param params Search parameters 
   * @param zone Optional memory zone name, uses defaultZone if not specified
   */
  async search(params: ESSearchParams & { zone?: string }): Promise<ESHighlightResponse<ESEntity | ESRelation>> {
    const actualZone = params.zone || this.defaultZone;
    await this.initialize(actualZone);
    
    const indexName = this.getIndexForZone(actualZone);
    
    // Build search query
    const query: any = {
      bool: {
        must: [
          {
            multi_match: {
              query: params.query,
              fields: ['name^3', 'entityType^2', 'observations', 'relationType^2']
            }
          }
        ]
      }
    };
    
    // Add entityType filter if specified
    if (params.entityTypes && params.entityTypes.length > 0) {
      query.bool.must.push({
        terms: {
          entityType: params.entityTypes
        }
      });
    }
    
    // Add zone filter
    query.bool.must.push({
      term: {
        zone: actualZone
      }
    });
    
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
    
    return response as unknown as ESHighlightResponse<ESEntity | ESRelation>;
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
} 
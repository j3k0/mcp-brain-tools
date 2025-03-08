import { Client } from '@elastic/elasticsearch';
import { 
  KG_INDEX, 
  KG_INDEX_CONFIG, 
  ESEntity, 
  ESRelation,
  ESSearchResponse,
  ESHighlightResponse,
  ESSearchParams
} from './es-types.js';

/**
 * Knowledge Graph Client
 * 
 * Core library for interacting with the Elasticsearch-backed knowledge graph
 */
export class KnowledgeGraphClient {
  private client: Client;
  private initialized: boolean = false;

  /**
   * Create a new KnowledgeGraphClient
   * @param options Connection options
   */
  constructor(private options: { 
    node: string;
    auth?: { username: string; password: string };
  }) {
    this.client = new Client(options);
  }

  /**
   * Initialize the knowledge graph (create index if needed)
   */
  async initialize(): Promise<void> {
    // Check if index exists
    const indexExists = await this.client.indices.exists({ index: KG_INDEX });
    
    if (!indexExists) {
      // Create index with our configuration
      await this.client.indices.create({
        index: KG_INDEX,
        ...KG_INDEX_CONFIG
      });
      console.log(`Created index: ${KG_INDEX}`);
    }
    
    this.initialized = true;
  }

  /**
   * Create or update an entity
   * @param entity Entity to create or update
   */
  async saveEntity(entity: Omit<ESEntity, 'type' | 'readCount' | 'lastRead' | 'lastWrite'>): Promise<ESEntity> {
    if (!this.initialized) await this.initialize();

    const now = new Date().toISOString();
    const existingEntity = await this.getEntity(entity.name);
    
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
      relevanceScore: existingEntity?.relevanceScore ?? 1.0
    };

    await this.client.index({
      index: KG_INDEX,
      id: `entity:${entity.name}`,
      document: newEntity,
      refresh: true // Make sure it's immediately available for search
    });

    return newEntity;
  }

  /**
   * Get an entity by name without updating lastRead timestamp
   * @param name Entity name
   */
  async getEntityWithoutUpdatingLastRead(name: string): Promise<ESEntity | null> {
    if (!this.initialized) await this.initialize();

    try {
      const result = await this.client.get<ESEntity>({
        index: KG_INDEX,
        id: `entity:${name}`
      });
      
      // Return entity without updating lastRead
      return result._source;
    } catch (error) {
      if ((error as any).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get an entity by name
   * This updates the lastRead timestamp, readCount, and doubles the relevanceScore
   * @param name Entity name
   */
  async getEntity(name: string): Promise<ESEntity | null> {
    if (!this.initialized) await this.initialize();

    try {
      const result = await this.client.get<ESEntity>({
        index: KG_INDEX,
        id: `entity:${name}`
      });
      
      // Update read count and timestamp
      const entity = result._source;
      if (entity) {
        const now = new Date().toISOString();
        
        // Double the relevance score (minimum 1.0)
        const newRelevanceScore = Math.max(1.0, (entity.relevanceScore || 1.0) * 2);
        
        await this.client.update({
          index: KG_INDEX,
          id: `entity:${name}`,
          doc: {
            lastRead: now,
            readCount: (entity.readCount || 0) + 1,
            relevanceScore: newRelevanceScore
          }
        });
        
        // Return updated entity
        return {
          ...entity,
          lastRead: now,
          readCount: (entity.readCount || 0) + 1,
          relevanceScore: newRelevanceScore
        };
      }
      
      return null;
    } catch (error) {
      if ((error as any).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete an entity by name
   * @param name Entity name
   */
  async deleteEntity(name: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    try {
      await this.client.delete({
        index: KG_INDEX,
        id: `entity:${name}`,
        refresh: true
      });
      
      // Also delete all relations involving this entity
      await this.client.deleteByQuery({
        index: KG_INDEX,
        query: {
          bool: {
            should: [
              { term: { from: name } },
              { term: { to: name } }
            ]
          }
        },
        refresh: true
      });
      
      return true;
    } catch (error) {
      if ((error as any).statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create a relation between entities
   * @param relation Relation to create
   */
  async saveRelation(relation: Omit<ESRelation, 'type'>): Promise<ESRelation> {
    if (!this.initialized) await this.initialize();

    // Make sure both entities exist
    const fromEntity = await this.getEntity(relation.from);
    const toEntity = await this.getEntity(relation.to);
    
    if (!fromEntity || !toEntity) {
      throw new Error(`Cannot create relation: entities do not exist`);
    }

    const newRelation: ESRelation = {
      type: 'relation',
      from: relation.from,
      to: relation.to,
      relationType: relation.relationType
    };

    // Create unique ID for relation
    const relationId = `relation:${relation.from}:${relation.relationType}:${relation.to}`;
    
    await this.client.index({
      index: KG_INDEX,
      id: relationId,
      document: newRelation,
      refresh: true
    });

    return newRelation;
  }

  /**
   * Delete a relation
   * @param from Source entity name
   * @param to Target entity name
   * @param relationType Relation type
   */
  async deleteRelation(from: string, to: string, relationType: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    const relationId = `relation:${from}:${relationType}:${to}`;
    
    try {
      await this.client.delete({
        index: KG_INDEX,
        id: relationId,
        refresh: true
      });
      
      return true;
    } catch (error) {
      if ((error as any).statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Search for entities using the query language
   * Results are scored based on:
   * 1. Relevance to search query
   * 2. Entity relevanceScore (increases when entity is accessed)
   * 3. Time decay (10% per month since last access)
   * @param params Search parameters
   */
  async search(params: ESSearchParams): Promise<ESHighlightResponse<ESEntity | ESRelation>> {
    if (!this.initialized) await this.initialize();

    const { query, entityTypes, limit = 10, offset = 0, sortBy = 'relevance', includeObservations = true } = params;
    
    // Build the query
    const esQuery: any = {
      bool: {
        must: [],
        filter: [
          // Only match entities, not relations
          { term: { type: 'entity' } }
        ]
      }
    };
    
    // Only add multi_match if there's a meaningful query
    if (query && query !== "*") {
      esQuery.bool.must.push({
        multi_match: {
          query,
          fields: ['name^3', 'entityType^2', ...(includeObservations ? ['observations'] : [])],
          fuzziness: 'AUTO'
        }
      });
    }
    
    // If query is wildcard "*", we'll match all documents with just the filter
    
    // Add entity type filter if specified
    if (entityTypes && entityTypes.length > 0) {
      esQuery.bool.filter.push({
        terms: { entityType: entityTypes }
      });
    }
    
    // Execute the search with function scoring
    // Using any type to bypass TypeScript checks for now
    const queryObj: any = {
      index: KG_INDEX,
      query: {
        function_score: {
          query: { bool: esQuery.bool },
          functions: [
            // Score based on relevanceScore field
            {
              field_value_factor: {
                field: "relevanceScore",
                factor: 1.0,
                missing: 1.0
              }
            },
            // Exponential decay based on lastRead (10% per month)
            {
              exp: {
                lastRead: {
                  scale: "30d",   // 30 days
                  decay: 0.1,     // 10% decay per scale
                  offset: "1d"    // Don't start decaying until after 1 day
                }
              }
            }
          ],
          boost_mode: "multiply"  // Multiply all function scores together
        }
      },
      highlight: {
        fields: {
          name: {},
          observations: {},
          entityType: {}
        },
        pre_tags: ['<em>'],
        post_tags: ['</em>']
      },
      size: limit,
      from: offset,
      _source: true
    };
    
    // Add custom sorting if specified
    if (sortBy === 'recent') {
      queryObj.sort = [
        { lastWrite: { order: 'desc' } }, // Sort by lastWrite first (most recently modified)
        { lastRead: { order: 'desc' } },  // Then by lastRead (most recently accessed)
        '_score'
      ];
    } else if (sortBy === 'importance') {
      queryObj.sort = [
        { relevanceScore: { order: 'desc' } },
        { readCount: { order: 'desc' } },
        '_score'
      ];
    }
    
    const result = await this.client.search(queryObj);
    
    return result as ESHighlightResponse<ESEntity | ESRelation>;
  }

  /**
   * Get related entities
   * @param name Entity name
   * @param maxDepth Maximum relationship depth
   */
  async getRelatedEntities(name: string, maxDepth: number = 1): Promise<{
    entities: ESEntity[],
    relations: ESRelation[]
  }> {
    if (!this.initialized) await this.initialize();
    
    // First, get all direct relations
    const result = await this.client.search<ESRelation>({
      index: KG_INDEX,
      query: {
        bool: {
          should: [
            { term: { from: name } },
            { term: { to: name } }
          ],
          minimum_should_match: 1,
          filter: [
            { term: { type: 'relation' } }
          ]
        }
      },
      size: 100 // Limit the number of relations to keep things manageable
    });
    
    const relations = result.hits.hits.map((hit: any) => hit._source as ESRelation);
    
    // Get all unique entity names from relations
    const entityNames = new Set<string>();
    relations.forEach((relation: ESRelation) => {
      entityNames.add(relation.from);
      entityNames.add(relation.to);
    });
    
    // Fetch all entities
    const entities: ESEntity[] = [];
    for (const entityName of entityNames) {
      const entity = await this.getEntity(entityName);
      if (entity) entities.push(entity);
    }
    
    // If we need to go deeper, recursively get related entities
    if (maxDepth > 1) {
      // For each related entity (except the original)
      for (const entityName of entityNames) {
        if (entityName === name) continue;
        
        // Get related entities for this entity
        const related = await this.getRelatedEntities(entityName, maxDepth - 1);
        
        // Add new entities and relations (avoid duplicates)
        related.entities.forEach(entity => {
          if (!entities.some(e => e.name === entity.name)) {
            entities.push(entity);
          }
        });
        
        related.relations.forEach(relation => {
          if (!relations.some((r: ESRelation) => 
            r.from === relation.from && r.to === relation.to && r.relationType === relation.relationType
          )) {
            relations.push(relation);
          }
        });
      }
    }
    
    return { entities, relations };
  }

  /**
   * Import data from a JSON file
   * @param data Array of entities and relations
   */
  async importData(data: Array<ESEntity | ESRelation>): Promise<{
    entitiesAdded: number;
    relationsAdded: number;
    invalidRelations?: Array<{relation: ESRelation, reason: string}>;
  }> {
    if (!this.initialized) await this.initialize();
    
    let entitiesAdded = 0;
    let relationsAdded = 0;
    const invalidRelations: Array<{relation: ESRelation, reason: string}> = [];
    
    // First, collect all entities to be imported
    const entities = data.filter(item => item.type === 'entity') as ESEntity[];
    const relations = data.filter(item => item.type === 'relation') as ESRelation[];
    
    // Create a set of all entity names (existing + to be imported)
    const entityNames = new Set<string>();
    
    // Add entities that already exist in the database
    try {
      const existingEntitiesResult = await this.client.search<{name: string}>({
        index: KG_INDEX,
        query: { term: { type: "entity" } },
        size: 10000, // This limits the total entities, may need pagination for very large datasets
        _source: ["name"]
      });
      
      existingEntitiesResult.hits.hits.forEach(hit => {
        if (hit._source && hit._source.name) {
          entityNames.add(hit._source.name);
        }
      });
    } catch (error) {
      console.error("Error fetching existing entities:", error);
      // Continue anyway, will just validate against imported entities
    }
    
    // Add the new entities being imported
    entities.forEach(entity => {
      entityNames.add(entity.name);
    });
    
    // Prepare bulk operations for entities
    const entityOperations: any[] = [];
    
    for (const entity of entities) {
      const id = `entity:${entity.name}`;
      entityOperations.push({ index: { _index: KG_INDEX, _id: id } });
      entityOperations.push(entity);
      entitiesAdded++;
    }
    
    // Execute bulk operation for entities
    if (entityOperations.length > 0) {
      await this.client.bulk({
        refresh: true,
        operations: entityOperations
      });
    }
    
    // Now validate and import relations
    const relationOperations: any[] = [];
    
    for (const relation of relations) {
      // Validate that both entities exist
      if (!entityNames.has(relation.from)) {
        invalidRelations.push({
          relation,
          reason: `Source entity "${relation.from}" does not exist`
        });
        continue;
      }
      
      if (!entityNames.has(relation.to)) {
        invalidRelations.push({
          relation,
          reason: `Target entity "${relation.to}" does not exist`
        });
        continue;
      }
      
      // Both entities exist, add the relation
      const id = `relation:${relation.from}:${relation.relationType}:${relation.to}`;
      relationOperations.push({ index: { _index: KG_INDEX, _id: id } });
      relationOperations.push(relation);
      relationsAdded++;
    }
    
    // Execute bulk operation for relations
    if (relationOperations.length > 0) {
      await this.client.bulk({
        refresh: true,
        operations: relationOperations
      });
    }
    
    // Log invalid relations if any
    if (invalidRelations.length > 0) {
      console.warn(`Warning: ${invalidRelations.length} invalid relations were not imported because their referenced entities don't exist.`);
      invalidRelations.forEach(invalid => {
        console.warn(`- Relation ${invalid.relation.from} --[${invalid.relation.relationType}]--> ${invalid.relation.to}: ${invalid.reason}`);
      });
    }
    
    return { 
      entitiesAdded, 
      relationsAdded,
      invalidRelations: invalidRelations.length > 0 ? invalidRelations : undefined
    };
  }

  /**
   * Export all data to a format compatible with the original JSON format
   */
  async exportData(): Promise<Array<ESEntity | ESRelation>> {
    if (!this.initialized) await this.initialize();
    
    // Get all documents
    const result = await this.client.search<ESEntity | ESRelation>({
      index: KG_INDEX,
      query: { match_all: {} },
      size: 10000 // This is the maximum without using scroll API
    });
    
    return result.hits.hits.map((hit: any) => hit._source as (ESEntity | ESRelation));
  }

  /**
   * Get relations for multiple entities
   * @param entityNames Array of entity names
   * @returns Object containing relations between the entities
   */
  async getRelationsForEntities(entityNames: string[]): Promise<{
    relations: ESRelation[]
  }> {
    if (!this.initialized) await this.initialize();
    
    if (entityNames.length === 0) {
      return { relations: [] };
    }
    
    // Build query to find all relations where any of the entities are involved
    const should = [];
    for (const name of entityNames) {
      should.push({ term: { from: name } });
      should.push({ term: { to: name } });
    }
    
    // Search for relations
    const result = await this.client.search<ESRelation>({
      index: KG_INDEX,
      query: {
        bool: {
          should,
          minimum_should_match: 1,
          filter: [
            { term: { type: 'relation' } }
          ]
        }
      },
      size: 200 // Limit the number of relations to keep things manageable
    });
    
    const relations = result.hits.hits.map((hit: any) => hit._source as ESRelation);
    
    // We don't need to filter relations - we want ALL relations where any of our entities
    // are involved, either as source or target
    
    return { relations };
  }
} 
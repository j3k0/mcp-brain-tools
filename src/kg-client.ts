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
      lastWrite: now
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
   * Get an entity by name
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
        await this.client.update({
          index: KG_INDEX,
          id: `entity:${name}`,
          doc: {
            lastRead: now,
            readCount: (entity.readCount || 0) + 1
          }
        });
        
        // Return updated entity
        return {
          ...entity,
          lastRead: now,
          readCount: (entity.readCount || 0) + 1
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
      query: { bool: esQuery.bool },
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
    
    // Add scoring based on sortBy
    if (sortBy === 'recent') {
      queryObj.sort = [
        { lastWrite: { order: 'desc' } }, // Sort by lastWrite first (most recently modified)
        { lastRead: { order: 'desc' } },  // Then by lastRead (most recently accessed)
        '_score'
      ];
    } else if (sortBy === 'importance') {
      queryObj.sort = [
        { isImportant: { order: 'desc' } },
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
  }> {
    if (!this.initialized) await this.initialize();
    
    let entitiesAdded = 0;
    let relationsAdded = 0;
    
    // Prepare bulk operations
    const operations: any[] = [];
    
    for (const item of data) {
      if (item.type === 'entity') {
        const id = `entity:${item.name}`;
        operations.push({ index: { _index: KG_INDEX, _id: id } });
        operations.push(item);
        entitiesAdded++;
      } else if (item.type === 'relation') {
        const id = `relation:${item.from}:${item.relationType}:${item.to}`;
        operations.push({ index: { _index: KG_INDEX, _id: id } });
        operations.push(item);
        relationsAdded++;
      }
    }
    
    // Execute bulk operation if there are items to add
    if (operations.length > 0) {
      await this.client.bulk({
        refresh: true,
        operations
      });
    }
    
    return { entitiesAdded, relationsAdded };
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
    
    // Filter to only keep relations between entities in our list
    const filteredRelations = relations.filter(relation => 
      entityNames.includes(relation.from) && entityNames.includes(relation.to)
    );
    
    return { relations: filteredRelations };
  }
} 
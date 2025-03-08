/**
 * Elasticsearch types for knowledge graph
 */

// Read index prefix from environment variable or use default
export const KG_INDEX_PREFIX = process.env.KG_INDEX_PREFIX || 'knowledge-graph';
// Relations index name
export const KG_RELATIONS_INDEX = `${KG_INDEX_PREFIX}-relations`;
// Metadata index for zones
export const KG_METADATA_INDEX = `${KG_INDEX_PREFIX}-metadata`;

// Function to construct index name with zone
export function getIndexName(zone: string = 'default'): string {
  return `${KG_INDEX_PREFIX}@${zone.toLowerCase()}`;
}

// For backward compatibility
export const KG_INDEX = getIndexName();

// Index settings and mappings
export const KG_INDEX_CONFIG = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        entity_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding']
        }
      }
    }
  },
  mappings: {
    properties: {
      // Entity fields
      type: { type: 'keyword' },
      name: { 
        type: 'text',
        analyzer: 'entity_analyzer',
        fields: {
          keyword: { type: 'keyword' } // For exact matches
        }
      },
      entityType: { type: 'keyword' },
      observations: { type: 'text', analyzer: 'entity_analyzer' },
      
      // Metadata fields for ranking
      lastRead: { type: 'date' },
      lastWrite: { type: 'date' },
      readCount: { type: 'integer' },
      relevanceScore: { type: 'float' },
      
      // Relation fields
      from: { type: 'keyword' },
      to: { type: 'keyword' },
      relationType: { type: 'keyword' }
    }
  }
};

// Entity document type
export interface ESEntity {
  type: 'entity';
  name: string;
  entityType: string;
  observations: string[];
  lastRead: string;
  lastWrite: string;
  readCount: number;
  relevanceScore: number;
  zone?: string; // The memory zone this entity belongs to
}

// Relation document type
export interface ESRelation {
  type: 'relation';
  from: string;       // Entity name (without zone suffix)
  fromZone: string;   // Source entity zone
  to: string;         // Entity name (without zone suffix)
  toZone: string;     // Target entity zone
  relationType: string;
}

// Type for ES search results
export interface ESSearchResponse<T> {
  hits: {
    total: {
      value: number;
      relation: 'eq' | 'gte';
    };
    hits: Array<{
      _id: string;
      _score: number;
      _source: T;
    }>;
  };
}

// Type for highlighting results
export interface ESHighlightResponse<T> extends ESSearchResponse<T> {
  hits: {
    total: {
      value: number;
      relation: 'eq' | 'gte';
    };
    hits: Array<{
      _id: string;
      _score: number;
      _source: T;
      highlight?: Record<string, string[]>;
    }>;
  };
}

// Search query parameters
export interface ESSearchParams {
  query: string;
  entityTypes?: string[];
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'recent' | 'importance';
  includeObservations?: boolean;
  zone?: string; // Optional memory zone to search in
} 
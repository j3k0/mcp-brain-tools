/**
 * Elasticsearch types for knowledge graph
 */

// Main index name
export const KG_INDEX = 'knowledge-graph';

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
      isImportant: { type: 'boolean' },
      
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
  isImportant: boolean;
}

// Relation document type
export interface ESRelation {
  type: 'relation';
  from: string;
  to: string;
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
} 
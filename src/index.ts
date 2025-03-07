#!/usr/bin/env node

// @ts-ignore
import { Server } from "@modelcontextprotocol/sdk";
// @ts-ignore
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { KnowledgeGraphClient } from './kg-client.js';
import { ESEntity, ESRelation, ESSearchParams } from './es-types.js';

// Environment configuration for Elasticsearch
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const ES_USERNAME = process.env.ES_USERNAME;
const ES_PASSWORD = process.env.ES_PASSWORD;

// Configure ES client with authentication if provided
const esOptions: { node: string; auth?: { username: string; password: string } } = {
  node: ES_NODE
};

if (ES_USERNAME && ES_PASSWORD) {
  esOptions.auth = { username: ES_USERNAME, password: ES_PASSWORD };
}

// Create KG client
const kgClient = new KnowledgeGraphClient(esOptions);

// Helper function to format dates in YYYY-MM-DD format
function formatDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
}

// Start the MCP server
async function startServer() {
  // Initialize the knowledge graph
  await kgClient.initialize();
  console.log('Elasticsearch Knowledge Graph initialized');
  
  // Create and start the MCP server
  // @ts-ignore
  const server = new Server("memory", new StdioServerTransport());
  
  console.log('Starting MCP server...');

  // Register tools
  // @ts-ignore
  server.registerTool({
    name: "create_entities",
    description: "Create one or more entities in the knowledge graph",
    parameters: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              entityType: { type: "string" },
              observations: {
                type: "array",
                items: { type: "string" }
              },
              isImportant: { type: "boolean" }
            },
            required: ["name", "entityType", "observations"]
          }
        }
      },
      required: ["entities"]
    },
    handler: async (params: any) => {
      const { entities } = params;
      const createdEntities = [];
      
      for (const entity of entities) {
        // Save each entity
        const savedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations,
          isImportant: entity.isImportant
        });
        
        createdEntities.push(savedEntity);
      }
      
      return {
        entities: createdEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        }))
      };
    }
  });

  server.registerTool({
    name: "update_entities",
    description: "Update one or more entities in the knowledge graph",
    parameters: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              entityType: { type: "string" },
              observations: {
                type: "array",
                items: { type: "string" }
              },
              isImportant: { type: "boolean" }
            },
            required: ["name"]
          }
        }
      },
      required: ["entities"]
    },
    handler: async (params: any) => {
      const { entities } = params;
      const updatedEntities = [];
      const errors = [];
      
      for (const entity of entities) {
        try {
          // First get the existing entity
          const existingEntity = await kgClient.getEntity(entity.name);
          
          if (!existingEntity) {
            errors.push({
              name: entity.name,
              error: `Entity not found`
            });
            continue;
          }
          
          // Update fields that are provided, keep existing values for others
          const updatedEntity = await kgClient.saveEntity({
            name: entity.name,
            entityType: entity.entityType || existingEntity.entityType,
            observations: entity.observations || existingEntity.observations,
            isImportant: entity.isImportant !== undefined ? entity.isImportant : existingEntity.isImportant
          });
          
          updatedEntities.push(updatedEntity);
        } catch (error) {
          errors.push({
            name: entity.name,
            error: (error as Error).message
          });
        }
      }
      
      return {
        entities: updatedEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations,
          isImportant: e.isImportant
        })),
        errors: errors.length > 0 ? errors : undefined
      };
    }
  });

  server.registerTool({
    name: "delete_entities",
    description: "Delete one or more entities from the knowledge graph",
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["names"]
    },
    handler: async (params: any) => {
      const { names } = params;
      const results = [];
      
      for (const name of names) {
        try {
          // Delete the entity
          const success = await kgClient.deleteEntity(name);
          
          results.push({
            name,
            deleted: success
          });
        } catch (error) {
          results.push({
            name,
            deleted: false,
            error: (error as Error).message
          });
        }
      }
      
      return { results };
    }
  });

  server.registerTool({
    name: "create_relations",
    description: "Create relations between entities in the knowledge graph",
    parameters: {
      type: "object",
      properties: {
        relations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              relationType: { type: "string" }
            },
            required: ["from", "to", "relationType"]
          }
        }
      },
      required: ["relations"]
    },
    handler: async (params: any) => {
      const { relations } = params;
      const createdRelations = [];
      
      for (const relation of relations) {
        try {
          const savedRelation = await kgClient.saveRelation({
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType
          });
          
          createdRelations.push(savedRelation);
        } catch (error) {
          console.error(`Error creating relation: ${(error as Error).message}`);
        }
      }
      
      return {
        relations: createdRelations.map(r => ({
          from: r.from,
          to: r.to,
          relationType: r.relationType
        }))
      };
    }
  });

  server.registerTool({
    name: "delete_relations",
    description: "Delete relations between entities in the knowledge graph",
    parameters: {
      type: "object",
      properties: {
        relations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              relationType: { type: "string" }
            },
            required: ["from", "to", "relationType"]
          }
        }
      },
      required: ["relations"]
    },
    handler: async (params: any) => {
      const { relations } = params;
      const results = [];
      
      for (const relation of relations) {
        try {
          // Delete the relation
          const success = await kgClient.deleteRelation(
            relation.from,
            relation.to,
            relation.relationType
          );
          
          results.push({
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType,
            deleted: success
          });
        } catch (error) {
          results.push({
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType,
            deleted: false,
            error: (error as Error).message
          });
        }
      }
      
      return { results };
    }
  });

  server.registerTool({
    name: "search_nodes",
    description: "Search for entities in the knowledge graph using a query string",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        entityTypes: {
          type: "array",
          items: { type: "string" }
        },
        limit: { type: "number" },
        sortBy: {
          type: "string",
          enum: ["relevance", "recent", "importance"]
        }
      },
      required: ["query"]
    },
    handler: async (params: any) => {
      const { query, entityTypes, limit = 10, sortBy = "relevance" } = params;
      
      const searchParams: ESSearchParams = {
        query,
        entityTypes,
        limit,
        sortBy: sortBy as 'relevance' | 'recent' | 'importance'
      };
      
      const results = await kgClient.search(searchParams);
      
      // Transform the results to the expected format
      const entities = results.hits.hits
        .filter((hit: any) => hit._source.type === 'entity')
        .map((hit: any) => ({
          name: hit._source.name,
          entityType: hit._source.entityType,
          observations: (hit._source as ESEntity).observations,
          score: hit._score,
          highlights: hit.highlight || {}
        }));
      
      return { entities };
    }
  });

  server.registerTool({
    name: "open_nodes",
    description: "Get details about specific entities by name",
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["names"]
    },
    handler: async (params: any) => {
      const { names } = params;
      const entities = [];
      const relations = [];
      
      // Get each requested entity
      for (const name of names) {
        const entity = await kgClient.getEntity(name);
        if (entity) {
          entities.push({
            name: entity.name,
            entityType: entity.entityType,
            observations: entity.observations
          });
          
          // Get related entities (direct connections only)
          const related = await kgClient.getRelatedEntities(name, 1);
          
          // Add relations
          for (const relation of related.relations) {
            relations.push({
              from: relation.from,
              to: relation.to,
              relationType: relation.relationType
            });
          }
        }
      }
      
      return { entities, relations };
    }
  });

  server.registerTool({
    name: "add_observations",
    description: "Add observations to an existing entity",
    parameters: {
      type: "object",
      properties: {
        entityName: { type: "string" },
        observations: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["entityName", "observations"]
    },
    handler: async (params: any) => {
      const { entityName, observations } = params;
      
      // Get existing entity
      const entity = await kgClient.getEntity(entityName);
      if (!entity) {
        throw new Error(`Entity "${entityName}" not found`);
      }
      
      // Add new observations
      const updatedObservations = [
        ...entity.observations,
        ...observations
      ];
      
      // Update entity
      const updated = await kgClient.saveEntity({
        name: entity.name,
        entityType: entity.entityType,
        observations: updatedObservations,
        isImportant: entity.isImportant
      });
      
      return {
        entity: {
          name: updated.name,
          entityType: updated.entityType,
          observations: updated.observations
        }
      };
    }
  });

  server.registerTool({
    name: "mark_important",
    description: "Mark an entity as important",
    parameters: {
      type: "object",
      properties: {
        entityName: { type: "string" },
        isImportant: { type: "boolean" }
      },
      required: ["entityName", "isImportant"]
    },
    handler: async (params: any) => {
      const { entityName, isImportant } = params;
      
      // Get existing entity
      const entity = await kgClient.getEntity(entityName);
      if (!entity) {
        throw new Error(`Entity "${entityName}" not found`);
      }
      
      // Update entity importance
      const updated = await kgClient.saveEntity({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
        isImportant
      });
      
      return {
        entity: {
          name: updated.name,
          entityType: updated.entityType,
          observations: updated.observations,
          isImportant: updated.isImportant
        }
      };
    }
  });

  server.registerTool({
    name: "get_recent",
    description: "Get recently accessed entities",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number" },
        entityTypes: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    handler: async (params: any) => {
      const { limit = 10, entityTypes } = params;
      
      // Search with empty query but sort by recency
      const searchParams: ESSearchParams = {
        query: "",  // Empty query matches everything
        entityTypes,
        limit,
        sortBy: 'recent'
      };
      
      const results = await kgClient.search(searchParams);
      
      // Transform the results to the expected format
      const entities = results.hits.hits
        .filter((hit: any) => hit._source.type === 'entity')
        .map((hit: any) => ({
          name: hit._source.name,
          entityType: hit._source.entityType,
          observations: (hit._source as ESEntity).observations,
          lastRead: (hit._source as ESEntity).lastRead
        }));
      
      return { entities };
    }
  });

  // Start the server
  await server.start();
}

// Startup error handling
startServer().catch(error => {
  console.error('Error starting server:', error);
  process.exit(1);
}); 
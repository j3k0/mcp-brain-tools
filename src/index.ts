#!/usr/bin/env node

// @ts-ignore
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// @ts-ignore
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema
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
  // Use stderr for logging, not stdout
  console.error('Elasticsearch Knowledge Graph initialized');
  
  // Create the MCP server
  const server = new Server({
    name: "memory",
    version: "1.0.0",
  }, {
    capabilities: {
      tools: {},
      // Add empty resource and prompt capabilities to support list requests
      resources: {},
      prompts: {}
    },
  });
  
  console.error('Starting MCP server...');

  // Handle resources/list requests (return empty list)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: []
    };
  });

  // Handle prompts/list requests (return empty list)
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: []
    };
  });

  // Register the tools handler to list all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "create_entities",
          description: "Create multiple new entities in the knowledge graph",
          parameters: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "The name of the entity" },
                    entityType: { type: "string", description: "The type of the entity" },
                    observations: { 
                      type: "array", 
                      items: { type: "string" },
                      description: "List of observations about this entity"
                    },
                    isImportant: { type: "boolean", description: "Whether this entity is considered important" }
                  },
                  required: ["name", "entityType"]
                }
              }
            },
            required: ["entities"]
          }
        },
        // Add similar definitions for all other tools
        {
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
          }
        },
        {
          name: "delete_entities",
          description: "Delete one or more entities from the knowledge graph",
          parameters: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: { type: "string" },
                description: "Names of entities to delete"
              }
            },
            required: ["names"]
          }
        },
        {
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
                    from: { type: "string", description: "Name of the source entity" },
                    to: { type: "string", description: "Name of the target entity" },
                    type: { type: "string", description: "Type of relationship" },
                    metadata: { 
                      type: "object", 
                      additionalProperties: true,
                      description: "Additional metadata about the relationship"
                    }
                  },
                  required: ["from", "to", "type"]
                }
              }
            },
            required: ["relations"]
          }
        },
        {
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
                    type: { type: "string" }
                  },
                  required: ["from", "to", "type"]
                }
              }
            },
            required: ["relations"]
          }
        },
        {
          name: "search_nodes",
          description: "Search for entities in the knowledge graph using Elasticsearch query capabilities. The query parameter accepts Elasticsearch Query String syntax including boolean operators (AND, OR, NOT), wildcards (*), fuzzy matching (~N), proximity searches (\"phrase\"~N), boosting (^N), and field-specific searches (field:value).",
          parameters: {
            type: "object",
            properties: {
              query: { 
                type: "string", 
                description: "Search query text. Examples: 'important:true', 'name:Alice AND entityType:person', 'observations:meeting~2'" 
              },
              entityTypes: { 
                type: "array", 
                items: { type: "string" },
                description: "Optional filter to only return entities of specific types" 
              },
              limit: { 
                type: "integer", 
                description: "Maximum number of results to return (default: 10)" 
              },
              sortBy: { 
                type: "string", 
                enum: ["relevance", "recency", "importance"],
                description: "How to sort results: by relevance to query, by recent updates, or by importance flag" 
              }
            },
            required: ["query"]
          }
        },
        {
          name: "open_nodes",
          description: "Get details about specific entities by name",
          parameters: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: { type: "string" },
                description: "Names of entities to retrieve"
              }
            },
            required: ["names"]
          }
        },
        {
          name: "add_observations",
          description: "Add observations to an existing entity",
          parameters: {
            type: "object",
            properties: {
              name: { 
                type: "string",
                description: "Name of the entity to update"
              },
              observations: { 
                type: "array", 
                items: { type: "string" },
                description: "New observations to add to the entity"
              }
            },
            required: ["name", "observations"]
          }
        },
        {
          name: "mark_important",
          description: "Mark an entity as important",
          parameters: {
            type: "object",
            properties: {
              name: { 
                type: "string",
                description: "Name of the entity to mark as important"
              },
              important: { 
                type: "boolean",
                description: "Whether the entity should be marked as important (true) or not important (false)"
              }
            },
            required: ["name", "important"]
          }
        },
        {
          name: "get_recent",
          description: "Get recently accessed entities",
          parameters: {
            type: "object",
            properties: {
              limit: { 
                type: "integer",
                description: "Maximum number of entities to return"
              }
            }
          }
        }
      ]
    };
  });
  
  // Register the call tool handler to handle tool executions
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const params = request.params.parameters as any; // Type assertion to handle the unknown parameters
    
    if (toolName === "create_entities") {
      const entities = params.entities;
      const createdEntities = [];
      
      for (const entity of entities) {
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
    else if (toolName === "update_entities") {
      const entities = params.entities;
      const updatedEntities = [];
      
      for (const entity of entities) {
        // Get the existing entity first, then update with new values
        const existingEntity = await kgClient.getEntity(entity.name);
        if (!existingEntity) {
          throw new Error(`Entity "${entity.name}" not found`);
        }
        
        // Update with new values, preserving existing values for missing fields
        const updatedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType || existingEntity.entityType,
          observations: entity.observations || existingEntity.observations,
          isImportant: entity.isImportant !== undefined ? entity.isImportant : existingEntity.isImportant
        });
        
        updatedEntities.push(updatedEntity);
      }
      
      return {
        entities: updatedEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        }))
      };
    }
    else if (toolName === "delete_entities") {
      const names = params.names;
      const results = [];
      
      // Delete each entity individually
      for (const name of names) {
        const success = await kgClient.deleteEntity(name);
        results.push({ name, deleted: success });
      }
      
      return {
        success: true,
        results
      };
    }
    else if (toolName === "create_relations") {
      const relations = params.relations;
      const savedRelations = [];
      
      for (const relation of relations) {
        const savedRelation = await kgClient.saveRelation({
          from: relation.from,
          to: relation.to,
          relationType: relation.type // Map "type" from API to "relationType" in internal model
        });
        
        savedRelations.push(savedRelation);
      }
      
      return {
        relations: savedRelations.map(r => ({
          from: r.from,
          to: r.to,
          type: r.relationType // Map "relationType" from internal model to "type" in API
        }))
      };
    }
    else if (toolName === "delete_relations") {
      const relations = params.relations;
      const results = [];
      
      // Delete each relation individually
      for (const relation of relations) {
        const success = await kgClient.deleteRelation(
          relation.from, 
          relation.to, 
          relation.type // Map "type" from API to "relationType" in internal call
        );
        results.push({ 
          from: relation.from, 
          to: relation.to, 
          type: relation.type,
          deleted: success 
        });
      }
      
      return {
        success: true,
        results
      };
    }
    else if (toolName === "search_nodes") {
      const searchParams: ESSearchParams = {
        query: params.query,
        entityTypes: params.entityTypes,
        limit: params.limit || 10,
        sortBy: params.sortBy
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
    else if (toolName === "open_nodes") {
      const names = params.names;
      const entities = [];
      
      // Get each entity by name
      for (const name of names) {
        const entity = await kgClient.getEntity(name);
        if (entity) {
          entities.push(entity);
        }
      }
      
      return {
        entities: entities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations,
          lastRead: e.lastRead,
          isImportant: e.isImportant
        }))
      };
    }
    else if (toolName === "add_observations") {
      const name = params.name;
      const observations = params.observations;
      
      // Get existing entity
      const entity = await kgClient.getEntity(name);
      if (!entity) {
        throw new Error(`Entity "${name}" not found`);
      }
      
      // Add new observations to the existing ones
      const updatedObservations = [
        ...entity.observations,
        ...observations
      ];
      
      // Update the entity
      const updatedEntity = await kgClient.saveEntity({
        name: entity.name,
        entityType: entity.entityType,
        observations: updatedObservations,
        isImportant: entity.isImportant
      });
      
      return {
        entity: {
          name: updatedEntity.name,
          entityType: updatedEntity.entityType,
          observations: updatedEntity.observations
        }
      };
    }
    else if (toolName === "mark_important") {
      const name = params.name;
      const important = params.important;
      
      // Get existing entity
      const entity = await kgClient.getEntity(name);
      if (!entity) {
        throw new Error(`Entity "${name}" not found`);
      }
      
      // Update importance flag
      const updatedEntity = await kgClient.saveEntity({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
        isImportant: important
      });
      
      return {
        entity: {
          name: updatedEntity.name,
          entityType: updatedEntity.entityType,
          observations: updatedEntity.observations,
          isImportant: updatedEntity.isImportant
        }
      };
    }
    else if (toolName === "get_recent") {
      const limit = params.limit || 10;
      
      // Search with empty query but sort by recency
      const searchParams: ESSearchParams = {
        query: "", // Empty query matches everything
        limit: limit,
        sortBy: 'recent' // Assuming this is the correct value for recent sorting
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
    
    throw new Error(`Unknown tool: ${toolName}`);
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

// Startup error handling
startServer().catch(error => {
  console.error('Error starting server:', error);
  process.exit(1);
}); 
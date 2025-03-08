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
const DEBUG = process.env.DEBUG === 'true';

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
  try {
    // Initialize the knowledge graph
    await kgClient.initialize();
    // Use stderr for logging, not stdout
    console.error('Elasticsearch Knowledge Graph initialized');
  } catch (error) {
    console.error('Warning: Failed to connect to Elasticsearch:', error.message);
    console.error('The memory server will still start, but operations requiring Elasticsearch will fail');
  }
  
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
    if (DEBUG) {
      console.error('ListResourcesRequestSchema');
    }
    return {
      resources: []
    };
  });

  // Handle prompts/list requests (return empty list)
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    if (DEBUG) {
      console.error('ListPromptsRequestSchema');
    }
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
          description: "Create entities in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: {type: "string", description: "Entity name"},
                    entityType: {type: "string", description: "Entity type"},
                    observations: {
                      type: "array", 
                      items: {type: "string"},
                      description: "Observations about this entity"
                    },
                    relevanceScore: {type: "number", description: "Relevance score (higher = more important)"}
                  },
                  required: ["name", "entityType"]
                },
                description: "List of entities to create"
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone to create entities in. If not specified, uses the default zone."
              }
            },
            required: ["entities"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "update_entities",
          description: "Update entities in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                description: "List of entities to update",
                items: {
                  type: "object",
                  properties: {
                    name: {type: "string"},
                    entityType: {type: "string"},
                    observations: {
                      type: "array",
                      items: {type: "string"}
                    },
                    isImportant: {type: "boolean"}
                  },
                  required: ["name"]
                }
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone specifier. If provided, entities will be updated in this zone."
              }
            },
            required: ["entities"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "delete_entities",
          description: "Delete entities from knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: {type: "string"},
                description: "Names of entities to delete"
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone specifier. If provided, entities will be deleted from this zone."
              }
            },
            required: ["names"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "create_relations",
          description: "Create relationships between entities in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              relations: {
                type: "array",
                description: "List of relations to create",
                items: {
                  type: "object",
                  properties: {
                    from: {type: "string", description: "Source entity name"},
                    fromZone: {type: "string", description: "Optional zone for source entity, defaults to memory_zone or default zone"},
                    to: {type: "string", description: "Target entity name"},
                    toZone: {type: "string", description: "Optional zone for target entity, defaults to memory_zone or default zone"},
                    type: {type: "string", description: "Relationship type"}
                  },
                  required: ["from", "to", "type"]
                }
              },
              memory_zone: {
                type: "string",
                description: "Optional default memory zone specifier. Used if a relation doesn't specify fromZone or toZone."
              }
            },
            required: ["relations"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "delete_relations",
          description: "Delete relationships from knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              relations: {
                type: "array",
                description: "List of relations to delete",
                items: {
                  type: "object",
                  properties: {
                    from: {type: "string", description: "Source entity name"},
                    to: {type: "string", description: "Target entity name"},
                    type: {type: "string", description: "Relationship type"}
                  },
                  required: ["from", "to", "type"]
                }
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone specifier. If provided, relations will be deleted from this zone."
              }
            },
            required: ["relations"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "search_nodes",
          description: "Search for entities in knowledge graph (memory) using Elasticsearch query capabilities. Returns matching entities and their relations. Supports advanced Elasticsearch query syntax including: Boolean operators (AND, OR, NOT), fuzzy matching (~N), proximity searches (\"phrase\"~N), and boosting (^N). Examples: 'JC AND Hoelt' for Boolean AND; 'Thea OR Souad' for Boolean OR; 'Hoelt NOT JC' for Boolean NOT; 'Helt~1' for fuzzy matching; '\"technical issues\"~2' for proximity searches; 'JC^3 Hoelt' for boosting specific terms.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Elasticsearch query (supports boolean operators, wildcards, fuzzy matching)"
              },
              entityTypes: {
                type: "array",
                items: {type: "string"},
                description: "Filter by entity types"
              },
              limit: {
                type: "integer",
                description: "Max results (default: 20 if includeObservations is false, 5 if true)"
              },
              sortBy: {
                type: "string",
                enum: ["relevance", "recency", "importance"],
                description: "Sort by relevance, recency, or importance"
              },
              includeObservations: {
                type: "boolean",
                description: "Whether to include full entity observations in results (default: false)",
                default: false
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone specifier. If provided, search will be limited to this zone."
              }
            },
            required: ["query"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "open_nodes",
          description: "Get details about specific entities in knowledge graph (memory) and their relations",
          inputSchema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: {type: "string"},
                description: "Names of entities to retrieve"
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone to retrieve entities from. If not specified, uses the default zone."
              }
            },
            required: ["names"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "add_observations",
          description: "Add observations to an existing entity in knowledge graph (memory)",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Name of entity to add observations to"
              },
              observations: {
                type: "array",
                items: {type: "string"},
                description: "Observations to add to the entity"
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone where the entity is stored. If not specified, uses the default zone."
              }
            },
            required: ["name", "observations"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "mark_important",
          description: "Mark entity as important in knowledge graph (memory) by boosting its relevance score",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Entity name"
              },
              important: {
                type: "boolean",
                description: "Set as important (true - multiply relevance by 10) or not (false - divide relevance by 10)"
              }
            },
            required: ["name", "important"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "get_recent",
          description: "Get recently accessed entities from knowledge graph (memory) and their relations",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "integer",
                description: "Max results (default: 20 if includeObservations is false, 5 if true)"
              },
              includeObservations: {
                type: "boolean",
                description: "Whether to include full entity observations in results (default: false)",
                default: false
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone to get recent entities from. If not specified, uses the default zone."
              }
            },
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        }
      ]
    };
  });
  
  // Register the call tool handler to handle tool executions
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (DEBUG) {
      console.error('Tool request received:', request.params.name);
      console.error('Tool request params:', JSON.stringify(request.params));
    }
    
    const toolName = request.params.name;
    // When using inputSchema, client sends parameters in 'arguments' not 'parameters'
    const params = request.params.arguments as any; // Type assertion to handle the unknown parameters
    
    if (DEBUG) {
      console.error('Parsed parameters:', JSON.stringify(params));
    }
    
    // Helper function to format response for Claude
    const formatResponse = (data: any) => {
      // Convert result to string for text field
      const stringifiedData = JSON.stringify(data, null, 2);
      return {
        content: [
          {
            type: "text",
            text: stringifiedData,
          },
        ],
      };
    };
    
    if (toolName === "create_entities") {
      const entities = params.entities;
      const zone = params.memory_zone;
      
      // First, check if any entities already exist
      const conflictingEntities = [];
      for (const entity of entities) {
        const existingEntity = await kgClient.getEntity(entity.name, zone);
        if (existingEntity) {
          conflictingEntities.push(entity.name);
        }
      }
      
      // If there are conflicts, reject the entire operation
      if (conflictingEntities.length > 0) {
        const zoneMsg = zone ? ` in zone "${zone}"` : "";
        return formatResponse({
          success: false,
          error: `Entity creation failed: Conflicts detected${zoneMsg}`,
          conflicts: conflictingEntities,
          message: "Please use update_entities for modifying existing entities."
        });
      }
      
      // If no conflicts, proceed with entity creation
      const createdEntities = [];
      for (const entity of entities) {
        const savedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations,
          relevanceScore: entity.relevanceScore
        }, zone);
        
        createdEntities.push(savedEntity);
      }
      
      return formatResponse({
        success: true,
        entities: createdEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        }))
      });
    }
    else if (toolName === "update_entities") {
      const entities = params.entities;
      const zone = params.memory_zone;
      const updatedEntities = [];
      
      for (const entity of entities) {
        // Get the existing entity first, then update with new values
        const existingEntity = await kgClient.getEntity(entity.name, zone);
        if (!existingEntity) {
          const zoneMsg = zone ? ` in zone "${zone}"` : "";
          throw new Error(`Entity "${entity.name}" not found${zoneMsg}`);
        }
        
        // Update with new values, preserving existing values for missing fields
        const updatedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType || existingEntity.entityType,
          observations: entity.observations || existingEntity.observations,
          relevanceScore: entity.relevanceScore || existingEntity.relevanceScore
        }, zone);
        
        updatedEntities.push(updatedEntity);
      }
      
      return formatResponse({
        entities: updatedEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        }))
      });
    }
    else if (toolName === "delete_entities") {
      const names = params.names;
      const zone = params.memory_zone;
      const results = [];
      
      // Delete each entity individually
      for (const name of names) {
        const success = await kgClient.deleteEntity(name, zone);
        results.push({ name, deleted: success });
      }
      
      return formatResponse({
        success: true,
        results
      });
    }
    else if (toolName === "create_relations") {
      const relations = params.relations;
      const defaultZone = params.memory_zone;
      const savedRelations = [];
      
      for (const relation of relations) {
        const fromZone = relation.fromZone || defaultZone;
        const toZone = relation.toZone || defaultZone;
        
        const savedRelation = await kgClient.saveRelation({
          from: relation.from,
          to: relation.to,
          relationType: relation.type
        }, fromZone, toZone);
        
        savedRelations.push(savedRelation);
      }
      
      return formatResponse({
        relations: savedRelations.map(r => ({
          from: r.from,
          to: r.to,
          type: r.relationType
        }))
      });
    }
    else if (toolName === "delete_relations") {
      const relations = params.relations;
      const zone = params.memory_zone;
      const results = [];
      
      // Delete each relation individually
      for (const relation of relations) {
        const success = await kgClient.deleteRelation(
          relation.from, 
          relation.to, 
          relation.type,
          zone,
          zone
        );
        results.push({ 
          from: relation.from, 
          to: relation.to, 
          type: relation.type,
          deleted: success 
        });
      }
      
      return formatResponse({
        success: true,
        results
      });
    }
    else if (toolName === "search_nodes") {
      const includeObservations = params.includeObservations ?? false;
      const defaultLimit = includeObservations ? 5 : 20;
      const zone = params.memory_zone;
      
      const searchParams: ESSearchParams = {
        query: params.query,
        entityTypes: params.entityTypes,
        limit: params.limit || defaultLimit,
        sortBy: params.sortBy,
        includeObservations,
        zone
      };
      
      const results = await kgClient.search(searchParams);
      
      // Transform the results to the expected format, removing unnecessary fields
      const entities = results.hits.hits
        .filter((hit: any) => hit._source.type === 'entity')
        .map((hit: any) => {
          const entity: any = {
            name: hit._source.name,
            entityType: hit._source.entityType,
          };
          
          // Only include observations and timestamps if requested
          if (includeObservations) {
            entity.observations = (hit._source as ESEntity).observations;
            entity.lastWrite = (hit._source as ESEntity).lastWrite;
            entity.lastRead = (hit._source as ESEntity).lastRead;
          }
          
          return entity;
        });
      
      // Get relations between these entities
      const entityNames = entities.map(e => e.name);
      const { relations } = await kgClient.getRelationsForEntities(entityNames);
      
      // Map relations to the expected format
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType
      }));
      
      return formatResponse({ entities, relations: formattedRelations });
    }
    else if (toolName === "open_nodes") {
      const names = params.names || [];
      const zone = params.memory_zone;
      
      // Get the entities
      const entities: ESEntity[] = [];
      for (const name of names) {
        const entity = await kgClient.getEntity(name, zone);
        if (entity) {
          entities.push(entity);
        }
      }
      
      // Format entities
      const formattedEntities = entities.map(e => ({
        name: e.name,
        entityType: e.entityType,
        observations: e.observations
      }));
      
      // Get relations between these entities
      const entityNames = formattedEntities.map(e => e.name);
      const { relations } = await kgClient.getRelationsForEntities(entityNames, zone);
      
      // Map relations to the expected format
      const formattedRelations = relations.map(r => ({
        from: r.from,
        to: r.to,
        type: r.relationType
      }));
      
      return formatResponse({ entities: formattedEntities, relations: formattedRelations });
    }
    else if (toolName === "add_observations") {
      const name = params.name;
      const observations = params.observations;
      const zone = params.memory_zone;
      
      // Get existing entity
      const entity = await kgClient.getEntity(name, zone);
      if (!entity) {
        const zoneMsg = zone ? ` in zone "${zone}"` : "";
        return formatResponse({
          success: false,
          error: `Entity "${name}" not found${zoneMsg}`,
          message: "Please create the entity before adding observations."
        });
      }
      
      // Add observations to the entity
      const updatedEntity = await kgClient.addObservations(name, observations, zone);
      
      return formatResponse({
        success: true,
        entity: updatedEntity
      });
    }
    else if (toolName === "mark_important") {
      const name = params.name;
      const important = params.important;
      const zone = params.memory_zone;
      
      // Get existing entity
      const entity = await kgClient.getEntity(name, zone);
      if (!entity) {
        const zoneMsg = zone ? ` in zone "${zone}"` : "";
        return formatResponse({
          success: false,
          error: `Entity "${name}" not found${zoneMsg}`,
          message: "Please create the entity before marking it as important."
        });
      }
      
      // Mark the entity as important
      const updatedEntity = await kgClient.markImportant(name, important, zone);
      
      return formatResponse({
        success: true,
        entity: updatedEntity
      });
    }
    else if (toolName === "get_recent") {
      const limit = params.limit || 20;
      const includeObservations = params.includeObservations ?? false;
      const zone = params.memory_zone;
      
      const recentEntities = await kgClient.getRecentEntities(limit, includeObservations, zone);
      
      return formatResponse({
        entities: recentEntities.map(e => ({
          name: e.name,
          entityType: e.entityType,
          observations: e.observations
        })),
        total: recentEntities.length
      });
    }
  });

  return server;
}

// Start the server with proper transport and error handling
async function initServer() {
  const server = await startServer();
  
  // Connect the server to the transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

// Initialize with error handling
initServer().catch(error => {
  console.error('Error starting server:', error);
  process.exit(1);
});
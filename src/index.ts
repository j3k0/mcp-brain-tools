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
import GroqAI from './ai-service.js';
import { inspectFile } from './filesystem/index.js';

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
          name: "inspect_files",
          description: "Agent driven file inspection that uses AI to retrieve relevant content from multiple files.",
          inputSchema: {
            type: "object",
            properties: {
              file_paths: {
                type: "array",
                items: { type: "string" },
                description: "Paths to the files to inspect"
              },
              information_needed: {
                type: "string",
                description: "Full description of what information is needed from the files, including the context of the information needed. Do not be vague, be specific. The AI agent does not have access to your context, only this \"information needed\" and \"reason\" fields. That's all it will use to decide that a line is relevant to the information needed. So provide a detailed specific description, listing all the details about what you are looking for."
              },
              reason: {
                type: "string",
                description: "Explain why this information is needed to help the AI agent give better results. The more context you provide, the better the results will be."
              },
              include_lines: {
                type: "boolean",
                description: "Whether to include the actual line content in the response, which uses more of your limited token quota, but gives more informatiom (default: false)"
              }
            },
            required: ["file_paths", "information_needed", "include_lines"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
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
                    }
                  },
                  required: ["name", "entityType"]
                },
                description: "List of entities to create"
              },
              memory_zone: {
                type: "string",
                description: "Memory zone to create entities in."
              }
            },
            required: ["entities", "memory_zone"],
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
                description: "Memory zone specifier. Entities will be updated in this zone."
              }
            },
            required: ["entities", "memory_zone"],
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
                description: "Memory zone specifier. Entities will be deleted from this zone."
              },
              cascade_relations: {
                type: "boolean",
                description: "Whether to delete relations involving these entities (default: true)",
                default: true
              }
            },
            required: ["names", "memory_zone"],
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
                    fromZone: {type: "string", description: "Optional zone for source entity, defaults to memory_zone or default zone. Must be one of the existing zones."},
                    to: {type: "string", description: "Target entity name"},
                    toZone: {type: "string", description: "Optional zone for target entity, defaults to memory_zone or default zone. Must be one of the existing zones."},
                    type: {type: "string", description: "Relationship type"}
                  },
                  required: ["from", "to", "type"]
                }
              },
              memory_zone: {
                type: "string",
                description: "Optional default memory zone specifier. Used if a relation doesn't specify fromZone or toZone."
              },
              auto_create_missing_entities: {
                type: "boolean",
                description: "Whether to automatically create missing entities in the relations (default: true)",
                default: true
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
          description: "Search entities using ElasticSearch query syntax. Supports boolean operators (AND, OR, NOT), fuzzy matching (~), phrases (\"term\"), proximity (\"terms\"~N), wildcards (*, ?), and boosting (^N). Examples: 'meeting AND notes', 'Jon~', '\"project plan\"~2'. All searches respect zone isolation.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "ElasticSearch query string."
              },
              informationNeeded: {
                type: "string",
                description: "Important. Describe what information you are looking for, to give a precise context to the search engine AI agent. What questions are you trying to answer? Helps get more useful results."
              },
              reason: {
                type: "string",
                description: "Explain why this information is needed to help the AI agent give better results. The more context you provide, the better the results will be."
              },
              entityTypes: {
                type: "array",
                items: {type: "string"},
                description: "Filter to specific entity types (OR condition if multiple)."
              },
              limit: {
                type: "integer",
                description: "Max results (default: 20, or 5 with observations)."
              },
              sortBy: {
                type: "string",
                enum: ["relevance", "recency", "importance"],
                description: "Sort by match quality, access time, or importance."
              },
              includeObservations: {
                type: "boolean",
                description: "Include full entity observations (default: false).",
                default: false
              },
              memory_zone: {
                type: "string",
                description: "Limit search to specific zone. Omit for default zone."
              },
            },
            required: ["query", "memory_zone", "informationNeeded", "reason"],
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
            required: ["names", "memory_zone"],
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
            required: ["memory_zone", "name", "observations"],
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
              },
              memory_zone: {
                type: "string",
                description: "Optional memory zone specifier. If provided, entity will be marked in this zone."
              },
              auto_create: {
                type: "boolean",
                description: "Whether to automatically create the entity if it doesn't exist (default: false)",
                default: false
              }
            },
            required: ["memory_zone", "name", "important"],
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
            required: ["memory_zone"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "list_zones",
          description: "List all available memory zones with metadata. When a reason is provided, zones will be filtered and prioritized based on relevance to your needs.",
          inputSchema: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description: "Reason for listing zones. What zones are you looking for? Why are you looking for them? The AI will use this to prioritize and filter relevant zones."
              }
            },
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
        {
          name: "create_zone",
          description: "Create a new memory zone with optional description.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Zone name (cannot be 'default')"
              },
              shortDescription: {
                type: "string",
                description: "Short description of the zone."
              },
              description: {
                type: "string",
                description: "Full zone description. Make it very descriptive and detailed."
              }
            },
            required: ["name"]
          }
        },
        {
          name: "delete_zone",
          description: "Delete a memory zone and all its entities/relations.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Zone name to delete (cannot be 'default')"
              },
              confirm: {
                type: "boolean",
                description: "Confirmation flag, must be true",
                default: false
              }
            },
            required: ["name", "confirm"]
          }
        },
        {
          name: "copy_entities",
          description: "Copy entities between zones with optional relation handling.",
          inputSchema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: { type: "string" },
                description: "Entity names to copy"
              },
              source_zone: {
                type: "string",
                description: "Source zone"
              },
              target_zone: {
                type: "string",
                description: "Target zone"
              },
              copy_relations: {
                type: "boolean",
                description: "Copy related relationships (default: true)",
                default: true
              },
              overwrite: {
                type: "boolean",
                description: "Overwrite if entity exists (default: false)",
                default: false
              }
            },
            required: ["names", "source_zone", "target_zone"]
          }
        },
        {
          name: "move_entities",
          description: "Move entities between zones (copy + delete from source).",
          inputSchema: {
            type: "object",
            properties: {
              names: {
                type: "array",
                items: { type: "string" },
                description: "Entity names to move"
              },
              source_zone: {
                type: "string",
                description: "Source zone"
              },
              target_zone: {
                type: "string",
                description: "Target zone"
              },
              move_relations: {
                type: "boolean",
                description: "Move related relationships (default: true)",
                default: true
              },
              overwrite: {
                type: "boolean",
                description: "Overwrite if entity exists (default: false)",
                default: false
              }
            },
            required: ["names", "source_zone", "target_zone"]
          }
        },
        {
          name: "merge_zones",
          description: "Merge multiple zones with conflict resolution options.",
          inputSchema: {
            type: "object",
            properties: {
              source_zones: {
                type: "array",
                items: { type: "string" },
                description: "Source zones to merge from"
              },
              target_zone: {
                type: "string",
                description: "Target zone to merge into"
              },
              delete_source_zones: {
                type: "boolean",
                description: "Delete source zones after merging",
                default: false
              },
              overwrite_conflicts: {
                type: "string",
                enum: ["skip", "overwrite", "rename"],
                description: "How to handle name conflicts",
                default: "skip"
              }
            },
            required: ["source_zones", "target_zone"]
          }
        },
        {
          name: "zone_stats",
          description: "Get statistics for entities and relationships in a zone.",
          inputSchema: {
            type: "object",
            properties: {
              zone: {
                type: "string",
                description: "Zone name (omit for default zone)"
              }
            },
            required: ["zone"]
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
    const params = request.params.arguments as any;
    
    if (DEBUG) {
      console.error('Parsed parameters:', JSON.stringify(params));
    }

    // Helper function to format response for Claude
    const formatResponse = (data: any) => {
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

    if (toolName === "inspect_files") {
      const { file_paths, information_needed, reason, include_lines } = params;
      const results = [];

      for (const filePath of file_paths) {
        try {
          const fileResults = await inspectFile(filePath, information_needed, reason);
          results.push({
            filePath,
            lines: include_lines ? fileResults.lines.map(line => `${line.lineNumber}:${line.content}`) : [],
            tentativeAnswer: fileResults.tentativeAnswer
          });
        } catch (error) {
          results.push({
            filePath,
            error: error.message
          });
        }
      }
      
      return formatResponse({
        success: true,
        results
      });
    }
    else if (toolName === "create_entities") {
      const entities = params.entities;
      const zone = params.memory_zone;
      
      // First, check if any entities already exist or have empty names
      const conflictingEntities = [];
      const invalidEntities = [];
      
      for (const entity of entities) {
        // Check for empty names
        if (!entity.name || entity.name.trim() === '') {
          invalidEntities.push({
            name: "[empty]",
            reason: "Entity name cannot be empty"
          });
          continue;
        }
        
        const existingEntity = await kgClient.getEntity(entity.name, zone);
        if (existingEntity) {
          conflictingEntities.push(entity.name);
        }
      }
      
      // If there are conflicts or invalid entities, reject the operation
      if (conflictingEntities.length > 0 || invalidEntities.length > 0) {
        const zoneMsg = zone ? ` in zone "${zone}"` : "";
        
        // Fetch existing entity details if there are conflicts
        const existingEntitiesData = [];
        if (conflictingEntities.length > 0) {
          for (const entityName of conflictingEntities) {
            const existingEntity = await kgClient.getEntity(entityName, zone);
            if (existingEntity) {
              existingEntitiesData.push(existingEntity);
            }
          }
        }
        
        return formatResponse({
          success: false,
          error: `Entity creation failed${zoneMsg}, no entities were created.`,
          conflicts: conflictingEntities.length > 0 ? conflictingEntities : undefined,
          existingEntities: existingEntitiesData.length > 0 ? existingEntitiesData : undefined,
          invalidEntities: invalidEntities.length > 0 ? invalidEntities : undefined,
          message: conflictingEntities.length > 0 ? 
            "Feel free to extend existing entities with more information if needed, or create entities with different names. Use update_entities to modify existing entities." : 
            "Please provide valid entity names for all entities."
        });
      }
      
      // If no conflicts, proceed with entity creation
      const createdEntities = [];
      for (const entity of entities) {
        const savedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations,
          relevanceScore: entity.relevanceScore ?? 1.0
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
          relevanceScore: entity.relevanceScore || ((existingEntity.relevanceScore ?? 1.0) * 2.0)
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
      const cascadeRelations = params.cascade_relations !== false; // Default to true
      const results = [];
      const invalidNames = [];
      
      // Validate names before attempting deletion
      for (const name of names) {
        if (!name || name.trim() === '') {
          invalidNames.push("[empty]");
          continue;
        }
      }
      
      // If there are invalid names, reject those operations
      if (invalidNames.length > 0) {
        return formatResponse({
          success: false,
          error: "Entity deletion failed for some entities",
          invalidNames,
          message: "Entity names cannot be empty"
        });
      }
      
      // Delete each valid entity individually
      for (const name of names) {
        try {
          const success = await kgClient.deleteEntity(name, zone, {
            cascadeRelations
          });
          results.push({ name, deleted: success });
        } catch (error) {
          results.push({ name, deleted: false, error: error.message });
        }
      }
      
      return formatResponse({
        success: true,
        results
      });
    }
    else if (toolName === "create_relations") {
      const relations = params.relations;
      const defaultZone = params.memory_zone;
      const autoCreateMissingEntities = params.auto_create_missing_entities !== false; // Default to true for backward compatibility
      const savedRelations = [];
      const failedRelations = [];
      
      for (const relation of relations) {
        const fromZone = relation.fromZone || defaultZone;
        const toZone = relation.toZone || defaultZone;
        
        try {
          const savedRelation = await kgClient.saveRelation({
            from: relation.from,
            to: relation.to,
            relationType: relation.type
          }, fromZone, toZone, { autoCreateMissingEntities });
          
          savedRelations.push(savedRelation);
        } catch (error) {
          failedRelations.push({
            relation,
            error: error.message
          });
        }
      }
      
      // If there were any failures, include them in the response
      if (failedRelations.length > 0) {
        return formatResponse({
          success: savedRelations.length > 0,
          relations: savedRelations.map(r => ({
            from: r.from,
            to: r.to,
            type: r.relationType,
            fromZone: r.fromZone,
            toZone: r.toZone
          })),
          failedRelations
        });
      }
      
      return formatResponse({
        success: true,
        relations: savedRelations.map(r => ({
          from: r.from,
          to: r.to,
          type: r.relationType,
          fromZone: r.fromZone,
          toZone: r.toZone
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
      const zone = params.memory_zone;
      
      // Use the high-level userSearch method that handles AI filtering internally
      const { entities: filteredEntities, relations: formattedRelations } = await kgClient.userSearch({
        query: params.query,
        entityTypes: params.entityTypes,
        limit: params.limit,
        sortBy: params.sortBy,
        includeObservations,
        zone,
        informationNeeded: params.informationNeeded,
        reason: params.reason
      });
      
      return formatResponse({ entities: filteredEntities, relations: formattedRelations });
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
        type: r.relationType,
        fromZone: r.fromZone,
        toZone: r.toZone
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
      const autoCreate = params.auto_create === true;
      
      try {
        // Mark the entity as important, with auto-creation if specified
        const updatedEntity = await kgClient.markImportant(name, important, zone, {
          autoCreateMissingEntities: autoCreate
        });
        
        return formatResponse({
          success: true,
          entity: updatedEntity,
          auto_created: autoCreate && !(await kgClient.getEntity(name, zone))
        });
      } catch (error) {
        const zoneMsg = zone ? ` in zone "${zone}"` : "";
        return formatResponse({
          success: false,
          error: `Entity "${name}" not found${zoneMsg}`,
          message: "Please create the entity before marking it as important, or set auto_create to true."
        });
      }
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
    else if (toolName === "list_zones") {
      const reason = params.reason;
      const zones = await kgClient.listMemoryZones(reason);
      
      // If reason is provided and GroqAI is available, use AI to score zone usefulness
      if (reason && GroqAI.isEnabled && zones.length > 0) {
        try {
          // Get usefulness scores for each zone
          const usefulnessScores = await GroqAI.classifyZoneUsefulness(zones, reason);
          
          // Process zones based on their usefulness scores
          const processedZones = zones.map(zone => {
            const usefulness = usefulnessScores[zone.name] !== undefined ? 
              usefulnessScores[zone.name] : 2; // Default to very useful (2) if not classified
            
            // Format zone info based on usefulness score
            if (usefulness === 0) { // Not useful
              return {
                name: zone.name,
                usefulness: 'not useful'
              };
            } else if (usefulness === 1) { // A little useful
              return {
                name: zone.name,
                description: zone.description,
                usefulness: 'a little useful'
              };
            } else { // Very useful (2) or default
              return {
                name: zone.name,
                description: zone.description,
                created_at: zone.createdAt,
                last_modified: zone.lastModified,
                config: zone.config,
                usefulness: 'very useful'
              };
            }
          });
          
          // Sort zones by usefulness (most useful first)
          processedZones.sort((a, b) => {
            const scoreA = usefulnessScores[a.name] !== undefined ? usefulnessScores[a.name] : 2;
            const scoreB = usefulnessScores[b.name] !== undefined ? usefulnessScores[b.name] : 2;
            return scoreB - scoreA; // Descending order
          });
          
          return formatResponse({
            zones: processedZones
          });
        } catch (error) {
          console.error('Error classifying zones:', error);
          // Fall back to default behavior
        }
      }
      
      // Default behavior (no reason provided or AI failed)
      return formatResponse({
        zones: zones.map(zone => ({
          name: zone.name,
          description: zone.description,
          created_at: zone.createdAt,
          last_modified: zone.lastModified,
          usefulness: 'very useful' // Default to very useful when no AI filtering is done
        }))
      });
    }
    else if (toolName === "create_zone") {
      const name = params.name;
      const description = params.description;
      
      try {
        await kgClient.addMemoryZone(name, description);
        
        return formatResponse({
          success: true,
          zone: name,
          message: `Zone "${name}" created successfully`
        });
      } catch (error) {
        return formatResponse({
          success: false,
          error: `Failed to create zone: ${(error as Error).message}`
        });
      }
    }
    else if (toolName === "delete_zone") {
      const name = params.name;
      const confirm = params.confirm === true;
      
      if (!confirm) {
        return formatResponse({
          success: false,
          error: "Confirmation required. Set confirm=true to proceed with deletion."
        });
      }
      
      try {
        const result = await kgClient.deleteMemoryZone(name);
        
        if (result) {
          return formatResponse({
            success: true,
            message: `Zone "${name}" deleted successfully`
          });
        } else {
          return formatResponse({
            success: false,
            error: `Failed to delete zone "${name}"`
          });
        }
      } catch (error) {
        return formatResponse({
          success: false,
          error: `Error deleting zone: ${(error as Error).message}`
        });
      }
    }
    else if (toolName === "copy_entities") {
      const names = params.names;
      const sourceZone = params.source_zone;
      const targetZone = params.target_zone;
      const copyRelations = params.copy_relations !== false;
      const overwrite = params.overwrite === true;
      
      try {
        const result = await kgClient.copyEntitiesBetweenZones(
          names,
          sourceZone,
          targetZone,
          {
            copyRelations,
            overwrite
          }
        );
        
        return formatResponse({
          success: result.entitiesCopied.length > 0,
          entities_copied: result.entitiesCopied,
          entities_skipped: result.entitiesSkipped,
          relations_copied: result.relationsCopied
        });
      } catch (error) {
        return formatResponse({
          success: false,
          error: `Error copying entities: ${(error as Error).message}`
        });
      }
    }
    else if (toolName === "move_entities") {
      const names = params.names;
      const sourceZone = params.source_zone;
      const targetZone = params.target_zone;
      const moveRelations = params.move_relations !== false;
      const overwrite = params.overwrite === true;
      
      try {
        const result = await kgClient.moveEntitiesBetweenZones(
          names,
          sourceZone,
          targetZone,
          {
            moveRelations,
            overwrite
          }
        );
        
        return formatResponse({
          success: result.entitiesMoved.length > 0,
          entities_moved: result.entitiesMoved,
          entities_skipped: result.entitiesSkipped,
          relations_moved: result.relationsMoved
        });
      } catch (error) {
        return formatResponse({
          success: false,
          error: `Error moving entities: ${(error as Error).message}`
        });
      }
    }
    else if (toolName === "merge_zones") {
      const sourceZones = params.source_zones;
      const targetZone = params.target_zone;
      const deleteSourceZones = params.delete_source_zones === true;
      const overwriteConflicts = params.overwrite_conflicts || 'skip';
      
      try {
        const result = await kgClient.mergeZones(
          sourceZones,
          targetZone,
          {
            deleteSourceZones,
            overwriteConflicts: overwriteConflicts as 'skip' | 'overwrite' | 'rename'
          }
        );
        
        return formatResponse({
          success: result.mergedZones.length > 0,
          merged_zones: result.mergedZones,
          failed_zones: result.failedZones,
          entities_copied: result.entitiesCopied,
          entities_skipped: result.entitiesSkipped,
          relations_copied: result.relationsCopied
        });
      } catch (error) {
        return formatResponse({
          success: false,
          error: `Error merging zones: ${(error as Error).message}`
        });
      }
    }
    else if (toolName === "zone_stats") {
      const zone = params.zone;
      
      try {
        const stats = await kgClient.getMemoryZoneStats(zone);
        
        return formatResponse({
          zone: stats.zone,
          entity_count: stats.entityCount,
          relation_count: stats.relationCount,
          entity_types: stats.entityTypes,
          relation_types: stats.relationTypes
        });
      } catch (error) {
        return formatResponse({
          success: false,
          error: `Error getting zone stats: ${(error as Error).message}`
        });
      }
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
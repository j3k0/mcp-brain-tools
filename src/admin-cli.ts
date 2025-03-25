#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { KnowledgeGraphClient } from './kg-client.js';
import { ESEntity, ESRelation, KG_RELATIONS_INDEX } from './es-types.js';
import { importFromJsonFile, exportToJsonFile } from './json-to-es.js';
import readline from 'readline';
import GroqAI from './ai-service.js';

// Environment configuration for Elasticsearch
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const ES_USERNAME = process.env.ES_USERNAME;
const ES_PASSWORD = process.env.ES_PASSWORD;
const DEFAULT_ZONE = process.env.KG_DEFAULT_ZONE || 'default';

// Configure ES client with authentication if provided
const esOptions: { 
  node: string; 
  auth?: { username: string; password: string };
  defaultZone?: string;
} = {
  node: ES_NODE,
  defaultZone: DEFAULT_ZONE
};

if (ES_USERNAME && ES_PASSWORD) {
  esOptions.auth = { username: ES_USERNAME, password: ES_PASSWORD };
}

// Create KG client
const kgClient = new KnowledgeGraphClient(esOptions);

/**
 * Display help information
 */
function showHelp() {
  console.log('Knowledge Graph Admin CLI');
  console.log('========================');
  console.log('');
  console.log('Commands:');
  console.log('  init                       Initialize the Elasticsearch index');
  console.log('  import <file> [zone]       Import data from a JSON file (optionally to a specific zone)');
  console.log('  export <file> [zone]       Export data to a JSON file (optionally from a specific zone)');
  console.log('  backup <file>              Backup all zones and relations to a file');
  console.log('  restore <file> [--yes]     Restore all zones and relations from a backup file');
  console.log('  stats [zone]               Display statistics about the knowledge graph');
  console.log('  search <query> [zone]      Search the knowledge graph');
  console.log('  reset [zone] [--yes]       Reset the knowledge graph (delete all data)');
  console.log('  entity <n> [zone]          Display information about a specific entity');
  console.log('  zones list                 List all memory zones');
  console.log('  zones add <name> [desc]    Add a new memory zone');
  console.log('  zones delete <name> [--yes] Delete a memory zone and all its data');
  console.log('  zones stats <name>         Show statistics for a specific zone');
  console.log('  zones update_descriptions <name> [limit] [prompt]');
  console.log('                             Generate AI descriptions based on zone content');
  console.log('                             (limit: optional entity limit, prompt: optional description of zone purpose)');
  console.log('  relations <entity> [zone]  Show relations for a specific entity');
  console.log('  help                       Show this help information');
  console.log('');
  console.log('Options:');
  console.log('  --yes, -y                  Automatically confirm all prompts (for scripts)');
  console.log('');
  console.log('Environment variables:');
  console.log('  ES_NODE                    Elasticsearch node URL (default: http://localhost:9200)');
  console.log('  ES_USERNAME                Elasticsearch username (if authentication is required)');
  console.log('  ES_PASSWORD                Elasticsearch password (if authentication is required)');
  console.log('  KG_DEFAULT_ZONE            Default zone to use (default: "default")');
}

/**
 * Initialize the Elasticsearch index
 */
async function initializeIndex() {
  try {
    await kgClient.initialize();
    console.log('Elasticsearch indices initialized successfully');
  } catch (error) {
    console.error('Error initializing index:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Display statistics about the knowledge graph or a specific zone
 */
async function showStats(zone?: string) {
  try {
    // Initialize client
    await kgClient.initialize(zone);
    
    if (zone) {
      // Get zone-specific stats
      const stats = await kgClient.getMemoryZoneStats(zone);
      
      console.log(`Knowledge Graph Statistics for Zone: ${zone}`);
      console.log('=============================================');
      console.log(`Total entities: ${stats.entityCount}`);
      console.log(`Total relations: ${stats.relationCount}`);
      console.log('');
      
      console.log('Entity types:');
      Object.entries(stats.entityTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      console.log('');
      
      console.log('Relation types:');
      Object.entries(stats.relationTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    } else {
      // Get all zone metadata
      const zones = await kgClient.listMemoryZones();
      console.log('Knowledge Graph Multi-zone Statistics');
      console.log('====================================');
      console.log(`Total zones: ${zones.length}`);
      console.log('');
      
      console.log('Zones:');
      for (const zone of zones) {
        console.log(`Zone: ${zone.name}`);
        console.log(`  Description: ${zone.description || 'N/A'}`);
        console.log(`  Created: ${zone.createdAt}`);
        console.log(`  Last modified: ${zone.lastModified}`);
        
        // Get zone stats
        const stats = await kgClient.getMemoryZoneStats(zone.name);
        console.log(`  Entities: ${stats.entityCount}`);
        console.log(`  Relations: ${stats.relationCount}`);
        console.log('');
      }
      
      // Get relation stats
      const data = await kgClient.exportData();
      const relations = data.filter(item => item.type === 'relation');
      
      console.log(`Total relations in all zones: ${relations.length}`);
      
      // Count relation types
      const relationTypes = new Map<string, number>();
      relations.forEach(relation => {
        const type = (relation as any).relationType;
        relationTypes.set(type, (relationTypes.get(type) || 0) + 1);
      });
      
      console.log('Relation types:');
      relationTypes.forEach((count, type) => {
        console.log(`  ${type}: ${count}`);
      });
    }
  } catch (error) {
    console.error('Error getting statistics:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Search the knowledge graph
 * @param query The search query
 * @param zone Optional zone to search in
 */
async function searchGraph(query: string, zone?: string) {
  try {
    // Initialize client
    await kgClient.initialize(zone);
    
    // Search for entities
    const results = await kgClient.search({
      query,
      limit: 10,
      sortBy: 'relevance',
      zone
    });
    
    // Display results
    console.log(`Search Results for "${query}"${zone ? ` in zone "${zone}"` : ''}`);
    console.log('====================================');
    console.log(`Found ${results.hits.total.value} matches`);
    console.log('');
    
    // Extract all entities from search results
    const entities = results.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => hit._source as ESEntity);
    
    // Get entity names for relation lookup
    const entityNames = entities.map(entity => entity.name);
    
    // Create a set of entity names for faster lookup
    const entityNameSet = new Set(entityNames);
    
    // Collect all relations
    const allRelations: ESRelation[] = [];
    const relatedEntities = new Map<string, ESEntity>();
    
    // For each found entity, get all its relations
    for (const entityName of entityNames) {
      const { relations } = await kgClient.getRelatedEntities(entityName, 1, zone);
      
      for (const relation of relations) {
        // Add relation if not already added
        if (!allRelations.some(r => 
          r.from === relation.from && 
          r.fromZone === relation.fromZone &&
          r.to === relation.to && 
          r.toZone === relation.toZone &&
          r.relationType === relation.relationType
        )) {
          allRelations.push(relation);
          
          // Track related entities that weren't in the search results
          // If 'from' entity is not in our set and not already tracked
          if (!entityNameSet.has(relation.from) && !relatedEntities.has(relation.from)) {
            const entity = await kgClient.getEntityWithoutUpdatingLastRead(relation.from, relation.fromZone);
            if (entity) relatedEntities.set(relation.from, entity);
          }
          
          // If 'to' entity is not in our set and not already tracked
          if (!entityNameSet.has(relation.to) && !relatedEntities.has(relation.to)) {
            const entity = await kgClient.getEntityWithoutUpdatingLastRead(relation.to, relation.toZone);
            if (entity) relatedEntities.set(relation.to, entity);
          }
        }
      }
    }
    
    // Display each entity from search results
    entities.forEach((entity, index) => {
      const hit = results.hits.hits.find(h => 
        h._source.type === 'entity' && (h._source as ESEntity).name === entity.name
      );
      const score = hit && hit._score !== null && hit._score !== undefined ? hit._score.toFixed(2) : 'N/A';
      
      console.log(`${index + 1}. ${entity.name} (${entity.entityType}) [Score: ${score}]`);
      console.log(`   Zone: ${entity.zone || 'default'}`);
      console.log(`   Observations: ${entity.observations.length}`);
      
      // Show highlights if available
      if (hit && hit.highlight) {
        console.log('   Matches:');
        Object.entries(hit.highlight).forEach(([field, highlights]) => {
          highlights.forEach(highlight => {
            console.log(`   - ${field}: ${highlight}`);
          });
        });
      }
      console.log('');
    });
    
    // Display relations if any
    if (allRelations.length > 0) {
      console.log('Relations for these entities:');
      console.log('====================================');
      
      allRelations.forEach(relation => {
        // Lookup entity types for more context
        const fromType = entityNameSet.has(relation.from) 
          ? entities.find(e => e.name === relation.from)?.entityType 
          : relatedEntities.get(relation.from)?.entityType || '?';
          
        const toType = entityNameSet.has(relation.to) 
          ? entities.find(e => e.name === relation.to)?.entityType 
          : relatedEntities.get(relation.to)?.entityType || '?';
        
        console.log(`${relation.from} [${relation.fromZone}] (${fromType}) → ${relation.relationType} → ${relation.to} [${relation.toZone}] (${toType})`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.error('Error searching knowledge graph:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Reset the knowledge graph (delete all data)
 * @param zone Optional zone to reset, if not provided resets all zones
 */
async function resetIndex(zone?: string, args: string[] = []) {
  try {
    const confirmMessage = zone 
      ? `Are you sure you want to delete all data in zone "${zone}"? This cannot be undone. (y/N) `
      : 'Are you sure you want to delete ALL DATA IN ALL ZONES? This cannot be undone. (y/N) ';
    
    const confirmed = await confirmAction(confirmMessage, args);
    
    if (confirmed) {
      if (zone) {
        // Delete specific zone
        if (zone === 'default') {
          // For default zone, just delete all entities but keep the index
          await kgClient.initialize(zone);
          const allEntities = await kgClient.exportData(zone);
          for (const item of allEntities) {
            if (item.type === 'entity') {
              await kgClient.deleteEntity(item.name, zone);
            }
          }
          
          // Delete relations involving this zone
          const client = kgClient['client']; // Access the private client property
          await client.deleteByQuery({
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
          
          console.log(`Zone "${zone}" has been reset (entities and relations deleted)`);
        } else {
          // For non-default zones, delete the zone completely
          const success = await kgClient.deleteMemoryZone(zone);
          if (success) {
            console.log(`Zone "${zone}" has been completely deleted`);
          } else {
            console.error(`Failed to delete zone "${zone}"`);
            process.exit(1);
          }
        }
      } else {
        // Delete all zones
        const zones = await kgClient.listMemoryZones();
        
        // Delete all indices
        const client = kgClient['client']; // Access the private client property
        
        for (const zone of zones) {
          if (zone.name === 'default') {
            // Clear default zone but don't delete it
            const indexName = `knowledge-graph@default`;
            try {
              await client.indices.delete({ index: indexName });
              console.log(`Deleted index: ${indexName}`);
            } catch (error) {
              console.error(`Error deleting index ${indexName}:`, error);
            }
          } else {
            // Delete non-default zones
            await kgClient.deleteMemoryZone(zone.name);
            console.log(`Deleted zone: ${zone.name}`);
          }
        }
        
        // Delete relations index
        try {
          await client.indices.delete({ index: KG_RELATIONS_INDEX });
          console.log('Deleted relations index');
        } catch (error) {
          console.error('Error deleting relations index:', error);
        }
        
        // Re-initialize everything
        await kgClient.initialize();
        console.log('Knowledge graph has been completely reset');
      }
    } else {
      console.log('Operation cancelled');
    }
    
  } catch (error) {
    console.error('Error resetting index:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Display information about a specific entity
 * @param name Entity name
 * @param zone Optional zone name
 */
async function showEntity(name: string, zone?: string) {
  try {
    // Initialize client
    await kgClient.initialize(zone);
    
    // Get entity
    const entity = await kgClient.getEntityWithoutUpdatingLastRead(name, zone);
    if (!entity) {
      console.error(`Entity "${name}" not found${zone ? ` in zone "${zone}"` : ''}`);
      process.exit(1);
    }
    
    // Get related entities
    const related = await kgClient.getRelatedEntities(name, 1, zone);
    
    // Display entity information
    console.log(`Entity: ${entity.name}`);
    console.log(`Type: ${entity.entityType}`);
    console.log(`Zone: ${entity.zone || 'default'}`);
    console.log(`Last read: ${entity.lastRead}`);
    console.log(`Last write: ${entity.lastWrite}`);
    console.log(`Read count: ${entity.readCount}`);
    console.log(`Relevance score: ${typeof entity.relevanceScore === 'number' ? entity.relevanceScore.toFixed(2) : '1.00'} (higher = more important)`);
    console.log('');
    
    console.log('Observations:');
    entity.observations.forEach((obs: string, i: number) => {
      console.log(`  ${i+1}. ${obs}`);
    });
    console.log('');
    
    console.log('Relations:');
    for (const relation of related.relations) {
      if (relation.from === name && relation.fromZone === (entity.zone || 'default')) {
        console.log(`  → ${relation.relationType} → ${relation.to} [${relation.toZone}]`);
      } else {
        console.log(`  ← ${relation.relationType} ← ${relation.from} [${relation.fromZone}]`);
      }
    }
  } catch (error) {
    console.error('Error getting entity:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * List all memory zones
 */
async function listZones() {
  try {
    await kgClient.initialize();
    const zones = await kgClient.listMemoryZones();
    
    console.log('Memory Zones:');
    console.log('=============');
    
    for (const zone of zones) {
      console.log(`${zone.name}`);
      console.log(`  Description: ${zone.description || 'N/A'}`);
      console.log(`  Created: ${zone.createdAt}`);
      console.log(`  Last modified: ${zone.lastModified}`);
      console.log('');
    }
    
    console.log(`Total: ${zones.length} zones`);
  } catch (error) {
    console.error('Error listing zones:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Add a new memory zone
 */
async function addZone(name: string, description?: string) {
  try {
    await kgClient.initialize();
    await kgClient.addMemoryZone(name, description);
    console.log(`Zone "${name}" created successfully`);
  } catch (error) {
    console.error('Error adding zone:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Delete a memory zone
 */
async function deleteZone(name: string, args: string[] = []) {
  try {
    const confirmMessage = `Are you sure you want to delete zone "${name}" and all its data? This cannot be undone. (y/N) `;
    const confirmed = await confirmAction(confirmMessage, args);
    
    if (confirmed) {
      await kgClient.initialize();
      const success = await kgClient.deleteMemoryZone(name);
      if (success) {
        console.log(`Zone "${name}" deleted successfully`);
      } else {
        console.error(`Failed to delete zone "${name}"`);
        process.exit(1);
      }
    } else {
      console.log('Operation cancelled');
    }
  } catch (error) {
    console.error('Error deleting zone:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Show relations for a specific entity
 */
async function showRelations(name: string, zone?: string) {
  try {
    await kgClient.initialize(zone);
    
    // Check if entity exists
    const entity = await kgClient.getEntityWithoutUpdatingLastRead(name, zone);
    if (!entity) {
      console.error(`Entity "${name}" not found${zone ? ` in zone "${zone}"` : ''}`);
      process.exit(1);
    }
    
    const actualZone = zone || 'default';
    
    // Get all relations for this entity
    const { relations } = await kgClient.getRelationsForEntities([name], actualZone);
    
    console.log(`Relations for entity "${name}" in zone "${actualZone}":"`);
    console.log('====================================');
    
    if (relations.length === 0) {
      console.log('No relations found.');
      return;
    }
    
    // Group by relation type
    const relationsByType = new Map<string, ESRelation[]>();
    
    for (const relation of relations) {
      if (!relationsByType.has(relation.relationType)) {
        relationsByType.set(relation.relationType, []);
      }
      relationsByType.get(relation.relationType)!.push(relation);
    }
    
    // Display grouped relations
    for (const [type, rels] of relationsByType.entries()) {
      console.log(`\n${type} (${rels.length}):`);
      console.log('----------------');
      
      for (const rel of rels) {
        if (rel.from === name && rel.fromZone === actualZone) {
          // This entity is the source
          console.log(`→ ${rel.to} [${rel.toZone}]`);
        } else {
          // This entity is the target
          console.log(`← ${rel.from} [${rel.fromZone}]`);
        }
      }
    }
  } catch (error) {
    console.error('Error showing relations:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Backup all zones to a file
 */
async function backupAll(filePath: string) {
  try {
    await kgClient.initialize();
    
    // Export all data from all zones
    console.log('Exporting all zones and relations...');
    const data = await kgClient.exportAllData();
    
    console.log(`Found ${data.entities.length} entities, ${data.relations.length} relations, and ${data.zones.length} zones`);
    
    // Write to file
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData);
    
    console.log(`Backup saved to ${filePath}`);
    console.log(`Entities: ${data.entities.length}`);
    console.log(`Relations: ${data.relations.length}`);
    console.log(`Zones: ${data.zones.length}`);
  } catch (error) {
    console.error('Error creating backup:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Restore all zones from a backup file
 */
async function restoreAll(filePath: string, args: string[] = []) {
  try {
    // Read the backup file
    const jsonData = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(jsonData);
    
    if (!data.entities || !data.relations || !data.zones) {
      console.error('Invalid backup file format');
      process.exit(1);
    }
    
    console.log(`Found ${data.entities.length} entities, ${data.relations.length} relations, and ${data.zones.length} zones in backup`);
    
    // Confirm with user
    const confirmMessage = 'This will merge the backup with existing data. Continue? (y/N) ';
    const confirmed = await confirmAction(confirmMessage, args);
    
    if (!confirmed) {
      console.log('Operation cancelled');
      return;
    }
    
    // Import the data
    await kgClient.initialize();
    const result = await kgClient.importAllData(data);
    
    console.log('Restore completed:');
    console.log(`Zones added: ${result.zonesAdded}`);
    console.log(`Entities added: ${result.entitiesAdded}`);
    console.log(`Relations added: ${result.relationsAdded}`);
  } catch (error) {
    console.error('Error restoring backup:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Helper function to check if --yes flag is present
 */
function hasYesFlag(args: string[]): boolean {
  return args.includes('--yes') || args.includes('-y');
}

/**
 * Remove --yes or -y flags from arguments if present
 */
function cleanArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--yes' && arg !== '-y');
}

/**
 * Confirm an action with the user
 * @param message The confirmation message to display
 * @param args Command line arguments to check for --yes flag
 */
async function confirmAction(message: string, args: string[]): Promise<boolean> {
  // Skip confirmation if --yes flag is present
  if (hasYesFlag(args)) {
    return true;
  }
  
  // Otherwise, ask for confirmation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise<string>((resolve) => {
    rl.question(message, (ans: string) => {
      resolve(ans);
      rl.close();
    });
  });
  
  return answer.toLowerCase() === 'y';
}

/**
 * Update zone descriptions based on content
 * @param zone Zone name to update
 * @param limit Optional maximum number of entities to analyze
 * @param userPrompt Optional user-provided description of the zone's purpose
 */
async function updateZoneDescriptions(zone: string, limit: number = 20, userPrompt?: string) {
  try {
    console.log(`Updating descriptions for zone "${zone}" based on content...`);
    
    // Initialize client
    await kgClient.initialize(zone);
    
    // Get current zone metadata
    const zoneMetadata = await kgClient.getZoneMetadata(zone);
    if (!zoneMetadata) {
      console.error(`Zone "${zone}" not found`);
      process.exit(1);
    }
    
    console.log(`Finding the most representative entities to answer "What is ${zone}?"...`);
    
    // Try multiple search strategies to get the most representative entities
    const relevantEntities = [];
    
    // If user provided a prompt, search for it specifically
    if (userPrompt) {
      console.log(`Using user-provided description: "${userPrompt}"`);
      
      const { entities: promptEntities } = await kgClient.userSearch({
        query: userPrompt,
        limit: limit,
        sortBy: 'importance', 
        includeObservations: true,
        informationNeeded: zone !== 'default' ? `What is ${zone}?` : undefined,
        reason: `Trying to figure out what ${zone} is about, in order to update the zone description.`,
        zone: zone
      });
      
      relevantEntities.push(...promptEntities);
    }
    
    // Strategy 1: First get most important entities
    if (relevantEntities.length < limit) {
      const { entities: importantEntities } = await kgClient.userSearch({
        query: "*", // Get all entities
        limit: Math.floor(limit / 2),
        sortBy: 'importance',
        includeObservations: true,
        informationNeeded: zone !== 'default' ? `What is ${zone}?` : undefined,
        reason: `Trying to figure out what ${zone} is about, in order to update the zone description.`,
        zone: zone
      });
      
      // Add only new entities
      for (const entity of importantEntities) {
        if (!relevantEntities.some(e => 
          e.entityType && // Make sure we're comparing entities
          entity.entityType && 
          e.name === entity.name
        )) {
          relevantEntities.push(entity);
        }
      }
    }
    
    // Strategy 2: Use zone name as search query to find semantically related entities
    if (relevantEntities.length < limit) {
      const { entities: nameEntities } = await kgClient.userSearch({
        query: zone, // Use zone name as search query
        limit: Math.ceil(limit / 4),
        sortBy: 'relevance',
        includeObservations: true,
        informationNeeded: zone !== 'default' ? `What is ${zone}?` : undefined,
        reason: `Trying to figure out what ${zone} is about, in order to update the zone description.`,
        zone: zone
      });
      
      // Add only new entities not already in the list
      for (const entity of nameEntities) {
        if (!relevantEntities.some(e => 
          e.entityType && // Make sure we're comparing entities
          entity.entityType && 
          e.name === entity.name
        )) {
          relevantEntities.push(entity);
        }
      }
    }
    
    // Strategy 3: Get most frequently accessed entities
    if (relevantEntities.length < limit) {
      const { entities: recentEntities } = await kgClient.userSearch({
        query: "*", // Get all entities
        limit: Math.ceil(limit / 4),
        sortBy: 'recent',
        includeObservations: true,
        informationNeeded: zone !== 'default' ? `What is ${zone}?` : undefined,
        reason: `Trying to figure out what ${zone} is about, in order to update the zone description.`,
        zone: zone
      });
      
      // Add only new entities not already in the list
      for (const entity of recentEntities) {
        if (!relevantEntities.some(e => 
          e.entityType && // Make sure we're comparing entities
          entity.entityType && 
          e.name === entity.name
        )) {
          relevantEntities.push(entity);
        }
      }
    }
    
    if (relevantEntities.length === 0) {
      console.log(`No entities found in zone "${zone}" to analyze.`);
      return;
    }
    
    // Trim to limit
    const finalEntities = relevantEntities.slice(0, limit);
    
    console.log(`Found ${finalEntities.length} representative entities to analyze for zone description.`);
    
    // Generate descriptions using AI
    console.log("\nGenerating descriptions...");
    try {
      const descriptions = await GroqAI.generateZoneDescriptions(
        zone, 
        zoneMetadata.description || '',
        finalEntities,
        userPrompt
      );
      
      // Update the zone with new descriptions
      await kgClient.updateZoneDescriptions(
        zone,
        descriptions.description,
        descriptions.shortDescription
      );
      
      console.log(`\nUpdated descriptions for zone "${zone}":`);
      console.log(`\nShort Description: ${descriptions.shortDescription}`);
      console.log(`\nFull Description: ${descriptions.description}`);
    } catch (error) {
      console.error(`\nError generating descriptions: ${error.message}`);
      console.log('\nFalling back to existing description. Please try again or provide a more specific prompt.');
    }
    
  } catch (error) {
    console.error('Error updating zone descriptions:', (error as Error).message);
    process.exit(1);
  }
}

/**
 * Main function to parse and execute commands
 */
async function main() {
  const args = process.argv.slice(2);
  const cleanedArgs = cleanArgs(args);
  const command = cleanedArgs[0];
  
  if (!command || command === 'help') {
    showHelp();
    return;
  }
  
  switch (command) {
    case 'init':
      await initializeIndex();
      break;
    
    case 'import':
      if (!cleanedArgs[1]) {
        console.error('Error: File path is required for import');
        process.exit(1);
      }
      await importFromJsonFile(cleanedArgs[1], {
        ...esOptions,
        defaultZone: cleanedArgs[2] || DEFAULT_ZONE
      });
      break;
    
    case 'export':
      if (!cleanedArgs[1]) {
        console.error('Error: File path is required for export');
        process.exit(1);
      }
      await exportToJsonFile(cleanedArgs[1], {
        ...esOptions,
        defaultZone: cleanedArgs[2] || DEFAULT_ZONE
      });
      break;
    
    case 'backup':
      if (!cleanedArgs[1]) {
        console.error('Error: File path is required for backup');
        process.exit(1);
      }
      await backupAll(cleanedArgs[1]);
      break;
    
    case 'restore':
      if (!cleanedArgs[1]) {
        console.error('Error: File path is required for restore');
        process.exit(1);
      }
      await restoreAll(cleanedArgs[1], args);
      break;
    
    case 'stats':
      await showStats(cleanedArgs[1]);
      break;
      
    case 'search':
      if (!cleanedArgs[1]) {
        console.error('Error: Search query is required');
        process.exit(1);
      }
      await searchGraph(cleanedArgs[1], cleanedArgs[2]);
      break;
    
    case 'reset':
      await resetIndex(cleanedArgs[1], args);
      break;
    
    case 'entity':
      if (!cleanedArgs[1]) {
        console.error('Error: Entity name is required');
        process.exit(1);
      }
      await showEntity(cleanedArgs[1], cleanedArgs[2]);
      break;
    
    case 'zones':
      const zonesCommand = cleanedArgs[1];
      
      if (!zonesCommand) {
        await listZones();
        break;
      }
      
      switch (zonesCommand) {
        case 'list':
          await listZones();
          break;
        
        case 'add':
          if (!cleanedArgs[2]) {
            console.error('Error: Zone name is required');
            process.exit(1);
          }
          await addZone(cleanedArgs[2], cleanedArgs[3]);
          break;
        
        case 'delete':
          if (!cleanedArgs[2]) {
            console.error('Error: Zone name is required');
            process.exit(1);
          }
          await deleteZone(cleanedArgs[2], args);
          break;
        
        case 'stats':
          if (!cleanedArgs[2]) {
            console.error('Error: Zone name is required');
            process.exit(1);
          }
          await showStats(cleanedArgs[2]);
          break;
        
        case 'update_descriptions':
          if (!cleanedArgs[2]) {
            console.error('Error: Zone name is required');
            process.exit(1);
          }
          
          let limit = 20;
          let userPrompt = undefined;
          
          // Check if the third argument is a number (limit) or a string (userPrompt)
          if (cleanedArgs[3]) {
            const parsedLimit = parseInt(cleanedArgs[3], 10);
            if (!isNaN(parsedLimit) && parsedLimit.toString() === cleanedArgs[3]) {
              // Only interpret as a limit if it's a pure number with no text
              limit = parsedLimit;
              // If there's a fourth argument, it's the user prompt
              if (cleanedArgs[4]) {
                userPrompt = cleanedArgs.slice(4).join(' ');
              }
            } else {
              // If third argument isn't a pure number, it's the start of the user prompt
              userPrompt = cleanedArgs.slice(3).join(' ');
            }
          }
          
          await updateZoneDescriptions(cleanedArgs[2], limit, userPrompt);
          break;
        
        default:
          console.error(`Unknown zones command: ${zonesCommand}`);
          showHelp();
          process.exit(1);
      }
      break;
    
    case 'relations':
      if (!cleanedArgs[1]) {
        console.error('Error: Entity name is required');
        process.exit(1);
      }
      await showRelations(cleanedArgs[1], cleanedArgs[2]);
      break;
    
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

// Run the CLI
main().catch(error => {
  console.error('Error:', (error as Error).message);
  process.exit(1); 
}); 
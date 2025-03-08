import { promises as fs } from 'fs';
import path from 'path';
import { KnowledgeGraphClient } from './kg-client.js';
import { ESEntity, ESRelation } from './es-types.js';

// Updated client options type
interface ESClientOptions {
  node: string;
  auth?: { username: string; password: string };
  defaultZone?: string;
}

/**
 * Import data from JSON file to Elasticsearch
 */
async function importFromJsonFile(
  filePath: string,
  esOptions: ESClientOptions
): Promise<{ 
  entitiesAdded: number; 
  relationsAdded: number;
  invalidRelationsCount?: number;
}> {
  try {
    // Read the file line by line
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    // Get current timestamp
    const now = new Date().toISOString();
    
    // Parse each line into an entity or relation
    const items: Array<ESEntity | ESRelation> = [];
    
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        
        if (item.type === 'entity') {
          // Convert to ESEntity format
          const entity: ESEntity = {
            type: 'entity',
            name: item.name,
            entityType: item.entityType,
            observations: item.observations || [],
            lastRead: item.lastRead || now,
            lastWrite: item.lastWrite || now,
            readCount: typeof item.readCount === 'number' ? item.readCount : 0,
            relevanceScore: typeof item.relevanceScore === 'number' ? item.relevanceScore : (item.isImportant ? 10 : 1.0),
            zone: item.zone || esOptions.defaultZone || 'default'
          };
          items.push(entity);
        } else if (item.type === 'relation') {
          // Handle relations based on format
          if ('fromZone' in item && 'toZone' in item) {
            // New format with explicit zones
            const relation: ESRelation = {
              type: 'relation',
              from: item.from,
              fromZone: item.fromZone,
              to: item.to,
              toZone: item.toZone,
              relationType: item.relationType
            };
            items.push(relation);
          } else {
            // Old format - convert to new format
            const relation: ESRelation = {
              type: 'relation',
              from: item.from,
              fromZone: esOptions.defaultZone || 'default',
              to: item.to,
              toZone: esOptions.defaultZone || 'default',
              relationType: item.relationType
            };
            items.push(relation);
          }
        }
      } catch (error) {
        console.error(`Error parsing JSON line: ${line}`, error);
      }
    }
    
    // Create ES client and import the data
    const client = new KnowledgeGraphClient(esOptions);
    await client.initialize();
    const result = await client.importData(items, esOptions.defaultZone);
    
    // Log import summary
    console.log(`Imported ${result.entitiesAdded} entities and ${result.relationsAdded} relations`);
    
    // Handle invalid relations
    if (result.invalidRelations && result.invalidRelations.length > 0) {
      console.log(`Warning: ${result.invalidRelations.length} relations were not imported due to missing entities.`);
      console.log('To fix this issue:');
      console.log('1. Create the missing entities first');
      console.log('2. Or remove the invalid relations from your import file');
    }
    
    return { 
      entitiesAdded: result.entitiesAdded, 
      relationsAdded: result.relationsAdded,
      invalidRelationsCount: result.invalidRelations?.length
    };
  } catch (error) {
    console.error('Error importing data:', error);
    throw error;
  }
}

/**
 * Export data from Elasticsearch to JSON file
 */
async function exportToJsonFile(
  filePath: string,
  esOptions: ESClientOptions
): Promise<{ entitiesExported: number; relationsExported: number }> {
  try {
    // Create ES client
    const client = new KnowledgeGraphClient(esOptions);
    await client.initialize();
    
    // Export all data
    const items = await client.exportData(esOptions.defaultZone);
    
    // Count entities and relations
    let entitiesExported = 0;
    let relationsExported = 0;
    
    // Convert to JSON lines format
    const lines = items.map(item => {
      if (item.type === 'entity') entitiesExported++;
      if (item.type === 'relation') relationsExported++;
      return JSON.stringify(item);
    });
    
    // Write to file
    await fs.writeFile(filePath, lines.join('\n'));
    
    console.log(`Exported ${entitiesExported} entities and ${relationsExported} relations${esOptions.defaultZone ? ` from zone "${esOptions.defaultZone}"` : ''}`);
    return { entitiesExported, relationsExported };
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
}

// Command line interface
// Check if this is the main module (ES modules version)
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];
  const filePath = args[1];
  const zone = args[2];
  const esNode = process.env.ES_NODE || 'http://localhost:9200';
  
  if (!command || !filePath) {
    console.error('Usage: node json-to-es.js import|export <file_path> [zone]');
    process.exit(1);
  }
  
  const esOptions: ESClientOptions = { 
    node: esNode,
    defaultZone: zone
  };
  
  // Add authentication if provided
  if (process.env.ES_USERNAME && process.env.ES_PASSWORD) {
    esOptions.auth = {
      username: process.env.ES_USERNAME,
      password: process.env.ES_PASSWORD
    };
  }
  
  // Run the appropriate command
  if (command === 'import') {
    importFromJsonFile(filePath, esOptions)
      .then(() => process.exit(0))
      .catch(err => {
        console.error(err);
        process.exit(1);
      });
  } else if (command === 'export') {
    exportToJsonFile(filePath, esOptions)
      .then(() => process.exit(0))
      .catch(err => {
        console.error(err);
        process.exit(1);
      });
  } else {
    console.error('Unknown command. Use "import" or "export"');
    process.exit(1);
  }
}

export { importFromJsonFile, exportToJsonFile }; 
import { Client } from '@elastic/elasticsearch';
import { KnowledgeGraphClient } from '../src/kg-client.js';
import { ESEntity, ESRelation } from '../src/es-types.js';

// Test environment configuration
export const TEST_ES_NODE = process.env.TEST_ES_NODE || 'http://localhost:9200';
export const TEST_USERNAME = process.env.TEST_USERNAME;
export const TEST_PASSWORD = process.env.TEST_PASSWORD;

// Test zones
export const TEST_ZONE_A = 'test-zone-a';
export const TEST_ZONE_B = 'test-zone-b';
export const DEFAULT_ZONE = 'default';

// Configure ES client with authentication if provided
const createESOptions = () => {
  const options: { node: string; auth?: { username: string; password: string } } = {
    node: TEST_ES_NODE
  };
  
  if (TEST_USERNAME && TEST_PASSWORD) {
    options.auth = { username: TEST_USERNAME, password: TEST_PASSWORD };
  }
  
  return options;
};

// Create a fresh KG client for testing
export const createTestKGClient = () => {
  return new KnowledgeGraphClient(createESOptions());
};

// Helper to clean up test data
export const cleanupTestData = async (client: KnowledgeGraphClient) => {
  try {
    // Delete any test data in the test zones
    const zones = [TEST_ZONE_A, TEST_ZONE_B];
    for (const zone of zones) {
      // Retrieve all entities in the zone
      const data = await client.exportData(zone);
      const entities = data.filter(item => item.type === 'entity');
      
      // Delete each entity
      for (const entity of entities) {
        await client.deleteEntity(entity.name, zone);
      }
    }
  } catch (error) {
    console.error(`Error cleaning up test data: ${error.message}`);
  }
};

// Setup test data for different scenarios
export const setupTestData = async (client: KnowledgeGraphClient) => {
  // Create test zones if they don't exist
  await client.addMemoryZone(TEST_ZONE_A, 'Test Zone A for unit tests');
  await client.addMemoryZone(TEST_ZONE_B, 'Test Zone B for unit tests');
  
  // Add some test entities in each zone
  await client.saveEntity({
    name: 'TestEntityA1',
    entityType: 'test',
    observations: ['This is a test entity in zone A', 'It has multiple observations'],
    relevanceScore: 1.0
  }, TEST_ZONE_A);
  
  await client.saveEntity({
    name: 'TestEntityA2',
    entityType: 'person',
    observations: ['This is a person in zone A', 'John likes coffee and programming'],
    relevanceScore: 1.0
  }, TEST_ZONE_A);
  
  await client.saveEntity({
    name: 'TestEntityB1',
    entityType: 'test',
    observations: ['This is a test entity in zone B'],
    relevanceScore: 1.0
  }, TEST_ZONE_B);
  
  await client.saveEntity({
    name: 'TestEntityB2',
    entityType: 'concept',
    observations: ['This is a concept in zone B', 'Related to artificial intelligence'],
    relevanceScore: 1.0
  }, TEST_ZONE_B);
  
  // Create cross-zone relationship
  await client.saveRelation({
    from: 'TestEntityA1',
    to: 'TestEntityB1',
    relationType: 'related_to'
  }, TEST_ZONE_A, TEST_ZONE_B);
  
  // Create same-zone relationship
  await client.saveRelation({
    from: 'TestEntityA1',
    to: 'TestEntityA2',
    relationType: 'knows'
  }, TEST_ZONE_A, TEST_ZONE_A);
}; 
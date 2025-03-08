// Test script for cross-zone relationships
import { Client } from '@elastic/elasticsearch';
import { KnowledgeGraphClient } from '../dist/kg-client.js';

// Test zones
const TEST_ZONE_A = 'test-zone-a';
const TEST_ZONE_B = 'test-zone-b';
const DEFAULT_ZONE = 'default';

// Configure ES client
const esOptions = {
  node: 'http://localhost:9200'
};

async function runTests() {
  // Create a client
  const client = new KnowledgeGraphClient(esOptions);
  await client.initialize();
  
  console.log('Setting up test data...');
  
  // Clean up any existing test data
  try {
    await client.deleteEntity('TestEntityA1', TEST_ZONE_A);
    await client.deleteEntity('TestEntityB1', TEST_ZONE_B);
  } catch (e) {
    // Ignore errors from deleting non-existent entities
  }
  
  // Create test zones
  await client.addMemoryZone(TEST_ZONE_A, 'Test Zone A for cross-zone tests');
  await client.addMemoryZone(TEST_ZONE_B, 'Test Zone B for cross-zone tests');
  
  // Create test entities
  await client.saveEntity({
    name: 'TestEntityA1',
    entityType: 'test',
    observations: ['Test entity in zone A'],
    relevanceScore: 1.0
  }, TEST_ZONE_A);
  
  await client.saveEntity({
    name: 'TestEntityB1',
    entityType: 'test',
    observations: ['Test entity in zone B'],
    relevanceScore: 1.0
  }, TEST_ZONE_B);
  
  // Create cross-zone relationship
  console.log('Creating cross-zone relationship...');
  const relation = await client.saveRelation({
    from: 'TestEntityA1',
    to: 'TestEntityB1',
    relationType: 'test_relation'
  }, TEST_ZONE_A, TEST_ZONE_B);
  
  console.log('Created relation:', relation);
  console.log('Checking if fromZone and toZone are present:');
  console.log('fromZone:', relation.fromZone);
  console.log('toZone:', relation.toZone);
  
  // Test getRelatedEntities with zone information
  console.log('\nTesting getRelatedEntities...');
  const relatedResult = await client.getRelatedEntities('TestEntityA1', 1, TEST_ZONE_A);
  console.log('Relations:', relatedResult.relations);
  
  // Clean up test data
  console.log('\nCleaning up test data...');
  await client.deleteEntity('TestEntityA1', TEST_ZONE_A);
  await client.deleteEntity('TestEntityB1', TEST_ZONE_B);
  
  console.log('Test completed!');
}

runTests().catch(error => {
  console.error('Test failed:', error);
}); 
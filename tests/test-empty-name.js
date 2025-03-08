// Test script for empty name validation
import { Client } from '@elastic/elasticsearch';
import { KnowledgeGraphClient } from '../dist/kg-client.js';

// Test zone
const TEST_ZONE = 'test-zone';

// Configure ES client
const esOptions = {
  node: 'http://localhost:9200'
};

async function runTests() {
  // Create a client
  const client = new KnowledgeGraphClient(esOptions);
  await client.initialize();
  
  console.log('Testing empty name validation...');
  
  // Create test zone
  await client.addMemoryZone(TEST_ZONE, 'Test Zone for empty name tests');
  
  // Test entity creation with empty name
  console.log('\nTesting entity creation with empty name...');
  try {
    await client.saveEntity({
      name: '',
      entityType: 'test',
      observations: ['Entity with empty name'],
      relevanceScore: 1.0
    }, TEST_ZONE);
    console.log('❌ FAILED: Entity with empty name was created!');
  } catch (error) {
    console.log('✅ SUCCESS: Properly rejected entity with empty name');
    console.log('Error message:', error.message);
  }
  
  // Test entity creation with whitespace name
  console.log('\nTesting entity creation with whitespace name...');
  try {
    await client.saveEntity({
      name: '   ',
      entityType: 'test',
      observations: ['Entity with whitespace name'],
      relevanceScore: 1.0
    }, TEST_ZONE);
    console.log('❌ FAILED: Entity with whitespace name was created!');
  } catch (error) {
    console.log('✅ SUCCESS: Properly rejected entity with whitespace name');
    console.log('Error message:', error.message);
  }
  
  // Test entity deletion with empty name
  console.log('\nTesting entity deletion with empty name...');
  try {
    await client.deleteEntity('', TEST_ZONE);
    console.log('❌ FAILED: Entity deletion with empty name was accepted!');
  } catch (error) {
    console.log('✅ SUCCESS: Properly rejected entity deletion with empty name');
    console.log('Error message:', error.message);
  }
  
  // Create a valid entity for relationship tests
  await client.saveEntity({
    name: 'ValidEntity',
    entityType: 'test',
    observations: ['Valid entity for relationship test'],
    relevanceScore: 1.0
  }, TEST_ZONE);
  
  // Test relationship creation with empty 'from' entity name
  console.log('\nTesting relationship with empty from entity...');
  try {
    await client.saveRelation({
      from: '',
      to: 'ValidEntity',
      relationType: 'test_relation'
    }, TEST_ZONE, TEST_ZONE, { autoCreateMissingEntities: false });
    console.log('❌ FAILED: Relationship with empty from entity was created!');
  } catch (error) {
    console.log('✅ SUCCESS: Properly rejected relationship with empty from entity');
    console.log('Error message:', error.message);
  }
  
  // Clean up
  console.log('\nCleaning up test data...');
  await client.deleteEntity('ValidEntity', TEST_ZONE);
  
  console.log('\nTest completed!');
}

runTests().catch(error => {
  console.error('Test failed:', error);
}); 
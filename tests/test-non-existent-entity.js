// Test script for non-existent entity in relationships
import { Client } from '@elastic/elasticsearch';
import { KnowledgeGraphClient } from '../dist/kg-client.js';

// Test zones
const TEST_ZONE_A = 'test-zone-a';
const TEST_ZONE_B = 'test-zone-b';

// Configure ES client
const esOptions = {
  node: 'http://localhost:9200'
};

// Create a direct Elasticsearch client for verification
const esClient = new Client(esOptions);

async function runTests() {
  // Create a client
  const client = new KnowledgeGraphClient(esOptions);
  await client.initialize();
  
  console.log('Testing non-existent entity in relationships...');
  
  // Create test zones
  await client.addMemoryZone(TEST_ZONE_A, 'Test Zone A');
  await client.addMemoryZone(TEST_ZONE_B, 'Test Zone B');
  
  // Clean up any existing test data
  try {
    await client.deleteEntity('ExistingEntity', TEST_ZONE_A);
    await client.deleteEntity('NonExistentEntity', TEST_ZONE_A);
    await client.deleteEntity('AnotherNonExistentEntity', TEST_ZONE_A);
  } catch (e) {
    // Ignore errors from deleting non-existent entities
  }
  
  // Create one entity for testing
  await client.saveEntity({
    name: 'ExistingEntity',
    entityType: 'test',
    observations: ['This is an existing entity for relationship tests'],
    relevanceScore: 1.0
  }, TEST_ZONE_A);
  
  // Test with auto-create enabled (default behavior)
  console.log('\nTesting with auto-create enabled (default)...');
  try {
    const relation = await client.saveRelation({
      from: 'ExistingEntity',
      to: 'NonExistentEntity',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_A);
    
    console.log('✅ SUCCESS: Relation created with auto-creation of missing entity');
    console.log('Relation:', relation);
    
    // Add a small delay to allow for indexing
    console.log('Waiting for Elasticsearch indexing...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Directly check if the entity exists in Elasticsearch
    console.log('Directly checking if entity exists in Elasticsearch...');
    try {
      const indexName = `knowledge-graph@${TEST_ZONE_A}`;
      const response = await esClient.get({
        index: indexName,
        id: `entity:NonExistentEntity`
      });
      
      if (response && response._source) {
        console.log('✅ SUCCESS: Entity exists in Elasticsearch');
        console.log('Entity:', response._source);
      } else {
        console.log('❌ FAILED: Entity not found in Elasticsearch');
      }
    } catch (error) {
      console.log('❌ FAILED: Error checking entity in Elasticsearch:', error.message);
    }
    
    // Try the getEntity method again
    const entity = await client.getEntity('NonExistentEntity', TEST_ZONE_A);
    if (entity) {
      console.log('✅ SUCCESS: Non-existent entity was auto-created');
      console.log('Entity:', {
        name: entity.name,
        entityType: entity.entityType
      });
    } else {
      console.log('❌ FAILED: Non-existent entity was not auto-created');
    }
  } catch (error) {
    console.log('❌ FAILED: Relation with auto-creation failed');
    console.log('Error:', error.message);
  }
  
  // Test with auto-create disabled
  console.log('\nTesting with auto-create disabled...');
  try {
    await client.saveRelation({
      from: 'ExistingEntity',
      to: 'AnotherNonExistentEntity',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_A, { autoCreateMissingEntities: false });
    
    console.log('❌ FAILED: Relation was created even with auto-create disabled!');
  } catch (error) {
    console.log('✅ SUCCESS: Properly rejected relation with non-existent entity when auto-create is disabled');
    console.log('Error message:', error.message);
  }
  
  // Clean up
  console.log('\nCleaning up test data...');
  await client.deleteEntity('ExistingEntity', TEST_ZONE_A);
  await client.deleteEntity('NonExistentEntity', TEST_ZONE_A);
  
  console.log('\nTest completed!');
}

runTests().catch(error => {
  console.error('Test failed:', error);
}); 
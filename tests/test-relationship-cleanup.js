// Test script for relationship cleanup after entity deletion
import { Client } from '@elastic/elasticsearch';
import { KnowledgeGraphClient } from '../dist/kg-client.js';

// Configure ES client
const esOptions = {
  node: 'http://localhost:9200'
};

async function runTests() {
  // Create a client
  const client = new KnowledgeGraphClient(esOptions);
  await client.initialize();
  
  console.log('Testing relationship cleanup after entity deletion...');
  
  // Test with cascadeRelations = true (default)
  console.log('\nTesting with cascadeRelations = true (default)...');
  
  // Create test entities
  console.log('Creating test entities...');
  await client.saveEntity({
    name: 'TestEntityA',
    entityType: 'test',
    observations: ['Test entity A'],
    relevanceScore: 1.0
  });
  
  await client.saveEntity({
    name: 'TestEntityB',
    entityType: 'test',
    observations: ['Test entity B'],
    relevanceScore: 1.0
  });
  
  // Create a relationship
  console.log('Creating relationship...');
  await client.saveRelation({
    from: 'TestEntityA',
    to: 'TestEntityB',
    relationType: 'test_relation'
  });
  
  // Delete TestEntityA with cascadeRelations = true
  console.log('Deleting TestEntityA with cascadeRelations = true...');
  await client.deleteEntity('TestEntityA', undefined, { cascadeRelations: true });
  
  // Check if the relationship was deleted
  console.log('Checking if the relationship was deleted...');
  const relations1 = await client.getRelationsForEntities(['TestEntityB']);
  console.log(`Relations involving TestEntityB after deletion with cascadeRelations = true: ${relations1.relations.length}`);
  
  if (relations1.relations.length === 0) {
    console.log('✅ SUCCESS: Relationship was properly deleted with cascadeRelations = true');
  } else {
    console.log('❌ FAILED: Relationship was not deleted with cascadeRelations = true');
  }
  
  // Test with cascadeRelations = false
  console.log('\nTesting with cascadeRelations = false...');
  
  // Create test entities again
  console.log('Creating test entities again...');
  await client.saveEntity({
    name: 'TestEntityA',
    entityType: 'test',
    observations: ['Test entity A'],
    relevanceScore: 1.0
  });
  
  // Create a relationship again
  console.log('Creating relationship again...');
  await client.saveRelation({
    from: 'TestEntityA',
    to: 'TestEntityB',
    relationType: 'test_relation'
  });
  
  // Delete TestEntityA with cascadeRelations = false
  console.log('Deleting TestEntityA with cascadeRelations = false...');
  await client.deleteEntity('TestEntityA', undefined, { cascadeRelations: false });
  
  // Check if the relationship still exists
  console.log('Checking if the relationship still exists...');
  const relations2 = await client.getRelationsForEntities(['TestEntityB']);
  console.log(`Relations involving TestEntityB after deletion with cascadeRelations = false: ${relations2.relations.length}`);
  
  if (relations2.relations.length > 0) {
    console.log('✅ SUCCESS: Relationship was preserved with cascadeRelations = false');
  } else {
    console.log('❌ FAILED: Relationship was deleted even though cascadeRelations = false');
  }
  
  // Clean up
  console.log('\nCleaning up test data...');
  await client.deleteEntity('TestEntityB');
  
  console.log('\nTest completed!');
}

runTests().catch(error => {
  console.error('Test failed:', error);
}); 
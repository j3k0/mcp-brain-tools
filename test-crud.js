import { KnowledgeGraphClient } from './dist/kg-client.js';

const TEST_ENTITY_NAME = 'TestEntity-' + Date.now();
const TEST_RELATION_TARGET = 'TestRelationTarget-' + Date.now();

// Create a client
const client = new KnowledgeGraphClient({
  node: 'http://localhost:9200'
});

async function runTests() {
  try {
    console.log('Initializing Elasticsearch...');
    await client.initialize();
    
    // Test 1: Create an entity
    console.log('\n--- Test 1: Create Entity ---');
    const entity = await client.saveEntity({
      name: TEST_ENTITY_NAME,
      entityType: 'TestEntityType',
      observations: ['This is a test entity', 'Created for CRUD testing'],
      isImportant: true
    });
    console.log('Entity created:', entity);
    
    // Test 2: Create relation target entity
    console.log('\n--- Test 2: Create Relation Target ---');
    const targetEntity = await client.saveEntity({
      name: TEST_RELATION_TARGET,
      entityType: 'TestEntityType',
      observations: ['This is a target entity for relations'],
      isImportant: false
    });
    console.log('Target entity created:', targetEntity);
    
    // Test 3: Create a relation
    console.log('\n--- Test 3: Create Relation ---');
    const relation = await client.saveRelation({
      from: TEST_ENTITY_NAME,
      to: TEST_RELATION_TARGET,
      relationType: 'test_relates_to'
    });
    console.log('Relation created:', relation);
    
    // Test 4: Update the entity
    console.log('\n--- Test 4: Update Entity ---');
    const updatedEntity = await client.saveEntity({
      name: TEST_ENTITY_NAME,
      entityType: 'UpdatedTestEntityType',
      observations: ['This is a test entity', 'Created for CRUD testing', 'Updated with new observation'],
      isImportant: false
    });
    console.log('Entity updated:', updatedEntity);
    
    // Test 5: Get the entity
    console.log('\n--- Test 5: Get Entity ---');
    const retrievedEntity = await client.getEntity(TEST_ENTITY_NAME);
    console.log('Retrieved entity:', retrievedEntity);
    
    // Test 6: Get related entities
    console.log('\n--- Test 6: Get Related Entities ---');
    const related = await client.getRelatedEntities(TEST_ENTITY_NAME, 1);
    console.log('Related entities:', related);
    
    // Test 7: Delete the relation
    console.log('\n--- Test 7: Delete Relation ---');
    const relationDeleted = await client.deleteRelation(
      TEST_ENTITY_NAME,
      TEST_RELATION_TARGET,
      'test_relates_to'
    );
    console.log('Relation deleted:', relationDeleted);
    
    // Test 8: Delete the entities
    console.log('\n--- Test 8: Delete Entities ---');
    const entityDeleted = await client.deleteEntity(TEST_ENTITY_NAME);
    const targetDeleted = await client.deleteEntity(TEST_RELATION_TARGET);
    console.log('Entity deleted:', entityDeleted);
    console.log('Target entity deleted:', targetDeleted);
    
    console.log('\n--- All tests completed successfully ---');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTests(); 
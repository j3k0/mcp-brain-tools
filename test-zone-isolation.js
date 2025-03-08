#!/usr/bin/env node

/**
 * Test script for zone isolation feature of the knowledge graph
 * 
 * This script tests:
 * 1. Zone creation and verification
 * 2. Entity creation in specific zones
 * 3. Zone isolation for search (entities in one zone not visible in another)
 * 4. Cross-zone relations (relations between entities in different zones)
 * 5. Recent entities per zone
 */

import { KnowledgeGraphClient } from './dist/kg-client.js';

// Configure client
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const ES_USERNAME = process.env.ES_USERNAME;
const ES_PASSWORD = process.env.ES_PASSWORD;

// Test constants
const ZONE_A = 'test-zone-a';
const ZONE_B = 'test-zone-b';
const ENTITY_A = 'TestEntityA';
const ENTITY_B = 'TestEntityB';
const ENTITY_DEFAULT = 'TestEntityDefault';

// Main test function
async function runTests() {
  console.log('Starting zone isolation tests...');
  
  try {
    const client = new KnowledgeGraphClient({
      node: ES_NODE,
      auth: ES_USERNAME && ES_PASSWORD ? {
        username: ES_USERNAME,
        password: ES_PASSWORD
      } : undefined
    });
    
    // Setup test environment
    await setupTestEnvironment(client);
    
    // Run tests
    await testZoneCreation(client);
    await testEntityCreationInZones(client);
    await testZoneIsolationForSearch(client);
    await testCrossZoneRelations(client);
    await testRecentEntitiesPerZone(client);
    
    // Clean up test data
    await cleanupTestData(client);
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Setup test environment
async function setupTestEnvironment(client) {
  console.log('\n🔧 Setting up test environment...');
  
  // Delete test entities if they exist
  try {
    await client.deleteEntity(ENTITY_A, ZONE_A);
    console.log(`  - Deleted existing entity ${ENTITY_A} in zone ${ZONE_A}`);
  } catch (error) {
    console.log(`  - Entity ${ENTITY_A} in zone ${ZONE_A} did not exist`);
  }
  
  try {
    await client.deleteEntity(ENTITY_B, ZONE_B);
    console.log(`  - Deleted existing entity ${ENTITY_B} in zone ${ZONE_B}`);
  } catch (error) {
    console.log(`  - Entity ${ENTITY_B} in zone ${ZONE_B} did not exist`);
  }
  
  try {
    await client.deleteEntity(ENTITY_DEFAULT);
    console.log(`  - Deleted existing entity ${ENTITY_DEFAULT} in default zone`);
  } catch (error) {
    console.log(`  - Entity ${ENTITY_DEFAULT} in default zone did not exist`);
  }
  
  console.log('  ✅ Test environment setup complete');
}

// Test zone creation
async function testZoneCreation(client) {
  console.log('\n🧪 Testing zone creation...');
  
  // Create test zones
  await client.addMemoryZone(ZONE_A, 'Test Zone A');
  await client.addMemoryZone(ZONE_B, 'Test Zone B');
  
  // Verify zones exist
  const zones = await client.listMemoryZones();
  console.log(`  - Available zones: ${zones.map(z => z.name).join(', ')}`);
  
  if (!zones.some(z => z.name === ZONE_A) || !zones.some(z => z.name === ZONE_B)) {
    throw new Error('Zone creation failed - zones not found in list');
  }
  
  console.log('  ✅ Zone creation test passed');
}

// Test entity creation in zones
async function testEntityCreationInZones(client) {
  console.log('\n🧪 Testing entity creation in zones...');
  
  try {
    // Check if the indices exist
    console.log('  - Checking if indices exist...');
    const indexA = await client.client.indices.exists({ index: `knowledge-graph@${ZONE_A}` });
    console.log(`  - Index for zone ${ZONE_A} exists: ${indexA}`);
    
    const indexB = await client.client.indices.exists({ index: `knowledge-graph@${ZONE_B}` });
    console.log(`  - Index for zone ${ZONE_B} exists: ${indexB}`);
    
    const indexDefault = await client.client.indices.exists({ index: 'knowledge-graph@default' });
    console.log(`  - Index for default zone exists: ${indexDefault}`);
    
    // Create entity in zone A
    console.log(`  - Creating entity ${ENTITY_A} in zone ${ZONE_A}...`);
    const savedEntityA = await client.saveEntity({
      name: ENTITY_A,
      entityType: 'test',
      observations: ['This is a test entity in zone A'],
      relevanceScore: 1
    }, ZONE_A);
    console.log(`  - Created entity ${ENTITY_A} in zone ${ZONE_A}`);
    console.log(`  - Saved entity details: ${JSON.stringify(savedEntityA)}`);
    
    // Create entity in zone B
    console.log(`  - Creating entity ${ENTITY_B} in zone ${ZONE_B}...`);
    const savedEntityB = await client.saveEntity({
      name: ENTITY_B,
      entityType: 'test',
      observations: ['This is a test entity in zone B'],
      relevanceScore: 1
    }, ZONE_B);
    console.log(`  - Created entity ${ENTITY_B} in zone ${ZONE_B}`);
    console.log(`  - Saved entity details: ${JSON.stringify(savedEntityB)}`);
    
    // Create entity in default zone
    console.log(`  - Creating entity ${ENTITY_DEFAULT} in default zone...`);
    const savedEntityDefault = await client.saveEntity({
      name: ENTITY_DEFAULT,
      entityType: 'test',
      observations: ['This is a test entity in the default zone'],
      relevanceScore: 1
    });
    console.log(`  - Created entity ${ENTITY_DEFAULT} in default zone`);
    console.log(`  - Saved entity details: ${JSON.stringify(savedEntityDefault)}`);
    
    // Wait for Elasticsearch to index the entities
    console.log('  - Waiting for Elasticsearch to index entities...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try a direct search using the Elasticsearch client
    console.log('  - Performing direct search using the Elasticsearch client...');
    
    let directSearchA;
    try {
      directSearchA = await client.client.search({
        index: `knowledge-graph@${ZONE_A}`,
        body: {
          query: {
            match_all: {}
          }
        }
      });
      console.log(`  - Direct search in zone ${ZONE_A} returned ${directSearchA.hits.hits.length} results`);
      if (directSearchA.hits.hits.length > 0) {
        console.log(`  - Results: ${JSON.stringify(directSearchA.hits.hits.map(hit => hit._source.name))}`);
      }
    } catch (error) {
      console.log(`  - Direct search in zone ${ZONE_A} failed: ${error.message}`);
    }
    
    let directSearchB;
    try {
      directSearchB = await client.client.search({
        index: `knowledge-graph@${ZONE_B}`,
        body: {
          query: {
            match_all: {}
          }
        }
      });
      console.log(`  - Direct search in zone ${ZONE_B} returned ${directSearchB.hits.hits.length} results`);
      if (directSearchB.hits.hits.length > 0) {
        console.log(`  - Results: ${JSON.stringify(directSearchB.hits.hits.map(hit => hit._source.name))}`);
      }
    } catch (error) {
      console.log(`  - Direct search in zone ${ZONE_B} failed: ${error.message}`);
    }
    
    let directSearchDefault;
    try {
      directSearchDefault = await client.client.search({
        index: 'knowledge-graph@default',
        body: {
          query: {
            match: {
              name: ENTITY_DEFAULT
            }
          }
        }
      });
      console.log(`  - Direct search for ${ENTITY_DEFAULT} in default zone returned ${directSearchDefault.hits.hits.length} results`);
      if (directSearchDefault.hits.hits.length > 0) {
        console.log(`  - Results: ${JSON.stringify(directSearchDefault.hits.hits.map(hit => hit._source.name))}`);
      }
    } catch (error) {
      console.log(`  - Direct search in default zone failed: ${error.message}`);
    }
    
    // Verify entities exist in their respective zones using direct search results
    const hasEntityA = directSearchA && directSearchA.hits.hits.some(hit => hit._source.name === ENTITY_A);
    console.log(`  - Found entity ${ENTITY_A} in zone ${ZONE_A}: ${hasEntityA ? 'Yes' : 'No'}`);
    
    const hasEntityB = directSearchB && directSearchB.hits.hits.some(hit => hit._source.name === ENTITY_B);
    console.log(`  - Found entity ${ENTITY_B} in zone ${ZONE_B}: ${hasEntityB ? 'Yes' : 'No'}`);
    
    const hasEntityDefault = directSearchDefault && directSearchDefault.hits.hits.some(hit => hit._source.name === ENTITY_DEFAULT);
    console.log(`  - Found entity ${ENTITY_DEFAULT} in default zone: ${hasEntityDefault ? 'Yes' : 'No'}`);
    
    if (!hasEntityA) {
      throw new Error(`Entity ${ENTITY_A} not found in zone ${ZONE_A}`);
    }
    
    if (!hasEntityB) {
      throw new Error(`Entity ${ENTITY_B} not found in zone ${ZONE_B}`);
    }
    
    if (!hasEntityDefault) {
      throw new Error(`Entity ${ENTITY_DEFAULT} not found in default zone`);
    }
    
    // Verify zone isolation
    const foundEntityAInB = await client.search({
      query: ENTITY_A,
      zone: ZONE_B
    });
    const hasEntityAInB = foundEntityAInB.hits.hits.some(hit => hit._source.name === ENTITY_A);
    console.log(`  - Found entity ${ENTITY_A} in zone ${ZONE_B}: ${hasEntityAInB ? 'Yes' : 'No'}`);
    
    if (hasEntityAInB) {
      throw new Error(`Zone isolation failed - entity ${ENTITY_A} found in zone ${ZONE_B}`);
    }
    
    const foundEntityBInA = await client.search({
      query: ENTITY_B,
      zone: ZONE_A
    });
    const hasEntityBInA = foundEntityBInA.hits.hits.some(hit => hit._source.name === ENTITY_B);
    console.log(`  - Found entity ${ENTITY_B} in zone ${ZONE_A}: ${hasEntityBInA ? 'Yes' : 'No'}`);
    
    if (hasEntityBInA) {
      throw new Error(`Zone isolation failed - entity ${ENTITY_B} found in zone ${ZONE_A}`);
    }
    
    console.log('  ✅ Entity creation in zones test passed');
  } catch (error) {
    console.error(`  ❌ Error in entity creation test: ${error.message}`);
    throw error;
  }
}

// Test zone isolation for search
async function testZoneIsolationForSearch(client) {
  console.log('\n🧪 Testing zone isolation for search...');
  
  // Search in zone A using direct search
  try {
    const searchA = await client.client.search({
      index: `knowledge-graph@${ZONE_A}`,
      body: {
        query: {
          match: {
            entityType: 'test'
          }
        }
      }
    });
    console.log(`  - Direct search in zone ${ZONE_A} returned ${searchA.hits.hits.length} results`);
    if (searchA.hits.hits.length > 0) {
      console.log(`  - Results: ${JSON.stringify(searchA.hits.hits.map(hit => hit._source.name))}`);
    }
    
    // Verify entity A is found in zone A
    const entityAInResultsA = searchA.hits.hits.some(hit => hit._source.name === ENTITY_A);
    console.log(`  - Found entity ${ENTITY_A} in zone ${ZONE_A} search: ${entityAInResultsA ? 'Yes' : 'No'}`);
    
    if (!entityAInResultsA) {
      throw new Error(`Search isolation failed - entity ${ENTITY_A} not found in zone ${ZONE_A} search`);
    }
    
    // Verify entity B is not found in zone A
    const entityBInResultsA = searchA.hits.hits.some(hit => hit._source.name === ENTITY_B);
    console.log(`  - Found entity ${ENTITY_B} in zone ${ZONE_A} search: ${entityBInResultsA ? 'Yes' : 'No'}`);
    
    if (entityBInResultsA) {
      throw new Error(`Search isolation failed - entity ${ENTITY_B} found in zone ${ZONE_A} search`);
    }
  } catch (error) {
    console.log(`  - Direct search in zone ${ZONE_A} failed: ${error.message}`);
    throw error;
  }
  
  // Search in zone B using direct search
  try {
    const searchB = await client.client.search({
      index: `knowledge-graph@${ZONE_B}`,
      body: {
        query: {
          match: {
            entityType: 'test'
          }
        }
      }
    });
    console.log(`  - Direct search in zone ${ZONE_B} returned ${searchB.hits.hits.length} results`);
    if (searchB.hits.hits.length > 0) {
      console.log(`  - Results: ${JSON.stringify(searchB.hits.hits.map(hit => hit._source.name))}`);
    }
    
    // Verify entity B is found in zone B
    const entityBInResultsB = searchB.hits.hits.some(hit => hit._source.name === ENTITY_B);
    console.log(`  - Found entity ${ENTITY_B} in zone ${ZONE_B} search: ${entityBInResultsB ? 'Yes' : 'No'}`);
    
    if (!entityBInResultsB) {
      throw new Error(`Search isolation failed - entity ${ENTITY_B} not found in zone ${ZONE_B} search`);
    }
    
    // Verify entity A is not found in zone B
    const entityAInResultsB = searchB.hits.hits.some(hit => hit._source.name === ENTITY_A);
    console.log(`  - Found entity ${ENTITY_A} in zone ${ZONE_B} search: ${entityAInResultsB ? 'Yes' : 'No'}`);
    
    if (entityAInResultsB) {
      throw new Error(`Search isolation failed - entity ${ENTITY_A} found in zone ${ZONE_B} search`);
    }
  } catch (error) {
    console.log(`  - Direct search in zone ${ZONE_B} failed: ${error.message}`);
    throw error;
  }
  
  console.log('  ✅ Zone isolation for search test passed');
}

// Test cross-zone relations
async function testCrossZoneRelations(client) {
  console.log('\n🧪 Testing cross-zone relations...');
  
  // Create relation between entities in different zones
  await client.saveRelation({
    from: ENTITY_A,
    to: ENTITY_B,
    relationType: 'related_to'
  }, ZONE_A, ZONE_B);
  console.log(`  - Created relation from ${ENTITY_A} (${ZONE_A}) to ${ENTITY_B} (${ZONE_B})`);
  
  // Wait for Elasticsearch to index the relation
  console.log('  - Waiting for Elasticsearch to index relation...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Verify relation exists using direct search
  try {
    const relationSearch = await client.client.search({
      index: 'knowledge-graph-relations',
      body: {
        query: {
          bool: {
            must: [
              { term: { from: ENTITY_A } },
              { term: { to: ENTITY_B } },
              { term: { relationType: 'related_to' } }
            ]
          }
        }
      }
    });
    
    console.log(`  - Relation search returned ${relationSearch.hits.hits.length} results`);
    
    if (relationSearch.hits.hits.length === 0) {
      throw new Error('Cross-zone relation creation failed - relation not found');
    }
    
    console.log('  - Verified cross-zone relation exists');
  } catch (error) {
    console.log(`  - Relation search failed: ${error.message}`);
    throw error;
  }
  
  // Delete relation
  await client.deleteRelation(ENTITY_A, ENTITY_B, 'related_to', ZONE_A, ZONE_B);
  console.log(`  - Deleted relation from ${ENTITY_A} (${ZONE_A}) to ${ENTITY_B} (${ZONE_B})`);
  
  // Wait for Elasticsearch to update
  console.log('  - Waiting for Elasticsearch to update...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Verify relation was deleted
  try {
    const relationSearchAfterDelete = await client.client.search({
      index: 'knowledge-graph-relations',
      body: {
        query: {
          bool: {
            must: [
              { term: { from: ENTITY_A } },
              { term: { to: ENTITY_B } },
              { term: { relationType: 'related_to' } }
            ]
          }
        }
      }
    });
    
    console.log(`  - Relation search after delete returned ${relationSearchAfterDelete.hits.hits.length} results`);
    
    if (relationSearchAfterDelete.hits.hits.length > 0) {
      throw new Error('Cross-zone relation deletion failed - relation still exists');
    }
    
    console.log('  - Verified cross-zone relation was deleted');
  } catch (error) {
    console.log(`  - Relation search after delete failed: ${error.message}`);
    throw error;
  }
  
  console.log('  ✅ Cross-zone relations test passed');
}

// Test recent entities per zone
async function testRecentEntitiesPerZone(client) {
  console.log('\n🧪 Testing recent entities per zone...');
  
  // Update last read timestamps
  await client.getEntity(ENTITY_A, ZONE_A); // This updates lastRead
  await client.getEntity(ENTITY_B, ZONE_B); // This updates lastRead
  console.log('  - Updated last read timestamps for test entities');
  
  // Wait for Elasticsearch to update
  console.log('  - Waiting for Elasticsearch to update...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Get recent entities in zone A using direct search
  try {
    const recentA = await client.client.search({
      index: `knowledge-graph@${ZONE_A}`,
      body: {
        query: {
          match_all: {}
        },
        sort: [
          { lastRead: { order: 'desc' } }
        ],
        size: 5
      }
    });
    
    console.log(`  - Recent search in zone ${ZONE_A} returned ${recentA.hits.hits.length} results`);
    if (recentA.hits.hits.length > 0) {
      console.log(`  - Results: ${JSON.stringify(recentA.hits.hits.map(hit => hit._source.name))}`);
    }
    
    // Verify entity A is in recent results for zone A
    const entityAInRecentA = recentA.hits.hits.some(hit => hit._source.name === ENTITY_A);
    console.log(`  - Found entity ${ENTITY_A} in zone ${ZONE_A} recent list: ${entityAInRecentA ? 'Yes' : 'No'}`);
    
    if (!entityAInRecentA) {
      throw new Error(`Recent entities isolation failed - entity ${ENTITY_A} not found in zone ${ZONE_A} recent list`);
    }
    
    // Verify entity B is not in recent results for zone A
    const entityBInRecentA = recentA.hits.hits.some(hit => hit._source.name === ENTITY_B);
    console.log(`  - Found entity ${ENTITY_B} in zone ${ZONE_A} recent list: ${entityBInRecentA ? 'Yes' : 'No'}`);
    
    if (entityBInRecentA) {
      throw new Error(`Recent entities isolation failed - entity ${ENTITY_B} found in zone ${ZONE_A} recent list`);
    }
  } catch (error) {
    console.log(`  - Recent search in zone ${ZONE_A} failed: ${error.message}`);
    throw error;
  }
  
  // Get recent entities in zone B using direct search
  try {
    const recentB = await client.client.search({
      index: `knowledge-graph@${ZONE_B}`,
      body: {
        query: {
          match_all: {}
        },
        sort: [
          { lastRead: { order: 'desc' } }
        ],
        size: 5
      }
    });
    
    console.log(`  - Recent search in zone ${ZONE_B} returned ${recentB.hits.hits.length} results`);
    if (recentB.hits.hits.length > 0) {
      console.log(`  - Results: ${JSON.stringify(recentB.hits.hits.map(hit => hit._source.name))}`);
    }
    
    // Verify entity B is in recent results for zone B
    const entityBInRecentB = recentB.hits.hits.some(hit => hit._source.name === ENTITY_B);
    console.log(`  - Found entity ${ENTITY_B} in zone ${ZONE_B} recent list: ${entityBInRecentB ? 'Yes' : 'No'}`);
    
    if (!entityBInRecentB) {
      throw new Error(`Recent entities isolation failed - entity ${ENTITY_B} not found in zone ${ZONE_B} recent list`);
    }
    
    // Verify entity A is not in recent results for zone B
    const entityAInRecentB = recentB.hits.hits.some(hit => hit._source.name === ENTITY_A);
    console.log(`  - Found entity ${ENTITY_A} in zone ${ZONE_B} recent list: ${entityAInRecentB ? 'Yes' : 'No'}`);
    
    if (entityAInRecentB) {
      throw new Error(`Recent entities isolation failed - entity ${ENTITY_A} found in zone ${ZONE_B} recent list`);
    }
  } catch (error) {
    console.log(`  - Recent search in zone ${ZONE_B} failed: ${error.message}`);
    throw error;
  }
  
  console.log('  ✅ Recent entities per zone test passed');
}

// Clean up test data
async function cleanupTestData(client) {
  console.log('\n🧹 Cleaning up test data...');
  
  // Delete test entities
  await client.deleteEntity(ENTITY_A, ZONE_A);
  await client.deleteEntity(ENTITY_B, ZONE_B);
  await client.deleteEntity(ENTITY_DEFAULT);
  
  // Delete test zones
  await client.deleteMemoryZone(ZONE_A);
  await client.deleteMemoryZone(ZONE_B);
  
  console.log('  ✅ Test data cleanup complete');
}

// Run the tests
runTests();
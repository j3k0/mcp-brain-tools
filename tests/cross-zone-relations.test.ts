import { KnowledgeGraphClient } from '../src/kg-client.js';
import { createTestKGClient, setupTestData, cleanupTestData, TEST_ZONE_A, TEST_ZONE_B } from './test-config.js';
import { ESSearchParams } from '../src/es-types.js';

describe('Cross-Zone Relationship Information', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = createTestKGClient();
    await client.initialize();
    await cleanupTestData(client);
    await setupTestData(client);
  });

  afterAll(async () => {
    await cleanupTestData(client);
  });

  test('getRelatedEntities should include zone information', async () => {
    // Get related entities for TestEntityA1 in zone A
    const result = await client.getRelatedEntities('TestEntityA1', 1, TEST_ZONE_A);
    
    // Check that we have relations and that they include zone information
    expect(result.relations.length).toBeGreaterThan(0);
    
    // Check each relation for zone information
    for (const relation of result.relations) {
      expect(relation).toHaveProperty('fromZone');
      expect(relation).toHaveProperty('toZone');
      
      // For relations starting from TestEntityA1, ensure the fromZone is TEST_ZONE_A
      if (relation.from === 'TestEntityA1') {
        expect(relation.fromZone).toBe(TEST_ZONE_A);
      }
      
      // Check cross-zone relation to ensure zones are correctly set
      if (relation.from === 'TestEntityA1' && relation.to === 'TestEntityB1') {
        expect(relation.fromZone).toBe(TEST_ZONE_A);
        expect(relation.toZone).toBe(TEST_ZONE_B);
      }
    }
  });

  test('getRelationsForEntities should include zone information', async () => {
    // Get relations for TestEntityA1 in zone A
    const result = await client.getRelationsForEntities(['TestEntityA1'], TEST_ZONE_A);
    
    // Check that we have relations and that they include zone information
    expect(result.relations.length).toBeGreaterThan(0);
    
    // Check each relation for zone information
    for (const relation of result.relations) {
      expect(relation).toHaveProperty('fromZone');
      expect(relation).toHaveProperty('toZone');
      
      // For relations involving TestEntityA1, ensure the zone information is correct
      if (relation.from === 'TestEntityA1') {
        expect(relation.fromZone).toBe(TEST_ZONE_A);
      }
      
      // Check cross-zone relation to ensure zones are correctly set
      if (relation.from === 'TestEntityA1' && relation.to === 'TestEntityB1') {
        expect(relation.fromZone).toBe(TEST_ZONE_A);
        expect(relation.toZone).toBe(TEST_ZONE_B);
      }
    }
  });

  test('search should include zone information in relations', async () => {
    // Search for entities in zone A
    const searchParams: ESSearchParams = {
      query: 'test',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Find relations in the results
    const relationHits = result.hits.hits.filter(hit => hit._source.type === 'relation');
    
    // Check each relation for zone information
    for (const hit of relationHits) {
      const relation = hit._source;
      expect(relation).toHaveProperty('fromZone');
      expect(relation).toHaveProperty('toZone');
    }
  });
}); 
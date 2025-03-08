import { KnowledgeGraphClient } from '../src/kg-client.js';
import { createTestKGClient, setupTestData, cleanupTestData, TEST_ZONE_A } from './test-config.js';
import { ESSearchParams } from '../src/es-types.js';

describe('Boolean Search Functionality', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = createTestKGClient();
    await client.initialize();
    await cleanupTestData(client);
    
    // Create specific entities for boolean search testing
    await client.saveEntity({
      name: 'BooleanTest1',
      entityType: 'test',
      observations: ['This entity contains apple and banana'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'BooleanTest2',
      entityType: 'test',
      observations: ['This entity contains apple but not banana'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'BooleanTest3',
      entityType: 'test',
      observations: ['This entity contains banana but not apple'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'BooleanTest4',
      entityType: 'test',
      observations: ['This entity contains neither apple nor banana'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
  });

  afterAll(async () => {
    await cleanupTestData(client);
  });

  test('AND operator should return results with all terms', async () => {
    const searchParams: ESSearchParams = {
      query: 'apple AND banana',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Only BooleanTest1 should match both terms
    expect(result.hits.hits.length).toBeGreaterThanOrEqual(1);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that BooleanTest1, which has both terms, is included
    expect(entityNames).toContain('BooleanTest1');
    
    // Check that others are not included
    expect(entityNames).not.toContain('BooleanTest2'); // has apple but not banana
    expect(entityNames).not.toContain('BooleanTest3'); // has banana but not apple
    expect(entityNames).not.toContain('BooleanTest4'); // has neither
  });

  test('OR operator should return results with any of the terms', async () => {
    const searchParams: ESSearchParams = {
      query: 'apple OR banana',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // BooleanTest1, BooleanTest2, and BooleanTest3 should match
    expect(result.hits.hits.length).toBeGreaterThanOrEqual(3);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that entities with either term are included
    expect(entityNames).toContain('BooleanTest1'); // has both
    expect(entityNames).toContain('BooleanTest2'); // has apple
    expect(entityNames).toContain('BooleanTest3'); // has banana
    
    // Check that the entity with neither term is not included
    expect(entityNames).not.toContain('BooleanTest4'); // has neither
  });

  test('NOT operator should exclude results with specified terms', async () => {
    const searchParams: ESSearchParams = {
      query: 'apple NOT banana',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Only BooleanTest2 should match (has apple but not banana)
    expect(result.hits.hits.length).toBeGreaterThanOrEqual(1);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that only BooleanTest2 is included
    expect(entityNames).toContain('BooleanTest2');
    
    // Check that others are not included
    expect(entityNames).not.toContain('BooleanTest1'); // has both
    expect(entityNames).not.toContain('BooleanTest3'); // has banana but not apple
    expect(entityNames).not.toContain('BooleanTest4'); // has neither
  });

  test('Complex boolean query should work correctly', async () => {
    const searchParams: ESSearchParams = {
      query: '(apple OR banana) AND NOT (apple AND banana)',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Only BooleanTest2 and BooleanTest3 should match
    expect(result.hits.hits.length).toBeGreaterThanOrEqual(2);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that only BooleanTest2 and BooleanTest3 are included
    expect(entityNames).toContain('BooleanTest2'); // has apple but not banana
    expect(entityNames).toContain('BooleanTest3'); // has banana but not apple
    
    // Check that others are not included
    expect(entityNames).not.toContain('BooleanTest1'); // has both
    expect(entityNames).not.toContain('BooleanTest4'); // has neither
  });
}); 
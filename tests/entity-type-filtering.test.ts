import { KnowledgeGraphClient } from '../src/kg-client.js';
import { createTestKGClient, setupTestData, cleanupTestData, TEST_ZONE_A } from './test-config.js';
import { ESSearchParams } from '../src/es-types.js';

describe('Entity Type Filtering', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = createTestKGClient();
    await client.initialize();
    await cleanupTestData(client);
    
    // Create entities with different types for testing
    await client.saveEntity({
      name: 'TypeFilterTest1',
      entityType: 'person',
      observations: ['This is a person entity'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'TypeFilterTest2',
      entityType: 'concept',
      observations: ['This is a concept entity'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'TypeFilterTest3',
      entityType: 'person',
      observations: ['This is another person entity'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'TypeFilterTest4',
      entityType: 'location',
      observations: ['This is a location entity'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
  });

  afterAll(async () => {
    await cleanupTestData(client);
  });

  test('should filter by single entity type', async () => {
    const searchParams: ESSearchParams = {
      query: 'entity',
      entityTypes: ['person'],
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Should only return person entities
    const entityTypes = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).entityType);
    
    // Check that all returned entities are of type 'person'
    expect(entityTypes.every(type => type === 'person')).toBe(true);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that person entities are included
    expect(entityNames).toContain('TypeFilterTest1');
    expect(entityNames).toContain('TypeFilterTest3');
    
    // Check that other entity types are not included
    expect(entityNames).not.toContain('TypeFilterTest2'); // concept
    expect(entityNames).not.toContain('TypeFilterTest4'); // location
  });

  test('should filter by multiple entity types', async () => {
    const searchParams: ESSearchParams = {
      query: 'entity',
      entityTypes: ['person', 'location'],
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Should return both person and location entities
    const entityTypes = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).entityType);
    
    // Check that all returned entities are of the specified types
    expect(entityTypes.every(type => type === 'person' || type === 'location')).toBe(true);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that person and location entities are included
    expect(entityNames).toContain('TypeFilterTest1'); // person
    expect(entityNames).toContain('TypeFilterTest3'); // person
    expect(entityNames).toContain('TypeFilterTest4'); // location
    
    // Check that concept entity is not included
    expect(entityNames).not.toContain('TypeFilterTest2'); // concept
  });

  test('should handle case insensitivity in entity type filtering', async () => {
    const searchParams: ESSearchParams = {
      query: 'entity',
      entityTypes: ['PERSON'], // uppercase to test case insensitivity
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Should still find person entities despite case difference
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that person entities are found despite the case difference
    expect(entityNames).toContain('TypeFilterTest1');
    expect(entityNames).toContain('TypeFilterTest3');
  });

  test('should handle partial entity type matching', async () => {
    const searchParams: ESSearchParams = {
      query: 'entity',
      entityTypes: ['pers'], // partial "person" to test partial matching
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Should find person entities with partial matching
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Check that person entities are found despite only providing a partial type
    expect(entityNames).toContain('TypeFilterTest1');
    expect(entityNames).toContain('TypeFilterTest3');
  });
}); 
import { KnowledgeGraphClient } from '../src/kg-client.js';
import { createTestKGClient, cleanupTestData, TEST_ZONE_A } from './test-config.js';
import { ESSearchParams } from '../src/es-types.js';

describe('Fuzzy Search Capabilities', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = createTestKGClient();
    await client.initialize();
    await cleanupTestData(client);
    
    // Create entities for fuzzy search testing
    await client.saveEntity({
      name: 'Programming',
      entityType: 'skill',
      observations: ['Software development with various programming languages'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'JavaScript',
      entityType: 'language',
      observations: ['A programming language commonly used for web development'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'Python',
      entityType: 'language',
      observations: ['A programming language known for its readability and versatility'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'Database',
      entityType: 'technology',
      observations: ['Structured collection of data for easy access and management'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'Architecture',
      entityType: 'concept',
      observations: ['The structure and organization of software components'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
  });

  afterAll(async () => {
    await cleanupTestData(client);
  });

  test('should support fuzzy search on entity names with tilde notation', async () => {
    // Search for "Programing~1" (misspelled, missing 'm')
    const searchParams: ESSearchParams = {
      query: 'Programing~1',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Should find "Programming" despite the misspelling
    expect(entityNames).toContain('Programming');
  });

  test('should support fuzzy search on observation content with tilde notation', async () => {
    // Search for "readabilty~1" (misspelled, missing 'i') in observations
    const searchParams: ESSearchParams = {
      query: 'readabilty~1',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Should find "Python" which has "readability" in its observations
    expect(entityNames).toContain('Python');
  });

  test('should adjust fuzzy matching precision with tilde number', async () => {
    // Search for "languag~2" with higher fuzziness
    const searchParams: ESSearchParams = {
      query: 'languag~2',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Should find entities with "language" in name or observations
    expect(entityNames).toContain('JavaScript');
    expect(entityNames).toContain('Python');
  });

  test('should support proximity searches with tilde notation', async () => {
    // Search for the phrase "programming language" with words not exactly adjacent
    const searchParams: ESSearchParams = {
      query: '"programming language"~2',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Should find entities with "programming" and "language" within 2 words of each other
    expect(entityNames).toContain('JavaScript');
    expect(entityNames).toContain('Python');
  });

  test('should combine fuzzy search with boolean operators', async () => {
    // Search for "programing~1 AND NOT javascript"
    const searchParams: ESSearchParams = {
      query: 'programing~1 AND NOT javascript',
      zone: TEST_ZONE_A
    };
    
    const result = await client.search(searchParams);
    
    // Extract entity names from the results
    const entityNames = result.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => (hit._source as any).name);
    
    // Should find "Programming" and "Python" but not "JavaScript"
    expect(entityNames).toContain('Programming');
    expect(entityNames).toContain('Python');
    expect(entityNames).not.toContain('JavaScript');
  });
}); 
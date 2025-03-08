import { KnowledgeGraphClient } from '../src/kg-client.js';
import { createTestKGClient, cleanupTestData, TEST_ZONE_A } from './test-config.js';

describe('Empty Name Entity Validation', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = createTestKGClient();
    await client.initialize();
    await cleanupTestData(client);
  });

  afterAll(async () => {
    await cleanupTestData(client);
  });

  test('should reject entity creation with empty name', async () => {
    // Empty string
    await expect(client.saveEntity({
      name: '',
      entityType: 'test',
      observations: ['Test observation'],
      relevanceScore: 1.0
    }, TEST_ZONE_A)).rejects.toThrow('Entity name cannot be empty');

    // Only whitespace
    await expect(client.saveEntity({
      name: '   ',
      entityType: 'test',
      observations: ['Test observation'],
      relevanceScore: 1.0
    }, TEST_ZONE_A)).rejects.toThrow('Entity name cannot be empty');
  });

  test('should reject entity deletion with empty name', async () => {
    // Empty string
    await expect(client.deleteEntity('', TEST_ZONE_A))
      .rejects.toThrow('Entity name cannot be empty');

    // Only whitespace
    await expect(client.deleteEntity('   ', TEST_ZONE_A))
      .rejects.toThrow('Entity name cannot be empty');
  });

  test('should validate entity names in relationship creation', async () => {
    // First create a valid entity
    await client.saveEntity({
      name: 'ValidEntity',
      entityType: 'test',
      observations: ['Valid entity for relationship test'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);

    // Empty 'from' entity name
    await expect(client.saveRelation({
      from: '',
      to: 'ValidEntity',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_A, { autoCreateMissingEntities: false }))
      .rejects.toThrow('Entity name cannot be empty');

    // Empty 'to' entity name
    await expect(client.saveRelation({
      from: 'ValidEntity',
      to: '',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_A, { autoCreateMissingEntities: false }))
      .rejects.toThrow('Entity name cannot be empty');
  });
}); 
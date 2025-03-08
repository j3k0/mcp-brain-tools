import { KnowledgeGraphClient } from '../src/kg-client.js';
import { createTestKGClient, cleanupTestData, TEST_ZONE_A, TEST_ZONE_B } from './test-config.js';

describe('Non-existent Entity in Relationships', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = createTestKGClient();
    await client.initialize();
    await cleanupTestData(client);
    
    // Create one entity for testing
    await client.saveEntity({
      name: 'ExistingEntity',
      entityType: 'test',
      observations: ['This is an existing entity for relationship tests'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
  });

  afterAll(async () => {
    await cleanupTestData(client);
  });

  test('should auto-create missing entity when auto-create is enabled', async () => {
    // Auto-create is enabled by default
    const relation = await client.saveRelation({
      from: 'ExistingEntity',
      to: 'NonExistentEntity',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_A);
    
    // Check that the relation was created
    expect(relation).toBeDefined();
    expect(relation.from).toBe('ExistingEntity');
    expect(relation.to).toBe('NonExistentEntity');
    expect(relation.relationType).toBe('test_relation');
    
    // Verify that the non-existent entity was auto-created
    const entity = await client.getEntity('NonExistentEntity', TEST_ZONE_A);
    expect(entity).toBeDefined();
    expect(entity?.name).toBe('NonExistentEntity');
    expect(entity?.entityType).toBe('unknown'); // Default entity type for auto-created entities
  });

  test('should reject relationship when auto-create is disabled and entity does not exist', async () => {
    // Explicitly disable auto-creation
    await expect(client.saveRelation({
      from: 'ExistingEntity',
      to: 'AnotherNonExistentEntity',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_A, { autoCreateMissingEntities: false }))
      .rejects.toThrow('Cannot create relation: Missing entities');
  });

  test('should handle cross-zone entity creation and validation', async () => {
    // Create entity in zone B for testing
    await client.saveEntity({
      name: 'ExistingEntityInZoneB',
      entityType: 'test',
      observations: ['This is an existing entity in zone B'],
      relevanceScore: 1.0
    }, TEST_ZONE_B);
    
    // Test auto-creation of missing entity in cross-zone relation
    const crossZoneRelation = await client.saveRelation({
      from: 'ExistingEntity',
      to: 'NonExistentEntityInZoneB',
      relationType: 'cross_zone_relation'
    }, TEST_ZONE_A, TEST_ZONE_B);
    
    // Check that the relation was created
    expect(crossZoneRelation).toBeDefined();
    expect(crossZoneRelation.from).toBe('ExistingEntity');
    expect(crossZoneRelation.fromZone).toBe(TEST_ZONE_A);
    expect(crossZoneRelation.to).toBe('NonExistentEntityInZoneB');
    expect(crossZoneRelation.toZone).toBe(TEST_ZONE_B);
    
    // Verify that the non-existent entity was auto-created in zone B
    const entityInZoneB = await client.getEntity('NonExistentEntityInZoneB', TEST_ZONE_B);
    expect(entityInZoneB).toBeDefined();
    expect(entityInZoneB?.name).toBe('NonExistentEntityInZoneB');
    expect(entityInZoneB?.zone).toBe(TEST_ZONE_B);
  });

  test('should reject cross-zone relationship when auto-create is disabled', async () => {
    // Explicitly disable auto-creation for cross-zone relation
    await expect(client.saveRelation({
      from: 'ExistingEntity',
      to: 'YetAnotherNonExistentEntity',
      relationType: 'test_relation'
    }, TEST_ZONE_A, TEST_ZONE_B, { autoCreateMissingEntities: false }))
      .rejects.toThrow('Cannot create relation: Missing entities');
  });
}); 
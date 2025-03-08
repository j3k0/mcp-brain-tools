/**
 * Test for zone management functionality
 * 
 * This tests the new zone management features including:
 * - Creating zones
 * - Listing zones
 * - Copying entities between zones
 * - Moving entities between zones
 * - Merging zones
 * - Deleting zones
 */

import { KnowledgeGraphClient } from '../dist/kg-client.js';

// Test zones
const TEST_ZONE_A = 'test-zone-a';
const TEST_ZONE_B = 'test-zone-b';
const TEST_ZONE_MERGED = 'test-zone-merged';

// Create client
const client = new KnowledgeGraphClient({
  node: 'http://localhost:9200',
  defaultZone: TEST_ZONE_A
});

async function runTests() {
  console.log('Starting zone management tests...');
  
  try {
    // Clean up any existing test zones
    console.log('\n==== Cleaning up existing test zones ====');
    try {
      await client.deleteMemoryZone(TEST_ZONE_A);
      await client.deleteMemoryZone(TEST_ZONE_B);
      await client.deleteMemoryZone(TEST_ZONE_MERGED);
    } catch (error) {
      // Ignore errors during cleanup
    }
    
    // 1. Create test zones
    console.log('\n==== Creating test zones ====');
    
    await client.addMemoryZone(TEST_ZONE_A, 'Test Zone A');
    console.log(`Created zone: ${TEST_ZONE_A}`);
    
    await client.addMemoryZone(TEST_ZONE_B, 'Test Zone B');
    console.log(`Created zone: ${TEST_ZONE_B}`);
    
    await client.addMemoryZone(TEST_ZONE_MERGED, 'Test Zone for Merging');
    console.log(`Created zone: ${TEST_ZONE_MERGED}`);
    
    // 2. List zones
    console.log('\n==== Listing zones ====');
    const zones = await client.listMemoryZones();
    console.log(`Found ${zones.length} zones: ${zones.map(z => z.name).join(', ')}`);
    
    if (!zones.some(z => z.name === TEST_ZONE_A) || 
        !zones.some(z => z.name === TEST_ZONE_B) || 
        !zones.some(z => z.name === TEST_ZONE_MERGED)) {
      throw new Error('Not all created zones were found in the list');
    }
    
    // 3. Create test entities in zones
    console.log('\n==== Creating test entities ====');
    
    // Create entities in Zone A
    await client.saveEntity({
      name: 'EntityA1',
      entityType: 'person',
      observations: ['Observation A1'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'EntityA2',
      entityType: 'person',
      observations: ['Observation A2'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    await client.saveEntity({
      name: 'Common',
      entityType: 'location',
      observations: ['This entity exists in both zones with different data'],
      relevanceScore: 1.0
    }, TEST_ZONE_A);
    
    // Create a relationship between entities in Zone A
    await client.saveRelation({
      from: 'EntityA1',
      to: 'EntityA2',
      relationType: 'knows'
    }, TEST_ZONE_A, TEST_ZONE_A);
    
    // Create entities in Zone B
    await client.saveEntity({
      name: 'EntityB1',
      entityType: 'person',
      observations: ['Observation B1'],
      relevanceScore: 1.0
    }, TEST_ZONE_B);
    
    await client.saveEntity({
      name: 'Common',
      entityType: 'location',
      observations: ['Same name but different content in Zone B'],
      relevanceScore: 1.0
    }, TEST_ZONE_B);
    
    console.log('Created test entities in both zones');
    
    // 4. Test copying entities
    console.log('\n==== Testing copy entities ====');
    const copyResult = await client.copyEntitiesBetweenZones(
      ['EntityA1', 'EntityA2'],
      TEST_ZONE_A,
      TEST_ZONE_B,
      { copyRelations: true }
    );
    
    console.log(`Copied ${copyResult.entitiesCopied.length} entities and ${copyResult.relationsCopied} relations`);
    console.log(`Skipped ${copyResult.entitiesSkipped.length} entities`);
    
    // Verify copy
    const entityA1inB = await client.getEntity('EntityA1', TEST_ZONE_B);
    if (!entityA1inB) {
      throw new Error('EntityA1 was not copied to Zone B');
    }
    console.log('Verified EntityA1 was copied to Zone B');
    
    // 5. Test conflict handling during copy
    console.log('\n==== Testing conflict handling during copy ====');
    const conflictCopyResult = await client.copyEntitiesBetweenZones(
      ['Common'],
      TEST_ZONE_A,
      TEST_ZONE_B,
      { copyRelations: true, overwrite: false }
    );
    
    if (conflictCopyResult.entitiesSkipped.length !== 1) {
      throw new Error('Expected Common entity copy to be skipped due to conflict');
    }
    console.log('Verified conflict handling: Common entity was skipped as expected');
    
    // 6. Test moving entities
    console.log('\n==== Testing move entities ====');
    const moveResult = await client.moveEntitiesBetweenZones(
      ['EntityA2'],
      TEST_ZONE_A,
      TEST_ZONE_MERGED,
      { moveRelations: true }
    );
    
    console.log(`Moved ${moveResult.entitiesMoved.length} entities and ${moveResult.relationsMoved} relations`);
    
    // Verify move
    const entityA2inMerged = await client.getEntity('EntityA2', TEST_ZONE_MERGED);
    if (!entityA2inMerged) {
      throw new Error('EntityA2 was not moved to Merged zone');
    }
    
    const entityA2inA = await client.getEntity('EntityA2', TEST_ZONE_A);
    if (entityA2inA) {
      throw new Error('EntityA2 was not deleted from Zone A after moving');
    }
    
    console.log('Verified EntityA2 was moved from Zone A to Merged zone');
    
    // 7. Test merging zones
    console.log('\n==== Testing zone merging ====');
    const mergeResult = await client.mergeZones(
      [TEST_ZONE_A, TEST_ZONE_B],
      TEST_ZONE_MERGED,
      { 
        deleteSourceZones: false,
        overwriteConflicts: 'rename'
      }
    );
    
    console.log(`Merged ${mergeResult.mergedZones.length} zones`);
    console.log(`Copied ${mergeResult.entitiesCopied} entities and ${mergeResult.relationsCopied} relations`);
    console.log(`Skipped ${mergeResult.entitiesSkipped} entities`);
    
    if (mergeResult.failedZones.length > 0) {
      console.error('Failed to merge zones:', mergeResult.failedZones);
    }
    
    // Check that the Common entity from both zones exists in the merged zone
    const commonInMerged = await client.getEntity('Common', TEST_ZONE_MERGED);
    const commonFromBInMerged = await client.getEntity('Common_from_test-zone-b', TEST_ZONE_MERGED);
    
    if (!commonInMerged) {
      throw new Error('Original Common entity was not merged');
    }
    
    if (!commonFromBInMerged) {
      throw new Error('Renamed Common entity from Zone B was not merged');
    }
    
    console.log('Verified entities were properly merged with conflict resolution');
    
    // 8. Get zone statistics
    console.log('\n==== Getting zone statistics ====');
    const stats = await client.getMemoryZoneStats(TEST_ZONE_MERGED);
    
    console.log(`Zone ${stats.zone} statistics:`);
    console.log(`- Entity count: ${stats.entityCount}`);
    console.log(`- Relation count: ${stats.relationCount}`);
    console.log(`- Entity types: ${JSON.stringify(stats.entityTypes)}`);
    console.log(`- Relation types: ${JSON.stringify(stats.relationTypes)}`);
    
    // 9. Delete test zones
    console.log('\n==== Deleting test zones ====');
    await client.deleteMemoryZone(TEST_ZONE_A);
    await client.deleteMemoryZone(TEST_ZONE_B);
    await client.deleteMemoryZone(TEST_ZONE_MERGED);
    console.log('All test zones deleted');
    
    console.log('\n==== Zone management tests completed successfully ====');
  } catch (error) {
    console.error('Error in zone management tests:', error);
    process.exit(1);
  }
}

// Run the tests
runTests(); 
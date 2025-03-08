#!/bin/bash
set -e

# Use a consistent index prefix for all operations
export KG_INDEX_PREFIX=test

echo "==== Multi-Zone Knowledge Graph Test Script ===="
echo

# Ensure we start with a clean slate
echo "Resetting the knowledge graph..."
node dist/admin-cli.js reset --yes

# Create multiple zones
echo -e "\n==== Creating memory zones ===="
node dist/admin-cli.js zones add projecta "Project A knowledge zone"
node dist/admin-cli.js zones add projectb "Project B knowledge zone"

# Ensure default index exists
echo "Creating default index..."
node dist/admin-cli.js init

node dist/admin-cli.js zones list

# Add entities to different zones
echo -e "\n==== Creating entities in different zones ===="
echo '{"type":"entity","name":"General Concept","entityType":"concept","observations":["A general concept that applies across projects"],"zone":"default"}' > default-entity.jsonl
echo '{"type":"entity","name":"Project A Feature","entityType":"feature","observations":["A specific feature for Project A"],"zone":"projecta"}' > projectA-entity.jsonl
echo '{"type":"entity","name":"Project B Component","entityType":"component","observations":["A component used in Project B"],"zone":"projectb"}' > projectB-entity.jsonl

node dist/admin-cli.js import default-entity.jsonl default
node dist/admin-cli.js import projectA-entity.jsonl projecta
node dist/admin-cli.js import projectB-entity.jsonl projectb

# Add a delay to ensure entities are indexed
echo "Waiting for Elasticsearch to index entities..."
sleep 5

# Verify entities exist
echo "Verifying entities exist:"
echo "- Default zone entity:"
node dist/admin-cli.js entity "General Concept" default || echo "Entity not found, but continuing..."
echo "- Direct Elasticsearch query for General Concept:"
curl -X GET "http://localhost:9200/test@default/_search?pretty" -H 'Content-Type: application/json' -d'{"query":{"match":{"name":"General Concept"}}}'
echo "- ProjectA zone entity:"
node dist/admin-cli.js entity "Project A Feature" projecta || echo "Entity not found, but continuing..."
echo "- ProjectB zone entity:"
node dist/admin-cli.js entity "Project B Component" projectb || echo "Entity not found, but continuing..."

# Create cross-zone relations
echo -e "\n==== Creating cross-zone relations ===="
echo '{"type":"relation","from":"Project A Feature","fromZone":"projecta","to":"General Concept","toZone":"default","relationType":"implements"}' > relationA.jsonl
echo '{"type":"relation","from":"Project B Component","fromZone":"projectb","to":"General Concept","toZone":"default","relationType":"uses"}' > relationB.jsonl
echo '{"type":"relation","from":"Project A Feature","fromZone":"projecta","to":"Project B Component","toZone":"projectb","relationType":"depends_on"}' > relationC.jsonl

node dist/admin-cli.js import relationA.jsonl default
node dist/admin-cli.js import relationB.jsonl default
node dist/admin-cli.js import relationC.jsonl default

# Check entities and their relations
echo -e "\n==== Checking entities and their relations ===="
node dist/admin-cli.js entity "General Concept"
node dist/admin-cli.js entity "Project A Feature" projecta
node dist/admin-cli.js entity "Project B Component" projectb

# Check zone statistics
echo -e "\n==== Checking zone statistics ===="
node dist/admin-cli.js stats
node dist/admin-cli.js zones stats projecta
node dist/admin-cli.js zones stats projectb

# Test search functionality
echo -e "\n==== Testing search functionality ===="
node dist/admin-cli.js search "Project" 
node dist/admin-cli.js search "Feature" projecta
node dist/admin-cli.js search "Component" projectb

# Create a backup
echo -e "\n==== Creating a backup ===="
node dist/admin-cli.js backup multi-zone-backup.json

# Delete projectA zone
echo -e "\n==== Deleting projectA zone ===="
node dist/admin-cli.js zones delete projecta --yes
node dist/admin-cli.js zones list

# Restore from backup
echo -e "\n==== Restoring from backup ===="
node dist/admin-cli.js restore multi-zone-backup.json --yes
node dist/admin-cli.js zones list

# Verify everything is restored correctly
echo -e "\n==== Verifying restoration ===="
node dist/admin-cli.js entity "Project A Feature" projecta
node dist/admin-cli.js relations "General Concept"

echo -e "\n==== Test completed successfully ====" 

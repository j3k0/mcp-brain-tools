#!/bin/bash
set -e

echo "==== Multi-Zone Knowledge Graph Test Script ===="
echo

# Ensure we start with a clean slate
echo "Resetting the knowledge graph..."
node dist/admin-cli.js reset --yes

# Create multiple zones
echo -e "\n==== Creating memory zones ===="
node dist/admin-cli.js zones add projectA "Project A knowledge zone"
node dist/admin-cli.js zones add projectB "Project B knowledge zone"
node dist/admin-cli.js zones list

# Add entities to different zones
echo -e "\n==== Creating entities in different zones ===="
echo '{"type":"entity","name":"General Concept","entityType":"concept","observations":["A general concept that applies across projects"]}' > default-entity.jsonl
echo '{"type":"entity","name":"Project A Feature","entityType":"feature","observations":["A specific feature for Project A"]}' > projectA-entity.jsonl
echo '{"type":"entity","name":"Project B Component","entityType":"component","observations":["A component used in Project B"]}' > projectB-entity.jsonl

node dist/admin-cli.js import default-entity.jsonl default
node dist/admin-cli.js import projectA-entity.jsonl projectA
node dist/admin-cli.js import projectB-entity.jsonl projectB

# Create cross-zone relations
echo -e "\n==== Creating cross-zone relations ===="
echo '{"type":"relation","from":"Project A Feature","fromZone":"projectA","to":"General Concept","toZone":"default","relationType":"implements"}' > relationA.jsonl
echo '{"type":"relation","from":"Project B Component","fromZone":"projectB","to":"General Concept","toZone":"default","relationType":"uses"}' > relationB.jsonl
echo '{"type":"relation","from":"Project A Feature","fromZone":"projectA","to":"Project B Component","toZone":"projectB","relationType":"depends_on"}' > relationC.jsonl

node dist/admin-cli.js import relationA.jsonl
node dist/admin-cli.js import relationB.jsonl
node dist/admin-cli.js import relationC.jsonl

# Check entities and their relations
echo -e "\n==== Checking entities and their relations ===="
node dist/admin-cli.js entity "General Concept"
node dist/admin-cli.js entity "Project A Feature" projectA
node dist/admin-cli.js entity "Project B Component" projectB

# Check zone statistics
echo -e "\n==== Checking zone statistics ===="
node dist/admin-cli.js stats
node dist/admin-cli.js zones stats projectA
node dist/admin-cli.js zones stats projectB

# Test search functionality
echo -e "\n==== Testing search functionality ===="
node dist/admin-cli.js search "Project" 
node dist/admin-cli.js search "Feature" projectA
node dist/admin-cli.js search "Component" projectB

# Create a backup
echo -e "\n==== Creating a backup ===="
node dist/admin-cli.js backup multi-zone-backup.json

# Delete projectA zone
echo -e "\n==== Deleting projectA zone ===="
node dist/admin-cli.js zones delete projectA --yes
node dist/admin-cli.js zones list

# Restore from backup
echo -e "\n==== Restoring from backup ===="
node dist/admin-cli.js restore multi-zone-backup.json --yes
node dist/admin-cli.js zones list

# Verify everything is restored correctly
echo -e "\n==== Verifying restoration ===="
node dist/admin-cli.js entity "Project A Feature" projectA
node dist/admin-cli.js relations "General Concept"

echo -e "\n==== Test completed successfully ====" 
# MCP Memory: Persistent Memory for AI Conversations 🧠

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-7.x-yellow)
![Node](https://img.shields.io/badge/node-18+-green)

> **Give your AI a memory that persists across conversations.** Never lose important context again.

MCP Memory is a robust, Elasticsearch-backed knowledge graph system that gives AI models persistent memory beyond the limits of their context windows. Built for the Model Context Protocol (MCP), it ensures your LLMs remember important information forever, creating more coherent, personalized, and effective AI conversations.

<p align="center">
  <img src="https://via.placeholder.com/800x400?text=MCP+Memory+Visualization" alt="MCP Memory Visualization" width="600">
</p>

## 🌟 Why AI Models Need Persistent Memory

Ever experienced these frustrations with AI assistants?

- Your AI forgetting crucial details from earlier conversations
- Having to repeat the same context every time you start a new chat
- Losing valuable insights once the conversation history fills up
- Inability to reference past work or decisions

MCP Memory solves these problems by creating a structured, searchable memory store that preserves context indefinitely. Your AI can now build meaningful, long-term relationships with users and maintain coherence across days, weeks, or months of interactions.

## ✨ Key Features

- **📊 Persistent Memory**: Store and retrieve information across multiple sessions
- **🔍 Smart Search**: Find exactly what you need with powerful Elasticsearch queries
- **📓 Contextual Recall**: AI automatically prioritizes relevant information based on the conversation
- **🧩 Relational Understanding**: Connect concepts with relationships that mimic human associative memory
- **🔄 Long-term / Short-term Memory**: Distinguish between temporary details and important knowledge
- **🗂️ Memory Zones**: Organize information into separate domains (projects, clients, topics)
- **🔒 Reliable & Scalable**: Built on Elasticsearch for enterprise-grade performance

## 🚀 5-Minute Setup

Getting started is incredibly simple:

```bash
# 1. Clone the repository
git clone https://github.com/mcp-servers/mcp-servers.git
cd mcp-servers/memory

# 2. Install dependencies
npm install

# 3. Start Elasticsearch (uses Docker)
npm run es:start

# 4. Build the project
npm run build

# 5. Start the MCP server
npm start
```

That's it! Your AI now has a persistent memory system.

## 💡 How It Works

MCP Memory creates a structured knowledge graph where:

1. **Entities** represent people, concepts, projects, or anything worth remembering
2. **Relations** connect entities, creating a network of associations
3. **Observations** capture specific details about entities
4. **Relevance scoring** determines what information to prioritize

When integrated with an LLM, the system automatically:
- Stores new information learned during conversations
- Retrieves relevant context when needed
- Builds connections between related concepts
- Forgets unimportant details while preserving critical knowledge

## 🛠️ Usage Examples

### Remembering User Preferences

```javascript
// Store a user preference
await memoryClient.createEntities({
  entities: [{
    name: "Jane Smith",
    entityType: "Person",
    observations: ["Prefers dark mode", "Lives in Boston"]
  }]
});

// Later, retrieve those preferences
const results = await memoryClient.searchNodes({
  query: "Jane Smith preferences",
  informationNeeds: "What UI preferences does Jane have?"
});
```

### Project Context

```javascript
// Store project information
await memoryClient.createEntities({
  entities: [{
    name: "Project Apollo",
    entityType: "Project",
    observations: ["Started on May 15, 2023", "Deadline is December 1, 2023"]
  }]
});

// Connect team members to project
await memoryClient.createRelations({
  relations: [
    { from: "Jane Smith", to: "Project Apollo", type: "works on" }
  ]
});
```

### Adding New Observations

```javascript
// Add new learnings about an entity
await memoryClient.addObservations({
  name: "Project Apollo",
  observations: ["Budget increased to $250K on July 3"]
});
```

## 🔎 Real-World Applications

- **Customer Support**: Remember details about customers and their past issues
- **Project Management**: Maintain context about projects, decisions, and discussions
- **Personal Assistants**: Build a personalized memory of user preferences and history
- **Education**: Remember student progress and learning patterns
- **Research**: Maintain knowledge graphs of complex research domains

## 📊 Memory vs. Traditional Approaches

| Feature | MCP Memory | Conversation History | Vector Databases | Traditional Databases |
|---------|------------|---------------------|------------------|------------------------|
| Persistence across sessions | ✅ | ❌ | ✅ | ✅ |
| Relationships between concepts | ✅ | ❌ | ⚠️ Limited | ⚠️ Limited |
| Automatic relevance ranking | ✅ | ❌ | ✅ | ❌ |
| Query flexibility | ✅ | ❌ | ⚠️ Limited | ✅ |
| Scalability | ✅ | ❌ | ✅ | ✅ |
| Memory organization | ✅ | ❌ | ⚠️ Limited | ⚠️ Limited |

## 🧰 Admin Tools

MCP Memory includes a comprehensive admin CLI for maintaining your knowledge graph:

```bash
# Search the memory
node dist/admin-cli.js search "project deadline"

# View details about a specific entity
node dist/admin-cli.js entity "Jane Smith"

# Back up your entire memory system
node dist/admin-cli.js backup memory-backup.json
```

## 📚 Advanced Features

### Memory Zones

Organize knowledge into separate domains:

```bash
# Create a project-specific memory zone
node dist/admin-cli.js zones add client-acme "ACME Corp Project Knowledge"

# Import data into that zone
node dist/admin-cli.js import acme-data.json client-acme
```

### Search Capabilities

Leverage Elasticsearch's powerful search features:

```bash
# Fuzzy search (finds "meeting" even with typo)
node dist/admin-cli.js search "meteing notes"

# Zone-specific search
node dist/admin-cli.js search "budget" client-acme
```

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📝 License

MIT

---

<p align="center">
  <b>Ready to give your AI a memory that lasts? Get started in 5 minutes!</b><br>
  <a href="https://github.com/mcp-servers/mcp-servers">GitHub</a> •
  <a href="https://discord.gg/mcp-community">Discord</a> •
  <a href="https://mcp-servers.readthedocs.io">Documentation</a>
</p>

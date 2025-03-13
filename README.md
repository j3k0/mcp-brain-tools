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

### Prerequisites

- **Docker**: Required for running Elasticsearch (or a local Elasticsearch installation)
- **Node.js**: Version 18 or higher
- **npm**: For package management

```bash
# 1. Clone the repository
git clone https://github.com/mcp-servers/mcp-servers.git
cd mcp-servers/memory

# 2. Install dependencies
npm install

# 3. Start Elasticsearch (uses Docker)
npm run es:start
# Note: If you prefer to use your own Elasticsearch installation,
# set the ES_NODE environment variable to point to your Elasticsearch instance

# 4. Build the project
npm run build
```

### 🔌 Connecting to Claude Desktop

MCP Memory is designed to work seamlessly with Claude Desktop, giving Claude persistent memory across all your conversations:

1. **Create and configure the launch script**:
   
   If `launch.example` doesn't exist, create a new file called `launch.sh` with the following content:
   
   ```bash
   #!/bin/bash
   set -e
   
   # Your Groq API Key (required for smart memory retrieval)
   export GROQ_API_KEY=gsk_your_groq_api_key_here
   
   # Optional configuration
   # export DEBUG=true
   # export ES_NODE=http://localhost:9200
   # export KG_DEFAULT_ZONE=default
   
   # Change to the script directory
   cd "$(dirname "$0")"
   
   # Ensure Elasticsearch is running
   docker ps | grep elasticsearch > /dev/null || npm run es:start
   
   # Start the MCP Memory server
   node dist/index.js
   ```
   
   Make the script executable:
   ```bash
   chmod +x launch.sh
   ```

2. **Add the command to Claude Desktop**:
   - Open Claude Desktop Settings
   - Navigate to the "Commands" section
   - Click "Add New Command"
   - Configure as follows:
     - **Name**: MCP Memory
     - **Command**: /path/to/mcp-servers/memory/launch.sh
     - **Arguments**: Leave empty
     - **Run in background**: Yes
     - **Show in menu**: Yes

3. **Verify connection**:
   - Start the command from Claude Desktop
   - You should see a notification that Claude is connected to MCP Memory
   - Try asking Claude about something you discussed in a previous conversation!

For complete examples and visual guides, see the [Claude Desktop MCP Server Setup Guide](https://github.com/anthropic-claude/claude-desktop-mcp-examples) online.

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

## 🛠️ Example: How Agents Use Memory

### From the User's Perspective

**Conversation 1: Initial Information**

```
User: My daughter's name is Emma and she's turning 8 next month.

Claude: That's wonderful! Emma will be turning 8 next month. Is there anything special you're planning for her birthday?
(Behind the scenes: Claude stores "Emma" as an entity of type "Person" with observations about her age and birthday timing)
```

**Conversation 2: Days or Weeks Later**

```
User: I'm thinking about what to get for a gift.

Claude: If you're looking for gift ideas for Emma's 8th birthday coming up, have you considered what her current interests are? At that age, many children enjoy creative items, books, or educational games.
(Behind the scenes: Claude retrieved the entity "Emma", her age, and the fact that her birthday is approaching)
```

**Conversation 3: After the Birthday**

```
User: The party went really well on Saturday!

Claude: I'm glad Emma's 8th birthday party was a success on Saturday! Did she enjoy the gifts she received?
(Behind the scenes: Claude updates the observations about Emma, noting that her birthday party occurred on a Saturday and went well)
```

### How the Agent Uses Memory

When the user mentions something important, the agent:

1. **Recognizes important information** worth remembering
2. **Stores it in memory** by creating entities, relations, and observations
3. **Updates existing information** when new details emerge

When the user mentions something related to stored information, the agent:

1. **Searches memory** for relevant context based on the current conversation
2. **Retrieves important details** that might be helpful
3. **Incorporates this information** naturally into its responses

This happens automatically - the user simply has a normal conversation with the assistant, and the memory system works behind the scenes to maintain context across sessions.

## 🧰 Admin Tools

MCP Memory includes a comprehensive admin CLI for maintaining your knowledge graph:

```bash
# Search the memory
node dist/admin-cli.js search "Emma birthday"

# View details about a specific entity
node dist/admin-cli.js entity "Emma"

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

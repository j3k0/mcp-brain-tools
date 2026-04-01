/**
 * memory-save-hook.ts — Claude Code Stop hook
 *
 * Fires once per complete assistant turn. Reads the recent exchange,
 * checks what's already in memory, and uses AI to decide what to save —
 * all without any agent cooperation.
 *
 * Register in ~/.claude/settings.json:
 *   "hooks": {
 *     "Stop": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/dist/memory-save-hook.js" }]
 *     }]
 *   }
 *
 * Uses the same env vars as memory-hook.ts (ES_NODE, AI_API_KEY/GROQ_API_KEY,
 * AI_API_BASE, AI_MODEL, KG_DEFAULT_ZONE, MEMORY_HOOK_ZONES).
 *
 * Additional env vars:
 *   MEMORY_SAVE_TRANSCRIPT_LINES  Lines of transcript to analyse (default: 60)
 *   MEMORY_SAVE_AI_TIMEOUT        AI call timeout in ms (default: 8000)
 *   MEMORY_SAVE_MIN_ASSISTANT_WORDS  Skip if assistant response < N words (default: 20)
 */

import { readFile } from 'fs/promises';

// --- Config ---
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const KG_INDEX_PREFIX = process.env.KG_INDEX_PREFIX || 'knowledge-graph';
const KG_DEFAULT_ZONE = process.env.KG_DEFAULT_ZONE || 'default';
const KG_RELATIONS_INDEX = `${KG_INDEX_PREFIX}-relations`;
const AI_API_KEY = process.env.AI_API_KEY || process.env.GROQ_API_KEY;
const AI_API_BASE = process.env.AI_API_BASE || 'https://api.groq.com/openai/v1';
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const TRANSCRIPT_LINES = parseInt(process.env.MEMORY_SAVE_TRANSCRIPT_LINES || '60', 10);
const AI_TIMEOUT_MS = parseInt(process.env.MEMORY_SAVE_AI_TIMEOUT || '8000', 10);
const MIN_ASSISTANT_WORDS = parseInt(process.env.MEMORY_SAVE_MIN_ASSISTANT_WORDS || '20', 10);
const ES_TIMEOUT_MS = 2000;

function getIndexName(zone: string): string {
  return `${KG_INDEX_PREFIX}@${zone.toLowerCase()}`;
}

// --- Read stdin ---
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 5000);
  });
}

// --- Read recent transcript ---
interface Message { role: string; text: string; }

async function readRecentTranscript(transcriptPath: string, nLines: number): Promise<Message[]> {
  try {
    const content = await readFile(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).slice(-nLines);
    const messages: Message[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role !== 'user' && entry.role !== 'assistant') continue;
        const text = typeof entry.content === 'string'
          ? entry.content
          : Array.isArray(entry.content)
            ? entry.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')
            : '';
        if (text.trim()) messages.push({ role: entry.role, text: text.slice(0, 500) });
      } catch { /* skip */ }
    }
    return messages;
  } catch {
    return [];
  }
}

// --- Search ES for existing entities ---
async function searchExisting(index: string, query: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ES_TIMEOUT_MS);
    const res = await fetch(`${ES_NODE}/${index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          bool: {
            must: [{ multi_match: { query, fields: ['name^3'], fuzziness: 'AUTO' } }],
            filter: [{ term: { type: 'entity' } }],
            must_not: [{ term: { entityType: 'Observation' } }],
          },
        },
        size: 15,
        _source: ['name', 'entityType'],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const result = await res.json() as any;
    return result.hits?.hits?.map((h: any) => h._source.name) || [];
  } catch {
    return [];
  }
}

// --- Get entity by exact name ---
async function getEntity(index: string, name: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ES_TIMEOUT_MS);
    const res = await fetch(`${ES_NODE}/${index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { bool: { filter: [{ term: { 'name.keyword': name } }, { term: { type: 'entity' } }] } },
        size: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const result = await res.json() as any;
    const hit = result.hits?.hits?.[0];
    return hit ? { id: hit._id, ...hit._source } : null;
  } catch {
    return null;
  }
}

// --- Save entity to ES ---
async function saveEntityToES(index: string, zone: string, entity: {
  name: string; entityType: string; reviewInterval: number;
}): Promise<void> {
  const now = new Date().toISOString();
  const nextReviewAt = new Date(Date.now() + entity.reviewInterval * 86_400_000).toISOString();
  const doc = {
    type: 'entity',
    name: entity.name,
    entityType: entity.entityType,
    observations: [],
    readCount: 0,
    lastRead: now,
    lastWrite: now,
    relevanceScore: 1,
    zone,
    verifiedAt: now,
    verifyCount: 0,
    reviewInterval: entity.reviewInterval,
    nextReviewAt,
  };
  await fetch(`${ES_NODE}/${index}/_doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
}

// --- Save observation entity + relation ---
async function saveObservation(index: string, zone: string, parentName: string, text: string, reviewInterval: number): Promise<void> {
  const obsName = `${parentName}: ${text}`;
  const now = new Date().toISOString();
  const nextReviewAt = new Date(Date.now() + reviewInterval * 86_400_000).toISOString();

  // Save observation entity
  await fetch(`${ES_NODE}/${index}/_doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'entity', name: obsName, entityType: 'Observation', observations: [],
      readCount: 0, lastRead: now, lastWrite: now, relevanceScore: 1,
      zone, verifiedAt: now, verifyCount: 0, reviewInterval, nextReviewAt,
    }),
  });

  // Save relation
  await fetch(`${ES_NODE}/${KG_RELATIONS_INDEX}/_doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'relation', from: obsName, fromZone: zone,
      to: parentName, toZone: zone, relationType: 'is_observation_of',
    }),
  });
}

// --- Verify entity (update verifiedAt, double reviewInterval) ---
async function verifyEntityInES(index: string, name: string): Promise<void> {
  const existing = await getEntity(index, name);
  if (!existing) return;
  const now = new Date();
  const newInterval = Math.min((existing.reviewInterval || 7) * 2, 365);
  const nextReviewAt = new Date(now.getTime() + newInterval * 86_400_000).toISOString();
  await fetch(`${ES_NODE}/${index}/_update/${existing.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      doc: { verifiedAt: now.toISOString(), verifyCount: (existing.verifyCount || 0) + 1, reviewInterval: newInterval, nextReviewAt },
    }),
  });
}

// --- AI: analyse exchange and decide what to save ---
interface SaveDecision {
  save: { name: string; entityType: string; observations: string[]; reviewInterval: number }[];
  verify: string[];
}

async function analyseExchange(messages: Message[], existingNames: string[]): Promise<SaveDecision> {
  if (!AI_API_KEY) return { save: [], verify: [] };

  const exchange = messages.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n');
  const existingList = existingNames.length > 0
    ? `Already in memory:\n${existingNames.map(n => `- ${n}`).join('\n')}`
    : 'Memory is currently empty for this topic.';

  const systemPrompt = `You analyse a conversation exchange and decide what to persist in a knowledge graph memory.

SAVE when the exchange reveals:
- A mistake or failed approach (and why it failed)
- An architectural or design decision (and the reason)
- A user correction or explicit preference
- A non-obvious fact that took effort to discover

DO NOT SAVE:
- Code patterns, file contents, or anything readable from source
- Git history or recent changes
- Ephemeral task state or in-progress work
- Things already covered by the existing memory entries listed below
- Obvious facts or general programming knowledge

For reviewInterval: 1-7 (volatile/task-specific), 14-30 (project state), 90-365 (stable facts/preferences).

Return ONLY valid JSON:
{
  "save": [
    { "name": "short entity name", "entityType": "Person|Project|Decision|Rule|Bug|Concept|Tool", "observations": ["concise observation"], "reviewInterval": 7 }
  ],
  "verify": ["name of existing entity confirmed still accurate"]
}
Return { "save": [], "verify": [] } if nothing is worth saving.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const res = await fetch(`${AI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${existingList}\n\nConversation exchange:\n${exchange}` },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) return { save: [], verify: [] };

    const result = await res.json() as any;
    let content = result.choices?.[0]?.message?.content?.trim() || '{}';
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(content);
    return {
      save: Array.isArray(parsed.save) ? parsed.save : [],
      verify: Array.isArray(parsed.verify) ? parsed.verify : [],
    };
  } catch {
    return { save: [], verify: [] };
  }
}

// --- Main ---
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;

    const input = JSON.parse(raw);
    const { transcript_path } = input;
    if (!transcript_path) return;

    const messages = await readRecentTranscript(transcript_path, TRANSCRIPT_LINES);
    if (messages.length === 0) return;

    // Skip if the assistant barely said anything
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return;
    const wordCount = lastAssistant.text.trim().split(/\s+/).length;
    if (wordCount < MIN_ASSISTANT_WORDS) return;

    // Determine zone
    const zonesEnv = process.env.MEMORY_HOOK_ZONES;
    const zone = zonesEnv ? zonesEnv.split(',')[0].trim() : KG_DEFAULT_ZONE;
    const index = getIndexName(zone);

    // Search for related existing entities
    const combinedText = messages.map(m => m.text).join(' ').slice(0, 400);
    const existingNames = await searchExisting(index, combinedText);

    // Ask AI what to save
    const decision = await analyseExchange(messages, existingNames);

    // Save new entities
    for (const entity of decision.save) {
      if (!entity.name?.trim()) continue;
      const existing = await getEntity(index, entity.name);
      if (!existing) {
        await saveEntityToES(index, zone, {
          name: entity.name,
          entityType: entity.entityType || 'Concept',
          reviewInterval: entity.reviewInterval || 7,
        });
      }
      for (const obs of (entity.observations || [])) {
        if (!obs?.trim()) continue;
        const obsName = `${entity.name}: ${obs}`;
        const obsExists = await getEntity(index, obsName);
        if (!obsExists) {
          await saveObservation(index, zone, entity.name, obs, entity.reviewInterval || 7);
        }
      }
    }

    // Verify confirmed entities
    for (const name of decision.verify) {
      await verifyEntityInES(index, name);
    }

  } catch {
    // Silent failure — never break the conversation
  }
}

main();

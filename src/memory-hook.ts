/**
 * memory-hook.ts — Claude Code UserPromptSubmit hook
 *
 * Automatically injects relevant memory context before each user message
 * so agents have prior context without needing to explicitly search.
 *
 * Register in ~/.claude/settings.json:
 *   "hooks": {
 *     "UserPromptSubmit": [{
 *       "hooks": [{ "type": "command", "command": "node /path/to/dist/memory-hook.js" }]
 *     }]
 *   }
 *
 * Environment variables:
 *   ES_NODE                      Elasticsearch URL (default: http://localhost:9200)
 *   KG_INDEX_PREFIX              Index prefix (default: knowledge-graph)
 *   KG_DEFAULT_ZONE              Default zone (default: default)
 *   MEMORY_HOOK_ZONES            Comma-separated zones to search (default: KG_DEFAULT_ZONE)
 *   AI_API_KEY                   OpenAI-compatible API key (falls back to GROQ_API_KEY)
 *   AI_API_BASE                  API base URL (default: https://api.groq.com/openai/v1)
 *   AI_MODEL                     Model name (default: llama-3.3-70b-versatile)
 *   MEMORY_HOOK_CONTEXT_LINES    Lines of transcript to include for query extraction (default: 20)
 *   MEMORY_HOOK_MAX_RESULTS      Max entities to fetch from ES per zone (default: 10)
 *   MEMORY_HOOK_AI_TIMEOUT       AI call timeout in ms (default: 4000)
 *   MEMORY_HOOK_ES_TIMEOUT       ES call timeout in ms (default: 2000)
 *   MEMORY_HOOK_MIN_SCORE        Minimum ES relevance score (default: 1.5)
 *   MEMORY_HOOK_MIN_WORDS        Skip prompts shorter than this many words (default: 5)
 */

import { readFile } from 'fs/promises';

// --- Config ---
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const KG_INDEX_PREFIX = process.env.KG_INDEX_PREFIX || 'knowledge-graph';
const KG_DEFAULT_ZONE = process.env.KG_DEFAULT_ZONE || 'default';
const AI_API_KEY = process.env.AI_API_KEY || process.env.GROQ_API_KEY;
const AI_API_BASE = process.env.AI_API_BASE || 'https://api.groq.com/openai/v1';
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const CONTEXT_LINES = parseInt(process.env.MEMORY_HOOK_CONTEXT_LINES || '20', 10);
const MAX_RESULTS = parseInt(process.env.MEMORY_HOOK_MAX_RESULTS || '10', 10);
const AI_TIMEOUT_MS = parseInt(process.env.MEMORY_HOOK_AI_TIMEOUT || '4000', 10);
const ES_TIMEOUT_MS = parseInt(process.env.MEMORY_HOOK_ES_TIMEOUT || '2000', 10);
const MIN_SCORE = parseFloat(process.env.MEMORY_HOOK_MIN_SCORE || '1.5');
const MIN_WORDS = parseInt(process.env.MEMORY_HOOK_MIN_WORDS || '5', 10);

// Conversational filler patterns — skip these entirely
const CONVERSATIONAL_RE = /^(ok|okay|yes|no|sure|thanks|thank you|great|perfect|done|got it|sounds good|agreed|continue|resume|go ahead|proceed|right|correct|exactly|good|nice|cool|yep|nope|k|y|n)[\s!.?]*$/i;

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

// --- Read recent transcript lines ---
async function readRecentTranscript(transcriptPath: string, nLines: number): Promise<string> {
  try {
    const content = await readFile(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const recent = lines.slice(-nLines);
    const messages: string[] = [];
    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        if (entry.role !== 'user' && entry.role !== 'assistant') continue;
        const text = typeof entry.content === 'string'
          ? entry.content
          : Array.isArray(entry.content)
            ? entry.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join(' ')
            : '';
        if (text) messages.push(`${entry.role}: ${text.slice(0, 300)}`);
      } catch {
        // skip malformed lines
      }
    }
    return messages.join('\n');
  } catch {
    return '';
  }
}

// --- Freshness: skip archival entities (freshness < -2) ---
function computeFreshness(entity: { verifiedAt?: string; reviewInterval?: number }): number {
  if (!entity.verifiedAt || !entity.reviewInterval) return 0;
  const daysSince = (Date.now() - new Date(entity.verifiedAt).getTime()) / 86_400_000;
  return 1 - (daysSince / entity.reviewInterval);
}

const ARCHIVAL_THRESHOLD = -2;

// --- Single AI call: extract search terms AND score results ---
// Returns { query, relevant } where relevant is filtered entity names (score >= 50)
async function aiQueryAndFilter(
  context: string,
  prompt: string,
  candidates: { name: string; entityType: string }[]
): Promise<{ query: string; relevant: string[] }> {
  if (!AI_API_KEY) return { query: prompt, relevant: candidates.map(c => c.name) };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const candidateList = candidates.map(c => `- ${c.name} (${c.entityType})`).join('\n');

    const response = await fetch(`${AI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You help determine which memory entries are relevant to the current task.\n' +
              'Given a conversation and a list of memory entities, return a JSON object with:\n' +
              '  "query": "3-7 comma-separated search terms describing what the user is working on"\n' +
              '  "relevant": ["entity name", ...] — only entities genuinely relevant to the task\n' +
              'Be strict: omit entities that are only tangentially related or coincidentally name-matched.\n' +
              'Return ONLY valid JSON. No markdown, no explanation.',
          },
          {
            role: 'user',
            content:
              (context ? `Recent conversation:\n${context}\n\n` : '') +
              `Current message: ${prompt}\n\n` +
              `Memory candidates:\n${candidateList}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) return { query: prompt, relevant: [] };

    const result = await response.json() as any;
    let content = result.choices?.[0]?.message?.content?.trim() || '{}';

    // Strip markdown fences if present
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(content);
    return {
      query: parsed.query || prompt,
      relevant: Array.isArray(parsed.relevant) ? parsed.relevant : [],
    };
  } catch {
    return { query: prompt, relevant: [] };
  }
}

// --- Search Elasticsearch with minimum score ---
async function searchES(index: string, query: string): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ES_TIMEOUT_MS);

    const response = await fetch(`${ES_NODE}/${index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_score: MIN_SCORE,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields: ['name^3', 'observations'],
                  fuzziness: 'AUTO',
                },
              },
            ],
            filter: [{ term: { type: 'entity' } }],
            must_not: [{ term: { entityType: 'Observation' } }],
          },
        },
        size: MAX_RESULTS,
        _source: ['name', 'entityType', 'verifiedAt', 'reviewInterval'],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) return [];

    const result = await response.json() as any;
    return result.hits?.hits?.map((h: any) => h._source) || [];
  } catch {
    return [];
  }
}

// --- Fetch observations for a list of entity names ---
async function fetchObservations(index: string, entityNames: string[]): Promise<Record<string, string[]>> {
  if (entityNames.length === 0) return {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ES_TIMEOUT_MS);

    const shouldClauses = entityNames.map(name => ({
      prefix: { 'name.keyword': `${name}: ` }
    }));

    const response = await fetch(`${ES_NODE}/${index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          bool: {
            should: shouldClauses,
            minimum_should_match: 1,
            filter: [
              { term: { type: 'entity' } },
              { term: { entityType: 'Observation' } },
            ],
          },
        },
        size: entityNames.length * 5,
        _source: ['name'],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) return {};

    const result = await response.json() as any;
    const obs: Record<string, string[]> = {};
    for (const hit of result.hits?.hits || []) {
      const name: string = hit._source.name;
      const colonIdx = name.indexOf(': ');
      if (colonIdx === -1) continue;
      const parent = name.slice(0, colonIdx);
      const text = name.slice(colonIdx + 2);
      if (!obs[parent]) obs[parent] = [];
      obs[parent].push(text);
    }
    return obs;
  } catch {
    return {};
  }
}

// --- Format entities as context block ---
function formatBlock(entities: any[], observations: Record<string, string[]>, zone: string): string {
  const lines = entities.map(e => {
    const freshness = computeFreshness(e);
    const staleMarker = freshness < 0 ? ' ⚠ needs review' : '';
    const obs = observations[e.name];
    const obsPart = obs && obs.length > 0
      ? '\n' + obs.slice(0, 3).map(o => `    - ${o}`).join('\n')
      : '';
    return `  - **${e.name}** (${e.entityType}${staleMarker})${obsPart}`;
  });
  return `<memory zone="${zone}">\n${lines.join('\n')}\n</memory>`;
}

// --- Main ---
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;

    const input = JSON.parse(raw);
    const { prompt, transcript_path } = input;
    if (!prompt || typeof prompt !== 'string') return;

    // Skip short or purely conversational prompts
    const wordCount = prompt.trim().split(/\s+/).length;
    if (wordCount < MIN_WORDS || CONVERSATIONAL_RE.test(prompt.trim())) return;

    // Determine zones to search
    const zonesEnv = process.env.MEMORY_HOOK_ZONES;
    const zones = zonesEnv
      ? zonesEnv.split(',').map(z => z.trim()).filter(Boolean)
      : [KG_DEFAULT_ZONE];

    // Get recent conversation context
    const recentContext = transcript_path
      ? await readRecentTranscript(transcript_path, CONTEXT_LINES)
      : '';

    // Search each zone with raw prompt first (to get candidates)
    const zoneResults: { zone: string; candidates: any[] }[] = [];
    for (const zone of zones) {
      const index = getIndexName(zone);
      const raw = await searchES(index, prompt);
      const candidates = raw.filter(e => computeFreshness(e) >= ARCHIVAL_THRESHOLD);
      if (candidates.length > 0) zoneResults.push({ zone, candidates });
    }

    if (zoneResults.length === 0) return;

    // Single AI call: extract query + filter all candidates across all zones
    const allCandidates = zoneResults.flatMap(r => r.candidates);
    const { relevant } = await aiQueryAndFilter(recentContext, prompt, allCandidates);

    if (relevant.length === 0) return;

    // Render only AI-approved entities, grouped by zone
    const relevantSet = new Set(relevant);
    const blocks: string[] = [];

    for (const { zone, candidates } of zoneResults) {
      const approved = candidates.filter(e => relevantSet.has(e.name));
      if (approved.length === 0) continue;

      const index = getIndexName(zone);
      const observations = await fetchObservations(index, approved.map(e => e.name));
      blocks.push(formatBlock(approved, observations, zone));
    }

    if (blocks.length > 0) {
      process.stdout.write(blocks.join('\n') + '\n');
    }
  } catch {
    // Silent failure — never break the conversation
  }
}

main();

# mcp-brain-tools — Commands & Style Guide
- **npm package**: `mcp-brain-tools` (v1.0.0)
- **repo**: `github.com/j3k0/mcp-brain-tools`

## Build & Test Commands
- Build: `npm run build`
- Start dev mode: `npm run dev` 
- Run all tests: `npm test`
- Run Jest tests: `npm run test:jest` (uses jest.config.cjs)
- Run single Jest test: `npx jest tests/[test-file].test.ts --config jest.config.cjs --forceExit`
- Run specific legacy test: `npm run test:cross-zone` (or other test scripts)
- Run tests with watch: `npm run test:watch`
- Start Elasticsearch: `npm run es:start`
- Stop Elasticsearch: `npm run es:stop`
- Reset Elasticsearch (wipe data): `npm run es:reset`
- Admin CLI: `node dist/admin-cli.js [command]`

## Architecture
- **Freshness & Spaced Repetition**: Entities have `verifiedAt`, `verifyCount`, `reviewInterval`, `nextReviewAt` fields. Freshness = `1 - (daysSinceVerified / reviewInterval)`. Labels: fresh/normal/aging/stale/archival. See [design spec](docs/superpowers/specs/2026-03-30-freshness-and-spaced-repetition-design.md).
- **Observations as Entities**: Observations are stored as separate entities (named `parent: observation text`) with `is_observation_of` relations, each with own freshness lifecycle.
- **Progressive Search**: Queries widen in 3 passes (freshness >= 0, >= -2, no filter) if no results found.
- **verify_entity**: Explicit verification doubles reviewInterval (capped at 365). Use for confirmed-still-valid info.
- **Core files**: `src/es-types.ts` (data model), `src/kg-client.ts` (ES client), `src/freshness.ts` (freshness math), `src/index.ts` (MCP tools), `src/ai-service.ts` (Groq AI filtering)

## Code Style Guidelines
- **Module System**: ES Modules with .js extension in imports
- **Types**: TypeScript with `@ts-ignore` where needed (strict mode disabled)
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces
- **Error Handling**: Use try/catch blocks with specific error messages
- **Logging**: Use console.error for logging (via logger.ts)
- **Environment**: Configuration via process.env variables
- **Async**: Use async/await pattern for asynchronous operations
- **Documentation**: JSDoc comments for function documentation
- **Testing**: Jest for TypeScript tests, separate JS test files for legacy tests

## Testing Gotchas
- ES-dependent tests need a running Elasticsearch (`npm run es:start`)
- First `saveEntity` after zone creation is slow (~3s, index init) — global `testTimeout: 15000` in jest.config.cjs handles this
- Some legacy JS test suites (`boolean-search`, `fuzzy-search`, etc.) have pre-existing failures unrelated to current code
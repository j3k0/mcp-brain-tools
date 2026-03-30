# MCP Knowledge Graph Memory Server Commands & Style Guide

## Build & Test Commands
- Build: `npm run build`
- Start dev mode: `npm run dev` 
- Run all tests: `npm test`
- Run Jest tests: `npm run test:jest`
- Run single Jest test: `npx jest tests/[test-file].test.ts`
- Run specific legacy test: `npm run test:cross-zone` (or other test scripts)
- Run tests with watch: `npm run test:watch`
- Start Elasticsearch: `npm run es:start`
- Admin CLI: `node dist/admin-cli.js [command]`

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
# Developer Guide

## Development Environment

- **Node.js**: `>= 20.19.0` (Runtime supports `>= 18.0.0`)
- **Package Manager**: `npm`
- **Build Tool**: `tsc` (TypeScript 5.3+)

## Common Commands

```bash
# Install dependencies
npm ci

# Build TypeScript to dist/
npm run build

# Run linting
npm run lint

# Run all test suites
npm test

# Run tests in development mode with live TS compilation
npx tsx --test "src/**/*.test.ts"

# Launch development CLI
npx tsx src/index.ts
```

## Adding a New Agent Tool

1. Create tool implementation under `src/tools/<category>/<tool-name>.ts` conforming to `AgentTool<TInput, TOutput>`.
2. Register the tool in `src/tools/registry.ts`.
3. Add comprehensive unit tests verifying valid execution, error conditions, and permission risk classification.
4. Verify overall test suite passes: `npm test`.

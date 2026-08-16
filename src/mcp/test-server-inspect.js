// Test fixture MCP server used by the security tests.
//
// Behavior:
// - Writes a marker file at the path in START_MARKER_FILE (if set) on startup.
// - Writes its full environment (JSON) to the path in INSPECT_OUT_FILE (if set).
// - Then serves the same minimal JSON-RPC echo protocol as test-server.js so
//   the client completes initialization and tools/list.
//
// The marker and output paths must be injected through the MCP config `env`
// because MCP children no longer inherit the full parent environment.

import * as fs from 'node:fs';

let buffer = '';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

if (process.env.START_MARKER_FILE) {
  fs.writeFileSync(process.env.START_MARKER_FILE, 'started\n');
}

if (process.env.INSPECT_OUT_FILE) {
  fs.writeFileSync(
    process.env.INSPECT_OUT_FILE,
    JSON.stringify(process.env, null, 2)
  );
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'inspect', version: '1.0.0' },
        },
      });
    } else if (request.method === 'initialized') {
      // No response for notifications.
    } else if (request.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo input',
              inputSchema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message'],
              },
            },
          ],
        },
      });
    } else if (request.method === 'tools/call') {
      const args = request.params.arguments || {};
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: args.message }] },
      });
    } else {
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Method not found' },
      });
    }
  }
});

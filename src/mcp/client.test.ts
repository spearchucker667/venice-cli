import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import { McpStdioClient } from './client.js';

// Tests run from the project root via `npm test`.
const fakeServer = path.join(process.cwd(), 'src/mcp/test-server.js');

describe('McpStdioClient', () => {
  it('lists and calls a tool', async () => {
    const client = new McpStdioClient({ command: 'node', args: [fakeServer] });
    await client.start();
    try {
      const tools = await client.listTools();
      assert.ok(tools.some((t) => t.name === 'echo'));
      const result = (await client.callTool('echo', { message: 'hi' })) as {
        content?: Array<{ text?: string }>;
      };
      assert.strictEqual(result.content?.[0]?.text, 'hi');
    } finally {
      await client.stop();
    }
  });

  it('reports server crash during startup', async () => {
    const client = new McpStdioClient({ command: 'node', args: ['-e', 'process.exit(1)'] });
    await assert.rejects(() => client.start(), /exited before initialization/);
  });

  it('reports missing command', async () => {
    const client = new McpStdioClient({ command: 'definitely-not-a-real-command-12345', args: [] });
    await assert.rejects(() => client.start(), /failed to start/);
  });
});

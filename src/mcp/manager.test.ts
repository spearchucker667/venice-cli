import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import { McpManager } from './manager.js';

const fakeServer = path.join(process.cwd(), 'src/mcp/test-server.js');

describe('McpManager', () => {
  it('starts enabled servers and discovers tools', async () => {
    const manager = new McpManager({ mcpServers: { echo: { command: 'node', args: [fakeServer] } } });
    await manager.start();
    try {
      const tools = manager.getTools();
      assert.strictEqual(tools.length, 1);
      assert.strictEqual(tools[0].serverName, 'echo');
      assert.strictEqual(tools[0].tool.name, 'echo');
    } finally {
      await manager.stop();
    }
  });

  it('is idempotent when start is called more than once', async () => {
    const manager = new McpManager({ mcpServers: { echo: { command: 'node', args: [fakeServer] } } });
    await Promise.all([manager.start(), manager.start()]);
    try {
      assert.strictEqual(manager.getServerStates().length, 1);
      assert.strictEqual(manager.getTools().length, 1);
    } finally {
      await manager.stop();
    }
  });

  it('skips disabled servers', async () => {
    const manager = new McpManager({
      mcpServers: { echo: { command: 'node', args: [fakeServer], disabled: true } },
    });
    await manager.start();
    try {
      assert.strictEqual(manager.getTools().length, 0);
    } finally {
      await manager.stop();
    }
  });

  it('records server errors without throwing', async () => {
    const manager = new McpManager({
      mcpServers: { bad: { command: 'node', args: ['-e', 'process.exit(1)'] } },
    });
    await manager.start();
    try {
      const states = manager.getServerStates();
      assert.strictEqual(states.length, 1);
      assert.ok(states[0].error);
      assert.strictEqual(manager.getTools().length, 0);
    } finally {
      await manager.stop();
    }
  });
});

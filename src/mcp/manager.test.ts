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

  it('starts multiple servers concurrently and registers them in config order (VCL-R3-020)', async () => {
    const manager = new McpManager({
      mcpServers: {
        a: { command: 'node', args: [fakeServer] },
        b: { command: 'node', args: [fakeServer] },
        c: { command: 'node', args: [fakeServer] },
      },
    });
    await manager.start();
    try {
      const states = manager.getServerStates();
      assert.deepStrictEqual(
        states.map((s) => s.name),
        ['a', 'b', 'c'],
        'server states must be registered in config order regardless of start completion order'
      );
      assert.strictEqual(manager.getTools().length, 3);
    } finally {
      await manager.stop();
    }
  });

  it('refetches and reports tools after a list_changed notification (VCL-R3-014)', async () => {
    const script = `
      let buffer='';
      const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');
      process.stdin.on('data',(chunk)=>{
        buffer+=chunk.toString();
        let i;
        while((i=buffer.indexOf('\\n'))!==-1){
          const line=buffer.slice(0,i).trim(); buffer=buffer.slice(i+1);
          if(!line) continue;
          const req=JSON.parse(line);
          if(req.method==='initialize') send({jsonrpc:'2.0',id:req.id,result:{protocolVersion:'2025-06-18',capabilities:{},serverInfo:{name:'t',version:'1'}}});
          if(req.method==='tools/list') send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'old'},{name:'new'}]}});
          if(req.method==='initialized') setTimeout(()=>send({jsonrpc:'2.0',method:'notifications/tools/list_changed',params:{}}),100);
        }
      });
      setInterval(()=>{},1000);
    `;
    const manager = new McpManager({
      mcpServers: { live: { command: 'node', args: ['-e', script] } },
    });
    let changed: Array<{ serverName: string; tools: string[] }> = [];
    manager.setToolsChangedHandler((serverName, tools) => {
      changed.push({ serverName, tools: tools.map((t) => t.name) });
    });
    await manager.start();
    try {
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(changed.length > 0, 'toolsChangedHandler must fire after list_changed');
      assert.strictEqual(changed[0].serverName, 'live');
      assert.deepStrictEqual(changed[0].tools, ['old', 'new']);
      assert.strictEqual(manager.getTools().length, 2);
    } finally {
      await manager.stop();
    }
  });
});

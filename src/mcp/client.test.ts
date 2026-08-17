import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpStdioClient } from './client.js';
import { MCP_PROTOCOL_VERSION } from './protocol.js';

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

  it('enforces a bounded startup timeout and terminates the server', async () => {
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] },
      { startTimeoutMs: 40, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /startup timed out/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(client.isRunning(), false);
  });

  it('rejects malformed JSON-RPC instead of silently waiting', async () => {
    const script = `process.stdin.once('data',()=>process.stdout.write('not-json\\n')); setInterval(()=>{},1000);`;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 500, requestTimeoutMs: 500, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /malformed JSON-RPC/);
    await client.stop();
  });

  it('terminates the whole process tree on malformed JSON-RPC, not just the direct child (P2)', async () => {
    const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-mcp-tree-')), 'grandchild.pid');
    const script = `
      const { spawn } = require('node:child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
      process.stdin.once('data', () => process.stdout.write('not-json\\n'));
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 500, requestTimeoutMs: 500, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /malformed JSON-RPC/);

    const pid = Number(fs.readFileSync(pidFile, 'utf-8').trim());
    // Poll until the grandchild is reaped; a bare SIGTERM to the direct child
    // would leave it alive (the leak this guards against).
    let alive = true;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    assert.strictEqual(alive, false, 'grandchild process must be terminated with the server');
    fs.rmSync(path.dirname(pidFile), { recursive: true, force: true });
  });

  it('rejects unbounded output without newlines and stops the server', async () => {
    // Writes more than MAX_FRAME_BYTES without ever emitting a newline. The
    // generous timeout keeps the 8 MiB write from racing the initialize
    // timeout under parallel test load.
    const script = `process.stdin.once('data',()=>{process.stdout.write('a'.repeat(8*1024*1024+100));}); setInterval(()=>{},1000);`;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 15000, requestTimeoutMs: 15000, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /frame limit/);
    await client.stop();
  });

  it('rejects pending requests when a running server exits', async () => {
    const script = jsonRpcScript(`if(request.method==='tools/call'){process.exit(7);}`);
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { requestTimeoutMs: 500, stopGraceMs: 20 }
    );
    await client.start();
    await assert.rejects(() => client.callTool('crash', {}), /exited \(code 7\)/);
    assert.strictEqual(client.isRunning(), false);
  });

  it('times out and cancels pending tool calls', async () => {
    const script = jsonRpcScript(`if(request.method==='tools/call'){return;}`);
    const timeoutClient = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { requestTimeoutMs: 40, stopGraceMs: 20 }
    );
    await timeoutClient.start();
    await assert.rejects(() => timeoutClient.callTool('slow', {}), /timed out/);
    await timeoutClient.stop();

    const cancelledClient = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await cancelledClient.start();
    const controller = new AbortController();
    const request = cancelledClient.callTool('slow', {}, controller.signal);
    controller.abort();
    await assert.rejects(() => request, /cancelled/);
    await cancelledClient.stop();
  });

  it('rejects an unsupported negotiated protocol version', async () => {
    const script = `
      process.stdin.once('data',(chunk)=>{
        const req=JSON.parse(chunk.toString().trim());
        const result={protocolVersion:'2030-01-01',capabilities:{},serverInfo:{name:'t',version:'1'}};
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /unsupported protocol version/);
    await client.stop();
  });

  it('rejects a server that omits its protocol version (VCL-R3-015)', async () => {
    const script = `
      process.stdin.once('data',(chunk)=>{
        const req=JSON.parse(chunk.toString().trim());
        const result={capabilities:{},serverInfo:{name:'t',version:'1'}};
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /did not include a protocolVersion/);
    await client.stop();
  });

  it('rejects an empty protocol version (VCL-R3-015)', async () => {
    const script = `
      process.stdin.once('data',(chunk)=>{
        const req=JSON.parse(chunk.toString().trim());
        const result={protocolVersion:'',capabilities:{},serverInfo:{name:'t',version:'1'}};
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await assert.rejects(() => client.start(), /did not include a protocolVersion/);
    await client.stop();
  });

  it('does not leave its child running after stop', async () => {
    const client = new McpStdioClient({ command: 'node', args: [fakeServer] }, { stopGraceMs: 50 });
    await client.start();
    assert.ok(client.getProcessId());
    assert.strictEqual(client.isRunning(), true);
    await client.stop();
    assert.strictEqual(client.isRunning(), false);
  });

  it('advertises the current MCP protocol revision (VCL-R3-019)', async () => {
    const script = `
      process.stdin.once('data',(chunk)=>{
        const req=JSON.parse(chunk.toString().trim());
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{protocolVersion:req.params.protocolVersion,capabilities:{},serverInfo:{name:'t',version:'1'}}})+'\\n');
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await client.start();
    // The negotiated version is whatever the client advertised.
    assert.strictEqual(client.getNegotiatedProtocolVersion(), MCP_PROTOCOL_VERSION);
    assert.strictEqual(client.getNegotiatedProtocolVersion(), '2025-06-18');
    await client.stop();
  });

  it('accepts a server negotiating down to the previous revision (VCL-R3-019)', async () => {
    const script = `
      process.stdin.once('data',(chunk)=>{
        const req=JSON.parse(chunk.toString().trim());
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'t',version:'1'}}})+'\\n');
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await client.start();
    assert.strictEqual(client.getNegotiatedProtocolVersion(), '2024-11-05');
    await client.stop();
  });

  it('paginates tools/list with cursors and assembles all pages (VCL-R3-013)', async () => {
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
          if(req.method==='tools/list'){
            const cursor=req.params && req.params.cursor;
            if(!cursor) send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'a'},{name:'b'}],nextCursor:'page-2'}});
            else if(cursor==='page-2') send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'c'}],nextCursor:''}});
            else send({jsonrpc:'2.0',id:req.id,error:{code:-1,message:'bad cursor'}});
          }
        }
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await client.start();
    const tools = await client.listTools();
    assert.deepStrictEqual(tools.map((t) => t.name), ['a', 'b', 'c']);
    await client.stop();
  });

  it('rejects a repeated tools/list cursor (VCL-R3-013)', async () => {
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
          if(req.method==='tools/list') send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'a'}],nextCursor:'loop'}});
        }
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    await client.start();
    await assert.rejects(() => client.listTools(), /repeated tools\/list cursor/);
    await client.stop();
  });

  it('delivers tools/list_changed notifications to the registered handler (VCL-R3-014)', async () => {
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
          if(req.method==='tools/list') send({jsonrpc:'2.0',id:req.id,result:{tools:[{name:'a'}]}});
          if(req.method==='initialized') send({jsonrpc:'2.0',method:'notifications/tools/list_changed',params:{}});
        }
      });
      setInterval(()=>{},1000);
    `;
    const client = new McpStdioClient(
      { command: 'node', args: ['-e', script] },
      { startTimeoutMs: 1000, requestTimeoutMs: 1000, stopGraceMs: 20 }
    );
    const notifications: string[] = [];
    client.onNotification((method) => notifications.push(method));
    await client.start();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(notifications.includes('notifications/tools/list_changed'));
    await client.stop();
  });
});

function jsonRpcScript(extra: string): string {
  return `
    let buffer='';
    const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
    process.stdin.on('data',(chunk)=>{
      buffer+=chunk.toString();
      let index;
      while((index=buffer.indexOf('\\n'))!==-1){
        const line=buffer.slice(0,index).trim(); buffer=buffer.slice(index+1);
        if(!line) continue;
        const request=JSON.parse(line);
        if(request.method==='initialize') send({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'test',version:'1'}}});
        ${extra}
      }
    });
  `;
}

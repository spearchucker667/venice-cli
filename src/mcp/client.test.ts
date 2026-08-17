import { describe, it } from 'node:test';
import assert from 'node:assert';
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

  it('accepts a server that omits its protocol version', async () => {
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
    await client.start();
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

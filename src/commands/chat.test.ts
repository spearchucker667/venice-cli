import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_TOOL_ROUNDS,
  nonStreamChat,
  streamChat,
} from './chat.js';
import { getToolDefinitions } from '../lib/tools.js';
import type { Message } from '../types/index.js';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

interface ChatRequest {
  messages: Message[];
  tools?: Array<{ function: { name: string } }>;
  venice_parameters?: Record<string, unknown>;
}

test('chat preserves options and enforces the allowlist across tool rounds', async () => {
  const requests: ChatRequest[] = [];
  let completionRound = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/api/v1/models')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        data: [{ id: 'test-model', type: 'text' }],
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/v1/chat/completions') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest);
      completionRound++;

      const toolCall = completionRound === 1
        ? {
            id: 'call-disabled',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' },
          }
        : {
            id: 'call-enabled',
            type: 'function',
            function: { name: 'datetime', arguments: '{"format":"date"}' },
          };
      const body = completionRound < 3
        ? {
            choices: [{
              message: { content: '', tool_calls: [toolCall] },
              finish_reason: completionRound === 1 ? 'stop' : 'tool_calls',
            }],
          }
        : {
            choices: [{
              message: { content: 'done' },
              finish_reason: 'stop',
            }],
          };

      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-test-'));
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          cliPath,
          'chat',
          '--no-stream',
          '--model',
          'test-model',
          '--tools',
          'datetime',
          '--web-search',
          'Use two tools',
        ],
        {
          env: {
            ...process.env,
            HOME: homeDir,
            NO_COLOR: '1',
            VENICE_API_KEY: 'test-key',
            VENICE_API_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
          },
        }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /done/);
    assert.equal(requests.length, 3);

    for (const request of requests) {
      assert.deepEqual(
        request.tools?.map((tool) => tool.function.name),
        ['datetime']
      );
      assert.equal(request.venice_parameters?.enable_web_search, 'on');
    }

    assert.equal(
      requests[1].messages.at(-1)?.content,
      'Tool not enabled: calculator'
    );
    assert.equal(requests[2].messages.at(-1)?.role, 'tool');
    assert.notEqual(
      requests[2].messages.at(-1)?.content,
      'Tool not enabled: datetime'
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('streaming chat preserves options and handles sequential tool rounds', async () => {
  const messages: Message[] = [{ role: 'user', content: 'Use two tools' }];
  const seenOptions: Array<{
    tools?: Array<{ function: { name: string } }>;
    venice_parameters?: Record<string, unknown>;
  }> = [];
  let round = 0;
  const completionStream: NonNullable<Parameters<typeof streamChat>[9]> =
    async function* (_messages, options) {
      seenOptions.push(options || {});
      round++;

      if (round === 1) {
        yield {
          tool_calls: [{
            index: 0,
            id: 'call-disabled',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' },
          }],
          done: false,
        };
        // Some compatible APIs mislabel streamed tool calls as stopped.
        yield { finish_reason: 'stop', done: false };
        yield { done: true };
        return;
      }

      if (round === 2) {
        yield {
          tool_calls: [{
            index: 0,
            id: 'call-enabled',
            type: 'function',
            function: { name: 'datetime', arguments: '{"format":"date"}' },
          }],
          done: false,
        };
        yield { finish_reason: 'tool_calls', done: false };
        yield { done: true };
        return;
      }

      yield { content: 'done', done: false };
      yield { finish_reason: 'stop', done: false };
      yield { done: true };
    };

  await streamChat(
    messages,
    'test-model',
    getToolDefinitions(['datetime']),
    false,
    'raw',
    { enable_web_search: 'on' },
    undefined,
    true,
    false,
    completionStream
  );

  assert.equal(round, 3);
  assert.equal(
    messages.find((message) => message.tool_call_id === 'call-disabled')?.content,
    'Tool not enabled: calculator'
  );
  assert.notEqual(
    messages.find((message) => message.tool_call_id === 'call-enabled')?.content,
    'Tool not enabled: datetime'
  );
  for (const options of seenOptions) {
    assert.deepEqual(
      options.tools?.map((tool) => tool.function.name),
      ['datetime']
    );
    assert.equal(options.venice_parameters?.enable_web_search, 'on');
  }
});

test('non-streaming chat stops after the maximum tool rounds', async () => {
  const messages: Message[] = [{ role: 'user', content: 'Keep calling tools' }];
  let completionCalls = 0;
  const completion: NonNullable<Parameters<typeof nonStreamChat>[8]> =
    async () => {
      completionCalls++;
      return {
        content: '',
        tool_calls: [{
          id: `call-${completionCalls}`,
          type: 'function',
          function: { name: 'datetime', arguments: '{}' },
        }],
        finish_reason: 'tool_calls',
      };
    };

  await assert.rejects(
    nonStreamChat(
      messages,
      'test-model',
      getToolDefinitions(['datetime']),
      false,
      'raw',
      undefined,
      undefined,
      true,
      completion
    ),
    new RegExp(`limit of ${MAX_TOOL_ROUNDS} rounds`)
  );
  assert.equal(completionCalls, MAX_TOOL_ROUNDS + 1);
});

test('streaming chat stops after the maximum tool rounds', async () => {
  const messages: Message[] = [{ role: 'user', content: 'Keep calling tools' }];
  let completionCalls = 0;
  const completionStream: NonNullable<Parameters<typeof streamChat>[9]> =
    async function* () {
      completionCalls++;
      yield {
        tool_calls: [{
          index: 0,
          id: `call-${completionCalls}`,
          type: 'function',
          function: { name: 'disabled', arguments: '{}' },
        }],
        done: false,
      };
      yield { finish_reason: 'tool_calls', done: false };
      yield { done: true };
    };

  await assert.rejects(
    streamChat(
      messages,
      'test-model',
      [],
      false,
      'raw',
      undefined,
      undefined,
      true,
      false,
      completionStream
    ),
    new RegExp(`limit of ${MAX_TOOL_ROUNDS} rounds`)
  );
  assert.equal(completionCalls, MAX_TOOL_ROUNDS + 1);
});

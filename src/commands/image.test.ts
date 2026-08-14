import assert from 'node:assert/strict';
import test from 'node:test';
import { Command } from 'commander';
import { registerImageCommand } from './image.js';

test('image-styles honors its output format option', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  globalThis.fetch = async (): Promise<Response> =>
    Response.json({ data: ['Cinematic'], object: 'list' });
  console.log = (...values: unknown[]) => {
    output.push(values.map(String).join(' '));
  };

  try {
    const program = new Command();
    program.exitOverride();
    registerImageCommand(program);
    await program.parseAsync(['node', 'venice', 'image-styles', '--format', 'json']);

    assert.deepEqual(JSON.parse(output.join('\n')), {
      data: ['Cinematic'],
      object: 'list',
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test('image generation accepts prompts beginning with editing command words', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalApiKey = process.env.VENICE_API_KEY;
  let requestBody: Record<string, unknown> = {};
  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = async (_input, init): Promise<Response> => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ id: 'image-id', images: ['generated-image'] });
  };
  console.log = () => {};

  try {
    const program = new Command();
    program.exitOverride();
    registerImageCommand(program);
    await program.parseAsync([
      'node',
      'venice',
      'image',
      'edit',
      'the',
      'lighting',
      '--format',
      'json',
    ]);

    assert.equal(requestBody.prompt, 'edit the lighting');
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

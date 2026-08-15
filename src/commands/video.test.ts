import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { VideoStatusResult } from '../lib/api.js';
import { classifyVideoStatus, waitForVideoStatus } from './video.js';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

function runCli(
  args: string[],
  homeDir: string,
  apiBaseUrl: string
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        HOME: homeDir,
        NO_COLOR: '1',
        VENICE_API_KEY: 'test-key',
        VENICE_API_BASE_URL: apiBaseUrl,
      },
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('classifyVideoStatus handles status casing and common terminal aliases', () => {
  assert.equal(classifyVideoStatus('PROCESSING'), 'processing');
  assert.equal(classifyVideoStatus('processing'), 'processing');
  assert.equal(classifyVideoStatus('in-progress'), 'processing');
  assert.equal(classifyVideoStatus('SUCCEEDED'), 'completed');
  assert.equal(classifyVideoStatus('cancelled'), 'failed');
  assert.equal(classifyVideoStatus('unknown'), 'other');
});

test('waitForVideoStatus polls lowercase processing and returns the final response', async () => {
  const responses: VideoStatusResult[] = [
    { status: 'processing', execution_duration: 1000 },
    { status: 'completed', video_url: 'https://example.com/video.mp4' },
  ];
  let fetchCount = 0;

  const result = await waitForVideoStatus(
    async () => {
      const response = responses[fetchCount];
      fetchCount += 1;
      assert.ok(response, 'status was fetched after receiving a terminal response');
      return response;
    },
    1000,
    1
  );

  assert.equal(fetchCount, 2);
  assert.deepEqual(result, responses[1]);
});

test('waitForVideoStatus times out even when a status request does not settle', async () => {
  await assert.rejects(
    waitForVideoStatus(
      () => new Promise<VideoStatusResult>(() => undefined),
      10,
      1
    ),
    /Timed out waiting for video generation/
  );
});

test('video retrieve keeps JSON stdout valid while downloading a status URL', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-video-test-'));
  const videoBytes = Buffer.from('xxxxftypisom');
  let origin = '';
  let retrieveRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/api/v1/video/retrieve') {
      retrieveRequests++;
      if (retrieveRequests === 3) {
        response.writeHead(200, { 'Content-Type': 'video/mp4' });
        response.end(videoBytes);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        status: 'COMPLETED',
        video_url: `${origin}/video.mp4`,
      }));
      return;
    }

    if (request.url === '/video.mp4') {
      response.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoBytes.length),
      });
      response.end(videoBytes);
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;

  try {
    const jsonOutput = join(homeDir, 'json-output.mp4');
    const jsonResult = await runCli([
      'video',
      'retrieve',
      'q1',
      '--model',
      'test-video-model',
      '--output',
      jsonOutput,
      '--format',
      'json',
    ], homeDir, `${origin}/api/v1`);

    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    assert.deepEqual(JSON.parse(jsonResult.stdout), {
      status: 'completed',
      output: jsonOutput,
      model: 'test-video-model',
    });
    assert.equal(readFileSync(jsonOutput).equals(videoBytes), true);

    const prettyOutput = join(homeDir, 'pretty-output.mp4');
    const prettyResult = await runCli([
      'video',
      'retrieve',
      'q2',
      '--model',
      'test-video-model',
      '--output',
      prettyOutput,
      '--format',
      'pretty',
    ], homeDir, `${origin}/api/v1`);

    assert.equal(prettyResult.status, 0, prettyResult.stderr);
    assert.match(prettyResult.stdout, /Downloading video\.\.\./);
    assert.match(prettyResult.stdout, /Video saved to/);

    const statusResult = await runCli([
      'video',
      'status',
      'q3',
      '--model',
      'test-video-model',
      '--format',
      'pretty',
    ], homeDir, `${origin}/api/v1`);

    assert.equal(statusResult.status, 0, statusResult.stderr);
    assert.match(statusResult.stdout, /Status: completed/i);
    assert.match(
      statusResult.stdout,
      /venice video retrieve q3 -m test-video-model/
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    rmSync(homeDir, { recursive: true, force: true });
  }
});

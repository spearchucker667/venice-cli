import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateVideoTool, imageToVideoTool } from './video.js';
import type { AgentState } from '../../agent/types.js';

const context = (workspaceRoot: string) => ({
  workspaceRoot,
  sessionId: 's1',
  objective: 'test',
  runtimeState: {
    sessionId: 's1',
    workspaceRoot,
    model: 'test',
    objective: 'test',
    status: 'idle',
    messages: [],
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
  } as AgentState,
});

describe('Venice video tools', () => {
  it('generate_video has correct schema and risk', () => {
    assert.strictEqual(generateVideoTool.name, 'generate_video');
    assert.strictEqual(generateVideoTool.risk, 'network');
    assert.deepStrictEqual(generateVideoTool.inputSchema.required, ['prompt']);
  });

  it('image_to_video has correct schema and risk', () => {
    assert.strictEqual(imageToVideoTool.name, 'image_to_video');
    assert.strictEqual(imageToVideoTool.risk, 'network');
    assert.deepStrictEqual(imageToVideoTool.inputSchema.required, ['image', 'prompt']);
  });

  it('generate_video rejects an empty prompt', async () => {
    const result = await generateVideoTool.execute({ prompt: '   ' }, context(os.tmpdir()));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'INVALID_VIDEO_PROMPT');
  });

  it('image_to_video rejects a missing reference image', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-i2v-'));
    const result = await imageToVideoTool.execute(
      { image: 'missing.png', prompt: 'animate this' },
      context(workspace)
    );
    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.code === 'IMAGE_NOT_FOUND' || result.error?.code === 'IMAGE_TO_VIDEO_ERROR');
  });
});

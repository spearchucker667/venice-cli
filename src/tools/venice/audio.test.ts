import { describe, it } from 'node:test';
import assert from 'node:assert';
import { textToSpeechTool, transcribeAudioTool } from './audio.js';

describe('Venice audio tools', () => {
  it('text_to_speech has correct schema and risk', () => {
    assert.strictEqual(textToSpeechTool.name, 'text_to_speech');
    assert.strictEqual(textToSpeechTool.risk, 'network');
    assert.deepStrictEqual(textToSpeechTool.inputSchema.required, ['text', 'output']);
  });

  it('transcribe_audio has correct schema and risk', () => {
    assert.strictEqual(transcribeAudioTool.name, 'transcribe_audio');
    assert.strictEqual(transcribeAudioTool.risk, 'network');
    assert.deepStrictEqual(transcribeAudioTool.inputSchema.required, ['audio']);
  });
});

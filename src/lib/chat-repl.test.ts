import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  isReplExitCommand,
  REPL_PROMPT,
  runChatRepl,
  shouldEnterRepl,
} from './chat-repl.js';

test('shouldEnterRepl only when there is no prompt and stdin is a TTY', () => {
  assert.equal(shouldEnterRepl('', true), true);
  assert.equal(shouldEnterRepl('   ', true), true);
  assert.equal(shouldEnterRepl('', false), false);
  assert.equal(shouldEnterRepl('', undefined), false);
  assert.equal(shouldEnterRepl('hello', true), false);
});

test('isReplExitCommand accepts exit and quit', () => {
  assert.equal(isReplExitCommand('exit'), true);
  assert.equal(isReplExitCommand('QUIT'), true);
  assert.equal(isReplExitCommand('  quit  '), true);
  assert.equal(isReplExitCommand('hello'), false);
});

test('runChatRepl collects turns until exit without requiring a TTY', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const turns: string[] = [];
  let outputText = '';
  output.on('data', (chunk) => {
    outputText += chunk.toString();
  });

  const done = runChatRepl({
    input,
    output,
    onTurn: async (line) => {
      turns.push(line);
    },
  });

  input.write('hello\n');
  input.write('\n');
  input.write('next turn\n');
  input.write('exit\n');
  input.end();

  await done;
  assert.deepEqual(turns, ['hello', 'next turn']);
  assert.match(outputText, new RegExp(REPL_PROMPT));
});

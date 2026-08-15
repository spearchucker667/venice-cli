import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTerminalText } from './output.js';

test('sanitizeTerminalText strips CSI, OSC, and other control characters', () => {
  assert.equal(sanitizeTerminalText('normal name'), 'normal name');
  assert.equal(sanitizeTerminalText('\u001b[31mred\u001b[0m'), 'red');
  assert.equal(sanitizeTerminalText('\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007'), 'click');
  assert.equal(sanitizeTerminalText('line\rhidden'), 'linehidden');
  assert.equal(sanitizeTerminalText('ok\nkeep'), 'ok\nkeep');
});

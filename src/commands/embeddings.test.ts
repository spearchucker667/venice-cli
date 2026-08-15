import assert from 'node:assert/strict';
import test from 'node:test';
import { Command } from 'commander';
import { registerEmbeddingsCommand } from './embeddings.js';

test('embeddings accepts omitted text for stdin input', () => {
  const program = new Command();
  registerEmbeddingsCommand(program);

  const command = program.commands.find((candidate) => candidate.name() === 'embeddings');
  const textArgument = command?.registeredArguments[0];

  assert.ok(textArgument);
  assert.equal(textArgument.required, false);
  assert.equal(textArgument.variadic, true);
});

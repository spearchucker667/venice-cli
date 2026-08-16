#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function discoverTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      tests.push(...await discoverTests(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      tests.push(entryPath);
    }
  }
  return tests;
}

const tests = (await discoverTests(resolve('dist'))).sort();
if (tests.length === 0) {
  console.error('No compiled test files found under dist.');
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
  const forward = (signal) => child.kill(signal);
  process.once('SIGINT', forward);
  process.once('SIGTERM', forward);
  child.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forward);
    process.removeListener('SIGTERM', forward);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

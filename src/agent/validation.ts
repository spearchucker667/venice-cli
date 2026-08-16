/**
 * Validation command detection for the agent runtime.
 *
 * Inspects repository files to determine the appropriate validation commands.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ValidationCommand {
  command: string;
  source: string;
  priority: number;
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

function hasScript(scripts: Record<string, string> | undefined, names: string[]): string | undefined {
  if (!scripts) return undefined;
  for (const name of names) {
    if (scripts[name]) return name;
  }
  return undefined;
}

export async function detectValidationCommands(workspaceRoot: string): Promise<ValidationCommand[]> {
  const commands: ValidationCommand[] = [];

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = readJson(packageJsonPath) as { scripts?: Record<string, string> } | undefined;
    const scripts = pkg?.scripts;

    const typecheck = hasScript(scripts, ['typecheck', 'tsc', 'type-check']);
    if (typecheck) commands.push({ command: `npm run ${typecheck}`, source: 'package.json', priority: 10 });

    const lint = hasScript(scripts, ['lint', 'eslint']);
    if (lint) commands.push({ command: `npm run ${lint}`, source: 'package.json', priority: 20 });

    const test = hasScript(scripts, ['test']);
    if (test) commands.push({ command: `npm run ${test}`, source: 'package.json', priority: 30 });

    const build = hasScript(scripts, ['build']);
    if (build) commands.push({ command: `npm run ${build}`, source: 'package.json', priority: 40 });
  }

  const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
  const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
  if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
    commands.push({ command: 'pytest', source: 'python-project', priority: 30 });
    commands.push({ command: 'python -m compileall .', source: 'python-project', priority: 40 });
  }

  const cargoPath = path.join(workspaceRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    commands.push({ command: 'cargo check', source: 'Cargo.toml', priority: 10 });
    commands.push({ command: 'cargo test', source: 'Cargo.toml', priority: 30 });
    commands.push({ command: 'cargo clippy', source: 'Cargo.toml', priority: 20 });
  }

  const goModPath = path.join(workspaceRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    commands.push({ command: 'go test ./...', source: 'go.mod', priority: 30 });
    commands.push({ command: 'go build ./...', source: 'go.mod', priority: 40 });
  }

  return commands.sort((a, b) => a.priority - b.priority);
}

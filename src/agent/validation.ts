/**
 * Validation command detection for the agent runtime.
 *
 * Inspects repository files to determine the appropriate validation commands.
 * Every detected command carries provenance so the permission layer can
 * distinguish repository-controlled executable scripts from deterministic
 * toolchain-convention invocations (VCL-R3-001).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type ValidationSourceKind = 'package-script' | 'toolchain-convention';

export interface ValidationCommand {
  command: string;
  /** Absolute path of the repository file that produced this command. */
  sourcePath: string;
  sourceKind: ValidationSourceKind;
  /**
   * Whether running this command counts as executing repository-controlled
   * code. Package-script commands are arbitrary strings defined by the repo
   * and always require workspace execution trust. Toolchain-convention
   * commands are deterministic invocations chosen by this CLI.
   */
  requiresWorkspaceExecutionTrust: boolean;
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
    if (typecheck) {
      commands.push({
        command: `npm run ${typecheck}`,
        sourcePath: packageJsonPath,
        sourceKind: 'package-script',
        requiresWorkspaceExecutionTrust: true,
        priority: 10,
      });
    }

    const lint = hasScript(scripts, ['lint', 'eslint']);
    if (lint) {
      commands.push({
        command: `npm run ${lint}`,
        sourcePath: packageJsonPath,
        sourceKind: 'package-script',
        requiresWorkspaceExecutionTrust: true,
        priority: 20,
      });
    }

    const test = hasScript(scripts, ['test']);
    if (test) {
      commands.push({
        command: `npm run ${test}`,
        sourcePath: packageJsonPath,
        sourceKind: 'package-script',
        requiresWorkspaceExecutionTrust: true,
        priority: 30,
      });
    }

    const build = hasScript(scripts, ['build']);
    if (build) {
      commands.push({
        command: `npm run ${build}`,
        sourcePath: packageJsonPath,
        sourceKind: 'package-script',
        requiresWorkspaceExecutionTrust: true,
        priority: 40,
      });
    }
  }

  const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
  const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
  if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
    const sourcePath = fs.existsSync(pyprojectPath) ? pyprojectPath : requirementsPath;
    commands.push({
      command: 'pytest',
      sourcePath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 30,
    });
    commands.push({
      command: 'python -m compileall .',
      sourcePath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 40,
    });
  }

  const cargoPath = path.join(workspaceRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    commands.push({
      command: 'cargo check',
      sourcePath: cargoPath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 10,
    });
    commands.push({
      command: 'cargo clippy',
      sourcePath: cargoPath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 20,
    });
    commands.push({
      command: 'cargo test',
      sourcePath: cargoPath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 30,
    });
  }

  const goModPath = path.join(workspaceRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    commands.push({
      command: 'go test ./...',
      sourcePath: goModPath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 30,
    });
    commands.push({
      command: 'go build ./...',
      sourcePath: goModPath,
      sourceKind: 'toolchain-convention',
      requiresWorkspaceExecutionTrust: false,
      priority: 40,
    });
  }

  return commands.sort((a, b) => a.priority - b.priority);
}

/**
 * Shared helpers for read-only subagent execution and result normalization.
 */

import type { SubagentFinding, SubagentKind, SubagentMode, SubagentResult, ToolInvocation } from './types.js';

export const SUBAGENT_DEFAULT_MAX_TURNS = 6;
export const SUBAGENT_MAX_TURNS_LIMIT = 20;

const SUBAGENT_KINDS: SubagentKind[] = ['explore', 'review', 'research', 'test', 'general'];

export function normalizeSubagentKind(kind: unknown): SubagentKind {
  if (typeof kind === 'string' && SUBAGENT_KINDS.includes(kind as SubagentKind)) {
    return kind as SubagentKind;
  }
  return 'general';
}

export function normalizeSubagentMode(mode: unknown): SubagentMode {
  return mode === 'write' ? 'write' : 'read-only';
}

export function normalizeSubagentMaxTurns(maxTurns: unknown): number {
  if (!Number.isFinite(maxTurns)) return SUBAGENT_DEFAULT_MAX_TURNS;
  const parsed = Math.trunc(Number(maxTurns));
  if (parsed < 1) return 1;
  if (parsed > SUBAGENT_MAX_TURNS_LIMIT) return SUBAGENT_MAX_TURNS_LIMIT;
  return parsed;
}

export function buildReadOnlySubagentObjective(task: string, kind: SubagentKind): string {
  return buildSubagentObjective(task, kind, 'read-only');
}

export function buildSubagentObjective(task: string, kind: SubagentKind, mode: SubagentMode): string {
  const accessContract = mode === 'write'
    ? 'You may inspect and edit files inside the workspace. You cannot run shell commands or access paths outside the workspace.'
    : 'You may inspect the workspace but must not modify files or run mutating commands.';
  return [
    `You are a ${mode} ${kind} subagent.`,
    accessContract,
    'Use available tools to gather evidence, then return concise findings.',
    '',
    'Return a JSON object (no markdown) with this exact shape:',
    '{',
    '  "summary": string,',
    '  "findings": [{ "severity"?: string, "file"?: string, "line"?: number, "description": string }],',
    '  "recommendations": string[]',
    '}',
    '',
    `Task: ${task.trim()}`,
  ].join('\n');
}

export function parseSubagentReport(output: string): Pick<SubagentResult, 'summary' | 'findings' | 'recommendations'> {
  const parsed = parseJsonCandidate(output);
  if (!parsed || typeof parsed !== 'object') {
    return {
      summary: normalizeSummary(output),
      findings: [],
      recommendations: [],
    };
  }

  const value = parsed as Record<string, unknown>;
  const summary = typeof value.summary === 'string' ? value.summary.trim() : normalizeSummary(output);
  const findings = normalizeFindings(value.findings);
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
    : [];

  return {
    summary: summary || normalizeSummary(output),
    findings,
    recommendations,
  };
}

export function collectSubagentFilesInspected(toolHistory: ToolInvocation[]): string[] {
  const files = new Set<string>();

  for (const invocation of toolHistory) {
    if (invocation.toolName === 'read_file') {
      addMaybePath(files, (invocation.input as { path?: unknown })?.path);
      continue;
    }

    if (invocation.toolName === 'read_many_files') {
      const paths = (invocation.input as { paths?: unknown })?.paths;
      if (Array.isArray(paths)) {
        for (const p of paths) addMaybePath(files, p);
      }
      continue;
    }

    if (invocation.toolName === 'find' || invocation.toolName === 'glob') {
      if (invocation.result.ok && Array.isArray(invocation.result.data)) {
        for (const p of invocation.result.data) addMaybePath(files, p);
      }
      continue;
    }

    if (invocation.toolName === 'grep') {
      if (invocation.result.ok && Array.isArray(invocation.result.data)) {
        for (const row of invocation.result.data as Array<{ file?: unknown }>) {
          addMaybePath(files, row.file);
        }
      }
    }
  }

  return Array.from(files).sort();
}

function parseJsonCandidate(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidates = [
    fenced?.[1],
    extractBraceObject(text),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // ignore and try next candidate
    }
  }
  return undefined;
}

function extractBraceObject(text: string): string | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function normalizeFindings(raw: unknown): SubagentFinding[] {
  if (!Array.isArray(raw)) return [];

  const findings: SubagentFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const finding = item as Record<string, unknown>;
    if (typeof finding.description !== 'string' || !finding.description.trim()) continue;

    const normalized: SubagentFinding = { description: finding.description.trim() };
    if (typeof finding.severity === 'string' && finding.severity.trim()) {
      normalized.severity = finding.severity.trim();
    }
    if (typeof finding.file === 'string' && finding.file.trim()) {
      normalized.file = finding.file.trim();
    }
    if (typeof finding.line === 'number' && Number.isFinite(finding.line) && finding.line > 0) {
      normalized.line = Math.trunc(finding.line);
    }
    findings.push(normalized);
  }
  return findings;
}

function normalizeSummary(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return 'Subagent completed without a summary.';
  return trimmed.length <= 1200 ? trimmed : `${trimmed.slice(0, 1200)}…`;
}

function addMaybePath(files: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  files.add(trimmed);
}

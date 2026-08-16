/**
 * Permission manager and risk classification for agent tools.
 */

export type ApprovalMode = 'suggest' | 'auto-edit' | 'auto' | 'yolo';
export type RiskLevel = 'read' | 'write' | 'execute' | 'network' | 'outside_workspace' | 'destructive';

export interface ApprovalScope {
  scope: 'once' | 'session' | 'pattern';
  toolName?: string;
  pattern?: RegExp;
}

export type ApprovalCallback = (
  toolName: string,
  input: unknown,
  risk: RiskLevel
) => Promise<{ approved: boolean; scope?: ApprovalScope['scope'] }>;

export class PermissionManager {
  private mode: ApprovalMode;
  private readonly grants: ApprovalScope[] = [];
  private approver?: ApprovalCallback;

  constructor(mode: ApprovalMode = 'suggest') {
    this.mode = mode;
  }

  setApprover(approver: ApprovalCallback): void {
    this.approver = approver;
  }

  getMode(): ApprovalMode {
    return this.mode;
  }

  setMode(mode: ApprovalMode): void {
    this.mode = mode;
    this.grants.length = 0;
  }

  async requestApproval(
    toolName: string,
    input: unknown,
    risk: RiskLevel
  ): Promise<{ approved: boolean; scope?: ApprovalScope['scope'] }> {
    if (this.approver) {
      return await this.approver(toolName, input, risk);
    }
    return { approved: false };
  }

  grant(scope: ApprovalScope['scope'], toolName?: string, pattern?: RegExp): void {
    this.grants.push({ scope, toolName, pattern });
  }

  async isApproved(toolName: string, input: unknown, risk: RiskLevel): Promise<boolean> {
    if (risk === 'outside_workspace') {
      return false;
    }

    if (this.mode === 'yolo' && risk !== 'destructive') {
      return true;
    }

    if (this.mode === 'auto' && risk !== 'destructive' && risk !== 'network') {
      return true;
    }

    if (this.mode === 'auto-edit' && (risk === 'read' || risk === 'write')) {
      return true;
    }

    // Auto-validation is a direct consequence of file edits in auto-edit mode.
    if (this.mode === 'auto-edit' && toolName === 'run_validation') {
      return true;
    }

    for (const grant of this.grants) {
      if (grant.toolName && grant.toolName !== toolName) continue;
      if (grant.pattern && !this.matchesPattern(grant.pattern, input)) continue;
      if (grant.scope === 'session') return true;
      if (grant.scope === 'once') {
        const index = this.grants.indexOf(grant);
        if (index !== -1) this.grants.splice(index, 1);
        return true;
      }
      if (grant.scope === 'pattern') return true;
    }

    return false;
  }

  private matchesPattern(pattern: RegExp, input: unknown): boolean {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return pattern.test(text);
  }
}

export function classifyRisk(toolName: string, input: unknown): RiskLevel {
  if (toolName === 'spawn_agent') {
    const mode = typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>).mode
      : undefined;
    return mode === 'write' ? 'write' : 'execute';
  }
  if (toolName === 'shell') {
    const command = typeof input === 'object' && input !== null
      ? String((input as Record<string, unknown>).command || '')
      : '';
    if (/\brm\b.*-rf|\bmkfs\b|\bdd\b|\bformat\b/i.test(command)) {
      return 'destructive';
    }
    return 'execute';
  }
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'apply_patch') {
    return 'write';
  }
  if (
    [
      'read_file',
      'read_many_files',
      'list_directory',
      'glob',
      'grep',
      'find',
      'git_status',
      'git_diff',
      'git_log',
      'todo_read',
      'todo_write',
      'skill_list',
      'skill_load',
    ].includes(toolName)
  ) {
    return 'read';
  }
  if (toolName === 'ask_user') return 'read';
  if (
    [
      'web_search',
      'web_scrape',
      'generate_image',
      'edit_image',
      'upscale_image',
      'remove_background',
      'generate_video',
      'image_to_video',
      'transcribe_audio',
      'text_to_speech',
      'generate_music',
    ].includes(toolName)
  ) {
    return 'network';
  }
  return 'execute';
}

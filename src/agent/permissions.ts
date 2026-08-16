/**
 * Permission manager and risk classification for agent tools.
 */

export type ApprovalMode = 'suggest' | 'auto-edit' | 'auto' | 'yolo';
export type RiskLevel = 'read' | 'write' | 'execute' | 'network' | 'outside_workspace' | 'destructive' | 'external_side_effect';

export interface Matcher {
  kind: 'path-glob' | 'command-prefix' | 'field-equals';
  field?: string;
  value: string;
}

export interface ApprovalScope {
  scope: 'once' | 'session' | 'pattern';
  toolName?: string;
  matcher?: Matcher;
}

export type ApprovalDecision =
  | { approved: false }
  | { approved: true; scope: 'once' }
  | { approved: true; scope: 'session' }
  | { approved: true; scope: 'pattern'; matcher: Matcher };

export type ApprovalCallback = (
  toolName: string,
  input: unknown,
  risk: RiskLevel
) => Promise<ApprovalDecision>;

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
  ): Promise<ApprovalDecision> {
    if (this.approver) {
      return await this.approver(toolName, input, risk);
    }
    return { approved: false };
  }

  grant(scope: ApprovalScope['scope'], toolName?: string, matcher?: Matcher): void {
    if (scope === 'pattern' && !matcher) {
      // Cannot grant pattern scope without a matcher
      return;
    }
    this.grants.push({ scope, toolName, matcher });
  }

  async isApproved(toolName: string, input: unknown, risk: RiskLevel): Promise<boolean> {
    if (risk === 'outside_workspace') {
      return false;
    }

    if (this.mode === 'yolo' && risk !== 'destructive') {
      return true;
    }

    if (this.mode === 'auto' && risk !== 'destructive' && risk !== 'network' && risk !== 'external_side_effect') {
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
      if (grant.scope === 'pattern' && grant.matcher) {
        if (!this.matchesPattern(grant.matcher, input)) continue;
        return true;
      }
      if (grant.scope === 'session') return true;
      if (grant.scope === 'once') {
        const index = this.grants.indexOf(grant);
        if (index !== -1) this.grants.splice(index, 1);
        return true;
      }
    }

    return false;
  }

  private matchesPattern(matcher: Matcher, input: unknown): boolean {
    if (!input || typeof input !== 'object') return false;
    const value = matcher.field ? (input as any)[matcher.field] : undefined;
    if (value === undefined) return false;
    
    if (matcher.kind === 'field-equals') {
      return String(value) === matcher.value;
    } else if (matcher.kind === 'command-prefix') {
      return String(value).startsWith(matcher.value);
    } else if (matcher.kind === 'path-glob') {
      // Basic glob to regex conversion for * and **
      const regexStr = matcher.value
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/(?<!\.)\*/g, '[^/]*');
      return new RegExp(`^${regexStr}$`).test(String(value));
    }
    return false;
  }
}


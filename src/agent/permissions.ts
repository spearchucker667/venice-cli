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
  /** Risk level the grant was issued for. Stored grants never authorize more severe risks. */
  risk?: RiskLevel;
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

/**
 * Separate policy for plan-exit approval. This is intentionally distinct
 * from ordinary tool approval: YOLO mode must NOT bypass plan approval
 * (work order §9 rule 7). With no approver installed the request fails
 * closed.
 */
export type PlanApprovalCallback = (plan: import('./types.js').PlanArtifact) => Promise<boolean>;

/**
 * Handler that actually collects a structured answer from the user for an
 * `ask_user` interaction (VC-KIMI-058). Returns `undefined` when no collector
 * is available, which the runtime reports as INTERACTION_REQUIRED.
 */
export type UserQuestionCallback = (
  request: import('./types.js').UserQuestionRequest
) => Promise<import('./types.js').UserQuestionResponse | undefined>;

/**
 * Relative severity of each risk level. A grant issued for a given risk may
 * only cover future requests at the same or a lower severity.
 */
const RISK_RANK: Record<RiskLevel, number> = {
  read: 0,
  write: 1,
  execute: 2,
  network: 3,
  external_side_effect: 4,
  outside_workspace: 5,
  destructive: 6,
};

/** Default ceiling for grants created without an explicit risk (legacy callers). */
const LEGACY_GRANT_RISK: RiskLevel = 'write';

export class PermissionManager {
  private mode: ApprovalMode;
  private readonly grants: ApprovalScope[] = [];
  private approver?: ApprovalCallback;
  private planApprover?: PlanApprovalCallback;
  private userQuestionHandler?: UserQuestionCallback;

  constructor(mode: ApprovalMode = 'suggest') {
    this.mode = mode;
  }

  setApprover(approver: ApprovalCallback): void {
    this.approver = approver;
  }

  /** Install the plan-exit approval handler (TUI renders the plan). */
  setPlanApprover(approver: PlanApprovalCallback): void {
    this.planApprover = approver;
  }

  /** Install the structured-question collector (TUI renders the prompt). */
  setUserQuestionHandler(handler: UserQuestionCallback): void {
    this.userQuestionHandler = handler;
  }

  /** Collect an answer; returns undefined when no collector is installed. */
  async requestUserAnswer(request: import('./types.js').UserQuestionRequest): Promise<import('./types.js').UserQuestionResponse | undefined> {
    if (this.userQuestionHandler) {
      return await this.userQuestionHandler(request);
    }
    return undefined;
  }

  /**
   * Ask the user to approve leaving plan mode with a proposed plan.
   * Fails closed (denies) when no approver is installed, which also means
   * YOLO mode cannot bypass plan approval.
   */
  async requestPlanApproval(plan: import('./types.js').PlanArtifact): Promise<boolean> {
    if (this.planApprover) {
      return await this.planApprover(plan);
    }
    return false;
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

  grant(
    scope: ApprovalScope['scope'],
    toolName?: string,
    matcher?: Matcher,
    risk?: RiskLevel
  ): void {
    if (scope === 'pattern' && !matcher) {
      // Cannot grant pattern scope without a matcher
      return;
    }
    this.grants.push({ scope, toolName, matcher, risk });
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

      // A stored grant never authorizes a call more severe than the one it
      // was issued for (VC-KIMI-009). Grants created without a risk get the
      // conservative 'write' ceiling.
      const grantedRisk = grant.risk ?? LEGACY_GRANT_RISK;
      if (RISK_RANK[risk] > RISK_RANK[grantedRisk]) continue;

      // Destructive operations always require a fresh explicit approval
      // unless a deliberately destructive pattern matcher exists.
      if (risk === 'destructive' && !(grant.scope === 'pattern' && grant.risk === 'destructive' && grant.matcher)) {
        continue;
      }

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
      // Match at a shell token boundary: `git` matches `git status` but not `gitty`.
      const candidate = String(value).trim();
      const prefix = matcher.value.trim();
      return candidate === prefix || candidate.startsWith(prefix + ' ');
    } else if (matcher.kind === 'path-glob') {
      // Normalize Windows separators so globs can always use `/`.
      const candidate = String(value).split('\\').join('/');
      return globToRegExp(matcher.value).test(candidate);
    }
    return false;
  }
}

/**
 * Convert a path glob to a regular expression.
 *
 * - `**` crosses directory boundaries;
 * - `*` matches within a single path segment;
 * - every other regex metacharacter in the glob is treated literally.
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('**')
    .map((segment) =>
      segment
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

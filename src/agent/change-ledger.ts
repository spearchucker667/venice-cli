/**
 * Change ledger: the single source of truth for the files a session has
 * mutated.
 *
 * This is deliberately separate from workspace path safety. `WorkspaceManager`
 * answers "may this path be touched?"; the ledger answers "what has been
 * touched?". Keeping them apart means path containment never has to know about
 * mutation state, and the persisted `AgentState.changedFiles` is a derived
 * snapshot of exactly one authority rather than a second store kept in
 * lockstep by hand.
 */

import type { WorkspaceFileRef } from './types.js';
import { normalizeFileRef } from './workspace.js';

export class ChangeLedger {
  private readonly primaryRoot: string;
  private readonly changed = new Set<string>();

  constructor(primaryRoot: string) {
    this.primaryRoot = primaryRoot;
  }

  /** Record a file as changed. Bare relative paths are primary-root-relative. */
  mark(ref: WorkspaceFileRef | string): void {
    const normalized = normalizeFileRef(ref, this.primaryRoot);
    this.changed.add(`${normalized.rootId}\u0000${normalized.relativePath}`);
  }

  /** Replace the ledger wholesale (used when a session is reset or resumed). */
  replace(refs: (WorkspaceFileRef | string)[]): void {
    this.changed.clear();
    for (const ref of refs) this.mark(ref);
  }

  /** Sorted, root-aware snapshot of every changed file. */
  get refs(): WorkspaceFileRef[] {
    return Array.from(this.changed)
      .map((key) => {
        const sep = key.indexOf('\u0000');
        return { rootId: key.slice(0, sep), relativePath: key.slice(sep + 1) };
      })
      .sort((a, b) => (
        a.rootId === b.rootId
          ? a.relativePath.localeCompare(b.relativePath)
          : a.rootId.localeCompare(b.rootId)
      ));
  }
}

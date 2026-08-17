/**
 * Foreground turn ownership.
 *
 * A foreground turn owns the session, workspace, and context one at a time.
 * The runtime funnels every turn entry point through one serializing
 * TurnController: `begin()` waits for the prior turn, installs the owner, and
 * hands back a handle whose `finish()` releases it. Busy state and the frozen
 * in-flight signal are read from the controller, not scattered runtime flags.
 */

import { randomUUID } from 'node:crypto';

export interface TurnExecution {
  readonly id: string;
  /** Abort signal frozen for this turn (a fresh controller when none was supplied). */
  readonly signal: AbortSignal;
  readonly startedAt: number;
  /** Release ownership. Idempotent; call once in a `finally`. */
  finish(): void;
}

export class TurnController {
  private pending = 0;
  private active?: TurnExecution;
  private lock: Promise<void> = Promise.resolve();

  /** True from the moment a turn is queued until its `finish()` completes. */
  isBusy(): boolean {
    return this.pending > 0 || this.active !== undefined;
  }

  /** The foreground turn currently owning the session, if any. */
  current(): TurnExecution | undefined {
    return this.active;
  }

  /**
   * Serialize a foreground turn. Concurrent callers queue in call order; each
   * owns the session until its handle's `finish()` runs.
   */
  async begin(signal?: AbortSignal): Promise<TurnExecution> {
    this.pending++;

    let releaseLock!: () => void;
    const nextLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const currentLock = this.lock;
    this.lock = this.lock.then(() => nextLock, () => nextLock);
    await currentLock;

    const turnSignal = signal ?? new AbortController().signal;
    const turn: TurnExecution = {
      id: randomUUID(),
      signal: turnSignal,
      startedAt: Date.now(),
      finish: () => {
        if (this.active !== turn) return; // already released
        this.active = undefined;
        this.pending--;
        releaseLock();
      },
    };
    this.active = turn;
    return turn;
  }

  /** Clear pending/active ownership at a session-reset boundary. */
  reset(): void {
    this.active = undefined;
    this.pending = 0;
  }
}

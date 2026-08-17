/**
 * Unit tests for the TurnController — the single serializing seam for
 * foreground turn ownership (R2-001).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TurnController } from './turn.js';

describe('TurnController', () => {
  it('is idle until a turn begins', () => {
    const turns = new TurnController();
    assert.strictEqual(turns.isBusy(), false);
    assert.strictEqual(turns.current(), undefined);
  });

  it('serializes concurrent begin() calls in order', async () => {
    const turns = new TurnController();
    const order: string[] = [];

    const first = await turns.begin();
    assert.strictEqual(turns.isBusy(), true);
    assert.strictEqual(turns.current(), first);

    const secondPromise = turns.begin().then((turn) => {
      order.push('second-owns');
      assert.strictEqual(turns.current(), turn);
      turn.finish();
      order.push('second-done');
    });

    // First turn still owns; the second is queued (busy stays true).
    await Promise.resolve();
    assert.strictEqual(order.length, 0, 'second must not run before first finishes');

    order.push('first-done');
    first.finish();
    await secondPromise;

    assert.deepStrictEqual(order, ['first-done', 'second-owns', 'second-done']);
    assert.strictEqual(turns.isBusy(), false);
  });

  it('freezes the signal supplied at begin()', async () => {
    const turns = new TurnController();
    const controller = new AbortController();
    const turn = await turns.begin(controller.signal);
    assert.strictEqual(turn.signal, controller.signal);
    turn.finish();
  });

  it('creates a fresh non-aborted signal when none is supplied', async () => {
    const turns = new TurnController();
    const turn = await turns.begin();
    assert.strictEqual(turn.signal.aborted, false);
    turn.finish();
  });

  it('finish() is idempotent', async () => {
    const turns = new TurnController();
    const turn = await turns.begin();
    turn.finish();
    turn.finish(); // must not decrement below zero
    assert.strictEqual(turns.isBusy(), false);
  });

  it('reset() clears active ownership', async () => {
    const turns = new TurnController();
    await turns.begin();
    assert.strictEqual(turns.isBusy(), true);
    turns.reset();
    assert.strictEqual(turns.isBusy(), false);
    assert.strictEqual(turns.current(), undefined);
  });
});

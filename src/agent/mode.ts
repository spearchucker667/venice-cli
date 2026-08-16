/**
 * Unified runtime mode state for the Venice CLI agent.
 */

import type { ApprovalMode } from './permissions.js';

export interface RuntimeModeState {
  inputMode: 'agent' | 'shell';
  operatingMode: 'agent' | 'plan';
  permissionMode: ApprovalMode;
}

export function defaultMode(permissionMode: ApprovalMode = 'suggest'): RuntimeModeState {
  return { inputMode: 'agent', operatingMode: 'agent', permissionMode };
}

export function setMode(state: RuntimeModeState, patch: Partial<RuntimeModeState>): RuntimeModeState {
  return { ...state, ...patch };
}

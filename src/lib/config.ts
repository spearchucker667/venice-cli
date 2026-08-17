/**
 * Configuration Management for Venice CLI
 * 
 * Stores config in ~/.venice/config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Ajv } from 'ajv';
import type { Message, VeniceConfig } from '../types/index.js';
import { sanitizeMessagesForHistory } from '../types/index.js';

const CONFIG_DIR = path.join(os.homedir(), '.venice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const USAGE_FILE = path.join(CONFIG_DIR, 'usage.json');

/**
 * JSON Schema for `~/.venice/config.json` (P2). Unknown keys are allowed so a
 * future config field never bricks an older CLI; known fields are type- and
 * value-checked so a malformed file is surfaced instead of silently accepted.
 */
const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    api_key: { type: 'string' },
    fallback_api_key: { type: 'string' },
    signInWithX: { type: 'string' },
    default_model: { type: 'string' },
    default_image_model: { type: 'string' },
    default_voice: { type: 'string' },
    output_format: { type: 'string', enum: ['pretty', 'json', 'markdown', 'raw'] },
    no_color: { type: 'boolean' },
    show_usage: { type: 'boolean' },
    media_safe_mode: { type: 'boolean' },
    theme: { type: 'string' },
  },
  additionalProperties: true,
} as const;

const configValidator = new Ajv({ allErrors: true, strict: true }).compile(CONFIG_SCHEMA);
let configWarningShown = false;

/**
 * Validate a parsed config object against the schema, returning human-readable
 * messages for every offending field. Pure and side-effect free so it can be
 * unit-tested without touching the real `~/.venice/config.json`.
 */
export function validateConfigShape(config: unknown): string[] {
  if (configValidator(config)) return [];
  return (configValidator.errors ?? []).map((error) => {
    const path = error.instancePath ? `$.${error.instancePath}` : '$';
    return `${path}: ${error.message ?? `failed ${error.keyword} validation`}`;
  });
}

export function ensureConfigDir(): void {
  if (fs.existsSync(CONFIG_DIR)) {
    const stat = fs.lstatSync(CONFIG_DIR);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Config path is not a directory: ${CONFIG_DIR}`);
    }
  } else {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(CONFIG_DIR, 0o700);
}

export function loadConfig(): VeniceConfig {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }

  assertRegularConfigFile();
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content) as VeniceConfig;
    // Surface malformed config instead of silently accepting it (P2). The
    // config is still returned so a single bad field never drops the user's
    // API key; the warning is emitted once per process to avoid noise.
    if (!configWarningShown) {
      const problems = validateConfigShape(parsed);
      if (problems.length > 0) {
        configWarningShown = true;
        console.error(`Warning: invalid entries in ${CONFIG_FILE}:\n  ${problems.join('\n  ')}`);
      }
    }
    return parsed;
  } catch {
    // Return empty config on error
  }
  return {};
}

export function saveConfig(config: VeniceConfig): void {
  ensureConfigDir();

  if (fs.existsSync(CONFIG_FILE)) {
    assertRegularConfigFile();
  }

  const temporaryFile = path.join(
    CONFIG_DIR,
    `.config-${process.pid}-${randomUUID()}.tmp`
  );
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.fchmodSync(fileDescriptor, 0o600);
    fs.writeFileSync(fileDescriptor, JSON.stringify(config, null, 2));
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryFile, CONFIG_FILE);
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
    fs.rmSync(temporaryFile, { force: true });
    throw error;
  }
}

function assertRegularConfigFile(): void {
  const stat = fs.lstatSync(CONFIG_FILE);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Config path is not a regular file: ${CONFIG_FILE}`);
  }
}

export function getConfigValue(key: keyof VeniceConfig): unknown {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue(key: keyof VeniceConfig, value: string): void {
  const config = loadConfig();
  
  // Handle boolean conversions
  if (key === 'no_color' || key === 'show_usage' || key === 'media_safe_mode') {
    (config as any)[key] = value === 'true' || value === '1';
  } else {
    (config as any)[key] = value;
  }
  
  saveConfig(config);
}

export function deleteConfigValue(key: keyof VeniceConfig): void {
  const config = loadConfig();
  delete config[key];
  saveConfig(config);
}

export function getApiKey(): string | undefined {
  // Priority: env var > config file primary key > config fallback key. The
  // fallback key doubles as the active credential when no primary is stored,
  // so a user who only configured `/config fallback-api-key` still works.
  const envKey = process.env.VENICE_API_KEY;
  if (envKey) return envKey;

  const config = loadConfig();
  return config.api_key || config.fallback_api_key;
}

/**
 * The secondary Venice API key, if configured. Never returns the primary key
 * (or `VENICE_API_KEY`): callers use this only as a retry credential when the
 * active key was rejected. The `VENICE_API_KEY_FALLBACK` env var overrides the
 * config value, mirroring `VENICE_API_KEY`.
 */
export function getFallbackApiKey(): string | undefined {
  const envKey = process.env.VENICE_API_KEY_FALLBACK;
  if (envKey) return envKey;

  const config = loadConfig();
  return config.fallback_api_key;
}

export function getSignInWithX(): string | undefined {
  const envKey = process.env.X_SIGN_IN_WITH_X;
  if (envKey) return envKey;
  
  const config = loadConfig();
  return config.signInWithX;
}

/**
 * The single source of truth for the x402 wallet-auth request header name.
 *
 * Note: Venice's endpoint reference pages currently name `SIGN-IN-WITH-X` as
 * the live header and describe `X-Sign-In-With-X` as the legacy header accepted
 * during migration, while the x402 integration guide documents
 * `X-Sign-In-With-X`. We follow the guide (and the work-order contract) and keep
 * this constant as the one place to change if the API settles the other way.
 */
export const X_SIGN_IN_WITH_X_HEADER = 'X-Sign-In-With-X';

export type VeniceAuth =
  | { kind: 'api-key'; value: string }
  | { kind: 'sign-in-with-x'; value: string };

export function getVeniceAuth(): VeniceAuth | undefined {
  const apiKey = getApiKey();
  if (apiKey) return { kind: 'api-key', value: apiKey };

  const signInWithX = getSignInWithX();
  if (signInWithX) return { kind: 'sign-in-with-x', value: signInWithX };

  return undefined;
}

/**
 * The fallback credential usable after the active credential is rejected.
 * Returns `undefined` when no fallback key is configured, or when the fallback
 * key is already the active credential (nothing left to fall back to).
 */
export function getFallbackVeniceAuth(): VeniceAuth | undefined {
  const key = getFallbackApiKey();
  if (!key) return undefined;

  const active = getVeniceAuth();
  if (active?.kind === 'api-key' && active.value === key) {
    return undefined;
  }
  return { kind: 'api-key', value: key };
}

export function applyVeniceAuth(
  headers: Record<string, string>,
  auth: VeniceAuth
): void {
  if (auth.kind === 'api-key') {
    headers.Authorization = `Bearer ${auth.value}`;
  } else {
    headers[X_SIGN_IN_WITH_X_HEADER] = auth.value;
  }
}

export function requireAuth(): VeniceAuth {
  const auth = getVeniceAuth();
  if (!auth) {
    throw new Error(
      'No API key or wallet token found.\n\n' +
      'Set your authentication using one of these methods:\n' +
      '  1. venice config set api_key\n' +
      '  2. venice config set signInWithX\n' +
      '  3. export VENICE_API_KEY=<your-key>\n' +
      '  4. export X_SIGN_IN_WITH_X=<your-token>\n\n' +
      'Get your API key at: https://venice.ai/settings/api'
    );
  }
  return auth;
}

/**
 * Central model-ID defaults. Direct API helpers and tools must reference these
 * instead of duplicating literals (VC-KIMI-068).
 */
export const DEFAULT_MODELS = {
  chat: 'kimi-k2-5',
  image: 'flux-2-pro',
  voice: 'af_sky',
  tts: 'tts-kokoro',
  voiceClone: 'tts-chatterbox-hd',
  transcription: 'nvidia/parakeet-tdt-0.6b-v3',
  embedding: 'text-embedding-3-small',
  textToVideo: 'wan-2.6-text-to-video',
  imageToVideo: 'wan-2.6-image-to-video',
  videoUpscale: 'topaz-video-upscale',
  imageUpscale: 'upscaler',
  music: 'elevenlabs-music',
} as const;

export function getDefaultModel(): string {
  const config = loadConfig();
  return config.default_model || DEFAULT_MODELS.chat;
}

/**
 * Project-level agent config from `<workspace>/.venice/config.json` (VCL-R3-010).
 *
 * `venice init` scaffolds this file with agent approval/validation and context
 * compaction settings. The runtime honors it at the documented precedence
 * (CLI > env > project > global > defaults). Auth secrets are never read from
 * a project config: the file is repo-committable and must not carry
 * credentials, so only the `agent`/`context` sections are recognized.
 */
export interface ProjectAgentConfig {
  agent?: {
    approvalMode?: 'suggest' | 'auto-edit' | 'auto' | 'yolo';
    autoValidate?: boolean;
  };
  context?: {
    autoCompact?: boolean;
  };
}

const PROJECT_APPROVAL_MODES = ['suggest', 'auto-edit', 'auto', 'yolo'] as const;

/** Read and validate the project config. Returns {} when absent/malformed. */
export function loadProjectConfig(workspaceRoot: string): ProjectAgentConfig {
  const file = path.join(workspaceRoot, '.venice', 'config.json');
  if (!fs.existsSync(file)) return {};
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return normalizeProjectConfig(parsed);
  } catch {
    return {};
  }
}

function normalizeProjectConfig(input: unknown): ProjectAgentConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const obj = input as Record<string, unknown>;
  const result: ProjectAgentConfig = {};

  const agent = obj.agent;
  if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
    const a = agent as Record<string, unknown>;
    if (typeof a.approvalMode === 'string' && (PROJECT_APPROVAL_MODES as readonly string[]).includes(a.approvalMode)) {
      result.agent = {
        ...(result.agent ?? {}),
        approvalMode: a.approvalMode as 'suggest' | 'auto-edit' | 'auto' | 'yolo',
      };
    }
    if (typeof a.autoValidate === 'boolean') {
      result.agent = { ...(result.agent ?? {}), autoValidate: a.autoValidate };
    }
  }

  const context = obj.context;
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    const c = context as Record<string, unknown>;
    if (typeof c.autoCompact === 'boolean') {
      result.context = { autoCompact: c.autoCompact };
    }
  }

  return result;
}

export function getDefaultImageModel(): string {
  const config = loadConfig();
  return config.default_image_model || DEFAULT_MODELS.image;
}

export function getDefaultVoice(): string {
  const config = loadConfig();
  return config.default_voice || DEFAULT_MODELS.voice;
}

/**
 * Central config-key registry. Every show/get/set/unset path must derive its
 * valid keys and secret masking from here (VC-KIMI-014/015).
 */
export const CONFIG_KEY_METADATA = {
  api_key: { secret: true },
  fallback_api_key: { secret: true },
  signInWithX: { secret: true },
  default_model: { secret: false },
  default_image_model: { secret: false },
  default_voice: { secret: false },
  output_format: { secret: false },
  no_color: { secret: false },
  show_usage: { secret: false },
  media_safe_mode: { secret: false },
  theme: { secret: false },
} as const satisfies Record<keyof VeniceConfig, { secret: boolean }>;

export type ConfigKey = keyof VeniceConfig;

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_KEY_METADATA, key);
}

export function isSecretConfigKey(key: string): boolean {
  return isConfigKey(key) && CONFIG_KEY_METADATA[key].secret;
}

export function maskSecretValue(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

export function getOutputFormat(): string {
  const config = loadConfig();
  return config.output_format || 'pretty';
}

export function isColorEnabled(): boolean {
  // Color detection must never crash on a malformed or symlinked config —
  // those conditions are diagnosed by `venice doctor config` instead.
  let config: VeniceConfig;
  try {
    config = loadConfig();
  } catch {
    config = {};
  }
  // Disable color if no_color is set or NO_COLOR env is set or not a TTY
  if (config.no_color) return false;
  if (process.env.NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

export function shouldShowUsage(): boolean {
  const config = loadConfig();
  return config.show_usage ?? true;
}

// History management
export interface ConversationEntry {
  id: string;
  timestamp: string;
  messages: Message[];
  model: string;
  character?: string;
  privacy?: 'plain' | 'e2ee' | 'tee';
}

export function loadHistory(): ConversationEntry[] {
  ensureConfigDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const parsed: ConversationEntry[] = JSON.parse(content);
      return parsed.map(sanitizeConversationForHistory);
    }
  } catch {
    // Return empty on error
  }
  return [];
}

export function saveHistory(history: ConversationEntry[]): void {
  ensureConfigDir();
  // Keep only last 100 conversations
  const trimmed = history.slice(-100).map(sanitizeConversationForHistory);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
}

export function addConversation(entry: ConversationEntry): void {
  const history = loadHistory();
  history.push(sanitizeConversationForHistory(entry));
  saveHistory(history);
}

export function sanitizeConversationForHistory(
  entry: ConversationEntry
): ConversationEntry {
  return {
    ...entry,
    messages: sanitizeMessagesForHistory(entry.messages),
  };
}

export function getLastConversation(): ConversationEntry | undefined {
  const history = loadHistory();
  return history[history.length - 1];
}

export function clearHistory(): void {
  ensureConfigDir();
  if (fs.existsSync(HISTORY_FILE)) {
    fs.unlinkSync(HISTORY_FILE);
  }
}

// Usage tracking
export interface UsageEntry {
  timestamp: string;
  command: string;
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export function loadUsage(): UsageEntry[] {
  ensureConfigDir();
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const content = fs.readFileSync(USAGE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return empty on error
  }
  return [];
}

export function saveUsage(usage: UsageEntry[]): void {
  ensureConfigDir();
  // Keep only last 30 days of usage
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const filtered = usage.filter(u => new Date(u.timestamp) > thirtyDaysAgo);
  fs.writeFileSync(USAGE_FILE, JSON.stringify(filtered, null, 2), { mode: 0o600 });
}

export function trackUsage(entry: Omit<UsageEntry, 'timestamp'>): void {
  const usage = loadUsage();
  usage.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  saveUsage(usage);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

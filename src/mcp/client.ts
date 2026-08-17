import { spawn, type ChildProcess } from 'node:child_process';
import type { McpServerConfig } from './config.js';
import { buildMcpEnv } from './env.js';
import { getVersion } from '../lib/version.js';
import { MCP_PROTOCOL_VERSION, isSupportedProtocolVersion } from './protocol.js';
import { terminateProcessTree, forceKillProcessTree } from '../lib/process-tree.js';

export interface McpTool {
  name: string;
  /** Human-friendly display title (MCP 2025-06-18). */
  title?: string;
  description?: string;
  inputSchema?: unknown;
  /** JSON Schema describing the tool's return value (MCP 2025-06-18). */
  outputSchema?: unknown;
  /**
   * Tool annotations (readOnly/destructiveTitleHint/idempotentHint…) from the
   * server. These are UNTRUSTED metadata: they are surfaced read-only and
   * never used to make security/permission decisions (VCL-R3-021).
   */
  annotations?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

export interface McpClientOptions {
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
  stopGraceMs?: number;
}

export class McpStdioClient {
  /** Bounds a single newline-delimited frame (VC-KIMI-020). */
  static readonly MAX_FRAME_BYTES = 8 * 1024 * 1024;
  /** tools/list cursor-loop caps (VCL-R3-013). */
  static readonly MAX_TOOLS_PAGES = 20;
  static readonly MAX_TOOLS = 1000;
  static readonly MAX_TOOLS_METADATA_BYTES = 1024 * 1024;

  private readonly config: McpServerConfig;
  private process?: ChildProcess;
  private buffer = '';
  private requestId = 0;
  private readonly pending = new Map<string | number, PendingRequest>();
  private initialized = false;
  private negotiatedProtocolVersion?: string;
  private serverCapabilities?: unknown;
  private readonly startTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly stopGraceMs: number;
  private stderrBuffer = '';
  private notificationHandler?: (method: string, params: unknown) => void;

  constructor(config: McpServerConfig, options: McpClientOptions = {}) {
    this.config = config;
    this.startTimeoutMs = options.startTimeoutMs ?? 30000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.stopGraceMs = options.stopGraceMs ?? 500;
  }

  async start(): Promise<void> {
    if (this.process) throw new Error('MCP client already started');
    return new Promise((resolve, reject) => {
      const args = this.config.args || [];
      // MCP servers are third-party executables: do not hand them the full
      // parent environment (see src/mcp/env.ts). Only allowlisted variables
      // and explicitly declared config env entries are propagated.
      const env = buildMcpEnv(this.config.env);
      // Detached on POSIX so stop() can terminate the whole process group
      // rather than only the direct child (VC-KIMI-042).
      this.process = spawn(this.config.command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      const startupTimer = setTimeout(() => {
        this.stop().catch(() => {});
        reject(new Error('MCP server startup timed out'));
      }, this.startTimeoutMs);

      this.process.on('error', (error) => {
        clearTimeout(startupTimer);
        this.rejectPending(new Error(`MCP server process error: ${error.message}`));
        reject(new Error(`MCP server failed to start: ${error.message}`));
      });

      this.process.on('exit', (code) => {
        clearTimeout(startupTimer);
        const wasInitialized = this.initialized;
        this.process = undefined;
        this.initialized = false;
        const error = new Error(
          `MCP server exited${wasInitialized ? '' : ' before initialization'} (code ${code ?? 'unknown'})${
            this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ''
          }`
        );
        this.rejectPending(error);
        if (!wasInitialized) {
          reject(
            error
          );
        }
      });

      this.process.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8');
        // A server that writes without ever emitting a newline must not grow
        // memory unboundedly (VC-KIMI-020). Reject pending work, stop the
        // server, and never persist the raw content.
        if (
          !this.buffer.includes('\n') &&
          Buffer.byteLength(this.buffer, 'utf-8') > McpStdioClient.MAX_FRAME_BYTES
        ) {
          this.buffer = '';
          this.rejectPending(new Error(
            `MCP server exceeded the ${McpStdioClient.MAX_FRAME_BYTES / (1024 * 1024)} MiB frame limit without emitting a newline`
          ));
          this.stop().catch(() => {});
          return;
        }
        this.flushLines();
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.stderrBuffer += text;
        if (this.stderrBuffer.length > 2000) {
          this.stderrBuffer = this.stderrBuffer.slice(-2000);
        }
      });

      this.sendRequest('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'venice-cli', version: getVersion() },
      }, undefined, this.startTimeoutMs)
        .then(async (result) => {
          // The server responds with the protocol version it will use. A
          // missing/empty protocolVersion is rejected outright — the client
          // never silently substitutes its own preference (VCL-R3-015) — and
          // an unsupported revision fails loudly (VC-KIMI-041).
          const response = result as
            | { protocolVersion?: string; capabilities?: unknown; serverInfo?: unknown }
            | undefined;
          const negotiated = response?.protocolVersion;
          if (typeof negotiated !== 'string' || !negotiated.trim()) {
            throw new Error(
              'MCP server initialize response did not include a protocolVersion'
            );
          }
          if (!isSupportedProtocolVersion(negotiated)) {
            throw new Error(`MCP server selected unsupported protocol version: ${negotiated}`);
          }
          this.negotiatedProtocolVersion = negotiated;
          this.serverCapabilities = response?.capabilities;
          this.initialized = true;
          clearTimeout(startupTimer);
          await this.sendNotification('initialized', {});
          resolve();
        })
        .catch((error) => {
          clearTimeout(startupTimer);
          this.stop().catch(() => {});
          reject(error);
        });
    });
  }

  async stop(): Promise<void> {
    this.rejectPending(new Error('MCP client stopped'));
    const child = this.process;
    this.process = undefined;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      terminateProcessTree(child);
      await Promise.race([exited, delay(this.stopGraceMs)]);
      if (child.exitCode === null) {
        forceKillProcessTree(child);
        await Promise.race([exited, delay(this.stopGraceMs)]);
      }
    }
    this.initialized = false;
    this.stderrBuffer = '';
    this.buffer = '';
  }

  /**
   * Register a handler for server-initiated JSON-RPC notifications (e.g.
   * `notifications/tools/list_changed`). Only one handler is supported.
   */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler;
  }

  /**
   * List tools with cursor pagination and hard caps (VCL-R3-013): repeated
   * cursors, excessive pages, tool counts, and cumulative metadata bytes all
   * fail loudly rather than looping or exhausting memory.
   */
  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    let previousCursor: string | undefined;
    let pages = 0;
    let cumulativeBytes = 0;

    while (true) {
      pages++;
      if (pages > McpStdioClient.MAX_TOOLS_PAGES) {
        throw new Error(`MCP server exceeded the ${McpStdioClient.MAX_TOOLS_PAGES}-page tools/list limit`);
      }
      const response = (await this.sendRequest('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      for (const tool of response.tools || []) {
        cumulativeBytes += Buffer.byteLength(JSON.stringify(tool));
        if (
          tools.length >= McpStdioClient.MAX_TOOLS ||
          cumulativeBytes > McpStdioClient.MAX_TOOLS_METADATA_BYTES
        ) {
          throw new Error(
            `MCP server exposed too many tools (limit ${McpStdioClient.MAX_TOOLS} / ${McpStdioClient.MAX_TOOLS_METADATA_BYTES} bytes)`
          );
        }
        tools.push(tool);
      }

      const next = response.nextCursor;
      if (!next) break;
      if (next === cursor || next === previousCursor) {
        throw new Error('MCP server returned a repeated tools/list cursor');
      }
      previousCursor = cursor;
      cursor = next;
    }

    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return await this.sendRequest('tools/call', { name, arguments: args }, signal);
  }

  isRunning(): boolean {
    return this.process !== undefined && this.process.exitCode === null;
  }

  getProcessId(): number | undefined {
    return this.process?.pid;
  }

  getNegotiatedProtocolVersion(): string | undefined {
    return this.negotiatedProtocolVersion;
  }

  getServerCapabilities(): unknown {
    return this.serverCapabilities;
  }

  private flushLines(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) break;
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const line = rawLine.trim();
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf-8') > McpStdioClient.MAX_FRAME_BYTES) {
        this.buffer = '';
        this.rejectPending(new Error('MCP server emitted an oversized frame'));
        this.stop().catch(() => {});
        return;
      }
      try {
        const message = JSON.parse(line) as {
          id?: string | number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: { code: number; message: string };
        };
        if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          this.removePending(message.id, pending);
          if (message.error) {
            pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
          } else {
            pending.resolve(message.result);
          }
        } else if (message.method) {
          // Server-initiated notification (no id), e.g.
          // notifications/tools/list_changed (VCL-R3-014).
          this.notificationHandler?.(message.method, message.params);
        }
      } catch {
        const error = new Error('MCP server sent malformed JSON-RPC');
        this.rejectPending(error);
        this.process?.kill('SIGTERM');
      }
    }
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin) return;
    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(message);
  }

  private sendRequest(method: string, params: unknown, signal?: AbortSignal, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin || this.process.stdin.destroyed) {
        reject(new Error('MCP client not started'));
        return;
      }
      if (signal?.aborted) {
        reject(new Error(`MCP request '${method}' cancelled`));
        return;
      }
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending) this.removePending(id, pending);
        reject(new Error(`MCP request '${method}' timed out`));
      }, timeoutMs);
      const pending: PendingRequest = { resolve, reject, timer, signal };
      if (signal) {
        pending.abortHandler = () => {
          this.removePending(id, pending);
          reject(new Error(`MCP request '${method}' cancelled`));
        };
        signal.addEventListener('abort', pending.abortHandler, { once: true });
      }
      this.pending.set(id, pending);
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.process.stdin.write(message, (error) => {
        if (!error) return;
        if (this.pending.get(id) === pending) this.removePending(id, pending);
        reject(new Error(`MCP request '${method}' could not be written: ${error.message}`));
      });
    });
  }

  private removePending(id: string | number, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler);
    }
    this.pending.delete(id);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.removePending(id, pending);
      pending.reject(error);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}



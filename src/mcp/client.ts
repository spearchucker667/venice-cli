import { spawn, type ChildProcess } from 'node:child_process';
import type { McpServerConfig } from './config.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpStdioClient {
  private readonly config: McpServerConfig;
  private process?: ChildProcess;
  private buffer = '';
  private requestId = 0;
  private readonly pending = new Map<string | number, PendingRequest>();
  private initialized = false;
  private readonly startTimeoutMs = 30000;
  private readonly requestTimeoutMs = 30000;
  private stderrBuffer = '';

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = this.config.args || [];
      const env = { ...process.env, ...this.config.env };
      this.process = spawn(this.config.command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

      const startupTimer = setTimeout(() => {
        this.stop().catch(() => {});
        reject(new Error('MCP server startup timed out'));
      }, this.startTimeoutMs);

      this.process.on('error', (error) => {
        clearTimeout(startupTimer);
        reject(new Error(`MCP server failed to start: ${error.message}`));
      });

      this.process.on('exit', (code) => {
        clearTimeout(startupTimer);
        if (!this.initialized) {
          reject(
            new Error(
              `MCP server exited before initialization (code ${code ?? 'unknown'})${
                this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ''
              }`
            )
          );
        }
      });

      this.process.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8');
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
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'venice-cli', version: '2.1.0' },
      })
        .then(async () => {
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP client stopped'));
    }
    this.pending.clear();
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }
    this.process = undefined;
    this.initialized = false;
    this.stderrBuffer = '';
  }

  async listTools(): Promise<McpTool[]> {
    const response = (await this.sendRequest('tools/list', {})) as { tools?: McpTool[] };
    return response.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.sendRequest('tools/call', { name, arguments: args });
  }

  private flushLines(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) break;
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as {
          id?: string | number;
          method?: string;
          result?: unknown;
          error?: { code: number; message: string };
        };
        if (message.id !== undefined) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
          } else {
            pending.resolve(message.result);
          }
        }
      } catch {
        // Ignore malformed lines.
      }
    }
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin) return;
    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(message);
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP client not started'));
        return;
      }
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.process.stdin.write(message);
    });
  }
}

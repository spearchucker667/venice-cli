import type { McpConfig, McpServerConfig } from './config.js';
import { McpStdioClient, type McpTool } from './client.js';

export interface ServerState {
  name: string;
  config: McpServerConfig;
  client: McpStdioClient;
  tools: McpTool[];
  error?: string;
}

export interface DiscoveredTool {
  serverName: string;
  tool: McpTool;
}

export class McpManager {
  private readonly config: McpConfig;
  private readonly servers: ServerState[] = [];
  private startPromise?: Promise<void>;
  private toolsChangedHandler?: (serverName: string, tools: McpTool[]) => void;

  constructor(config: McpConfig) {
    this.config = config;
  }

  /**
   * Register a callback invoked when a server reports tools/list_changed and
   * its tool list has been refetched (VCL-R3-014). The callback should
   * atomically replace the server's namespace in the runtime tool registry.
   */
  setToolsChangedHandler(handler: (serverName: string, tools: McpTool[]) => void): void {
    this.toolsChangedHandler = handler;
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startServers();
    return this.startPromise;
  }

  /** Max MCP servers starting in parallel (VCL-R3-020). */
  private static readonly START_CONCURRENCY = 4;

  private async startServers(): Promise<void> {
    const entries = Object.entries(this.config.mcpServers).filter(([, config]) => !config.disabled);
    const states = new Map<string, ServerState>();

    const startOne = async (name: string, config: McpServerConfig): Promise<void> => {
      const client = new McpStdioClient(config);
      const state: ServerState = { name, config, client, tools: [] };
      // Register the notification handler before start() so a list_changed
      // sent in response to `initialized` is not dropped (VCL-R3-014).
      client.onNotification((method) => {
        if (method === 'notifications/tools/list_changed') {
          void this.refreshServerTools(name);
        }
      });
      try {
        await client.start();
        state.tools = await client.listTools();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        try {
          await client.stop();
        } catch {
          // Ignore stop errors after a failed start.
        }
      }
      states.set(name, state);
    };

    // Start independent servers with bounded concurrency; results are then
    // registered in config order so tool discovery stays deterministic
    // (VCL-R3-020).
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const index = cursor++;
        if (index >= entries.length) return;
        const [name, config] = entries[index];
        await startOne(name, config);
      }
    };
    const concurrency = Math.max(1, Math.min(McpManager.START_CONCURRENCY, entries.length || 1));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    for (const [name] of entries) {
      const state = states.get(name);
      if (state) this.servers.push(state);
    }
  }

  /**
   * Refetch a server's tools after a tools/list_changed notification and
   * notify the runtime so it can atomically replace the namespace (VCL-R3-014).
   */
  private async refreshServerTools(name: string): Promise<void> {
    const state = this.servers.find((s) => s.name === name);
    if (!state || !state.client.isRunning()) return;
    try {
      state.tools = await state.client.listTools();
      this.toolsChangedHandler?.(name, state.tools);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.client.stop().catch(() => {})));
    this.servers.length = 0;
    this.startPromise = undefined;
  }

  getTools(): DiscoveredTool[] {
    const tools: DiscoveredTool[] = [];
    for (const server of this.servers) {
      for (const tool of server.tools) {
        tools.push({ serverName: server.name, tool });
      }
    }
    return tools;
  }

  getServerStates(): ServerState[] {
    return this.servers.map((s) => ({ ...s, client: s.client }));
  }
}

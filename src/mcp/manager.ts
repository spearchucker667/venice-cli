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

  constructor(config: McpConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startServers();
    return this.startPromise;
  }

  private async startServers(): Promise<void> {
    for (const [name, config] of Object.entries(this.config.mcpServers)) {
      if (config.disabled) continue;
      const client = new McpStdioClient(config);
      const state: ServerState = { name, config, client, tools: [] };
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
      this.servers.push(state);
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

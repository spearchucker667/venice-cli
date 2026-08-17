import { Command } from 'commander';
import * as fs from 'node:fs';
import type { McpConfig, McpServerConfig } from '../mcp/config.js';
import {
  loadMcpConfig,
  loadMcpConfigStrict,
  saveMcpConfig,
  getMcpConfigPath,
  getWorkspaceMcpConfigPath,
} from '../mcp/config.js';
import { McpManager } from '../mcp/manager.js';
import { McpStdioClient } from '../mcp/client.js';
import { isSupportedProtocolVersion } from '../mcp/protocol.js';
import {
  WorkspaceTrustStore,
  hashMcpConfigBytes,
  resolveProjectMcpTrust,
  defaultConfirmTrust,
  summarizeServers,
  fingerprintServerExecutables,
} from '../mcp/trust.js';
import { detectWorkspaceRoot } from '../agent/runtime.js';
import { formatError, getChalk } from '../lib/output.js';

function loadStrictForMutation(configPath: string): McpConfig {
  // Refuse to overwrite a malformed/symlinked config (VC-KIMI-038).
  try {
    return loadMcpConfigStrict(configPath);
  } catch (error) {
    console.error(formatError(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export function registerMcpCommand(program: Command, configPath = getMcpConfigPath()): void {
  const mcp = program.command('mcp').description('Manage MCP servers for the Venice agent');
  const c = getChalk();

  mcp
    .command('list')
    .description('List configured MCP servers and discovered tools')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const config = loadMcpConfig(configPath);
      const manager = new McpManager(config);
      await manager.start();
      try {
        const states = manager.getServerStates();
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                servers: states.map((s) => ({
                  name: s.name,
                  disabled: s.config.disabled,
                  tools: s.tools.map((t) => t.name),
                  error: s.error,
                })),
              },
              null,
              2
            )
          );
        } else {
          if (Object.keys(config.mcpServers).length === 0) {
            console.log('No MCP servers configured.');
            return;
          }
          for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
            const state = states.find((s) => s.name === name);
            const status = serverConfig.disabled
              ? 'disabled'
              : state?.error
                ? `error: ${state.error}`
                : `ok (${state?.tools.length ?? 0} tools)`;
            console.log(`${c.bold(name)}: ${status}`);
          }
        }
      } finally {
        await manager.stop();
      }
    });

  mcp
    .command('add <name>')
    .description('Add an MCP server to global config')
    .requiredOption('--command <command>', 'Server command')
    .option('--args <args...>', 'Command arguments')
    .action((name: string, options) => {
      const config = loadStrictForMutation(configPath);
      const server: McpServerConfig = { command: options.command };
      if (options.args) server.args = options.args;
      config.mcpServers[name] = server;
      saveMcpConfig(config, configPath);
      console.log(`Added MCP server '${name}'.`);
    });

  mcp
    .command('remove <name>')
    .description('Remove an MCP server from global config')
    .action((name: string) => {
      const config = loadStrictForMutation(configPath);
      if (!config.mcpServers[name]) {
        console.error(formatError(`Unknown MCP server: ${name}`));
        process.exit(1);
      }
      delete config.mcpServers[name];
      saveMcpConfig(config, configPath);
      console.log(`Removed MCP server '${name}'.`);
    });

  mcp
    .command('enable <name>')
    .description('Enable an MCP server')
    .action((name: string) => {
      const config = loadStrictForMutation(configPath);
      if (!config.mcpServers[name]) {
        console.error(formatError(`Unknown MCP server: ${name}`));
        process.exit(1);
      }
      config.mcpServers[name].disabled = false;
      saveMcpConfig(config, configPath);
      console.log(`Enabled MCP server '${name}'.`);
    });

  mcp
    .command('disable <name>')
    .description('Disable an MCP server')
    .action((name: string) => {
      const config = loadStrictForMutation(configPath);
      if (!config.mcpServers[name]) {
        console.error(formatError(`Unknown MCP server: ${name}`));
        process.exit(1);
      }
      config.mcpServers[name].disabled = true;
      saveMcpConfig(config, configPath);
      console.log(`Disabled MCP server '${name}'.`);
    });

  mcp
    .command('version <name>')
    .description('Probe an MCP server and report its negotiated protocol version and capabilities')
    .action(async (name: string) => {
      const config = loadStrictForMutation(configPath);
      const server = config.mcpServers[name];
      if (!server) {
        console.error(formatError(`Unknown MCP server: ${name}`));
        process.exit(1);
      }

      const client = new McpStdioClient(server);
      try {
        await client.start();
        const version = client.getNegotiatedProtocolVersion();
        console.log(
          JSON.stringify(
            {
              name,
              protocolVersion: version,
              supported: version ? isSupportedProtocolVersion(version) : false,
              capabilities: client.getServerCapabilities() ?? {},
            },
            null,
            2
          )
        );
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      } finally {
        await client.stop();
      }
    });

  mcp
    .command('trust')
    .description('Review and approve the project .venice/mcp.json for this workspace')
    .option('--status', 'Print trust status without prompting')
    .option('--revoke', 'Revoke trust for this workspace')
    .action(async (options) => {
      const workspaceRoot = detectWorkspaceRoot(process.cwd());
      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
      const store = new WorkspaceTrustStore();

      if (!fs.existsSync(configPath)) {
        console.log(`No project MCP config found at ${configPath}`);
        return;
      }

      const configHash = hashMcpConfigBytes(fs.readFileSync(configPath));
      const record = store.getRecord(workspaceRoot);
      const executables = fingerprintServerExecutables(
        summarizeServers(JSON.parse(fs.readFileSync(configPath, 'utf-8')) as McpConfig),
        workspaceRoot
      );
      const approved = store.isApproved(workspaceRoot, configHash, executables);

      if (options.revoke) {
        store.revoke(workspaceRoot);
        console.log(`Revoked MCP trust for ${workspaceRoot}.`);
        return;
      }

      if (options.status) {
        console.log(`Workspace: ${workspaceRoot}`);
        console.log(`Config:    ${configPath}`);
        if (approved) {
          console.log('Trust:     approved');
        } else if (record) {
          console.log('Trust:     config changed since last approval');
        } else {
          console.log('Trust:     not approved');
        }
        console.log(`Hash:      ${configHash.slice(0, 12)}…`);
        return;
      }

      if (approved) {
        console.log('Project MCP servers are already approved for this workspace.');
        return;
      }

      const result = await resolveProjectMcpTrust({
        workspaceRoot,
        configPath,
        interactive: true,
        store,
        confirm: defaultConfirmTrust,
        warn: (message) => console.error(message),
      });

      if (result.status === 'approved') {
        console.log(`Approved ${result.config ? Object.keys(result.config.mcpServers).length : 0} project MCP server(s).`);
      } else if (result.status === 'no-config') {
        console.log('No runnable project MCP servers to approve.');
      } else {
        console.log('Approval declined; project MCP servers will not be started.');
      }
    });

  mcp
    .command('inspect <name>')
    .description('Inspect an MCP server configuration')
    .action((name: string) => {
      const config = loadMcpConfig(configPath);
      const server = config.mcpServers[name];
      if (!server) {
        console.error(formatError(`Unknown MCP server: ${name}`));
        process.exit(1);
      }
      const masked = { ...server };
      if (masked.env) {
        masked.env = Object.fromEntries(Object.entries(masked.env).map(([k]) => [k, '***']));
      }
      console.log(JSON.stringify({ name, ...masked }, null, 2));
    });
}

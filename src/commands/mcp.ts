import { Command } from 'commander';
import type { McpServerConfig } from '../mcp/config.js';
import { loadMcpConfig, saveMcpConfig, getMcpConfigPath } from '../mcp/config.js';
import { McpManager } from '../mcp/manager.js';
import { formatError, getChalk } from '../lib/output.js';

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
      const config = loadMcpConfig(configPath);
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
      const config = loadMcpConfig(configPath);
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
      const config = loadMcpConfig(configPath);
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
      const config = loadMcpConfig(configPath);
      if (!config.mcpServers[name]) {
        console.error(formatError(`Unknown MCP server: ${name}`));
        process.exit(1);
      }
      config.mcpServers[name].disabled = true;
      saveMcpConfig(config, configPath);
      console.log(`Disabled MCP server '${name}'.`);
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

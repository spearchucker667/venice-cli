import { execSync } from 'node:child_process';
import assert from 'node:assert';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
}

console.log('Running completions parity check...');

try {
  // 1. Get list of top-level commands from help
  const helpOutput = run('node dist/index.js --help');
  const commandsMatch = helpOutput.match(/Commands:\s+([\s\S]+)$/);
  assert(commandsMatch, 'Could not find Commands section in --help output');
  
  const commandsSection = commandsMatch[1];
  const commandLines = commandsSection.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('-'));
  const commands = commandLines.map(l => l.split(' ')[0]).filter(c => c && c !== 'help');
  
  console.log('Detected top-level commands:', commands.join(', '));
  assert(commands.length > 5, 'Should have several commands detected');

  // 2. Generate bash completions
  const bashCompletions = run('node dist/index.js completions bash');
  
  // 3. Generate zsh completions
  const zshCompletions = run('node dist/index.js completions zsh');

  // 4. Generate fish completions
  const fishCompletions = run('node dist/index.js completions fish');

  // Verify each command is present in the completion scripts
  for (let cmd of commands) {
    if (cmd.includes('|')) cmd = cmd.split('|')[0];
    if (cmd === 'completions' || cmd === '__complete') continue;
    
    // Check bash (bash uses a space-separated string)
    assert(bashCompletions.includes(` ${cmd} `) || bashCompletions.includes(`"${cmd} `) || bashCompletions.includes(` ${cmd}"`), `Bash completion missing command: ${cmd}`);
    
    // Check zsh (zsh uses 'command' or 'command:description' format in the commands array)
    assert(zshCompletions.includes(`'${cmd}:`) || zshCompletions.includes(`"${cmd}:`) || zshCompletions.includes(`'${cmd}'`), `Zsh completion missing command: ${cmd}`);
    
    // Check fish
    assert(fishCompletions.includes(`-a ${cmd} `) || fishCompletions.includes(`-a "${cmd}"`) || fishCompletions.includes(`-a '${cmd}'`), `Fish completion missing command: ${cmd}`);
  }

  // 5. Verify subcommands of command groups are present too (wallet is the
  // newest group; extend this list as groups are added). This guards against
  // adding a subcommand without updating the static zsh/fish blocks — bash
  // derives its list dynamically from the program.
  const walletHelp = run('node dist/index.js wallet --help');
  const walletCommands = extractSubcommands(walletHelp);
  console.log('Detected wallet subcommands:', walletCommands.join(', '));
  assert(walletCommands.length > 0, 'Wallet should expose subcommands');
  for (const cmd of walletCommands) {
    // bash: wallet_cmds="..." is generated from the live program
    assert(bashCompletions.includes(`wallet_cmds="`) && bashCompletions.split('\n').some(l => l.startsWith('    local wallet_cmds=') && l.includes(cmd)), `Bash completion missing wallet subcommand: ${cmd}`);
    // zsh: 'name:description' entries inside the wallet _describe block
    assert(zshCompletions.includes(`'${cmd}:`), `Zsh completion missing wallet subcommand: ${cmd}`);
    // fish: -a <name> -d "..." lines
    assert(fishCompletions.includes(`-a ${cmd} `) || fishCompletions.includes(`-a ${cmd}\n`), `Fish completion missing wallet subcommand: ${cmd}`);
  }

  console.log('✅ Completions parity check passed successfully.');
} catch (e) {
  console.error('❌ Completions Parity Check Failed:', e.message);
  process.exit(1);
}

function extractSubcommands(helpOutput) {
  const commandsMatch = helpOutput.match(/Commands:\s+([\s\S]+)$/);
  if (!commandsMatch) return [];
  const section = commandsMatch[1];
  // Only lines that declare a command (`name [options]` or `name <arg>`) are
  // real subcommands; wrapped description continuation lines (e.g. "wallet"
  // after "Show the x402 ... for a") must be ignored.
  return section
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[A-Za-z0-9-]+(\s+\[|\s+<)/.test(l))
    .map(l => l.split(' ')[0])
    .filter(c => c && c !== 'help');
}

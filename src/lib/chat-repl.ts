import readline from 'node:readline';

export const REPL_PROMPT = 'you> ';

export function shouldEnterRepl(prompt: string, stdinIsTTY: boolean | undefined): boolean {
  return prompt.trim() === '' && stdinIsTTY === true;
}

export function isReplExitCommand(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized === 'exit' || normalized === 'quit';
}

export async function runChatRepl(options: {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  onTurn: (prompt: string) => Promise<void>;
  prompt?: string;
}): Promise<void> {
  const promptLabel = options.prompt ?? REPL_PROMPT;
  const input = options.input as NodeJS.ReadStream;
  const rl = readline.createInterface({
    input: options.input,
    output: options.output,
    terminal: Boolean(input.isTTY),
  });
  rl.setPrompt(promptLabel);

  let closed = false;
  const onSigint = () => {
    options.output.write('\n');
    closed = true;
    rl.close();
  };
  rl.on('SIGINT', onSigint);
  rl.on('close', () => {
    closed = true;
  });
  rl.prompt();

  try {
    for await (const answer of rl) {
      const line = answer.trim();
      if (!line) {
        rl.prompt();
        continue;
      }
      if (isReplExitCommand(line)) {
        break;
      }
      await options.onTurn(line);
      if (closed) {
        break;
      }
      rl.prompt();
    }
  } finally {
    rl.off('SIGINT', onSigint);
    rl.close();
  }
}

import { Command } from 'commander';
import { apiRequest } from '../lib/api.js';
import { formatOutput, getChalk } from '../lib/output.js';

async function readStdin(): Promise<string> {
  let result = '';
  for await (const chunk of process.stdin) {
    result += chunk;
  }
  return result.trim();
}

export function registerResponsesCommand(program: Command): void {
  const responsesCmd = program
    .command('responses')
    .description('Interact with the Venice Responses API (Alpha)');

  responsesCmd
    .command('create')
    .description('Create a response using the Responses API')
    .option('-m, --model <model>', 'Model to use')
    .option('-p, --prompt <prompt>', 'Prompt for the response (or use stdin)')
    .option('-s, --system <system>', 'System prompt')
    .option('--json', 'Output as raw JSON instead of text')
    .action(async (options) => {
      try {
        let prompt = options.prompt;
        if (!prompt && !process.stdin.isTTY) {
          prompt = await readStdin();
        }

        if (!prompt) {
          throw new Error('A prompt must be provided via --prompt or stdin.');
        }

        const body: Record<string, unknown> = {
          input: [{ type: 'message', role: 'user', content: prompt }],
        };

        if (options.system) {
          body.input = [
            { type: 'message', role: 'system', content: options.system },
            { type: 'message', role: 'user', content: prompt }
          ];
        }

        if (options.model) {
          body.model = options.model;
        }

        const response = await apiRequest<any>('/responses', {
          method: 'POST',
          body,
          spinnerText: 'Generating response...',
        });

        if (options.json) {
          console.log(formatOutput(response, 'json'));
        } else {
          // Fallback to text output assuming structure like { choices: [ { message: { content: ... } } ] }
          // or plain text string if the API returns just a string
          const content = response?.choices?.[0]?.message?.content || response?.content || JSON.stringify(response, null, 2);
          console.log(content);
        }
      } catch (error: any) {
        console.error(getChalk().red(`Error: ${error.message}`));
        process.exit(1);
      }
    });
}

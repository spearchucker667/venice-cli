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

interface ResponsesOutputText {
  type: 'output_text';
  text?: string;
  annotations?: Array<{ type?: string; url?: string; title?: string }>;
}

interface ResponsesOutputMessage {
  type: 'message';
  id?: string;
  status?: 'completed' | 'in_progress' | 'failed';
  role?: 'assistant';
  content?: ResponsesOutputText[];
}

interface ResponsesOutputReasoning {
  type: 'reasoning';
  id?: string;
  summary?: string[];
  encrypted_content?: string;
}

interface ResponsesApiResponse {
  id?: string;
  object?: 'response';
  created_at?: number;
  model?: string;
  status?: 'completed' | 'failed' | 'in_progress' | 'cancelled';
  output?: Array<ResponsesOutputMessage | ResponsesOutputReasoning>;
}

function extractResponseText(response: ResponsesApiResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join('');
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

        const response = await apiRequest<ResponsesApiResponse>('/responses', {
          method: 'POST',
          body,
          spinnerText: 'Generating response...',
        });

        if (response.status === 'failed') {
          throw new Error('The Responses API reported a failed response.');
        }

        if (options.json) {
          console.log(formatOutput(response, 'json'));
          return;
        }

        const text = extractResponseText(response);
        console.log(text || JSON.stringify(response, null, 2));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(getChalk().red(`Error: ${message}`));
        process.exit(1);
      }
    });
}

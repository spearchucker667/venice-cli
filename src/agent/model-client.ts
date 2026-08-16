/**
 * Venice model client for the agent runtime.
 *
 * Wraps the existing chat completion API and adapts agent messages to the
 * Venice API message format.
 */

import type { AgentMessage, TokenUsage } from './types.js';
import type { Message } from '../types/index.js';
import { chatCompletion, chatCompletionStream, listModels, type VeniceApiError } from '../lib/api.js';
import { getDefaultModel } from '../lib/config.js';

export interface ModelClientOptions {
  model?: string;
}

export interface ModelResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage?: TokenUsage;
  finishReason: string;
}

export interface StreamingDelta {
  content?: string;
  reasoningContent?: string;
  toolCalls?: unknown[];
  finishReason?: string;
  usage?: TokenUsage;
  done: boolean;
}

export class VeniceModelClient {
  constructor(private readonly options: ModelClientOptions = {}) {}

  async complete(messages: AgentMessage[]): Promise<ModelResponse> {
    const apiMessages = messages.map((m) => this.toApiMessage(m));
    const result = await chatCompletion(apiMessages, {
      model: this.options.model || getDefaultModel(),
    });

    return {
      content: result.content || '',
      toolCalls: result.tool_calls,
      usage: result.usage,
      finishReason: result.finish_reason,
    };
  }

  async *stream(messages: AgentMessage[]): AsyncGenerator<StreamingDelta> {
    const apiMessages = messages.map((m) => this.toApiMessage(m));
    for await (const delta of chatCompletionStream(apiMessages, {
      model: this.options.model || getDefaultModel(),
    })) {
      yield {
        content: delta.content,
        reasoningContent: delta.reasoning_content,
        toolCalls: delta.tool_calls,
        finishReason: delta.finish_reason,
        usage: delta.usage,
        done: delta.done,
      };
    }
  }

  async getModelContextLimit(modelId?: string): Promise<number> {
    const targetId = modelId || this.options.model || getDefaultModel();
    try {
      const models = await listModels({ showSpinner: false });
      const model = models.find((m) => m.id === targetId);
      if (model?.model_spec) {
        const spec = model.model_spec as Record<string, unknown>;
        if (typeof spec.context_size === 'number') {
          return spec.context_size;
        }
      }
    } catch {
      // fall back to heuristic/default
    }

    // Conservative heuristics based on common model naming.
    const lower = targetId.toLowerCase();
    if (lower.includes('128k') || lower.includes('kimi-k2-5') || lower.includes('kimi-k2.5')) return 128000;
    if (lower.includes('32k')) return 32000;
    if (lower.includes('8k')) return 8192;
    return 128000;
  }

  private toApiMessage(message: AgentMessage): Message {
    const base: Message = { role: message.role, content: message.content };
    if (message.tool_calls) (base as any).tool_calls = message.tool_calls;
    if (message.tool_call_id) base.tool_call_id = message.tool_call_id;
    return base;
  }
}

export { VeniceApiError };

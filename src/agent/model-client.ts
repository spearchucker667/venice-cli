/**
 * Venice model client for the agent runtime.
 *
 * Wraps the existing chat completion API and adapts agent messages to the
 * Venice API message format.
 */

import type { AgentMessage, TokenUsage } from './types.js';
import type { Message } from '../types/index.js';
import type { ToolDefinition } from '../types/index.js';
import { chatCompletionStream, type VeniceApiError } from '../lib/api.js';
import { getDefaultModel } from '../lib/config.js';
import { profileModel, type ModelProfile } from './model-profile.js';
import { ModelCatalog } from './model-catalog.js';

export interface ModelClientOptions {
  model?: string;
  /**
   * Injectable model source with caching. Defaults to the live Venice API;
   * tests inject a fake catalog so discovery runs offline (VCL-R3-027).
   */
  catalog?: ModelCatalog;
}

/**
 * Conservative context budget for a model whose capacity is unknown
 * (VCL-R3-028). The previous optimistic 128K default could exceed a smaller
 * model's real window; 32K is safe for the supported text models and keeps
 * compaction conservative when discovery is unavailable.
 */
export const UNKNOWN_CONTEXT_LIMIT = 32_000;

export interface ModelResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage?: TokenUsage;
  finishReason: string;
  /** True when the response was assembled from a streaming request (VCL-R3-012). */
  streamed?: boolean;
}

export interface StreamingDelta {
  content?: string;
  reasoningContent?: string;
  toolCalls?: unknown[];
  finishReason?: string;
  usage?: TokenUsage;
  done: boolean;
}

/** Incremental chunks surfaced to callers while a stream is in flight. */
export interface StreamChunk {
  content?: string;
  reasoningContent?: string;
}

export class VeniceModelClient {
  private readonly catalog: ModelCatalog;

  constructor(private readonly options: ModelClientOptions = {}) {
    this.catalog = options.catalog ?? new ModelCatalog();
  }

  setModel(model: string): void {
    this.options.model = model;
  }

  /**
   * Complete a turn by consuming the streaming endpoint (VCL-R3-012).
   *
   * Incremental content, reasoning, fragmented tool-call ids/names/arguments,
   * finish reason, and usage are accumulated into one canonical response.
   * `onDelta` (optional) receives each content/reasoning chunk as it arrives.
   */
  async complete(
    messages: AgentMessage[],
    tools: ToolDefinition[] = [],
    onDelta?: (chunk: StreamChunk) => void,
    options?: { reasoningEffort?: string }
  ): Promise<ModelResponse> {
    let content = '';
    let reasoningContent = '';
    let finishReason = 'stop';
    let usage: TokenUsage | undefined;
    let sawToolCalls = false;
    // OpenAI-style streaming tool-call deltas are keyed by index with
    // fragmented name/arguments strings that must be concatenated.
    const toolCalls = new Map<number, { id?: string; type?: string; name?: string; arguments?: string }>();

    for await (const delta of this.stream(messages, tools, options)) {
      if (delta.content) {
        content += delta.content;
        onDelta?.({ content: delta.content });
      }
      if (delta.reasoningContent) {
        reasoningContent += delta.reasoningContent;
        onDelta?.({ reasoningContent: delta.reasoningContent });
      }
      if (delta.toolCalls) {
        sawToolCalls = true;
        for (const raw of delta.toolCalls) {
          if (!raw || typeof raw !== 'object') continue;
          const tc = raw as { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };
          const index = typeof tc.index === 'number' ? tc.index : 0;
          const entry = toolCalls.get(index) ?? {};
          if (tc.id) entry.id = tc.id;
          if (tc.type) entry.type = tc.type;
          if (tc.function?.name) entry.name = (entry.name ?? '') + tc.function.name;
          if (tc.function?.arguments) entry.arguments = (entry.arguments ?? '') + tc.function.arguments;
          toolCalls.set(index, entry);
        }
      }
      if (delta.finishReason) finishReason = delta.finishReason;
      if (delta.usage) usage = delta.usage;
    }

    const assembledToolCalls: ModelResponse['toolCalls'] = sawToolCalls && toolCalls.size > 0
      ? Array.from(toolCalls.entries())
          .sort(([a], [b]) => a - b)
          .map(([, value]) => ({
            id: value.id || `call_${Math.random().toString(36).slice(2, 10)}`,
            type: 'function',
            function: { name: value.name || '', arguments: value.arguments || '{}' },
          }))
      : undefined;

    return {
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      toolCalls: assembledToolCalls,
      usage,
      finishReason,
      streamed: true,
    };
  }

  async *stream(messages: AgentMessage[], tools: ToolDefinition[] = [], options?: { reasoningEffort?: string }): AsyncGenerator<StreamingDelta> {
    const apiMessages = messages.map((m) => this.toApiMessage(m));
    for await (const delta of chatCompletionStream(apiMessages, {
      model: this.options.model || getDefaultModel(),
      tools,
      tool_choice: tools.length ? 'auto' : 'none',
      showSpinner: false,
      reasoning_effort: options?.reasoningEffort as any,
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
      const model = await this.catalog.find(targetId);
      if (model?.model_spec) {
        if (typeof model.model_spec.availableContextTokens === 'number') {
          return model.model_spec.availableContextTokens;
        }
      }
    } catch {
      // fall back to heuristic/default
    }

    // Deterministic heuristics based on common model naming; anything else is
    // explicitly UNKNOWN and gets a conservative budget (VCL-R3-028).
    const lower = targetId.toLowerCase();
    if (lower.includes('128k') || lower.includes('kimi-k2-5') || lower.includes('kimi-k2.5')) return 128000;
    if (lower.includes('32k')) return 32000;
    if (lower.includes('8k')) return 8192;
    return UNKNOWN_CONTEXT_LIMIT;
  }

  async getModelProfile(modelId?: string): Promise<ModelProfile | undefined> {
    const targetId = modelId || this.options.model || getDefaultModel();
    const model = await this.catalog.find(targetId);
    return model ? profileModel(model) : undefined;
  }

  private toApiMessage(message: AgentMessage): Message {
    const base: Message = { role: message.role, content: message.content };
    if (message.tool_calls) (base as any).tool_calls = message.tool_calls;
    if (message.tool_call_id) base.tool_call_id = message.tool_call_id;
    return base;
  }
}

export { VeniceApiError };

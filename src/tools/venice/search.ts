/**
 * Venice-native search and scrape tools for the agent runtime.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { dedicatedWebSearch, scrapeWebPage } from '../../lib/api.js';

export const webSearchTool: AgentTool<{ query: string; limit?: number; provider?: 'brave' | 'google' }, { query: string; results: Array<{ title: string; url: string; content: string; date: string }> }> = {
  name: 'web_search',
  description: 'Search the web using the Venice dedicated search API.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' },
      provider: { type: 'string', enum: ['brave', 'google'] },
    },
    required: ['query'],
  },
  risk: 'network',
  async execute(input, _context) {
    try {
      const result = await dedicatedWebSearch(input.query, {
        limit: input.limit,
        provider: input.provider,
      });
      return success(result);
    } catch (error) {
      return failure('WEB_SEARCH_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const webScrapeTool: AgentTool<{ url: string }, { url: string; content: string; format: string }> = {
  name: 'web_scrape',
  description: 'Scrape a public web page to Markdown using the Venice scrape API.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
    },
    required: ['url'],
  },
  risk: 'network',
  async execute(input, _context) {
    try {
      const result = await scrapeWebPage(input.url);
      return success(result, { truncated: result.content.length > 50000 });
    } catch (error) {
      return failure('WEB_SCRAPE_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

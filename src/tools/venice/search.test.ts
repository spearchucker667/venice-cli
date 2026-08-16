import { describe, it } from 'node:test';
import assert from 'node:assert';
import { webSearchTool, webScrapeTool } from './search.js';

describe('Venice search tools', () => {
  it('web_search has correct schema and risk', () => {
    assert.strictEqual(webSearchTool.name, 'web_search');
    assert.strictEqual(webSearchTool.risk, 'network');
    assert.ok(webSearchTool.inputSchema.required?.includes('query'));
  });

  it('web_scrape has correct schema and risk', () => {
    assert.strictEqual(webScrapeTool.name, 'web_scrape');
    assert.strictEqual(webScrapeTool.risk, 'network');
    assert.ok(webScrapeTool.inputSchema.required?.includes('url'));
  });
});

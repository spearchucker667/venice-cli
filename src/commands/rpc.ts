/**
 * RPC Command - Proxy JSON-RPC requests to blockchain nodes
 */

import { Command } from 'commander';
import * as fs from 'fs';
import {
  cryptoRpc,
  listCryptoNetworks,
  type CryptoRpcResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../lib/api.js';
import {
  formatError,
  getChalk,
  detectOutputFormat,
} from '../lib/output.js';
import type { OutputFormat } from '../types/index.js';

export const MAX_RPC_BATCH = 100;

export function registerRpcCommand(program: Command): void {
  program
    .command('rpc [network] [method] [params...]')
    .description('Proxy JSON-RPC requests to blockchain nodes')
    .option('--batch <file>', 'JSON array of JSON-RPC requests (max 100)')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .addHelpText(
      'after',
      `
Examples:
  $ venice rpc networks
  $ venice rpc ethereum-mainnet eth_blockNumber
  $ venice rpc base-mainnet eth_getBalance 0x... latest
  $ venice rpc ethereum-mainnet --batch reqs.json`
    )
    .action(async (network: string | undefined, method: string | undefined, params: string[], options) => {
      const format = detectOutputFormat(options.format);

      try {
        if (!network || network === 'networks') {
          if (options.batch) {
            console.error(formatError('Network is required for --batch. Usage: venice rpc <network> --batch <file>'));
            process.exit(1);
          }
          await printNetworks(format);
          return;
        }

        if (options.batch && method) {
          console.error(formatError('Use either a method or --batch, not both.'));
          process.exit(1);
        }

        let body: JsonRpcRequest | JsonRpcRequest[];

        if (options.batch) {
          body = readBatchFile(options.batch);
        } else if (!method) {
          console.error(formatError('Missing JSON-RPC method.'));
          console.error('Usage: venice rpc <network> <method> [params...]');
          console.error('       venice rpc <network> --batch <file>');
          console.error('       venice rpc networks');
          process.exit(1);
        } else {
          body = buildJsonRpcRequest(method, params);
        }

        const result = await cryptoRpc(network, body);
        printRpcResult(result, format);

        if (jsonRpcHasError(result.body)) {
          process.exit(1);
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}

async function printNetworks(format: OutputFormat): Promise<void> {
  const networks = await listCryptoNetworks();
  const c = getChalk();

  if (format === 'json') {
    console.log(JSON.stringify({ networks }, null, 2));
    return;
  }

  if (format === 'raw') {
    console.log(networks.join('\n'));
    return;
  }

  if (networks.length === 0) {
    console.log(c.yellow('No RPC networks returned.'));
    return;
  }

  console.log(c.bold(`\nSupported RPC networks (${networks.length})\n`));
  for (const slug of networks) {
    console.log(`  ${c.cyan(slug)}`);
  }
}

export function parseRpcParam(token: string): unknown {
  const trimmed = token.trim();
  if (!looksLikeJson(trimmed)) {
    return token;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`Invalid JSON parameter: ${token}`);
  }

  if (
    typeof parsed === 'number' &&
    (!Number.isFinite(parsed) || (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)))
  ) {
    throw new Error(
      `Unsafe numeric parameter: ${token}. Use a quoted string or chain-native hex quantity.`
    );
  }
  return parsed;
}

function looksLikeJson(token: string): boolean {
  if (
    token.startsWith('{') ||
    token.startsWith('[') ||
    token.startsWith('"') ||
    token === 'true' ||
    token === 'false' ||
    token === 'null'
  ) {
    return true;
  }

  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token);
}

export function buildJsonRpcRequest(method: string, params: string[] = []): JsonRpcRequest {
  validateRpcMethod(method);
  return {
    jsonrpc: '2.0',
    method,
    params: params.map(parseRpcParam),
    id: 1,
  };
}

export function readBatchFile(filePath: string): JsonRpcRequest[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Batch file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    throw new Error(`Batch file is not valid JSON: ${filePath}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Batch file must contain a JSON array of JSON-RPC requests');
  }

  if (parsed.length === 0) {
    throw new Error('Batch file is empty');
  }

  if (parsed.length > MAX_RPC_BATCH) {
    throw new Error(`Batch requests are limited to ${MAX_RPC_BATCH} items (got ${parsed.length})`);
  }

  for (const [index, item] of parsed.entries()) {
    validateBatchItem(item, index);
  }

  return parsed as JsonRpcRequest[];
}

function validateRpcMethod(method: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(method)) {
    throw new Error(`Invalid JSON-RPC method: ${method}`);
  }
}

function validateBatchItem(item: unknown, index: number): void {
  const label = `Batch item ${index + 1}`;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`${label} must be a JSON-RPC object`);
  }

  const request = item as Partial<JsonRpcRequest>;
  if (request.jsonrpc !== '2.0') {
    throw new Error(`${label} must set jsonrpc to "2.0"`);
  }
  if (typeof request.method !== 'string' || !request.method) {
    throw new Error(`${label} is missing a method`);
  }
  validateRpcMethod(request.method);
  if (
    typeof request.id !== 'string' &&
    (typeof request.id !== 'number' || !Number.isSafeInteger(request.id))
  ) {
    throw new Error(`${label} must have a string or safe-integer id`);
  }
  if (
    request.params !== undefined &&
    (!request.params || typeof request.params !== 'object')
  ) {
    throw new Error(`${label} params must be an array or object`);
  }
}

export function jsonRpcHasError(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(isRpcErrorItem);
  }
  return isRpcErrorItem(body);
}

function isRpcErrorItem(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }
  const error = (item as JsonRpcResponse).error;
  return Boolean(error && typeof error === 'object');
}

function printRpcResult(result: CryptoRpcResult, format: OutputFormat): void {
  const c = getChalk();
  const body = result.body;

  if (format === 'json') {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  if (format === 'raw') {
    console.log(JSON.stringify(body));
    return;
  }

  const items = Array.isArray(body) ? body : [body];
  const multiple = Array.isArray(body);

  for (const [index, item] of items.entries()) {
    const label = multiple ? `${c.dim(`[${item.id ?? index + 1}]`)} ` : '';
    if (item.error) {
      const code = item.error.code != null ? ` (${item.error.code})` : '';
      console.error(`${label}${c.red('error:')} ${item.error.message || 'RPC error'}${code}`);
      if (item.error.data !== undefined) {
        console.error(c.dim(JSON.stringify(item.error.data, null, 2)));
      }
      continue;
    }

    const value = item.result;
    if (value === undefined) {
      console.log(`${label}${JSON.stringify(item, null, 2)}`);
    } else if (value !== null && typeof value === 'object') {
      const json = JSON.stringify(value, null, 2);
      console.log(multiple ? `${label}\n${json}` : json);
    } else {
      console.log(`${label}${String(value)}`);
    }
  }

  const costParts: string[] = [];
  if (result.credits) {
    costParts.push(`${c.dim('Credits:')} ${result.credits}`);
  }
  if (result.costUsd) {
    costParts.push(`${c.dim('Cost:')} $${result.costUsd}`);
  }
  if (costParts.length > 0) {
    console.log(`\n${costParts.join('  ')}`);
  }
}

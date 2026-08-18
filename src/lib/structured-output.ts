/**
 * Structured output helpers for chat completions.
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';

export const MAX_SCHEMA_FILE_BYTES = 1024 * 1024;
const MAX_RESPONSE_FORMAT_NAME_LENGTH = 64;
const RESPONSE_FORMAT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const PROMPT_CACHE_RETENTIONS = ['default', 'extended', '24h'] as const;
export type PromptCacheRetention = (typeof PROMPT_CACHE_RETENTIONS)[number];

export interface JsonSchemaWrapper {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

export interface ResponseFormat {
  type: 'json_schema' | 'json_object' | 'text';
  json_schema?: JsonSchemaWrapper;
}

export const JSON_OBJECT_RESPONSE_FORMAT: ResponseFormat = { type: 'json_object' };

export function resolveResponseFormat(options: {
  json?: boolean;
  jsonSchema?: string;
}): ResponseFormat | undefined {
  if (options.json && options.jsonSchema) {
    throw new Error('Cannot combine --json and --json-schema');
  }
  if (options.jsonSchema) {
    return loadResponseFormat(options.jsonSchema);
  }
  if (options.json) {
    return JSON_OBJECT_RESPONSE_FORMAT;
  }
  return undefined;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function isPromptCacheRetention(value: string): value is PromptCacheRetention {
  return (PROMPT_CACHE_RETENTIONS as readonly string[]).includes(value);
}

export function loadResponseFormat(filePath: string): ResponseFormat {
  const resolved = resolve(filePath);
  let descriptor: number;
  try {
    descriptor = openSync(resolved, 'r');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`JSON schema file not found: ${filePath}`);
    }
    throw new Error(`Unable to open JSON schema file "${filePath}": ${errorMessage(error)}`);
  }

  let raw: string;
  try {
    const initialSize = fstatSync(descriptor).size;
    if (initialSize > MAX_SCHEMA_FILE_BYTES) {
      throw schemaSizeError(filePath);
    }

    // The fixed-size buffer and MAX+1 read limit enforce the cap even if the
    // file grows after fstatSync. No race can cause an unbounded allocation.
    const buffer = Buffer.allocUnsafe(MAX_SCHEMA_FILE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead <= MAX_SCHEMA_FILE_BYTES) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        MAX_SCHEMA_FILE_BYTES + 1 - bytesRead,
        null
      );
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_SCHEMA_FILE_BYTES) {
      throw schemaSizeError(filePath);
    }
    raw = buffer.toString('utf8', 0, bytesRead);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('JSON schema file exceeds')) {
      throw error;
    }
    throw new Error(`Unable to read JSON schema file "${filePath}": ${errorMessage(error)}`);
  } finally {
    closeSync(descriptor);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in schema file "${filePath}": ${errorMessage(error)}`);
  }

  return normalizeResponseFormat(parsed, filePath);
}

export function normalizeResponseFormat(parsed: unknown, source = 'schema'): ResponseFormat {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`JSON schema in "${source}" must be an object`);
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.type === 'json_object') {
    return { type: 'json_object' };
  }

  if (obj.type === 'json_schema' && obj.json_schema && typeof obj.json_schema === 'object') {
    if (Array.isArray(obj.json_schema)) {
      throw new Error(`JSON schema wrapper in "${source}" must be an object`);
    }
    return {
      type: 'json_schema',
      json_schema: normalizeJsonSchemaWrapper(obj.json_schema as Record<string, unknown>, source),
    };
  }

  if (obj.schema && typeof obj.schema === 'object' && !Array.isArray(obj.schema)) {
    return {
      type: 'json_schema',
      json_schema: normalizeJsonSchemaWrapper(obj, source),
    };
  }

  // Any remaining object is a raw JSON Schema. Compilation is the authority:
  // valid schemas using enum/const/$ref/composition do not need a top-level type.
  compileSchema(obj, source);
  return {
    type: 'json_schema',
    json_schema: {
      name: 'response',
      strict: true,
      schema: obj,
    },
  };
}

function normalizeJsonSchemaWrapper(
  wrapper: Record<string, unknown>,
  source: string
): JsonSchemaWrapper {
  const schema = wrapper.schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`JSON schema wrapper in "${source}" is missing a schema object`);
  }

  let name = 'response';
  if (wrapper.name !== undefined) {
    if (typeof wrapper.name !== 'string' || !wrapper.name.trim()) {
      throw new Error(`JSON schema name in "${source}" must be a non-empty string`);
    }
    name = wrapper.name.trim();
  }
  if (
    name.length > MAX_RESPONSE_FORMAT_NAME_LENGTH ||
    !RESPONSE_FORMAT_NAME_PATTERN.test(name)
  ) {
    throw new Error(
      `JSON schema name in "${source}" must be 1-${MAX_RESPONSE_FORMAT_NAME_LENGTH} characters using only letters, numbers, "_" or "-"`
    );
  }
  if (wrapper.strict !== undefined && typeof wrapper.strict !== 'boolean') {
    throw new Error(`JSON schema strict setting in "${source}" must be a boolean`);
  }

  compileSchema(schema as Record<string, unknown>, source);

  return {
    name,
    strict: wrapper.strict === false ? false : true,
    schema: schema as Record<string, unknown>,
  };
}

export function parseStructuredContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Model returned an empty response; expected JSON.');
  }

  // The normal structured-output path should already be exact JSON. Parse it
  // first so JSON strings/arrays/scalars remain supported without heuristics.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to recovery for models that wrap JSON in prose/fences.
  }

  // Preserve support for fenced scalar JSON while using the *last* fence as
  // the closing marker. A non-greedy regex incorrectly treats ``` embedded in
  // a JSON string as the end of the block.
  const fenced = extractFencedCandidate(trimmed);
  if (fenced !== undefined) {
    try {
      return JSON.parse(fenced);
    } catch {
      // A malformed/unclosed fence may still contain a complete object/array;
      // the balanced scanner below can recover it safely.
    }
  }

  const balanced = extractBalancedJsonValue(trimmed);
  if (balanced !== undefined) {
    return balanced;
  }

  throw new Error('Model response was not valid JSON: no complete JSON value could be extracted.');
}

/**
 * Extract the body of the first Markdown code fence, preferring the final
 * triple-backtick sequence as its close. This avoids terminating on backticks
 * embedded inside a JSON string and still permits an unclosed fence when the
 * remaining body itself is valid JSON.
 */
function extractFencedCandidate(text: string): string | undefined {
  const opening = /```(?:json)?\s*/i.exec(text);
  if (!opening || opening.index === undefined) return undefined;

  const bodyStart = opening.index + opening[0].length;
  const remainder = text.slice(bodyStart);
  const closing = remainder.lastIndexOf('```');
  const body = closing >= 0 ? remainder.slice(0, closing) : remainder;
  const candidate = body.trim();
  return candidate || undefined;
}

/**
 * Find the first complete JSON object/array in arbitrary surrounding text.
 * Delimiters inside quoted JSON strings are ignored, including escaped quotes
 * and backslashes. Each balanced candidate is parsed before it is accepted so
 * prose such as "use {braces}" cannot be mistaken for structured output.
 */
function extractBalancedJsonValue(text: string): unknown | undefined {
  for (let start = 0; start < text.length; start++) {
    const first = text[start];
    if (first !== '{' && first !== '[') continue;

    const candidate = balancedJsonCandidate(text, start);
    if (candidate === undefined) continue;

    try {
      return JSON.parse(candidate);
    } catch {
      // This balanced region was not JSON; continue scanning for a later one.
    }
  }
  return undefined;
}

function balancedJsonCandidate(text: string, start: number): string | undefined {
  const stack: Array<'}' | ']'> = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }
    if (char === '[') {
      stack.push(']');
      continue;
    }
    if (char === '}' || char === ']') {
      if (stack.length === 0 || stack[stack.length - 1] !== char) {
        return undefined;
      }
      stack.pop();
      if (stack.length === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>
): string[] {
  const validate = compileSchema(schema, 'response schema');
  return validate(value) ? [] : formatValidationErrors(validate.errors);
}

function compileSchema(
  schema: Record<string, unknown>,
  source: string
): ValidateFunction {
  const schemaUri = typeof schema.$schema === 'string' ? schema.$schema : '';
  const options = {
    allErrors: true,
    strict: true,
    validateSchema: true,
    allowUnionTypes: true,
  } as const;
  const ajv = schemaUri.includes('2020-12')
    ? new Ajv2020(options)
    : schemaUri.includes('2019-09')
      ? new Ajv2019(options)
      : new Ajv(options);
  const addFormats = formatsModule.default as unknown as
    (instance: typeof ajv) => typeof ajv;
  addFormats(ajv);

  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new Error(`Invalid or unsupported JSON schema in "${source}": ${errorMessage(error)}`);
  }
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath ? `$${error.instancePath}` : '$';
    if (error.keyword === 'required') {
      return `${path}: missing required property "${String(error.params.missingProperty)}"`;
    }
    if (error.keyword === 'additionalProperties') {
      return `${path}: unexpected property "${String(error.params.additionalProperty)}"`;
    }
    return `${path}: ${error.message ?? `failed ${error.keyword} validation`}`;
  });
}

function schemaSizeError(filePath: string): Error {
  return new Error(
    `JSON schema file exceeds the ${MAX_SCHEMA_FILE_BYTES}-byte (1 MiB) limit: ${filePath}`
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

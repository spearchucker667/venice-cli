/**
 * Structured output helpers for chat completions.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  if (!existsSync(resolved)) {
    throw new Error(`JSON schema file not found: ${filePath}`);
  }

  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf-8');
  } catch {
    throw new Error(`Unable to read JSON schema file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in schema file "${filePath}": ${reason}`);
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

  if (obj.type === 'object' || obj.properties || obj.$schema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: obj,
      },
    };
  }

  throw new Error(
    `Unrecognized JSON schema in "${source}". Provide a JSON Schema object, a { name, schema } wrapper, or a response_format object.`
  );
}

function normalizeJsonSchemaWrapper(
  wrapper: Record<string, unknown>,
  source: string
): JsonSchemaWrapper {
  const schema = wrapper.schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`JSON schema wrapper in "${source}" is missing a schema object`);
  }

  const name = typeof wrapper.name === 'string' && wrapper.name.trim()
    ? wrapper.name
    : 'response';

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

  const extracted = extractJson(trimmed);
  try {
    return JSON.parse(extracted);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Model response was not valid JSON: ${reason}`);
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text;
}

export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$'
): string[] {
  const errors: string[] = [];
  const types = normalizeTypes(schema.type);

  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path}: expected ${types.join(' | ')}, got ${describeType(value)}`);
    return errors;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = isSchemaMap(schema.properties) ? schema.properties : undefined;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [];

    for (const key of required) {
      if (!(key in obj) || obj[key] === undefined) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }

    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj && obj[key] !== undefined) {
          errors.push(...validateAgainstSchema(obj[key], propSchema, `${path}.${key}`));
        }
      }
    }
  }

  if (Array.isArray(value) && isSchemaObject(schema.items)) {
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
    });
  }

  return errors;
}

function isSchemaMap(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => isSchemaObject(entry));
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTypes(type: unknown): string[] {
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

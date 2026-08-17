/**
 * Tool argument schema validation (VCL-R3-005).
 *
 * Tool `inputSchema`s are compiled to AJV validators once per registration and
 * enforced before risk classification, permission matching, and execution.
 *
 * Remote `$ref` loading is deliberately disabled: tool schemas come from the
 * model (built-in) or from MCP servers (untrusted), and neither may pull
 * external schemas over the network. A schema that references an external
 * URI fails compilation instead of fetching.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import * as formatsModule from 'ajv-formats';

export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** Compile a tool schema, rejecting remote `$ref` loading and invalid schemas. */
export function compileToolSchema(schema: ToolSchema): ValidateFunction {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateSchema: true,
    allowUnionTypes: true,
    // Never fetch external schemas referenced via $ref.
    loadSchema: async () => {
      throw new Error('Remote $ref loading is not allowed in tool schemas');
    },
  });
  const addFormats = formatsModule.default as unknown as
    (instance: typeof ajv) => typeof ajv;
  addFormats(ajv);
  return ajv.compile(schema);
}

/** Format AJV errors into concise, model/UI-friendly messages. */
export function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string[] {
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

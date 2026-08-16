/**
 * MCP protocol version policy (VC-KIMI-041).
 *
 * The client advertises the latest version it supports during `initialize`;
 * the server responds with the version it will use. That response is
 * validated against the supported set so an unknown server version fails
 * loudly rather than being silently accepted.
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  MCP_PROTOCOL_VERSION,
];

export function isSupportedProtocolVersion(version: string): boolean {
  return MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

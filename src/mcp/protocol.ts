/**
 * MCP protocol version policy (VC-KIMI-041).
 *
 * The client advertises the latest version it supports during `initialize`;
 * the server responds with the version it will use. That response is
 * validated against the supported set so an unknown server version fails
 * loudly rather than being silently accepted.
 */

// The client advertises the latest revision it supports (VCL-R3-019). Servers
// may negotiate down to an older revision that is still in the supported set.
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-06-18',
  '2024-11-05',
];

export function isSupportedProtocolVersion(version: string): boolean {
  return MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

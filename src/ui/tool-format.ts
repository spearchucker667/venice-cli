interface ToolResultLike {
  ok?: boolean;
  data?: unknown;
  error?: { message?: string };
  metadata?: { affectedFiles?: string[]; truncated?: boolean };
}

export function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input); } catch { return input; }
}

export function toolActivity(toolName: string, input: unknown): string {
  const value = asRecord(parseToolInput(input));
  switch (toolName) {
    case 'read_file': return `Reading ${text(value.path, 'file')}`;
    case 'read_many_files': return 'Reading files';
    case 'list_directory': return `Listing ${text(value.path, 'workspace')}`;
    case 'glob': return `Finding ${quoted(value.pattern, 'files')}`;
    case 'grep': return `Searching ${quoted(value.pattern, 'workspace')}`;
    case 'find': return `Finding ${quoted(value.name, 'files')}`;
    case 'write_file': return `Writing ${text(value.path, 'file')}`;
    case 'edit_file': return `Editing ${text(value.path, 'file')}`;
    case 'apply_patch': return 'Applying patch';
    case 'shell': return `Running ${text(value.command, 'command')}`;
    case 'git_status': return 'Inspecting Git status';
    case 'git_diff': return 'Inspecting Git diff';
    case 'git_log': return 'Reading Git history';
    case 'web_search': return `Searching the web for ${quoted(value.query, 'query')}`;
    case 'web_scrape': return `Reading ${text(value.url, 'web page')}`;
    case 'generate_image': return 'Generating image';
    case 'edit_image': return 'Editing image';
    case 'upscale_image': return 'Upscaling image';
    case 'remove_background': return 'Removing image background';
    case 'generate_video': return 'Generating video';
    case 'image_to_video': return 'Generating video from image';
    case 'transcribe_audio': return 'Transcribing audio';
    case 'text_to_speech': return 'Generating speech';
    case 'generate_music': return 'Generating music';
    case 'spawn_agent': return `Starting ${text(value.kind, 'general')} subagent`;
    default: return humanize(toolName);
  }
}

export function toolResultSummary(toolName: string, result: ToolResultLike): string {
  if (!result.ok) return compactError(result.error?.message, 1)[0];
  const data = result.data;
  const value = asRecord(data);
  if (toolName === 'shell') {
    const exitCode = typeof value.exitCode === 'number' ? value.exitCode : undefined;
    const output = [value.stdout, value.stderr].filter((entry): entry is string => typeof entry === 'string').join('\n');
    return [exitCode === undefined ? 'complete' : `exit ${exitCode}`, summarizeTests(output)].filter(Boolean).join(' · ');
  }
  if (Array.isArray(data)) return `${data.length} ${data.length === 1 ? 'result' : 'results'}`;
  if (typeof data === 'string') {
    const lines = data ? data.split(/\r?\n/).length : 0;
    return lines ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : 'complete';
  }
  const affected = result.metadata?.affectedFiles?.length ?? 0;
  if (affected) return `${affected} ${affected === 1 ? 'file' : 'files'} changed`;
  if (typeof value.replacements === 'number') return `${value.replacements} replacements`;
  return result.metadata?.truncated ? 'complete · output truncated' : 'complete';
}

export function compactError(error: string | undefined, maxLines = 3, maxWidth = 160): string[] {
  if (!error) return ['failed'];
  return error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, maxLines)
    .map((line) => line.length > maxWidth ? `${line.slice(0, maxWidth - 1)}…` : line);
}

function summarizeTests(output: string): string | undefined {
  const pass = output.match(/# pass\s+(\d+)/i)?.[1] || output.match(/(\d+)\s+passed/i)?.[1];
  const fail = output.match(/# fail\s+(\d+)/i)?.[1] || output.match(/(\d+)\s+failed/i)?.[1];
  return pass || fail ? `${pass || '0'} passed · ${fail || '0'} failed` : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback: string): string { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
function quoted(value: unknown, fallback: string): string { return typeof value === 'string' && value.trim() ? `"${value.trim()}"` : fallback; }
function humanize(value: string): string { const label = value.replaceAll('_', ' '); return label.charAt(0).toUpperCase() + label.slice(1); }

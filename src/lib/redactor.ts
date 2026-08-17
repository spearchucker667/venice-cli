import { loadConfig } from './config.js';

export class SecretRedactor {
  private patterns: RegExp[] = [
    // Standard basic redaction patterns for API keys, tokens, and secrets
    /([a-zA-Z0-9_]{0,10}api[_-]?key)['":=\s]+([a-zA-Z0-9_\-\.]{15,})/gi,
    /(authorization|bearer)['":=\s]+([a-zA-Z0-9_\-\.]{15,})/gi,
    /([a-zA-Z0-9_]{0,10}token)['":=\s]+([a-zA-Z0-9_\-\.]{15,})/gi,
    /([a-zA-Z0-9_]{0,10}secret)['":=\s]+([a-zA-Z0-9_\-\.]{15,})/gi,
    /(password)['":=\s]+([^\s"']{8,})/gi,
    /(private[_-]?key)['":=\s]+([^\s"']{15,})/gi,
    /(cookie)['":=\s]+([^\s"']{15,})/gi,
  ];

  constructor(private knownSecrets: string[] = []) {}

  public redact<T>(input: T): T {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      let redactedStr = input as string;
      // Mask explicitly known secrets first
      for (const secret of this.knownSecrets) {
        if (secret && secret.length > 5) {
          // simple replacement, case sensitive
          redactedStr = redactedStr.split(secret).join('***REDACTED***');
        }
      }

      // Mask generic patterns
      for (const pattern of this.patterns) {
        redactedStr = redactedStr.replace(pattern, (_match, p1) => {
          return `${p1}="***REDACTED***"`;
        });
      }

      return redactedStr as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.redact(item)) as unknown as T;
    }

    if (typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (/api[_-]?key|token|secret|password|private[_-]?key/i.test(key) && typeof value === 'string') {
          result[key] = '***REDACTED***';
        } else {
          result[key] = this.redact(value);
        }
      }
      return result as unknown as T;
    }

    return input;
  }
}

export function collectKnownSecrets(): string[] {
  const secrets: string[] = [];
  if (process.env.VENICE_API_KEY) secrets.push(process.env.VENICE_API_KEY);
  if (process.env.GITHUB_TOKEN) secrets.push(process.env.GITHUB_TOKEN);
  if (process.env.NPM_TOKEN) secrets.push(process.env.NPM_TOKEN);
  
  try {
    const config = loadConfig();
    if (config.api_key) secrets.push(config.api_key);
  } catch {
    // Ignore config loading errors to prevent breaking redactor
  }
  
  return secrets.filter(Boolean);
}

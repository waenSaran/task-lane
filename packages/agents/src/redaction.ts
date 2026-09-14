const REDACTED = '[REDACTED]';

const BUILTIN_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[^\s]+/gi,
  /(Authorization\s*:\s*)[^\r\n]+/gi,
  /\b((?:api[_-]?key|token|password|secret)\s*[:=]\s*)([^\s,;]+)/gi,
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET)[A-Z0-9_]*\s*=\s*)([^\s]+)/g,
];

export function redactSecrets(input: string, literalSecrets: readonly string[] = []): string {
  let output = input;
  for (const pattern of BUILTIN_PATTERNS) {
    output = output.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === 'string' && prefix.length > 0) return `${prefix}${REDACTED}`;
      if (/^Bearer\s+/i.test(match)) return `Bearer ${REDACTED}`;
      return REDACTED;
    });
  }
  for (const secret of literalSecrets) {
    if (!secret) continue;
    output = output.split(secret).join(REDACTED);
  }
  return output;
}

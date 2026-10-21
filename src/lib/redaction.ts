const sensitiveField = /^(api[-_]?key|authorization|proxy[-_]?authorization|cookie|set-cookie|password|passwd|secret|access[-_]?token|refresh[-_]?token|credential)$/i;
export function redact(value: unknown, secrets: Iterable<string> = [], maxString = 40000, limits: {depth?:number;entries?:number} = {}): unknown {
  const known = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  const seen = new WeakSet<object>();
  function string(text: string) {
    for (const secret of known) text = text.split(secret).join('[redacted]');
    text = text.replace(/\bBearer\s+[^\s"',;<>]+/gi, 'Bearer [redacted]')
      .replace(/\b(sk-[\w-]{8,})\b/g, '[redacted]')
      .replace(/((?:api[-_]?key|authorization|password|secret|access[-_]?token)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]');
    return text.length > maxString ? text.slice(0, maxString) + '\n[truncated]' : text;
  }
  function visit(input: unknown, depth: number): unknown {
    if (typeof input === 'string') return string(input);
    if (typeof input === 'bigint') return input.toString();
    if (input === null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (input === undefined) return null;
    if (typeof input !== 'object') return string(String(input));
    if (seen.has(input)) return '[circular]';
    if (depth > (limits.depth ?? 10)) return '[nested data omitted]';
    seen.add(input);
    if (input instanceof Error) return { name: input.name, message: string(input.message), stack: string(input.stack || '') };
    if (Array.isArray(input)) return input.slice(0, limits.entries ?? 200).map(v => visit(v, depth + 1));
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input).slice(0, limits.entries ?? 200)) result[key] = sensitiveField.test(key) ? '[redacted]' : visit(item, depth + 1);
    return result;
  }
  return visit(value, 0);
}

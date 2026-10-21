export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEntry = { id: number; at: string; level: LogLevel; source: string; message: string; data?: unknown; storyId?: string; requestId?: string };
export type TraceEntry = { id: string; at: string; finishedAt?: string; kind: string; status: 'pending' | 'complete' | 'error'; storyId?: string; storyRevision?: number; durationMs?: number; request: unknown; response?: unknown; error?: string };

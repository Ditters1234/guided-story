export type JobState = 'queued' | 'generating' | 'validating' | 'committing' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
export type JobRecord = {
  id: string; kind: string; storyId?: string; requestId: string; expectedRevision?: number; targetId?: string;
  state: JobState; lockKey: string; fingerprint: string; attempt: number; recoverable: boolean;
  createdAt: string; updatedAt: string; error?: string;
  history: { at: string; state: JobState; attempt: number }[]; details: Record<string, unknown>;
};

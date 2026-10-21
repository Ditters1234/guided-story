import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getJobs, cancelJob } from '#lib/server/jobs';
import { readJson, failure } from '#lib/server/http';
export async function POST({ request }: { request: Request }) {
  try {
    const input = z.object({ storyId: z.string().min(1).max(100), requestId: z.string().uuid() }).parse(await readJson(request));
    const job = getJobs().find(input);
    const maintenance = job?.state === 'complete' ? getJobs().list().find(j => j.storyId === input.storyId && j.kind === 'memory-compaction' && j.details.triggerRequestId === input.requestId && ['queued','generating','validating','committing'].includes(j.state)) : null;
    return json({ state: maintenance ? cancelJob(maintenance.id).state : job ? cancelJob(job.id).state : 'not-started', passageAlreadySaved: !!maintenance });
  }
  catch (e) { return failure(e); }
}

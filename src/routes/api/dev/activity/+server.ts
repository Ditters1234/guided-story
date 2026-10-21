import { json } from '@sveltejs/kit';
import { getDiagnostics } from '#lib/server/diagnostics';
import { getJobs } from '#lib/server/jobs';
import { activeJobStates, type ActivitySnapshot } from '#lib/activity';
import { failure } from '#lib/server/http';
export function GET(){
  try{
    const store=getDiagnostics(),requests=store.activity(),jobs=getJobs().activity();
    const snapshot:ActivitySnapshot={at:new Date().toISOString(),requests,jobs,errors:store.errors(),activeRequests:requests.filter(r=>r.status==='pending').length,activeJobs:jobs.filter(j=>activeJobStates.includes(j.state)).length};
    return json(snapshot);
  }catch(e){return failure(e);}
}

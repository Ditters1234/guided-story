import { json } from '@sveltejs/kit';
import { APP_VERSION } from '#lib/version';
export function GET(){return json({app:'storyweaver',version:APP_VERSION,instance:process.env.STORY_INSTANCE||'dev',runtime:process.env.STORY_PRODUCTION==='1'?'production':'development'},{headers:{'Cache-Control':'no-store'}});}

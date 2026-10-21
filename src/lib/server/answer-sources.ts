import type { Story, Passage } from '../story';
import { evidenceSources } from './evidence-sources';
export function answerSources(story:Story,passage:Passage){
  const index=story.passages.findIndex(p=>p.id===passage.id);
  return evidenceSources([passage.paragraphs.join('\n\n')],600).map(s=>({id:`quote-${index}-${s.id.slice(7)}`,passageId:passage.id,quote:s.text}));
}

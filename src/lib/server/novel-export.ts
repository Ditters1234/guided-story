import type { Story } from '../story';
const heading=(text:string)=>text.replace(/[\r\n]+/g,' ').replace(/[\\`*_{}\[\]<>#]/g,'\\$&');
export function novelMarkdown(story:Story) {
  const lines=[`# ${heading(story.title)}`,''];let chapter=0;
  for(const p of story.passages){
    if(p.chapter!==chapter){chapter=p.chapter;lines.push(`## Chapter ${chapter}: ${heading(p.chapterTitle)}`,'');}
    lines.push(`### ${heading(p.title)}`,'',...p.paragraphs.flatMap(text=>[text,'']));
  }
  return lines.join('\n');
}

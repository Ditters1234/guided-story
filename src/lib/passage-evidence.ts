export function evidenceSources(paragraphs: string[], maxLength=900) {
  const result: { id: string; paragraphIndex: number; text: string }[] = [];
  paragraphs.forEach((paragraph,paragraphIndex) => {
    for (let start=0;start<paragraph.length;) {
      let end=Math.min(start+maxLength,paragraph.length);
      if (paragraph.length-end<8) end=paragraph.length;
      if(maxLength<900&&end<paragraph.length){const boundary=Math.max(paragraph.lastIndexOf(' ',end),paragraph.lastIndexOf('\n',end));if(boundary>start+maxLength*0.65)end=boundary;}
      if (end<paragraph.length && /[\uD800-\uDBFF]/.test(paragraph[end-1])) end--;
      const text=paragraph.slice(start,end).trim();start=end;
      if (text.length>=8 && text.length<=1000) result.push({id:`source-${result.length}`,paragraphIndex,text});
    }
  });
  return result;
}

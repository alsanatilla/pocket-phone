// Local thought extraction must remain available offline. This only excludes
// code from Pocket's >> markers; all Markdown rendering still uses Satteri.
export function noteProseLines(source) {
  const result = []; let fence = null;
  String(source ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    let text = line.replace(/\t/g, '    '), quote = 0;
    // Inside a fence, > is literal except for the fence's own quote container.
    const quoteLimit = fence ? fence.quote : Infinity;
    while (quote < quoteLimit && /^ {0,3}> ?/.test(text)) { text = text.replace(/^ {0,3}> ?/, ''); quote++; }
    const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)]) +/.exec(text);
    const indent = /^ */.exec(text)[0].length;
    if (fence && (quote < fence.quote || line.trim() && indent < fence.indent && !list)) fence = null;
    const rest = fence?.indent ? text.slice(fence.indent) : list ? text.slice(list[0].length) : text;
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(rest);
    if (fence) {
      if (mark && mark[1][0] === fence.mark[0] && mark[1].length >= fence.mark.length && !mark[2].trim()) fence = null;
      return;
    }
    if (mark && (mark[1][0] === '~' || !mark[2].includes('`'))) { fence = { mark: mark[1], quote, indent: list ? list[0].length : 0 }; return; }
    if (!/^(?: {4}| {0,3}\t)/.test(line)) result.push({ line, index });
  });
  return result;
}

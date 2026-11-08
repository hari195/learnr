import type { ReactNode } from 'react';

function inline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) output.push(text.slice(cursor, start));
    const token = match[0];
    const key = `${keyPrefix}-${start}`;
    if (token.startsWith('`')) output.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token)!;
      output.push(<a key={key} href={parts[2]} target="_blank" rel="noreferrer">{parts[1]}</a>);
    } else if (token.startsWith('**') || token.startsWith('__')) output.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith('~~')) output.push(<del key={key}>{inline(token.slice(2, -2), key)}</del>);
    else output.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    cursor = start + token.length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';
  return /^```/.test(line) || /^#{1,6}\s/.test(line) || /^>\s?/.test(line)
    || /^\s*[-+*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
    || (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(next));
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

export function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = /^```\s*([\w.+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code data-language={fence[1] || undefined}>{code.join('\n')}</code></pre>);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[level - 1];
      blocks.push(<Tag key={`heading-${index}`}>{inline(heading[2], `heading-${index}`)}</Tag>);
      index += 1; continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={`quote-${index}`}>{inline(quote.join('\n'), `quote-${index}`)}</blockquote>);
      continue;
    }

    const unordered = /^\s*[-+*]\s+/.test(line);
    const ordered = /^\s*\d+[.)]\s+/.test(line);
    if (unordered || ordered) {
      const items: string[] = [];
      const matcher = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      while (index < lines.length) {
        const item = matcher.exec(lines[index]);
        if (!item) break;
        items.push(item[1]); index += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `list-${index}-${itemIndex}`)}</li>)}</Tag>);
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />); index += 1; continue;
    }

    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const headers = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(<div className="markdown-table-wrap" key={`table-${index}`}><table><thead><tr>{headers.map((value, cellIndex) => <th key={cellIndex}>{inline(value, `th-${index}-${cellIndex}`)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, cellIndex) => <td key={cellIndex}>{inline(value, `td-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++]);
    blocks.push(<p key={`paragraph-${index}`}>{inline(paragraph.join('\n'), `paragraph-${index}`)}</p>);
  }
  return <div className="markdown-body">{blocks}</div>;
}

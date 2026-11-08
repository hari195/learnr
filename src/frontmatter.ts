import type { NoteReference } from './types';

export function mergeRelatedNoteLinks(markdown: string, references: NoteReference[]): string {
  const links = [...new Set(references.filter((reference) => !reference.ambiguous).map((reference) => reference.wikilink))];
  if (!links.length) return markdown;
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (normalized.startsWith('---\n') && !frontmatterMatch) throw new Error('The draft has invalid YAML frontmatter. Fix it before adding related-note links.');
  const additions = links.map((link) => `  - ${JSON.stringify(link)}`);
  if (!frontmatterMatch) return `---\nrelated:\n${additions.join('\n')}\n---\n\n${normalized}`;
  const body = frontmatterMatch[1];
  const lines = body.split('\n');
  if (lines.some((line) => line.trim() && !/^\s/.test(line) && !/^#/.test(line) && !/^[A-Za-z0-9_-]+\s*:/.test(line))) throw new Error('The draft has invalid YAML frontmatter. Fix it before adding related-note links.');
  const relatedIndex = lines.findIndex((line) => /^related\s*:/.test(line));
  if (relatedIndex < 0) {
    const merged = `${body}${body ? '\n' : ''}related:\n${additions.join('\n')}`;
    return normalized.replace(frontmatterMatch[0], `---\n${merged}\n---\n`);
  }
  if (!/^related\s*:\s*(?:#.*)?$/.test(lines[relatedIndex])) throw new Error('The existing related frontmatter field must be a YAML list before learnr can add links.');
  let end = relatedIndex + 1;
  const existing = new Set<string>();
  while (end < lines.length && (/^\s+/.test(lines[end]) || !lines[end].trim())) {
    const item = /^\s*-\s*["']?(\[\[[^\]]+\]\])["']?\s*(?:#.*)?$/.exec(lines[end]);
    if (lines[end].trim() && !item && !/^\s*#/.test(lines[end])) throw new Error('The existing related frontmatter list is not valid YAML.');
    if (item) existing.add(item[1]);
    end += 1;
  }
  const missing = links.filter((link) => !existing.has(link)).map((link) => `  - ${JSON.stringify(link)}`);
  if (!missing.length) return normalized;
  lines.splice(end, 0, ...missing);
  return normalized.replace(frontmatterMatch[0], `---\n${lines.join('\n')}\n---\n`);
}

export function mergeWorkspaceFrontmatter(markdown: string, workspaceName: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const value = JSON.stringify(workspaceName.trim() || 'Default');
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (normalized.startsWith('---\n') && !frontmatter) throw new Error('The draft has invalid YAML frontmatter. Fix it before saving.');
  if (!frontmatter) return `---\nworkspace: ${value}\n---\n\n${normalized}`;
  const lines = frontmatter[1].split('\n');
  const index = lines.findIndex((line) => /^workspace\s*:/.test(line));
  if (index >= 0) lines[index] = `workspace: ${value}`; else lines.push(`workspace: ${value}`);
  return normalized.replace(frontmatter[0], `---\n${lines.join('\n')}\n---\n`);
}

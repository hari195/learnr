import { describe, expect, it } from 'vitest';
import { matchingSlashCommands, slashCommandInsertion, SLASH_COMMANDS } from './command-catalog';
import { parseComposerCommand } from './artifacts';
import { parseMediaCommand } from './media';

describe('slash command catalog', () => {
  it('documents every parsed command and routes video only through /video', () => {
    expect(SLASH_COMMANDS.map((item) => item.command.split(' ')[0])).toEqual(['/keep', '/note', '/draft', '/search', '/link', '/image', '/video']);
    expect(parseComposerCommand('/keep a thought')).toEqual({ type: 'keep', text: 'a thought' });
    expect(parseComposerCommand('/note my own words')).toEqual({ type: 'note', text: 'my own words' });
    expect(parseComposerCommand('/draft causal mechanism')).toEqual({ type: 'draft', focus: 'causal mechanism' });
    expect(parseComposerCommand('/draft')).toEqual({ type: 'draft', focus: '' });
    expect(parseComposerCommand('/search causal mechanism')).toEqual({ type: 'search', query: 'causal mechanism' });
    expect(parseMediaCommand('/video question')).toEqual({ type: 'video', question: 'question' });
    expect(parseMediaCommand('/transcribe question')).toBeNull();
  });

  it('filters a leading command token and inserts the right argument spacing', () => {
    expect(matchingSlashCommands('/dr').map((item) => item.command)).toContain('/draft [focus]');
    expect(matchingSlashCommands('/se').map((item) => item.command)).toContain('/search <query>');
    expect(matchingSlashCommands('  /NO').map((item) => item.command)).toContain('/note <text>');
    expect(matchingSlashCommands('/draft topic')).toEqual([]);
    expect(slashCommandInsertion(SLASH_COMMANDS.find((item) => item.command.startsWith('/draft'))!)).toBe('/draft ');
    expect(slashCommandInsertion(SLASH_COMMANDS.find((item) => item.command === '/link [query]')!)).toBe('/link ');
  });
});

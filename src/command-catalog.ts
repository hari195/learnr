export interface SlashCommandDefinition {
  command: string;
  summary: string;
  requirement: string;
  providerCall: boolean;
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { command: '/keep <text>', summary: 'Keep editable author material for the next note.', requirement: 'Add text after the command.', providerCall: false },
  { command: '/note <text>', summary: 'Append your own Markdown unchanged to the My Notes section.', requirement: 'Add text after the command.', providerCall: false },
  { command: '/draft [focus]', summary: 'Create a full-context note or a focused atomic note.', requirement: 'An OpenRouter key and Draft model.', providerCall: true },
  { command: '/search <query>', summary: 'Semantically search enabled saved-note libraries.', requirement: 'A built embedding library and OpenRouter key.', providerCall: true },
  { command: '/link [query]', summary: 'Choose one or more indexed notes to add as wikilinks.', requirement: 'A configured and indexed note library.', providerCall: false },
  { command: '/image [question]', summary: 'Analyze attached images with the Image model.', requirement: 'At least one image attachment.', providerCall: true },
  { command: '/video [question]', summary: 'Analyze the selected YouTube video with the Video model and Video prompt.', requirement: 'An open or highlighted YouTube video.', providerCall: true },
];

export const COMPOSER_COMMAND_HINT = 'Ask, /search, /draft, /note, /keep, /link, /image, or /video…';

export function matchingSlashCommands(input: string, commands = SLASH_COMMANDS): SlashCommandDefinition[] {
  const match = input.match(/^\s*(\/[^\s]*)$/); if (!match) return [];
  const query = match[1].toLocaleLowerCase();
  return commands.filter((item) => item.command.split(/\s/)[0].toLocaleLowerCase().startsWith(query) || item.summary.toLocaleLowerCase().includes(query.slice(1)));
}

export function slashCommandInsertion(definition: SlashCommandDefinition): string {
  const command = definition.command.split(/\s/)[0];
  return `${command}${/[<\[]/.test(definition.command) ? ' ' : ''}`;
}

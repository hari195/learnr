export async function consumeJsonSse<T>(response: Response, onEvent: (event: T) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The provider returned an empty response.');

  const decoder = new TextDecoder();
  let buffer = '';

  const consumeLines = (final: boolean) => {
    const lines = buffer.split('\n');
    buffer = final ? '' : lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try { onEvent(JSON.parse(data) as T); }
      catch { /* OpenRouter may send optional keepalives or malformed non-result events. */ }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    consumeLines(false);
  }
  buffer += decoder.decode();
  if (buffer) buffer += '\n';
  consumeLines(true);
}

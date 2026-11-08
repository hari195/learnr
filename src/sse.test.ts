import { describe, expect, it, vi } from 'vitest';
import { consumeJsonSse } from './sse';

function streamedResponse(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}

describe('JSON server-sent event reader', () => {
  it('preserves Unicode split across chunks and consumes a final event without a newline', async () => {
    const encoded = new TextEncoder().encode('data: {"text":"Hej 🌍"}');
    const split = encoded.indexOf(0xf0) + 2;
    const onEvent = vi.fn();

    await consumeJsonSse(streamedResponse([encoded.slice(0, split), encoded.slice(split)]), onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({ text: 'Hej 🌍' });
  });

  it('accepts CRLF, ignores done markers, comments, and malformed optional events', async () => {
    const body = ': keepalive\r\ndata: not-json\r\ndata: {"value":1}\r\ndata: [DONE]\r\n';
    const onEvent = vi.fn();

    await consumeJsonSse(streamedResponse([new TextEncoder().encode(body)]), onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({ value: 1 });
  });

  it('rejects an empty response body', async () => {
    await expect(consumeJsonSse({ body: null } as Response, vi.fn())).rejects.toThrow('empty response');
  });
});

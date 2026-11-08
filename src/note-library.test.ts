import { afterEach, describe, expect, it, vi } from 'vitest';
import { chunkMarkdown, commonEmbeddingLibraryModel, cosineSimilarity, createEmbeddings, hashNoteContent, stableNoteId } from './note-library';

afterEach(() => vi.unstubAllGlobals());

describe('saved-note indexing helpers', () => {
  it('creates stable path IDs and content hashes', () => {
    expect(stableNoteId('Ideas/One.md')).toBe(stableNoteId('Ideas/One.md'));
    expect(stableNoteId('Ideas/One.md')).not.toBe(stableNoteId('Ideas/Two.md'));
    expect(hashNoteContent('one')).not.toBe(hashNoteContent('two'));
  });

  it('chunks long Markdown around headings and preserves overlap', () => {
    const markdown = `# First\n${'alpha '.repeat(900)}\n## Second\n${'beta '.repeat(900)}`;
    const chunks = chunkMarkdown(markdown);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.some((chunk) => chunk.heading === 'Second')).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 4_000)).toBe(true);
  });

  it('ranks equal and unrelated vectors using cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 0])).toBe(-1);
  });

  it('allows multi-library search only with one common embedding model', () => {
    expect(commonEmbeddingLibraryModel([{ id: 'a', name: 'A', model: 'embed-1' }, { id: 'b', name: 'B', model: 'embed-1' }])).toBe('embed-1');
    expect(commonEmbeddingLibraryModel([{ id: 'a', name: 'A', model: 'embed-1' }, { id: 'b', name: 'B', model: 'embed-2' }])).toBeNull();
    expect(commonEmbeddingLibraryModel([])).toBeNull();
  });

  it('routes a selectable embedding model through OpenRouter and accepts its native dimensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { total_tokens: 4, cost: 0.00001 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createEmbeddings('openrouter', 'or-key', ['query'], undefined, 'search_query', 'vendor/custom-embed')).resolves.toEqual({
      embeddings: [[0.1, 0.2, 0.3]], tokens: 4, costUsd: 0.00001, requestCount: 1, tokensReported: true, costReported: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/embeddings', expect.objectContaining({
      body: JSON.stringify({ model: 'vendor/custom-embed', input: ['query'], encoding_format: 'float', input_type: 'search_query' }),
    }));
  });

  it('rejects the retired direct OpenAI embedding route', async () => {
    await expect(createEmbeddings('openai', 'legacy-key', ['query'])).rejects.toThrow('use OpenRouter');
  });

  it('never estimates an embedding cost when OpenRouter omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }], usage: { total_tokens: 7 } }), { status: 200 })));
    await expect(createEmbeddings('openrouter', 'or-key', ['query'])).resolves.toMatchObject({ tokens: 7, costUsd: 0, tokensReported: true, costReported: false, requestCount: 1 });
  });
});

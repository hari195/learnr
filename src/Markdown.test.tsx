import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders common response formatting', () => {
    const html = renderToStaticMarkup(<Markdown>{'# Summary\n\n- **First** item\n- `code`\n\n> Note\n\n[Source](https://example.com)'}</Markdown>);
    expect(html).toContain('<h1>Summary</h1>');
    expect(html).toContain('<ul><li><strong>First</strong> item</li><li><code>code</code></li></ul>');
    expect(html).toContain('<blockquote>Note</blockquote>');
    expect(html).toContain('target="_blank"');
  });

  it('renders fenced code and tables while escaping raw HTML', () => {
    const html = renderToStaticMarkup(<Markdown>{'```ts\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<script>alert(1)</script>'}</Markdown>);
    expect(html).toContain('<pre><code data-language="ts">const x = 1;</code></pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});

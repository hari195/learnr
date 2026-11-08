import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('renders the approved paper-plane SVG geometry', () => {
    const markup = renderToStaticMarkup(<BrandMark />);
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('M6 12 3.269 3.125');
    expect(markup).toContain('59.768 59.768 0 0 1 3.27 20.875');
  });
});

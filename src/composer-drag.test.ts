import { describe, expect, it } from 'vitest';
import { isComposerDragActive, nextComposerDragDepth } from './composer-drag';

describe('composer drag state', () => {
  it('stays active while a drag moves across nested composer elements', () => {
    let depth = nextComposerDragDepth(0, 'enter');
    depth = nextComposerDragDepth(depth, 'enter');
    depth = nextComposerDragDepth(depth, 'leave');

    expect(depth).toBe(1);
    expect(isComposerDragActive(depth)).toBe(true);
  });

  it('clears every nested drag level immediately after a drop', () => {
    expect(nextComposerDragDepth(3, 'drop')).toBe(0);
    expect(isComposerDragActive(nextComposerDragDepth(3, 'drop'))).toBe(false);
  });

  it('clears stale state when the browser ends the drag outside the composer', () => {
    expect(nextComposerDragDepth(2, 'dragend')).toBe(0);
  });
});

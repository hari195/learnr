export type ComposerDragTransition = 'enter' | 'leave' | 'drop' | 'dragend';

/**
 * Drag events enter and leave every nested composer element. Track that depth so
 * moving over attachment controls cannot incorrectly hide or latch the overlay.
 */
export function nextComposerDragDepth(currentDepth: number, transition: ComposerDragTransition): number {
  const depth = Math.max(0, currentDepth);
  if (transition === 'drop' || transition === 'dragend') return 0;
  if (transition === 'enter') return depth + 1;
  return Math.max(0, depth - 1);
}

export function isComposerDragActive(depth: number): boolean {
  return depth > 0;
}

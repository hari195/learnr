import { describe, expect, it } from 'vitest';
import { guardrailInstructions, normalizeGuardrails, resolveGuardrail } from './guardrails';

describe('behavior guardrails', () => {
  it('normalizes the balanced default and clamps custom controls', () => {
    expect(normalizeGuardrails().global.values).toEqual({ evidence: 4, uncertainty: 3, creativity: 3, challenge: 3, detail: 3 });
    expect(normalizeGuardrails({ global: { preset: 'custom', values: { evidence: 99, uncertainty: 0, creativity: 3, challenge: 3, detail: 3 } } }).global.values).toMatchObject({ evidence: 5, uncertainty: 1 });
  });

  it('resolves inheritance and renders deterministic instructions', () => {
    const settings = normalizeGuardrails();
    expect(resolveGuardrail(settings, 'drafting')).toEqual(settings.global);
    expect(guardrailInstructions(settings, 'chat')).toContain('Ground important claims in available evidence.');
  });
});

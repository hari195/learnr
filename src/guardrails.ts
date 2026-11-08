import { DEFAULT_SETTINGS } from './defaults';
import type { GuardrailProfile, GuardrailPreset, GuardrailSettings, GuardrailStage, GuardrailValues } from './types';

export const GUARDRAIL_PRESETS: Record<Exclude<GuardrailPreset, 'custom'>, GuardrailValues> = {
  balanced: { evidence: 4, uncertainty: 3, creativity: 3, challenge: 3, detail: 3 },
  'evidence-first': { evidence: 5, uncertainty: 5, creativity: 1, challenge: 4, detail: 4 },
  exploratory: { evidence: 3, uncertainty: 4, creativity: 5, challenge: 4, detail: 4 },
};

function clamp(value: unknown, fallback: number): number { const numeric = Number(value); return Math.min(5, Math.max(1, Number.isFinite(numeric) ? numeric : fallback)); }

export function normalizeProfile(profile: Partial<GuardrailProfile> | undefined, fallback = DEFAULT_SETTINGS.guardrails.global): GuardrailProfile {
  const preset = (['balanced', 'evidence-first', 'exploratory', 'custom'].includes(profile?.preset ?? '') ? profile!.preset : fallback.preset) as GuardrailPreset;
  const base = preset === 'custom' ? fallback.values : GUARDRAIL_PRESETS[preset];
  const values = preset === 'custom' ? {
    evidence: clamp(profile?.values?.evidence, base.evidence), uncertainty: clamp(profile?.values?.uncertainty, base.uncertainty), creativity: clamp(profile?.values?.creativity, base.creativity), challenge: clamp(profile?.values?.challenge, base.challenge), detail: clamp(profile?.values?.detail, base.detail),
  } : { ...base };
  return { preset, values };
}

export function normalizeGuardrails(value?: Partial<GuardrailSettings>): GuardrailSettings {
  const global = normalizeProfile(value?.global);
  return { global, stages: Object.fromEntries((['chat', 'drafting', 'pdf', 'image', 'video'] as GuardrailStage[]).map((stage) => {
    const saved = value?.stages?.[stage];
    return [stage, { inherit: saved?.inherit ?? true, profile: normalizeProfile(saved?.profile, global) }];
  })) as GuardrailSettings['stages'] };
}

export function resolveGuardrail(settings: GuardrailSettings, stage: GuardrailStage): GuardrailProfile { return settings.stages[stage].inherit ? settings.global : settings.stages[stage].profile; }

export function guardrailInstructions(settings: GuardrailSettings, stage: GuardrailStage): string {
  const { values } = resolveGuardrail(settings, stage);
  const pick = (value: number, options: string[]) => options[value - 1];
  return [
    'Behavior guidance:',
    `- Evidence: ${pick(values.evidence, ['Explore plausible ideas freely while labelling inference.', 'Use reasonable inference but distinguish it from evidence.', 'Balance evidence and inference.', 'Ground important claims in available evidence.', 'Make only well-supported claims and identify missing evidence.'])}`,
    `- Uncertainty: ${pick(values.uncertainty, ['Use only essential caveats.', 'Mention material uncertainty briefly.', 'State meaningful uncertainty clearly.', 'Call out assumptions and conflicting evidence.', 'Explicitly identify uncertainty, assumptions, conflicts, and confidence.'])}`,
    `- Creativity: ${pick(values.creativity, ['Prefer literal synthesis.', 'Stay close to supplied material.', 'Use balanced synthesis and connection-making.', 'Make useful non-obvious connections.', 'Think associatively and generate multiple novel connections.'])}`,
    `- Challenge: ${pick(values.challenge, ['Develop the user’s framing supportively.', 'Question only clear weaknesses.', 'Balance support with critique.', 'Actively test assumptions and counterarguments.', 'Rigorously stress-test premises, counterexamples, and implications.'])}`,
    `- Detail: ${pick(values.detail, ['Be exceptionally concise.', 'Be concise.', 'Use moderate detail.', 'Explain thoroughly.', 'Be comprehensive and explicit.'])}`,
  ].join('\n');
}

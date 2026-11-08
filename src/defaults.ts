import type { AppSettings } from './types';
import { DEFAULT_IMAGE_PROMPT_TEMPLATE, DEFAULT_NOTE_PROMPT_TEMPLATE, DEFAULT_PDF_PROMPT_TEMPLATE, DEFAULT_SYSTEM_PROMPT_TEMPLATE, DEFAULT_VIDEO_PROMPT_TEMPLATE } from './prompt';

export const DEFAULT_MODELS = {
  openai: [],
  openrouter: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'],
} as const;

// Shared by both builds and the one-time Arc workspace upgrade.
export const ENABLED_FEATURE_DEFAULTS = {
  autoFollowActiveTab: true,
  chatSuggestionsEnabled: true,
  microphoneDictationEnabled: true,
  videoAnalysisEnabled: true,
  imageAnalysisEnabled: true,
  webSearchEnabled: true,
  webFetchEnabled: true,
  pdfExtractionEnabled: true,
  showChatReplyStats: true,
  showDraftStats: true,
  usageWarningsEnabled: true,
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: 'openrouter',
  aiRoles: {
    chat: { provider: 'openrouter', model: 'openai/gpt-5-mini' },
    drafting: { provider: 'openrouter', model: 'openai/gpt-5-mini' },
    pdf: { provider: 'openrouter', model: 'openai/gpt-5-mini' },
    image: { provider: 'openrouter', model: 'openai/gpt-5-mini' },
    video: { provider: 'openrouter', model: '' },
    transcription: { provider: 'openrouter', model: 'openai/gpt-4o-mini-transcribe' },
  },
  themeMode: 'website',
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  notePromptTemplate: DEFAULT_NOTE_PROMPT_TEMPLATE,
  pdfPromptTemplate: DEFAULT_PDF_PROMPT_TEMPLATE,
  imagePromptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE,
  videoPromptTemplate: DEFAULT_VIDEO_PROMPT_TEMPLATE,
  zettelkastenFilenames: true,
  autoFollowActiveTab: true,
  activateSourceTabOnConversationSelect: false,
  chatSuggestions: ['Give me the core argument', 'What should I question?', 'Connect this to what I selected'],
  chatSuggestionsEnabled: true,
  allowNoteInDraftContext: false,
  microphoneDictationEnabled: true,
  videoAnalysisEnabled: true,
  imageAnalysisEnabled: true,
  webSearchEnabled: true,
  webFetchEnabled: true,
  pdfExtractionEnabled: true,
  pdfExtractionMode: 'countdown',
  keepSavedDraftsInEditor: true,
  sourceContextBudgetTokens: 32_000,
  savedNotes: { embeddingProvider: 'openrouter', embeddingModel: 'openai/text-embedding-3-small', enabledEmbeddingProfileIds: [], embeddingProfileId: '', searchInChat: false },
  guardrails: {
    global: { preset: 'balanced', values: { evidence: 4, uncertainty: 3, creativity: 3, challenge: 3, detail: 3 } },
    stages: Object.fromEntries(['chat', 'drafting', 'pdf', 'image', 'video'].map((stage) => [stage, { inherit: true, profile: { preset: 'balanced', values: { evidence: 4, uncertainty: 3, creativity: 3, challenge: 3, detail: 3 } } }])) as AppSettings['guardrails']['stages'],
  },
  showChatReplyStats: true,
  showDraftStats: true,
  usageWarningsEnabled: true,
  tokenWarnings: { conversationTokens: 100_000, globalTokens: 1_000_000, globalPeriod: 'month' },
  usageWindowByModel: {},
  providers: {
    openai: {
      providerId: 'openai',
      apiKey: '',
      selectedModel: 'gpt-5.6-terra',
      connectionStatus: 'untested',
      availableModels: [],
    },
    openrouter: {
      providerId: 'openrouter',
      apiKey: '',
      selectedModel: DEFAULT_MODELS.openrouter[0],
      connectionStatus: 'untested',
      availableModels: [...DEFAULT_MODELS.openrouter],
    },
  },
};

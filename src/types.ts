export type ProviderId = 'openai' | 'openrouter';
export type PageTheme = 'light' | 'dark';
export type ThemeMode = 'website' | 'system' | 'light' | 'dark';
export type DocumentKind = 'html' | 'pdf' | 'youtube' | 'instagram-reel' | 'instagram-media';
export type MediaProcessingStatus = 'idle' | 'waiting' | 'countdown' | 'processing' | 'ready' | 'skipped' | 'stopped' | 'error';
export type UsageWindow = 'today' | '7d' | '30d' | 'month' | 'all';
export type UsageOperation = 'chat' | 'drafting' | 'image' | 'video' | 'pdf' | 'transcription' | 'embedding' | 'saved-note-tool' | 'web-search' | 'autogroup';
export type TabAccessState = 'connected' | 'protected' | 'loading' | 'extraction-unavailable';

export interface ActiveTabConnection {
  tabId: number;
  url: string;
  title: string;
  status: TabAccessState;
  detail?: string;
}

export interface YouTubeContext {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channel?: string;
  description?: string;
  durationSeconds?: number;
  currentTimeSeconds?: number;
  captions?: string;
  captionsAvailable: boolean;
}

export interface InstagramReelContext {
  shortcode: string;
  canonicalUrl: string;
  title: string;
  account?: string;
  durationSeconds?: number;
  currentTimeSeconds?: number;
}

export interface InstagramMediaContext {
  shortcode: string;
  route: 'reel' | 'post';
  canonicalUrl: string;
  title: string;
  account?: string;
  caption?: string;
  mediaType: 'image' | 'video' | 'carousel' | 'unknown';
  hasVideo: boolean;
  itemCount?: number;
  durationSeconds?: number;
  currentTimeSeconds?: number;
}

export interface PdfContext {
  cacheKey: string;
  filename: string;
  byteSize?: number;
  status: MediaProcessingStatus;
  truncated?: boolean;
  error?: string;
  extractedChars?: number;
  completedAt?: number;
  durationMs?: number;
  responseStats?: AiResponseStats;
}

export interface PageContext {
  title: string;
  url: string;
  author?: string;
  publishedDate?: string;
  selectedText?: string;
  cleanedMarkdown: string;
  extractionStatus: 'readable' | 'selection' | 'visible-text' | 'unavailable';
  pageTheme: PageTheme;
  documentKind?: DocumentKind;
  pdf?: PdfContext;
  youtube?: YouTubeContext;
  instagramMedia?: InstagramMediaContext;
  /** @deprecated Read old saved conversations through instagramMedia when possible. */
  instagramReel?: InstagramReelContext;
}

export interface ProviderSettings {
  providerId: ProviderId;
  apiKey: string;
  selectedModel: string;
  connectionStatus: 'untested' | 'connected' | 'failed';
  availableModels: string[];
  modelCatalog?: OpenRouterModelMetadata[];
  modelsUpdatedAt?: number;
}

export interface OpenRouterPricingTier {
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  webSearch?: string;
  internalReasoning?: string;
  inputCacheRead?: string;
  inputCacheWrite?: string;
  minContext?: number;
}

export interface OpenRouterModelMetadata {
  id: string;
  name?: string;
  contextLength?: number;
  maxCompletionTokens?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  pricing: OpenRouterPricingTier[];
}

export interface SavedNotesSettings {
  embeddingProvider: ProviderId;
  embeddingModel: string;
  enabledEmbeddingProfileIds: string[];
  /** @deprecated Retained only while migrating singular workspace indexes. */
  embeddingProfileId: string;
  searchInChat: boolean;
}

export interface EmbeddingIndexProfile {
  id: string;
  workspaceId: string;
  name: string;
  folderName?: string;
  model: string;
  dimensions?: number;
  autoUpdate: boolean;
  imported?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiRoleAssignment { provider: ProviderId; model: string }
export type GuardrailPreset = 'balanced' | 'evidence-first' | 'exploratory' | 'custom';
export type GuardrailStage = 'chat' | 'drafting' | 'pdf' | 'image' | 'video';
export interface GuardrailValues { evidence: number; uncertainty: number; creativity: number; challenge: number; detail: number }
export interface GuardrailProfile { preset: GuardrailPreset; values: GuardrailValues }
export interface GuardrailOverride { inherit: boolean; profile: GuardrailProfile }
export interface GuardrailSettings { global: GuardrailProfile; stages: Record<GuardrailStage, GuardrailOverride> }

export interface AppSettings {
  /** One-time Arc feature upgrade; subsequent explicit opt-outs are preserved. */
  arcFeatureDefaultsVersion?: number;
  defaultProvider: ProviderId;
  aiRoles: { chat: AiRoleAssignment; drafting: AiRoleAssignment; pdf: AiRoleAssignment; image: AiRoleAssignment; video: AiRoleAssignment; transcription: AiRoleAssignment };
  providers: Record<ProviderId, ProviderSettings>;
  themeMode: ThemeMode;
  systemPromptTemplate: string;
  notePromptTemplate: string;
  pdfPromptTemplate: string;
  imagePromptTemplate: string;
  videoPromptTemplate: string;
  zettelkastenFilenames: boolean;
  autoFollowActiveTab: boolean;
  activateSourceTabOnConversationSelect: boolean;
  chatSuggestions: [string, string, string];
  chatSuggestionsEnabled: boolean;
  allowNoteInDraftContext: boolean;
  microphoneDictationEnabled: boolean;
  videoAnalysisEnabled: boolean;
  imageAnalysisEnabled: boolean;
  webSearchEnabled: boolean;
  webFetchEnabled: boolean;
  pdfExtractionEnabled: boolean;
  pdfExtractionMode: 'countdown' | 'manual';
  keepSavedDraftsInEditor: boolean;
  sourceContextBudgetTokens: number;
  savedNotes: SavedNotesSettings;
  guardrails: GuardrailSettings;
  showChatReplyStats: boolean;
  showDraftStats: boolean;
  usageWarningsEnabled: boolean;
  tokenWarnings: TokenWarningSettings;
  usageWindowByModel: Record<string, UsageWindow>;
}

export type WorkspaceSettings = AppSettings;

export interface WorkspaceDefinition {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface GlobalSettings {
  activeWorkspaceId: string;
  workspaces: WorkspaceDefinition[];
  openRouter: ProviderSettings;
  keyboardShortcutsEnabled: boolean;
  slashCommandsEnabled: boolean;
  closedConnectedTabBehavior: 'keep' | 'remove' | 'ask';
  accentColor: string;
  lightBackgroundColor: string;
  darkBackgroundColor: string;
  lightHighlightColor: string;
  darkHighlightColor: string;
  settingsCardOrder: {
    dashboard: string[];
    workspace: string[];
    app: string[];
  };
  autoGroupModel: string;
  embeddingProfiles: EmbeddingIndexProfile[];
  embeddingProfilesVersion: number;
  usageAccountingVersion: number;
}

export interface AutoGroupTabSummary {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  hostname: string;
  fingerprint: string;
}

export interface AutoGroupExistingGroup {
  id: number;
  windowId: number;
  title: string;
}

export type AutoGroupDestination =
  | { kind: 'existing'; groupId: number; title: string }
  | { kind: 'new'; category: string };

export interface AutoGroupAssignment {
  tab: AutoGroupTabSummary;
  destination: AutoGroupDestination;
  originalDestination?: AutoGroupDestination;
}

export interface AutoGroupApplyResult {
  applied: number;
  skipped: number;
  existingGroupsUsed: number;
  newGroupsCreated: number;
}

export interface AutoGroupUndoSnapshot {
  createdAt: number;
  affected: Array<{ tabId: number; windowId: number; destinationGroupId: number }>;
  createdGroupIds: number[];
}

export interface DuplicateTabSummary {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  groupId: number;
  groupTitle?: string;
  pinned: boolean;
  active: boolean;
  lastAccessed?: number;
}

export interface DuplicateTabSet { url: string; tabs: DuplicateTabSummary[]; keeperId: number }
export interface DuplicateRemovalResult { closed: number; skipped: number }

export type TokenWarningPeriod = 'day' | 'week' | 'month';
export interface TokenWarningSettings {
  conversationTokens: number;
  globalTokens: number;
  globalPeriod: TokenWarningPeriod;
}

export interface ProviderUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  requestCount: number;
  tokensReported: boolean;
  costReported: boolean;
}

export type SessionUsage = ProviderUsage;

export interface UsageEvent extends ProviderUsage {
  id: string;
  provider: ProviderId;
  model: string;
  operation: UsageOperation;
  conversationId?: string;
  createdAt: number;
  workspaceId?: string;
  embeddingProfileId?: string;
  embeddingProfileIds?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  attachments?: ChatAttachment[];
  highlights?: ChatHighlight[];
  sources?: ChatSource[];
  webSearchRequests?: number;
  webFetchRequests?: number;
  noteToolRequests?: number;
  noteReferences?: NoteReference[];
  videoAnalysis?: boolean;
  videoId?: string;
  responseStats?: AiResponseStats;
}

export interface AiResponseStats {
  provider: ProviderId;
  model: string;
  totalTokens: number;
  outputTokens?: number;
  costUsd: number;
  tokensReported?: boolean;
  costReported?: boolean;
  durationMs?: number;
}

export type ConversationArtifact =
  | { id: string; type: 'keep'; text: string; createdAt: number }
  | { id: string; type: 'note'; text: string; createdAt: number }
  | { id: string; type: 'link'; noteId: string; embeddingProfileId?: string; libraryName?: string; filename: string; relativePath: string; wikilink: string; createdAt: number };

export interface NoteReference {
  noteId: string;
  embeddingProfileId?: string;
  libraryName?: string;
  filename: string;
  relativePath: string;
  wikilink: string;
  excerpt?: string;
  score?: number;
  ambiguous?: boolean;
}

export interface IndexedNote {
  workspaceId?: string;
  workspaceName?: string;
  id: string;
  filename: string;
  relativePath: string;
  title: string;
  markdown: string;
  modifiedAt: number;
  size: number;
  contentHash: string;
  updatedAt: number;
}

export interface IndexedNoteChunk {
  id: string;
  noteId: string;
  index: number;
  heading: string;
  text: string;
  embedding: number[];
}

export interface NoteIndexStatus {
  state: 'empty' | 'ready' | 'indexing' | 'error';
  provider?: ProviderId;
  model?: string;
  dimensions?: number;
  noteCount: number;
  chunkCount: number;
  skippedCount: number;
  lastRefreshedAt?: number;
  error?: string;
}

export interface SemanticNoteResult extends NoteReference {
  title: string;
  markdown: string;
}

export interface ProviderFunctionTool {
  name: 'search_saved_notes' | 'read_saved_note';
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderToolExecution {
  output: string;
  usage: ProviderUsage;
  references: NoteReference[];
}

export interface ChatSource {
  url: string;
  title: string;
  snippet?: string;
}

export interface ChatHighlight {
  id: string;
  startOffset: number;
  endOffset: number;
  text: string;
  createdAt: number;
}

export interface SourceHighlight {
  id: string;
  text: string;
  quote: string;
  prefix: string;
  suffix: string;
  documentStart: number;
  documentEnd: number;
  createdAt: number;
  pageFingerprint: string;
  pageId?: string;
}

export type ConversationPageLinkOrigin = 'primary' | 'manual' | 'group' | 'spawned';
export interface ConversationPage {
  id: string;
  tabId?: number;
  context: PageContext;
  faviconUrl?: string;
  linkOrigin: ConversationPageLinkOrigin;
  groupId?: number;
  linkedAt: number;
  lastActiveAt: number;
  contextCharsUsed?: number;
  truncated?: boolean;
  contextTokensUsed?: number;
  parentPageId?: string;
  contextIncluded?: boolean;
  pending?: boolean;
  closedAt?: number;
  closeDecisionPending?: boolean;
}

export interface LinkedTabGroup {
  groupId: number;
  windowId: number;
  title: string;
  color: string;
  synchronized: true;
}

export interface ImageHighlight {
  id: string;
  assetId: string;
  filename: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  byteSize: number;
  source: 'web' | 'local';
  originalName?: string;
  sourceUrl?: string;
  createdAt: number;
  pageFingerprint: string;
  pageId?: string;
  sourceAnchor?: { src: string; alt?: string; index?: number };
}

export interface VideoHighlight {
  id: string;
  videoId: string;
  title: string;
  url: string;
  currentTimeSeconds?: number;
  createdAt: number;
  pageFingerprint: string;
  pageId?: string;
}

export interface VideoTranscriptContext {
  videoId: string;
  title: string;
  url: string;
  transcript: string;
  analyzedAt: number;
  model: string;
  platform?: 'youtube' | 'instagram';
  status?: 'complete' | 'partial';
  capturedThroughSeconds?: number;
  durationSeconds?: number;
  segments?: MediaTranscriptSegment[];
  responseStats?: AiResponseStats;
}

export interface MediaTranscriptSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface StoredPdfAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: 'application/pdf';
  byteSize: number;
  blob: Blob;
  createdAt: number;
}

export interface PdfProcessingProgress {
  stage: 'detecting' | 'downloading' | 'preparing' | 'processing' | 'extracting' | 'ready' | 'error' | 'stopped';
  receivedBytes?: number;
  totalBytes?: number;
  extractedChars?: number;
  startedAt: number;
  message?: string;
}

export interface StoredImageAsset {
  id: string;
  historyId: string;
  mimeType: ImageHighlight['mimeType'];
  blob: Blob;
  createdAt: number;
}

export type ChatAttachment =
  | { id: string; kind: 'image'; name: string; mimeType: string; imageUrl: string; source: 'web' | 'local' }
  | { id: string; kind: 'text'; name: string; mimeType: string; text: string; source: 'local' };

export interface ChatSession {
  workspaceId?: string;
  tabId: number;
  historyId: string;
  pageFingerprint: string;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  artifacts: ConversationArtifact[];
  sourceHighlights: SourceHighlight[];
  imageHighlights: ImageHighlight[];
  videoHighlights?: VideoHighlight[];
  videoContexts?: VideoTranscriptContext[];
  usage: SessionUsage;
  pages: ConversationPage[];
  activePageId: string;
  linkedGroup?: LinkedTabGroup;
  drafts?: NoteDraft[];
  activeDraftId?: string;
  revision?: number;
  updatedByInstanceId?: string;
  activeView?: 'chat' | 'draft';
  operation?: { id: string; kind: 'chat' | 'draft' | 'pdf' | 'image' | 'video'; ownerInstanceId: string; startedAt: number };
  interruptedOperation?: { kind: 'chat' | 'draft' | 'pdf' | 'image' | 'video'; interruptedAt: number };
  /** Legacy singular draft, normalized into drafts on read. */
  draft?: NoteDraft | null;
}

export interface ChatHistoryRecord {
  workspaceId?: string;
  id: string;
  title: string;
  url: string;
  lastInteractedAt: number;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  artifacts: ConversationArtifact[];
  sourceHighlights: SourceHighlight[];
  imageHighlights: ImageHighlight[];
  videoHighlights?: VideoHighlight[];
  videoContexts?: VideoTranscriptContext[];
  usage: SessionUsage;
  context: PageContext;
  pages: ConversationPage[];
  activePageId: string;
  drafts?: NoteDraft[];
  activeDraftId?: string;
}

export type ChatHistorySummary = Pick<ChatHistoryRecord, 'id' | 'title' | 'url' | 'lastInteractedAt' | 'provider' | 'model' | 'workspaceId'> & { pageCount?: number; pageUrls?: string[]; workspaceName?: string };

export interface LifetimeStats {
  notesSaved: number;
  noteWords: number;
  totalTokens: number;
  totalCostUsd: number;
  timeSavedMinutes: number;
}

export interface NoteDraft {
  id: string;
  focus: string;
  highlightsMarkdown: string;
  /** Stable conversation material already reconciled into highlightsMarkdown. */
  capturedHighlightIds: string[];
  /** Explicit saved-note links belonging to this draft. */
  links: NoteReference[];
  aiMarkdown: string;
  myNotesMarkdown: string;
  /** Legacy/composed field retained for storage and vault compatibility. */
  markdown: string;
  filename: string;
  images: ImageHighlight[];
  targetSubfolder: string;
  workspaceId?: string;
  workspaceName?: string;
  responseStats?: AiResponseStats;
  generating?: boolean;
  generationStartedAt?: number;
  generationError?: string;
  savedAt?: number;
  savedPath?: string;
}

export type UnifiedSearchResult =
  | { id: string; kind: 'current'; title: string; subtitle: string; snippet: string; messageId?: string; artifactId?: string; score: number }
  | { id: string; kind: 'history'; title: string; subtitle: string; snippet: string; historyId: string; workspaceId?: string; score: number }
  | { id: string; kind: 'note'; title: string; subtitle: string; snippet: string; noteId: string; filename: string; relativePath: string; wikilink: string; workspaceId?: string; embeddingProfileId?: string; libraryName?: string; score: number; semantic?: boolean };

export interface ProviderAdapter {
  validateKey(apiKey: string): Promise<void>;
  listModelCatalog?(apiKey: string): Promise<OpenRouterModelMetadata[]>;
  listModels(apiKey: string): Promise<string[]>;
  listImageModels?(apiKey: string): Promise<string[]>;
  listVideoModels?(apiKey: string): Promise<string[]>;
  listTranscriptionModels?(apiKey: string): Promise<string[]>;
  listEmbeddingModels?(apiKey: string): Promise<string[]>;
  streamChat(args: {
    apiKey: string;
    model: string;
    context: PageContext;
    systemPrompt: string;
    messages: ChatMessage[];
    webSearchEnabled: boolean;
    webFetchEnabled: boolean;
    functionTools?: ProviderFunctionTool[];
    executeTool?: (name: string, argumentsJson: string) => Promise<ProviderToolExecution>;
    signal: AbortSignal;
    onToken(token: string): void;
  }): Promise<{ usage: ProviderUsage; sources: ChatSource[]; webSearchRequests: number; webFetchRequests: number; noteToolRequests: number; noteReferences: NoteReference[]; noteToolUsage?: ProviderUsage }>;
  streamNote(args: {
    apiKey: string;
    model: string;
    notePrompt: string;
    signal: AbortSignal;
    onToken(token: string): void;
  }): Promise<ProviderUsage>;
  parsePdf(args: {
    apiKey: string;
    model: string;
    filename: string;
    fileData: string;
    prompt?: string;
    signal: AbortSignal;
    onToken(token: string): void;
  }): Promise<ProviderUsage>;
  streamImage?(args: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    question: string;
    attachments: Extract<ChatAttachment, { kind: 'image' }>[];
    signal: AbortSignal;
    onToken(token: string): void;
  }): Promise<ProviderUsage>;
  streamVideo?(args: {
    apiKey: string;
    model: string;
    videoUrl: string;
    prompt: string;
    signal: AbortSignal;
    onToken(token: string): void;
  }): Promise<ProviderUsage>;
  transcribeAudio?(args: {
    apiKey: string;
    model: string;
    audioBase64: string;
    format: string;
    signal: AbortSignal;
  }): Promise<{ text: string; usage: ProviderUsage }>;
}

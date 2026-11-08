import type { MediaTranscriptSegment, VideoTranscriptContext } from './types';

export const MEDIA_TRANSCRIPT_SEGMENT_SECONDS = 45;
export const LONG_MEDIA_CONFIRM_SECONDS = 10 * 60;

export function formatMediaTimestamp(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function composeTimestampedTranscript(segments: MediaTranscriptSegment[]): string {
  return [...segments]
    .sort((a, b) => a.index - b.index)
    .filter((segment) => segment.text.trim())
    .map((segment) => `### ${formatMediaTimestamp(segment.startSeconds)}–${formatMediaTimestamp(segment.endSeconds)}\n\n${segment.text.trim()}`)
    .join('\n\n');
}

export function mediaTranscriptLabel(context: VideoTranscriptContext): string {
  const platform = context.platform === 'instagram' ? 'Instagram Reel' : 'YouTube video';
  return `${platform}: ${context.title}`;
}

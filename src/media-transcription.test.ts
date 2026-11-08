import { describe, expect, it } from 'vitest';
import { composeTimestampedTranscript, formatMediaTimestamp, LONG_MEDIA_CONFIRM_SECONDS, MEDIA_TRANSCRIPT_SEGMENT_SECONDS } from './media-transcription';

describe('media transcription helpers', () => {
  it('uses the planned real-time segment and confirmation thresholds', () => {
    expect(MEDIA_TRANSCRIPT_SEGMENT_SECONDS).toBe(45);
    expect(LONG_MEDIA_CONFIRM_SECONDS).toBe(600);
  });

  it('formats short and long media timestamps', () => {
    expect(formatMediaTimestamp(0)).toBe('0:00');
    expect(formatMediaTimestamp(65.9)).toBe('1:05');
    expect(formatMediaTimestamp(3_661)).toBe('1:01:01');
  });

  it('orders transcript segments chronologically and labels their ranges', () => {
    expect(composeTimestampedTranscript([
      { index: 1, startSeconds: 45, endSeconds: 90, text: 'Second.' },
      { index: 0, startSeconds: 0, endSeconds: 45, text: ' First. ' },
    ])).toBe('### 0:00–0:45\n\nFirst.\n\n### 0:45–1:30\n\nSecond.');
  });
});

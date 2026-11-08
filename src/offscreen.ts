import { MEDIA_TRANSCRIPT_SEGMENT_SECONDS } from './media-transcription';

type CaptureJob = {
  jobId: string;
  stream: MediaStream;
  audioContext: AudioContext;
  recorder: MediaRecorder | null;
  chunks: BlobPart[];
  segmentIndex: number;
  segmentStartSeconds: number;
  segmentStartedAt: number;
  segmentTimer?: number;
  segmentTimerStartedAt: number;
  segmentRemainingMs: number;
  stopping: boolean;
  cancelled: boolean;
  pausedAt?: number;
  pausedDurationMs: number;
};

let active: CaptureJob | null = null;

function supportedMimeType(): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'video/webm;codecs=opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

async function blobBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function clearSegmentTimer(job: CaptureJob): void {
  if (job.segmentTimer) window.clearTimeout(job.segmentTimer);
  job.segmentTimer = undefined;
}

function startSegment(job: CaptureJob): void {
  if (active !== job || job.stopping) return;
  job.chunks = [];
  job.segmentStartedAt = performance.now();
  const mimeType = supportedMimeType();
  const recorder = new MediaRecorder(job.stream, mimeType ? { mimeType } : undefined);
  job.recorder = recorder;
  recorder.ondataavailable = (event) => { if (event.data.size) job.chunks.push(event.data); };
  recorder.onerror = () => void failJob(job, 'The browser audio recorder failed.');
  recorder.onstop = () => void finishSegment(job, recorder.mimeType || mimeType || 'audio/webm');
  recorder.start();
  job.segmentRemainingMs = MEDIA_TRANSCRIPT_SEGMENT_SECONDS * 1000;
  scheduleSegmentStop(job);
}

function scheduleSegmentStop(job: CaptureJob): void {
  job.segmentTimerStartedAt = performance.now();
  job.segmentTimer = window.setTimeout(() => {
    if (job.recorder?.state === 'recording') job.recorder.stop();
  }, job.segmentRemainingMs);
}

async function finishSegment(job: CaptureJob, mimeType: string): Promise<void> {
  clearSegmentTimer(job);
  const elapsedSeconds = Math.max(0, (performance.now() - job.segmentStartedAt - job.pausedDurationMs) / 1000);
  job.pausedDurationMs = 0;
  const endSeconds = job.segmentStartSeconds + elapsedSeconds;
  const blob = new Blob(job.chunks, { type: mimeType });
  if (blob.size > 0) {
    await chrome.runtime.sendMessage({
      target: 'learnr-background',
      type: 'LEARNR_OFFSCREEN_SEGMENT',
      jobId: job.jobId,
      index: job.segmentIndex,
      startSeconds: job.segmentStartSeconds,
      endSeconds,
      mimeType,
      audioBase64: await blobBase64(blob),
    });
    job.segmentIndex += 1;
    job.segmentStartSeconds = endSeconds;
  }
  if (job.stopping) {
    await chrome.runtime.sendMessage({ target: 'learnr-background', type: 'LEARNR_OFFSCREEN_DONE', jobId: job.jobId, cancelled: job.cancelled });
    cleanup(job);
  } else {
    startSegment(job);
  }
}

function cleanup(job: CaptureJob): void {
  clearSegmentTimer(job);
  job.stream.getTracks().forEach((track) => track.stop());
  void job.audioContext.close();
  if (active === job) active = null;
}

async function failJob(job: CaptureJob, error: string): Promise<void> {
  await chrome.runtime.sendMessage({ target: 'learnr-background', type: 'LEARNR_OFFSCREEN_ERROR', jobId: job.jobId, error });
  cleanup(job);
}

async function startCapture(message: { jobId: string; streamId: string; startSeconds?: number; startIndex?: number }): Promise<void> {
  if (active) throw new Error('Another tab audio capture is already active.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } } as MediaTrackConstraints,
    video: false,
  });
  const audioContext = new AudioContext();
  audioContext.createMediaStreamSource(stream).connect(audioContext.destination);
  const job: CaptureJob = {
    jobId: message.jobId,
    stream,
    audioContext,
    recorder: null,
    chunks: [],
    segmentIndex: Math.max(0, Math.floor(message.startIndex ?? 0)),
    segmentStartSeconds: message.startSeconds ?? 0,
    segmentStartedAt: 0,
    stopping: false,
    cancelled: false,
    pausedDurationMs: 0,
    segmentTimerStartedAt: 0,
    segmentRemainingMs: MEDIA_TRANSCRIPT_SEGMENT_SECONDS * 1000,
  };
  active = job;
  startSegment(job);
  await chrome.runtime.sendMessage({ target: 'learnr-background', type: 'LEARNR_OFFSCREEN_READY', jobId: job.jobId });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'learnr-offscreen') return;
  if (message.type === 'LEARNR_OFFSCREEN_START') {
    void startCapture(message).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  const job = active;
  if (!job || job.jobId !== message.jobId) { sendResponse({ ok: false, error: 'Capture is not active.' }); return; }
  if (message.type === 'LEARNR_OFFSCREEN_PAUSE' && job.recorder?.state === 'recording') {
    job.pausedAt = performance.now();
    job.segmentRemainingMs = Math.max(250, job.segmentRemainingMs - (performance.now() - job.segmentTimerStartedAt));
    clearSegmentTimer(job);
    job.recorder.pause();
  } else if (message.type === 'LEARNR_OFFSCREEN_RESUME' && job.recorder?.state === 'paused') {
    if (job.pausedAt) job.pausedDurationMs += performance.now() - job.pausedAt;
    job.pausedAt = undefined;
    job.recorder.resume();
    scheduleSegmentStop(job);
  } else if (message.type === 'LEARNR_OFFSCREEN_STOP') {
    job.stopping = true;
    job.cancelled = Boolean(message.cancelled);
    clearSegmentTimer(job);
    if (job.recorder?.state === 'paused') job.recorder.resume();
    if (job.recorder && job.recorder.state !== 'inactive') job.recorder.stop();
    else void finishSegment(job, job.recorder?.mimeType || 'audio/webm');
  }
  sendResponse({ ok: true });
});

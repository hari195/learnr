import type { AppSettings, MediaProcessingStatus } from './types';

export const PDF_AUTOSTART_DELAY_MS = 5_000;

export function pdfPreflightStatus(mode: AppSettings['pdfExtractionMode']): MediaProcessingStatus {
  return mode === 'manual' ? 'waiting' : 'countdown';
}

export function shouldReconcilePdfPreflight(status: MediaProcessingStatus, mode: AppSettings['pdfExtractionMode']): boolean {
  return status === 'idle' || (status === 'waiting' && mode === 'countdown') || (status === 'countdown' && mode === 'manual');
}

export function canStartPdf(status: MediaProcessingStatus): boolean {
  return ['waiting', 'countdown', 'skipped', 'stopped', 'error'].includes(status);
}

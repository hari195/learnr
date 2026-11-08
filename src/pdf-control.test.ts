import { describe, expect, it } from 'vitest';
import { canStartPdf, PDF_AUTOSTART_DELAY_MS, pdfPreflightStatus, shouldReconcilePdfPreflight } from './pdf-control';

describe('PDF extraction controls', () => {
  it('uses a five-second countdown by default and supports manual waiting', () => {
    expect(PDF_AUTOSTART_DELAY_MS).toBe(5_000);
    expect(pdfPreflightStatus('countdown')).toBe('countdown');
    expect(pdfPreflightStatus('manual')).toBe('waiting');
  });

  it('does not silently restart skipped, stopped, or completed PDFs', () => {
    expect(shouldReconcilePdfPreflight('idle', 'countdown')).toBe(true);
    expect(shouldReconcilePdfPreflight('waiting', 'countdown')).toBe(true);
    expect(shouldReconcilePdfPreflight('countdown', 'manual')).toBe(true);
    expect(shouldReconcilePdfPreflight('skipped', 'countdown')).toBe(false);
    expect(shouldReconcilePdfPreflight('stopped', 'countdown')).toBe(false);
    expect(shouldReconcilePdfPreflight('ready', 'manual')).toBe(false);
  });

  it('offers starts and restarts only for actionable states', () => {
    for (const status of ['waiting', 'countdown', 'skipped', 'stopped', 'error'] as const) expect(canStartPdf(status)).toBe(true);
    expect(canStartPdf('processing')).toBe(false);
    expect(canStartPdf('ready')).toBe(false);
  });
});

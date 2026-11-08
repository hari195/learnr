import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { openOptionsPage } from './browser-bridge';

interface SettingsOverlayProps {
  open: boolean;
  standalone?: boolean;
  dirty?: boolean;
  onClose(): void;
  children: ReactNode;
}

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SettingsOverlay({ open, standalone = false, dirty = false, onClose, children }: SettingsOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(focusable)?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)].filter((element) => element.offsetParent !== null);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0]; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', keydown); restoreFocusRef.current?.focus(); };
  }, [open]);

  async function expand() {
    if (dirty && !window.confirm('Unsaved prompt or suggestion edits cannot move to the full Settings tab. Open it anyway?')) return;
    await openOptionsPage();
  }

  return <div className={`settings-overlay${open ? ' open' : ''}${standalone ? ' standalone' : ''}`} aria-hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="settings-overlay-sheet" role="dialog" aria-modal="true" aria-label="Learnr settings">
      <header className="settings-overlay-toolbar"><strong>Settings</strong><div><button type="button" title="Open full Settings" aria-label="Open full Settings" onClick={() => void expand()}>↗</button><button type="button" title="Close Settings" aria-label="Close Settings" onClick={onClose}>×</button></div></header>
      <div className="settings-overlay-scroll">{children}</div>
    </section>
  </div>;
}

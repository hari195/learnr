import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark } from './BrandMark';
import type { GlobalSettings } from './types';
import { loadGlobalSettings } from './workspaces';
import { globalAppearanceStyle } from './app-appearance';
import { BROWSER_NAME, IS_ARC_BUILD } from './build-target';
import './styles.css';

function MicrophonePermissionPage() {
  const [state, setState] = useState<'ready' | 'requesting' | 'granted' | 'denied'>('ready');
  const [error, setError] = useState('');
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  useEffect(() => { void loadGlobalSettings().then(setGlobalSettings).catch(() => undefined); }, []);

  async function allow() {
    setState('requesting'); setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setState('granted');
      const conversationId = new URLSearchParams(location.search).get('conversation') ?? '';
      await chrome.storage.session.set({ learnrPendingDictation: { conversationId, createdAt: Date.now() } });
      await chrome.runtime.sendMessage({ type: 'LEARNR_MIC_PERMISSION_GRANTED', conversationId });
      setTimeout(() => window.close(), 700);
    } catch (cause) {
      setState('denied');
      setError(cause instanceof Error ? cause.message : `${BROWSER_NAME} did not grant microphone access.`);
      await chrome.runtime.sendMessage({ type: 'LEARNR_MIC_PERMISSION_DENIED' }).catch(() => undefined);
    }
  }

  return <div className="app microphone-permission-page" data-theme="light" style={globalAppearanceStyle(globalSettings, 'light')}><main><BrandMark /><span className="eyebrow">One-time setup</span><h1>Let learnr hear your dictation.</h1><p>{IS_ARC_BUILD ? 'Arc requires microphone permission from a full extension tab.' : 'Chrome cannot display its microphone prompt inside a side panel.'} Grant access here once, then this tab will close and recording will begin in learnr.</p>{state === 'granted' ? <div className="notice success">Microphone enabled. Returning to learnr…</div> : <button className="primary" disabled={state === 'requesting'} onClick={() => void allow()}>{state === 'requesting' ? `Waiting for ${BROWSER_NAME}…` : state === 'denied' ? 'Try again' : 'Allow microphone'}</button>}{error && <div className="notice error">{error}</div>}<small>Audio is sent to OpenRouter only after you finish recording. learnr never stores the recording.</small></main></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><MicrophonePermissionPage /></React.StrictMode>);

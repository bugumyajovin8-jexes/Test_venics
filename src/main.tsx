import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage } from './utils/persistStorage';

// Ask Chrome (esp. for the installed PWA) not to evict our storage under pressure.
// Best-effort and fire-and-forget; iOS relies on the HttpOnly session cookie instead.
void requestPersistentStorage();

registerSW({
  onNeedRefresh() {
    // registerType: 'autoUpdate' — Workbox calls skipWaiting() inside the install event,
    // so the new SW activates immediately and fires 'controllerchange'.
    // The registerSW runtime listens for controllerchange and reloads the page
    // automatically — no manual action needed here.
  },
  onOfflineReady() {
    console.log('[PWA] Ready to work offline.');
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Chrome throttles SW update checks to once per 24 hours for unchanged scripts.
    // Poll every 60 minutes so users receive new builds much faster.
    setInterval(() => {
      registration.update().catch(console.warn);
    }, 60 * 60 * 1000);
  },
});

// The boundary sits OUTSIDE HashRouter and outside App on purpose. A React
// error boundary only catches its descendants, so the one declared inside App
// can catch a page but never App itself — and an uncaught error in App's own
// render tears down the whole root, leaving #root empty and nothing on screen
// but the bare `body` background.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);

// Tell the index.html watchdog that React mounted, so it won't trigger recovery.
(window as any).__reactMounted = true;

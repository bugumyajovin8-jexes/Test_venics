import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { hydrateDurableAuth, requestPersistentStorage } from './utils/durableStorage';

// Register Service Worker for offline PWA support.
// autoUpdate mode: new SW installs and activates automatically.
// App.tsx listens for 'controllerchange' to do the actual page reload
// (with a cart-in-progress guard so mid-sale reloads never happen).
registerSW({
  onOfflineReady() {
    console.log('[SW] App is ready to work offline');
  },
  onRegisteredSW(_swUrl, registration) {
    console.log('[SW] Service worker registered:', registration?.scope);
  },
});

// Restore the auth session from durable native storage (in case the browser/WebView
// evicted localStorage) BEFORE importing App — App transitively creates the Supabase
// client and the store, both of which read storage at module load. App is imported
// dynamically so its module init runs only after rehydration completes.
async function bootstrap() {
  await hydrateDurableAuth();
  void requestPersistentStorage();

  const { default: App } = await import('./App.tsx');

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );

  (window as any).__reactMounted = true;
}

void bootstrap();

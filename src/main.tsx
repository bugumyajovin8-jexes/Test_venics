import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

(window as any).__reactMounted = true;

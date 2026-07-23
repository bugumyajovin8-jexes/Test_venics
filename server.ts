import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import {
  REFRESH_COOKIE,
  readCookie,
  refreshSupabaseSession,
  buildSetCookie,
  buildClearCookie,
  isSecureRequest,
} from './api/_lib/session';

dotenv.config();

// NOTE: This server hosts the Vite frontend (dev) / static build (prod) and mirrors
// the /api/session/* HttpOnly-cookie endpoints (also deployed as Vercel functions).

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // --- HttpOnly cookie session endpoints (mirror of api/session/* for local dev) ---
  app.post('/api/session/set', (req, res) => {
    const refreshToken = req.body?.refresh_token;
    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ error: 'Missing refresh_token' });
      return;
    }
    res.setHeader('Set-Cookie', buildSetCookie(refreshToken, isSecureRequest(req.headers as any)));
    res.status(200).json({ ok: true });
  });

  app.all('/api/session/restore', async (req, res) => {
    const secure = isSecureRequest(req.headers as any);
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (!token) {
      res.status(401).json({ error: 'No session' });
      return;
    }
    const session = await refreshSupabaseSession(token);
    if (!session) {
      res.setHeader('Set-Cookie', buildClearCookie(secure));
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    res.setHeader('Set-Cookie', buildSetCookie(session.refresh_token, secure));
    res.status(200).json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
    });
  });

  app.post('/api/session/clear', (req, res) => {
    res.setHeader('Set-Cookie', buildClearCookie(isSecureRequest(req.headers as any)));
    res.status(200).json({ ok: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

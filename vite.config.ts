/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content Security Policy for production builds. The app makes no
// network requests: everything is bundled and served from the same origin,
// and connect-src only allows the origin itself (for the service worker).
// Dev mode is left without it so Vite's hot reload websocket keeps working.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'mishmash-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});

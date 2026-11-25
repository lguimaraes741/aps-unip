import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Content-Security-Policy no build de produção. O refresh token do painel fica em
 * sessionStorage; a CSP impede que um script injetado (XSS) rode e o leia.
 * Só no build: em desenvolvimento o Vite injeta scripts inline (recarregamento automático).
 */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const api = new URL(apiUrl);
  const ws = `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`;
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Leaflet e atributos style do React usam estilos inline.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: https://tile.openstreetmap.org ${api.origin}`,
    `connect-src 'self' ${api.origin} ${ws}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'alertacidade-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_API_URL ?? 'http://localhost:3000')],
    // Porta padrão do Vite = origem já liberada no CORS da API (CORS_ORIGINS).
    server: { port: 5173, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});

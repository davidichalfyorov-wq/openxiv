import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  // CSRF is handled by JWT-in-cookie (sameSite=lax) at the API layer; the
  // Astro origin check rejects legitimate same-origin multipart uploads when
  // there's a proxy in front, so disable it here.
  security: { checkOrigin: false },
  server: { port: 4321, host: '0.0.0.0' },
  vite: {
    server: {
      watch: { ignored: ['**/_legacy/**'] },
      allowedHosts: ['openxiv.net', 'www.openxiv.net', 'localhost', '127.0.0.1'],
    },
  },
});

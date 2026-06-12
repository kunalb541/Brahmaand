import { defineConfig } from 'vite';

// Plain static SPA. WebXR needs a secure context; http://localhost counts as secure,
// so no HTTPS plugin is required for local dev. For LAN/headset testing, run
// `vite --host` behind a tunnel (see plan/PHASE-0-setup.md / docs/research/deploy-assets.md §5).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  server: { host: true },
});

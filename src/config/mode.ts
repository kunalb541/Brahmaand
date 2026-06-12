/**
 * Pro / Public dual-mode. One codebase, two experiences:
 *   - 'pro'    — professional astronomers: catalogues, classifier detail, RA/Dec readout,
 *                stats, exposure, full survey ladder. (Default — customers are pros first.)
 *   - 'public' — general public: clean sky, search, fly, Tonight, share; research chrome hidden.
 * Selected via URL (?mode=pro|public — wins and persists) or the in-app toggle; stored in
 * localStorage. The two App Store/Play listings can ship with different defaults later by
 * baking ?mode= into the native shell URL.
 */
export type AppMode = 'pro' | 'public';

const KEY = 'brahmaand-mode';

let mode: AppMode = (() => {
  const fromUrl = new URLSearchParams(location.search).get('mode');
  if (fromUrl === 'pro' || fromUrl === 'public') {
    try {
      localStorage.setItem(KEY, fromUrl);
    } catch {
      /* private browsing */
    }
    return fromUrl;
  }
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'pro' || stored === 'public') return stored;
  } catch {
    /* private browsing */
  }
  return 'pro';
})();

const listeners: Array<(m: AppMode) => void> = [];

export function getMode(): AppMode {
  return mode;
}
export function isPro(): boolean {
  return mode === 'pro';
}
export function setMode(m: AppMode): void {
  mode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* private browsing */
  }
  for (const fn of listeners) fn(m);
}
export function onModeChange(fn: (m: AppMode) => void): void {
  listeners.push(fn);
}

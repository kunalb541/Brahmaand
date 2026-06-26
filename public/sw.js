// Brahmaand service worker: offline app shell + cached catalogs/textures, plus a
// capped cache for CORS-fetched CDS HiPS tiles. Dynamic data (SIMBAD/ALeRCE/Sesame) is never
// cached. Bump CACHE_VERSION to invalidate. Registered only in production (see main.ts).
const CACHE_VERSION = 'brahmaand-v4';
const TILE_CACHE = 'brahmaand-tiles-v1';
const TILE_MAX = 1500;

const CDS_TILE_HOSTS = ['alasky.cds.unistra.fr', 'alaskybis.cds.unistra.fr'];
// dynamic services — always go to network, never cache (CDS, ALeRCE, Gaia, VizieR, ANTARES, AAVSO VSX)
const DYNAMIC_HOSTS = [
  'simbad.cds.unistra.fr', 'cds.unistra.fr', 'tapvizier.cds.unistra.fr',
  'api.alerce.online', 'gea.esac.esa.int',
  'api.antares.noirlab.edu', 'antares.noirlab.edu', 'vsx.aavso.org',
];

self.addEventListener('install', (e) => {
  // Precache the shell — fetched fresh ({cache:'reload'} bypasses the 10-min HTTP cache) so offline
  // works from the very first activation rather than relying on an incidental HTTP-cache hit. Never
  // block install on a precache miss.
  e.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((c) => c.add(new Request('./', { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== TILE_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // dynamic catalog/object/transient services → network only
  if (DYNAMIC_HOSTS.includes(url.hostname)) return;

  // hips2fits server-rendered images & cutouts → load natively, no interception. The CORS-forcing
  // cache handler below makes plain <img> loads fail (net::ERR_FAILED) — that broke survey imagery.
  if (url.pathname.includes('hips-image-services')) return;

  // CDS HiPS tiles / cutouts (cross-origin, CORS) → cache-first, capped, CORS-only
  if (CDS_TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req, { mode: 'cors' });
        if (res.ok && res.type === 'cors') {
          cache.put(req, res.clone());
          trimCache(TILE_CACHE, TILE_MAX);
        }
        return res;
      }),
    );
    return;
  }

  // same-origin
  if (url.origin === self.location.origin) {
    // App shell (the page itself) → NETWORK-FIRST so new deploys actually reach users.
    // (Cache-first here pinned every visitor to the FIRST build they ever loaded — they never
    // saw any later deploy.) The HTML references hash-named JS, so a fresh page pulls fresh code.
    //
    // CRITICAL: fetch with { cache: 'no-store' }. GitHub Pages serves the HTML with
    // `Cache-Control: max-age=600`, so a plain fetch() is satisfied from the browser's HTTP cache
    // for 10 min — which silently defeats "network-first" and re-serves the stale shell (→ stale
    // JS hash → stale code) on every refresh. no-store forces a real network hit for the HTML.
    const isShell =
      req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    if (isShell) {
      event.respondWith(
        (async () => {
          try {
            const res = await fetch(req, { cache: 'no-store' });
            if (res.ok) (await caches.open(CACHE_VERSION)).put(req, res.clone());
            return res;
          } catch {
            const cache = await caches.open(CACHE_VERSION);
            return (await cache.match(req)) ?? (await cache.match('./')) ?? Response.error();
          }
        })(),
      );
      return;
    }
    // Same-origin static files, two classes:
    //  • Hash-named build assets (assets/*) + big near-immutable binaries/textures (catalogs/*,
    //    textures/*) → CACHE-FIRST. Hashed names change per build; the binaries change ~never (a
    //    CACHE_VERSION bump covers the rare case) and are too large to re-fetch every load.
    //  • Stable-named, regenerable data (data/*, transients/*) → STALE-WHILE-REVALIDATE: serve the
    //    cached copy instantly but refresh in the background (bypassing the HTTP cache) so a
    //    data-only redeploy (e.g. the nightly transients snapshot) reaches returning users on the
    //    NEXT load — no CACHE_VERSION bump required.
    const isData = url.pathname.includes('/data/') || url.pathname.includes('/transients/');
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit && !isData) return hit; // immutable → cache-first, no network
        const network = fetch(req, isData ? { cache: 'no-store' } : undefined)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit ?? Response.error());
        return hit ?? network; // data: cached copy now + background refresh; any miss: await network
      }),
    );
  }
});

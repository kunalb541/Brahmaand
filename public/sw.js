// Brahmaand service worker (PHASE-8): offline app shell + cached catalogs/textures, plus a
// capped cache for CORS-fetched CDS HiPS tiles. Dynamic data (SIMBAD/ALeRCE/Sesame) is never
// cached. Bump CACHE_VERSION to invalidate. Registered only in production (see main.ts).
const CACHE_VERSION = 'brahmaand-v1';
const TILE_CACHE = 'brahmaand-tiles-v1';
const TILE_MAX = 1500;

const CDS_TILE_HOSTS = ['alasky.cds.unistra.fr', 'alaskybis.cds.unistra.fr'];
// dynamic services — always go to network, never cache
const DYNAMIC_HOSTS = ['simbad.cds.unistra.fr', 'cds.unistra.fr', 'api.alerce.online', 'gea.esac.esa.int'];

self.addEventListener('install', () => self.skipWaiting());

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

  // same-origin app shell + catalogs + textures + data → cache-first, fill on first use
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          // offline and uncached
          return hit ?? Response.error();
        }
      }),
    );
  }
});

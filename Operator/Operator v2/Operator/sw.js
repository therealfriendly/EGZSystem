/* Operator – Service Worker (Offline-Modus)
   Grundregel: IMMER zuerst das Netz fragen (max. ca. 3 s), nur sonst die gespeicherte Kopie nehmen.
   Du bekommst also nach jeder Aenderung an den Dateien sofort den neuen Code, sobald du online bist.
   Der Cache ist nur der Notnagel fuer offline oder sehr langsames Netz. */
'use strict';

// Nach Aenderungen hochzaehlen (z. B. 'operator-1.0.1'). Dann wird der Offline-Speicher
// beim naechsten Start komplett neu gefuellt und alte Caches werden geloescht.
const VERSION = 'operator-1.0.0';
const TIMEOUT_MS = 3000;

// App-Grundgeruest: alles, was index.html laedt, plus Schriften und Icons.
// Neue Dateien in index.html werden beim Installieren zusaetzlich automatisch gefunden (siehe refsFromIndex).
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  'css/base.css', 'css/map.css', 'css/holo.css',
  'css/screens/setup.css', 'css/screens/taverne.css', 'css/screens/kampf.css',
  'css/screens/haus.css', 'css/screens/profil.css', 'css/screens/zauberbude.css',
  'js/vendor/three.min.js',
  'js/core/util.js', 'js/data/constants.js', 'js/data/enemies.js', 'js/data/cardio.js', 'js/data/achievements.js',
  'js/core/store.js', 'js/logic/game.js',
  'js/ui/icons.js', 'js/ui/ui.js', 'js/three/holo.js', 'js/ui/map-config.js', 'js/ui/map.js',
  'js/screens/shells.js', 'js/screens/setup.js', 'js/screens/taverne.js', 'js/screens/schmuggler.js',
  'js/screens/zirkus.js', 'js/screens/arena.js', 'js/screens/kampf.js', 'js/screens/gym.js',
  'js/screens/kalorien.js', 'js/screens/quests.js', 'js/screens/profil.js', 'js/screens/zauberbude.js',
  'js/screens/hilfe.js', 'js/app.js',
  'assets/fonts/chakra-petch-500.woff2', 'assets/fonts/chakra-petch-600.woff2', 'assets/fonts/chakra-petch-700.woff2',
  'assets/map/world.jpg',
  'assets/icons/favicon.svg', 'assets/icons/favicon-32.png', 'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png'
];

/* ---------- Installieren: Grundgeruest speichern ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const urls = Array.from(new Set(SHELL.concat(await refsFromIndex())));
    // Jede Datei einzeln: fehlt eine (404/offline), klappt die Installation trotzdem
    await Promise.allSettled(urls.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (isStorable(res)) await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

// Liest alle lokalen src="..." und href="..." aus index.html (falls du dort Dateien ergaenzt)
async function refsFromIndex() {
  try {
    const html = await (await fetch('./index.html', { cache: 'reload' })).text();
    const found = [];
    html.replace(/\s(?:src|href)="([^"]+)"/g, (m, p) => {
      // nur eigene Dateien: keine fremden Adressen (https:, data:, //), keine Sprungmarken
      if (!/^([a-z]+:|\/\/|#)/i.test(p)) found.push(p.split('#')[0].split('?')[0]);
      return m;
    });
    return found.filter(Boolean);
  } catch (e) {
    return [];
  }
}

/* ---------- Aktivieren: alte Operator-Caches loeschen ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf('operator-') === 0 && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- Nachrichten von der Seite ---------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- Anfragen: Netz zuerst, Cache als Notnagel ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                               // nur Lesen
  if (new URL(req.url).origin !== self.location.origin) return;   // fremde Server: Browser macht es selbst
  if (req.headers.has('range')) return;                           // Teil-Anfragen (Video/Audio) nicht anfassen

  const net = fromNetwork(req);
  event.waitUntil(net.saved);           // SW wach halten, bis die neue Kopie gespeichert ist
  event.respondWith(answer(req, net.res));
});

// Nur echte, vollstaendige Treffer speichern (nie 404, nie Umleitungen).
// Gilt auch fuer Sprites unter assets/sprites/: neu hinzugefuegte Bilder erscheinen so sofort.
function isStorable(res) {
  return !!res && res.status === 200 && res.type === 'basic' && !res.redirected;
}

// Laedt frisch vom Server und legt gute Antworten in den Cache.
// cache 'no-cache' = der Browser fragt beim Server nach (304, wenn unveraendert) statt blind seinen HTTP-Cache zu nehmen.
function fromNetwork(req) {
  let fresh;
  try {
    fresh = req.mode === 'navigate'
      ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : new Request(req, { cache: 'no-cache' });
  } catch (e) {
    fresh = req;
  }
  let saving = Promise.resolve();
  const res = fetch(fresh).then((r) => {
    if (isStorable(r)) {
      const copy = r.clone();
      saving = caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
    }
    return r;
  });
  return { res: res, saved: res.then(() => saving, () => {}) };
}

// Wettlauf: Netz gegen die 3-Sekunden-Uhr
async function answer(req, netRes) {
  const isNav = req.mode === 'navigate';
  const timer = new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS, 'timeout'));
  try {
    const first = await Promise.race([netRes, timer]);
    if (first !== 'timeout') {
      // Server-Fehler (5xx): lieber die letzte gute Kopie zeigen, falls vorhanden
      if (first.status >= 500) return (await fromCache(req, isNav)) || first;
      // Umleitung bei einer Seiten-Navigation sauber an den Browser weitergeben
      if (isNav && first.redirected) return Response.redirect(first.url, 302);
      return first;
    }
    // Netz zu langsam: gespeicherte Kopie nehmen (das Netz laeuft im Hintergrund weiter und aktualisiert den Cache)
    const cached = await fromCache(req, isNav);
    return cached || (await netRes);
  } catch (e) {
    // Offline oder Verbindung abgebrochen
    return (await fromCache(req, isNav)) || Response.error();
  }
}

// Kopie aus dem Cache. Seiten-Navigationen landen offline immer bei index.html.
async function fromCache(req, isNav) {
  const cache = await caches.open(VERSION);
  let hit = await cache.match(req, { ignoreSearch: true });
  if (!hit && isNav) hit = (await cache.match('./index.html')) || (await cache.match('./'));
  return hit || null;
}

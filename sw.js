'use strict';

// A release is immutable. Bump VERSION and changed asset URLs together.
const VERSION = '20260914-iphone2';
const SCOPE = new URL(self.registration.scope);
// CacheStorage is shared by the entire origin, including other GitHub Pages repos.
const PREFIX = 'hksi-offline:' + encodeURIComponent(SCOPE.href) + ':';
const RELEASE_PREFIX = PREFIX + 'release:';
const RELEASE_CACHE = RELEASE_PREFIX + VERSION;
const META_CACHE = PREFIX + 'clients-v1';
const INDEX_URL = new URL('index.html', SCOPE).href;
const MANIFEST_URL = new URL('__hksi_sw__/release', SCOPE).href;
const ACTIVE_URL = new URL('__hksi_sw__/active', SCOPE).href;
const CLIENT_PREFIX = new URL('__hksi_sw__/client/', SCOPE).href;
const CORE_URLS = [
  'index.html',
  'css/app.css?v=20260914-1',
  'css/study.css?v=20260914-1',
  'css/mobile.css?v=20260914-iphone2',
  'data/vault.js?v=20260914-1', // Encrypted static payload only; never decrypted data.
  'js/study.js?v=20260914-iphone2',
  'js/app.js?v=20260914-iphone2',
  'js/install.js?v=20260914-iphone2',
  'js/migration.js?v=20260914-iphone2',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
].map(path => new URL(path, SCOPE).href);
const ASSET_PATHS = new Set(CORE_URLS.map(url => new URL(url).pathname));

function inScope(value) {
  try {
    const url = new URL(value);
    return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  } catch (_) { return false; }
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function unavailable() {
  // Fail closed if storage was evicted. Fetching one new asset into an old page
  // could mix incompatible app and vault releases. The UI can request an update.
  return new Response('離線檔案不完整。請重新開啟頁面，依照畫面指示重新準備離線資料。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function recoveryPage() {
  // A JS string literal, not HTML interpolation. Escape script-closing syntax
  // even though URL serialization normally percent-encodes it already.
  const scopeLiteral = JSON.stringify(SCOPE.href).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return new Response(`<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>重新準備離線資料</title>
<style>body{margin:0;padding:32px 20px;background:#f4f7fc;color:#182334;font:17px/1.7 system-ui,sans-serif}main{max-width:560px;margin:8vh auto}h1{font-size:26px;line-height:1.3}button{min-height:48px;padding:12px 20px;border:0;border-radius:10px;background:#2f6fed;color:white;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.6}#status{min-height:2em}</style>
</head><body><main><h1>離線檔案不完整</h1>
<p>部分離線檔案已遺失或未完整下載。請先連線，再重新準備離線資料；離線時無法重新下載。</p>
<p>這個操作只重設本網站的離線載入方式，不會刪除既有學習紀錄或其他網站的資料。重新載入後，請確認離線資料準備完成，再中斷網路。</p>
<button id="repair" type="button">重新準備離線資料</button>
<p id="status" role="status" aria-live="polite"></p>
<noscript>請啟用 JavaScript 後重新開啟頁面，才能重新準備離線資料。</noscript>
</main><script>
'use strict';
const siteScope = ${scopeLiteral};
const button = document.getElementById('repair');
const status = document.getElementById('status');
button.addEventListener('click', async function () {
  if (navigator.onLine === false) {
    status.textContent = '目前沒有網路連線。請先連線，再重新準備離線資料。';
    return;
  }
  button.disabled = true;
  status.textContent = '正在重新準備本網站的離線載入方式…';
  try {
    const registration = await navigator.serviceWorker.getRegistration(siteScope);
    // getRegistration can match a broader parent scope: never unregister it.
    if (registration && registration.scope !== siteScope) throw new Error('Scope mismatch');
    if (registration) await registration.unregister();
    location.reload();
  } catch (_) {
    status.textContent = '未能重新準備離線資料。請確認網路連線後再試；學習紀錄未被刪除。';
    button.disabled = false;
  }
});
</script></body></html>`, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    }
  });
}

async function readJSON(cacheName, url) {
  if (!(await caches.has(cacheName))) return null;
  const response = await (await caches.open(cacheName)).match(url);
  if (!response) return null;
  try { return await response.json(); } catch (_) { return null; }
}

async function releaseInfo(cacheName) {
  if (typeof cacheName !== 'string' || !cacheName.startsWith(RELEASE_PREFIX)) return null;
  const info = await readJSON(cacheName, MANIFEST_URL);
  if (!info || info.scope !== SCOPE.href || info.schema !== 1 ||
      cacheName !== RELEASE_PREFIX + info.version || !Array.isArray(info.assets) ||
      !info.assets.length || info.assets.length > 64 || !info.assets.includes(INDEX_URL)) return null;
  const unique = new Set(info.assets);
  if (unique.size !== info.assets.length || info.assets.some(value => {
    if (typeof value !== 'string' || !inScope(value)) return true;
    const url = new URL(value);
    return !ASSET_PATHS.has(url.pathname) || url.hash !== '';
  })) return null;
  return info;
}

async function completeRelease(cacheName, expectedURLs) {
  const info = await releaseInfo(cacheName);
  if (!info) return false;
  if (expectedURLs && (info.assets.length !== expectedURLs.length ||
      expectedURLs.some(url => !info.assets.includes(url)))) return false;
  const cache = await caches.open(cacheName);
  const matches = await Promise.all(info.assets.map(url => cache.match(url)));
  return matches.every(response => response && response.ok && response.type !== 'opaque');
}

function validAssetResponse(response, url) {
  if (!response || !response.ok || response.status !== 200 || response.redirected ||
      response.type === 'opaque' || (response.url && response.url !== url)) return false;
  const type = (response.headers.get('Content-Type') || '').toLowerCase();
  const path = new URL(url).pathname;
  if (path.endsWith('.html')) return type.includes('text/html');
  if (path.endsWith('.css')) return type.includes('text/css');
  if (path.endsWith('.js')) return /(?:java|ecma)script/.test(type);
  if (path.endsWith('.png')) return type.includes('image/png');
  return type.includes('json') || type.includes('manifest');
}

async function installRelease() {
  // Re-registering this exact version must not overwrite an installed release.
  if (await completeRelease(RELEASE_CACHE, CORE_URLS)) return;
  try {
    await caches.delete(RELEASE_CACHE); // Only our uncommitted/evicted candidate.
    const cache = await caches.open(RELEASE_CACHE);
    for (const url of CORE_URLS) {
      const response = await fetch(new Request(url, {
        cache: 'reload', credentials: 'same-origin', redirect: 'error'
      }));
      if (!validAssetResponse(response, url) || (await response.clone().arrayBuffer()).byteLength === 0) {
        throw new Error('Invalid offline asset: ' + url);
      }
      await cache.put(url, response);
    }
    // Publication barrier: nobody serves this cache before every write finishes.
    await cache.put(MANIFEST_URL, jsonResponse({
      schema: 1, scope: SCOPE.href, version: VERSION, assets: CORE_URLS
    }));
    if (!(await completeRelease(RELEASE_CACHE, CORE_URLS))) {
      throw new Error('Offline release is incomplete');
    }
  } catch (error) {
    // Sequential fetches/writes mean none can finish after this cleanup.
    await caches.delete(RELEASE_CACHE);
    throw error;
  }
}

async function readPin(clientId) {
  if (!clientId) return null;
  const pin = await readJSON(META_CACHE, CLIENT_PREFIX + encodeURIComponent(clientId));
  return pin && typeof pin.cache === 'string' && pin.cache.startsWith(RELEASE_PREFIX) ? pin.cache : null;
}

async function pinClient(clientId, cacheName) {
  if (!clientId) return;
  const meta = await caches.open(META_CACHE);
  // Only routing metadata is stored here: browser client ID and release name.
  await meta.put(CLIENT_PREFIX + encodeURIComponent(clientId), jsonResponse({ cache: cacheName }));
}

async function activateRelease() {
  if (!(await completeRelease(RELEASE_CACHE, CORE_URLS))) throw new Error('Cannot activate incomplete release');
  const meta = await caches.open(META_CACHE);
  const previousState = await readJSON(META_CACHE, ACTIVE_URL);
  const previous = previousState && previousState.cache !== RELEASE_CACHE &&
    await releaseInfo(previousState.cache) ? previousState.cache : null;
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter(client => inScope(client.url));
  const keep = new Set([RELEASE_CACHE]);
  if (previous) keep.add(previous);
  const livePinURLs = new Set();
  for (const client of clients) {
    livePinURLs.add(CLIENT_PREFIX + encodeURIComponent(client.id));
    let pin = await readPin(client.id);
    if (!pin && previous) {
      // Covers an old page opened before its first controlled navigation.
      pin = previous;
      await pinClient(client.id, pin);
    }
    if (pin) keep.add(pin);
  }
  await meta.put(ACTIVE_URL, jsonResponse({ cache: RELEASE_CACHE }));
  // Keep current, previous and all live-client releases (at most clients + 2).
  // Never delete caches belonging to a different site/subpath on this origin.
  for (const name of await caches.keys()) {
    if (name.startsWith(RELEASE_PREFIX) && !keep.has(name)) await caches.delete(name);
  }
  for (const request of await meta.keys()) {
    if (request.url.startsWith(CLIENT_PREFIX) && !livePinURLs.has(request.url)) await meta.delete(request);
  }
  // No clients.claim(): the first online document finishes loading undisturbed.
  // No reload message: the page changes release only on a subsequent navigation.
}

async function serveAsset(event, url) {
  const navigation = event.request.mode === 'navigate';
  const shell = url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname;
  const key = shell ? INDEX_URL : url.href;
  let cacheName = RELEASE_CACHE;
  if (!navigation && event.clientId) cacheName = await readPin(event.clientId) || RELEASE_CACHE;
  // A cached index is not usable if even one of its required assets is missing.
  // The recovery page has no external assets, so it also works while offline.
  if (navigation && shell && !(await completeRelease(cacheName, CORE_URLS))) return recoveryPage();
  const info = await releaseInfo(cacheName);
  if (!info || !info.assets.includes(key)) return unavailable();
  const response = await (await caches.open(cacheName)).match(key);
  if (!response || !response.ok) return unavailable();
  if (navigation && shell) {
    // A reload creates a new document/client. Existing tabs keep their old pins.
    await pinClient(event.resultingClientId || event.clientId, cacheName);
  } else if (event.clientId && !(await readPin(event.clientId))) {
    await pinClient(event.clientId, cacheName);
  }
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(installRelease());
  // The browser waits for old clients, unless the user sends SKIP_WAITING.
});

self.addEventListener('activate', event => {
  event.waitUntil(activateRelease());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !inScope(event.request.url)) return;
  const url = new URL(event.request.url);
  const isShell = url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname;
  if (!isShell && !ASSET_PATHS.has(url.pathname)) return;
  // Never cache runtime requests, official external links, answers or passwords.
  event.respondWith(serveAsset(event, url).catch(() =>
    isShell && event.request.mode === 'navigate' ? recoveryPage() : unavailable()));
});

self.addEventListener('message', event => {
  if (!event.source || !inScope(event.source.url)) return;
  const type = event.data && event.data.type;
  if (type !== 'STATUS' && type !== 'SKIP_WAITING') return;
  event.waitUntil((async () => {
    let ready = false;
    try { ready = await completeRelease(RELEASE_CACHE, CORE_URLS); } catch (_) { /* storage unavailable */ }
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: 'HKSI_OFFLINE_STATUS', version: VERSION, ready });
    if (type === 'SKIP_WAITING' && ready) await self.skipWaiting();
  })());
});

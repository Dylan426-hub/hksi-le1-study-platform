// Synthetic network/cache fixtures only. No actual vault, password or progress.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');
const scope = 'https://example.github.io/hksi-study/';
const version = source.match(/const VERSION = '([^']+)'/)[1];
const prefix = 'hksi-offline:' + encodeURIComponent(scope) + ':';
const releaseName = value => prefix + 'release:' + value;
const key = value => typeof value === 'string' ? value : value.url;
const plain = value => JSON.parse(JSON.stringify(value));
const mime = url => {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('.html')) return 'text/html';
  if (pathname.endsWith('.css')) return 'text/css';
  if (pathname.endsWith('.js')) return 'application/javascript';
  if (pathname.endsWith('.png')) return 'image/png';
  return 'application/manifest+json';
};

function storage() {
  const all = new Map(), deleted = [], puts = [];
  const config = { failPut: null };
  return {
    all, deleted, puts, config,
    async has(name) { return all.has(name); },
    async open(name) {
      if (!all.has(name)) all.set(name, new Map());
      const values = all.get(name);
      return {
        async match(request) { return values.get(key(request))?.clone(); },
        async put(request, response) {
          if (config.failPut && config.failPut(name, key(request))) throw new Error('Synthetic quota failure');
          puts.push({ name, url: key(request) });
          values.set(key(request), response.clone());
        },
        async delete(request) { return values.delete(key(request)); },
        async keys() { return [...values.keys()].map(url => new Request(url)); }
      };
    },
    async keys() { return [...all.keys()]; },
    async delete(name) { deleted.push(name); return all.delete(name); }
  };
}

function harness(options = {}) {
  const caches = options.caches || storage();
  const handlers = {}, network = [], clients = options.clients || [];
  const state = { online: true, skips: 0, claims: 0, fail: null, response: null };
  const release = options.version || version;
  const self = {
    registration: { scope: options.scope || scope },
    clients: {
      async matchAll() { return clients.slice(); },
      async claim() { state.claims++; }
    },
    async skipWaiting() { state.skips++; },
    addEventListener(name, handler) { handlers[name] = handler; }
  };
  const context = vm.createContext({
    self, caches, URL, Response, Request, Set, console,
    async fetch(request) {
      network.push(request);
      if (!state.online || (state.fail && state.fail(request.url))) throw new Error('Synthetic network failure');
      if (state.response) return state.response(request);
      return new Response(release + ' synthetic ' + request.url, {
        headers: { 'Content-Type': mime(request.url) }
      });
    }
  });
  vm.runInContext(source.replaceAll(version, release) +
    '\nself.__test = {CORE_URLS, RELEASE_CACHE, META_CACHE, MANIFEST_URL, CLIENT_PREFIX, ACTIVE_URL};', context);
  async function dispatch(name, fields = {}) {
    const promises = [];
    handlers[name]({ ...fields, waitUntil(promise) { promises.push(promise); } });
    await Promise.all(promises);
  }
  return {
    caches, state, network, clients, config: self.__test,
    install: () => dispatch('install'), activate: () => dispatch('activate'),
    async message(type, sourceURL = scope) {
      let result;
      await dispatch('message', { data: { type }, source: { id: 'message-client', url: sourceURL },
        ports: [{ postMessage(value) { result = plain(value); } }] });
      return result;
    },
    async request(value, options = {}) {
      let response;
      const request = { url: new URL(value, options.scope || scope).href, method: options.method || 'GET', mode: options.mode || 'cors' };
      handlers.fetch({ request, clientId: options.clientId || '', resultingClientId: options.resultingClientId || '',
        respondWith(promise) { response = promise; } });
      return response ? await response : undefined;
    }
  };
}

test('registration alone is not offline readiness; full installed release is ready', async () => {
  const h = harness();
  assert.deepEqual(await h.message('STATUS'), { type: 'HKSI_OFFLINE_STATUS', version, ready: false });
  assert.equal(h.caches.all.size, 0, 'Status must not create empty caches');
  await h.install();
  assert.equal(h.network.length, 13);
  assert(h.config.CORE_URLS.includes(scope + 'data/vault.js?v=20260914-1'));
  assert(h.config.CORE_URLS.includes(scope + 'js/migration.js?v=' + version));
  assert.deepEqual(await h.message('STATUS'), { type: 'HKSI_OFFLINE_STATUS', version, ready: true });
  assert.equal(h.state.skips, 0, 'Install never forces an update');
  assert(h.network.every(request => request.cache === 'reload' && request.redirect === 'error'));
});

test('all core resources and exact root/index shell requests work offline', async () => {
  const h = harness(); await h.install(); await h.activate(); h.state.online = false;
  const networkCount = h.network.length;
  for (const url of h.config.CORE_URLS) {
    const response = await h.request(url, { clientId: 'tab-a' });
    assert.equal(response.status, 200); assert((await response.text()).startsWith(version));
  }
  for (const url of [scope, scope + '?launch=home', scope + 'index.html', scope + 'index.html?launch=home']) {
    const response = await h.request(url, { mode: 'navigate', resultingClientId: 'new-tab' });
    assert.equal(await response.text(), version + ' synthetic ' + scope + 'index.html');
  }
  assert.equal(h.network.length, networkCount, 'No opportunistic network updates');
  assert.equal(h.state.claims, 0, 'Activation does not claim existing online documents');
});

test('cache responses can be consumed repeatedly without changing the stored release', async () => {
  const h = harness(); await h.install();
  const url = h.config.CORE_URLS[4];
  assert.equal(await (await h.request(url)).text(), await (await h.request(url)).text());
  const before = h.network.length; await h.install();
  assert.equal(h.network.length, before, 'Same version is immutable, including a repeated install');
});

test('network failure cleans only the incomplete candidate and preserves active release', async () => {
  const old = harness({ version: 'test-old' }); await old.install(); await old.activate();
  const oldEntries = old.caches.all.get(releaseName('test-old')).size;
  const h = harness({ caches: old.caches });
  h.state.fail = url => url.includes('data/vault.js');
  await assert.rejects(h.install(), /Synthetic network failure/);
  assert.equal(h.caches.all.has(releaseName(version)), false);
  assert.equal(h.caches.all.get(releaseName('test-old')).size, oldEntries);
  assert.equal((await h.message('STATUS')).ready, false);
  assert.equal(h.state.skips, 0);
});

test('quota failure after partial writes removes candidate without late background writes', async () => {
  const h = harness();
  h.caches.config.failPut = (name, url) => url.includes('js/app.js');
  await assert.rejects(h.install(), /Synthetic quota failure/);
  assert.equal(h.caches.all.has(releaseName(version)), false);
  const count = h.caches.puts.length; await Promise.resolve();
  assert.equal(h.caches.puts.length, count);
  h.caches.config.failPut = null;
  await h.install(); assert.equal((await h.message('STATUS')).ready, true);
});

test('HTTP errors, redirect responses and HTML fallback for JavaScript reject installation', async () => {
  for (const invalid of ['http', 'html', 'redirect']) {
    const h = harness();
    h.state.response = request => {
      if (!request.url.includes('data/vault.js')) return new Response('synthetic asset', { headers: { 'Content-Type': mime(request.url) } });
      if (invalid === 'http') return new Response('missing', { status: 404 });
      if (invalid === 'html') return new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } });
      const response = new Response('redirect', { headers: { 'Content-Type': 'application/javascript' } });
      Object.defineProperty(response, 'redirected', { value: true });
      return response;
    };
    await assert.rejects(h.install(), /Invalid offline asset/);
    assert.equal(h.caches.all.has(releaseName(version)), false);
  }
});

test('zero-byte HTTP 200 assets reject installation before being cached', async () => {
  for (const emptyPath of ['index.html', 'css/app.css', 'data/vault.js', 'icons/icon-512.png']) {
    const h = harness();
    h.state.response = request => new Response(new URL(request.url).pathname.endsWith(emptyPath) ? '' : 'synthetic asset', {
      headers: { 'Content-Type': mime(request.url) }
    });
    await assert.rejects(h.install(), /Invalid offline asset/);
    assert.equal(h.caches.all.has(releaseName(version)), false);
    assert(!h.caches.puts.some(put => new URL(put.url).pathname.endsWith(emptyPath)));
    assert.equal((await h.message('STATUS')).ready, false);
  }
});

test('shell navigation checks the complete release, not just its cached index', async () => {
  const h = harness(); await h.install(); await h.activate();
  h.caches.all.get(releaseName(version)).delete(scope + 'js/app.js?v=' + version);
  h.state.online = false;
  for (const url of [scope, scope + 'index.html', scope + '?launch=home']) {
    const response = await h.request(url, { mode: 'navigate', resultingClientId: 'recover-tab' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const html = await response.text();
    assert(html.includes('重新準備離線資料')); assert(html.includes('不會刪除既有學習紀錄'));
    assert(html.includes('離線時無法重新下載'));
    assert(!/<(?:script|img)\b[^>]*\bsrc\s*=|<link\b/i.test(html), 'Recovery has no required external assets');
  }
  assert.equal((await h.request('js/app.js?v=' + version)).status, 503);
  assert.equal(h.network.length, 13, 'Recovery does not fetch any files automatically');
});

async function recoveryHarness(options = {}) {
  const recoveryScope = options.scope || scope;
  const h = harness({ scope: recoveryScope });
  const response = await h.request(recoveryScope, { mode: 'navigate' });
  const html = await response.text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  let click;
  const button = { disabled: false, addEventListener(type, handler) { assert.equal(type, 'click'); click = handler; } };
  const status = { textContent: '' };
  const state = { lookups: [], unregisters: [], reloads: 0 };
  const navigator = {
    onLine: options.online !== false,
    serviceWorker: {
      async getRegistration(value) {
        state.lookups.push(value);
        if (options.lookupError) throw new Error('Synthetic lookup failure');
        if (options.noRegistration) return undefined;
        return { scope: options.registrationScope || recoveryScope,
          async unregister() {
            state.unregisters.push(options.registrationScope || recoveryScope);
            if (options.unregisterError) throw new Error('Synthetic unregister failure');
            return true;
          } };
      }
    }
  };
  const document = { getElementById(id) { return id === 'repair' ? button : status; } };
  const context = vm.createContext({
    navigator, document, location: { reload() { state.reloads++; } }, console
    // Deliberately no storage/cookie/cache API: recovery must not depend on one.
  });
  vm.runInContext(scripts[0][1], context, { filename: 'synthetic-recovery-inline.js' });
  assert(click);
  return { html, state, button, status, click };
}

test('recovery unregisters only the exact current scope after an explicit online click', async () => {
  const h = await recoveryHarness();
  assert.deepEqual(h.state, { lookups: [], unregisters: [], reloads: 0 }, 'No automatic unregister or reload');
  assert(!/localStorage|sessionStorage|document\.cookie|caches\.delete|indexedDB|\.clear\(/.test(h.html));
  await h.click();
  assert.deepEqual(h.state.lookups, [scope]); assert.deepEqual(h.state.unregisters, [scope]);
  assert.equal(h.state.reloads, 1);
});

test('offline recovery leaves the registration and learning data untouched', async () => {
  const h = await recoveryHarness({ online: false }); await h.click();
  assert.deepEqual(h.state, { lookups: [], unregisters: [], reloads: 0 });
  assert(h.status.textContent.includes('請先連線')); assert.equal(h.button.disabled, false);
});

test('a broader or neighboring service-worker scope can never be unregistered by recovery', async () => {
  for (const registrationScope of ['https://example.github.io/', 'https://example.github.io/another-repo/']) {
    const h = await recoveryHarness({ registrationScope }); await h.click();
    assert.deepEqual(h.state.unregisters, []); assert.equal(h.state.reloads, 0);
    assert(h.status.textContent.includes('學習紀錄未被刪除')); assert.equal(h.button.disabled, false);
  }
});

test('recovery reports registration errors without clearing data or reloading', async () => {
  for (const option of ['lookupError', 'unregisterError']) {
    const h = await recoveryHarness({ [option]: true }); await h.click();
    assert.equal(h.state.reloads, 0); assert.equal(h.button.disabled, false);
    assert(h.status.textContent.includes('未能重新準備離線資料'));
  }
});

test('recovery serializes unusual scope characters as one safe inline script', async () => {
  const unusualScope = new URL('https://example.github.io/scope-\'\"</script>\\u2028/').href;
  const h = await recoveryHarness({ scope: unusualScope }); await h.click();
  assert.deepEqual(h.state.lookups, [unusualScope]); assert.deepEqual(h.state.unregisters, [unusualScope]);
  assert.equal(h.state.reloads, 1);
});

test('readiness checks every asset after installation, not just the completion marker', async () => {
  const h = harness(); await h.install();
  h.caches.all.get(releaseName(version)).delete(scope + 'data/vault.js?v=20260914-1');
  assert.equal((await h.message('STATUS')).ready, false);
  await h.message('SKIP_WAITING'); assert.equal(h.state.skips, 0);
  await assert.rejects(h.activate(), /Cannot activate incomplete release/);
  const before = h.network.length;
  assert.equal((await h.request('data/vault.js?v=20260914-1')).status, 503);
  assert.equal(h.network.length, before, 'An evicted asset cannot silently fetch a different release');
});

test('only explicit valid-scope SKIP_WAITING can force activation', async () => {
  const h = harness(); await h.install();
  await h.message('STATUS'); await h.message('unrelated'); assert.equal(h.state.skips, 0);
  await h.message('SKIP_WAITING', 'https://example.github.io/other-repo/');
  await h.message('SKIP_WAITING', 'https://official.example/'); assert.equal(h.state.skips, 0);
  assert.equal((await h.message('SKIP_WAITING')).ready, true); assert.equal(h.state.skips, 1);
});

test('foreign origin/repos, arbitrary paths and non-GET requests are never intercepted or cached', async () => {
  const h = harness(); await h.install();
  const puts = h.caches.puts.length, networkCount = h.network.length;
  for (const url of [
    'https://official.example/revision.pdf', 'https://example.github.io/other-repo/index.html',
    'https://example.github.io/hksi-study-neighbor/index.html',
    'https://example.github.io/hksi-study/../another/index.html',
    '404.html', 'not-an-app-route', 'data/plain-questions.json', '__hksi_sw__/client/x', 'progress.json'
  ]) assert.equal(await h.request(url, { mode: 'navigate' }), undefined, url);
  assert.equal(await h.request('index.html', { method: 'POST' }), undefined);
  assert.equal(await h.request('index.html', { method: 'HEAD' }), undefined);
  assert.equal(h.caches.puts.length, puts); assert.equal(h.network.length, networkCount);
});

test('unknown asset versions fail closed instead of ignoring query strings or hitting network', async () => {
  const h = harness(); await h.install();
  for (const url of ['js/app.js?v=unknown', 'data/vault.js', 'css/app.css?v=20260914-1&secret=synthetic']) {
    assert.equal((await h.request(url)).status, 503);
  }
  assert.equal(h.network.length, 13);
});

test('activation pins old clients; changed and shared asset keys cannot mix releases', async () => {
  const clients = [{ id: 'old-tab', url: scope }];
  const old = harness({ version: 'test-old', clients }); await old.install(); await old.activate();
  await old.request(scope, { mode: 'navigate', resultingClientId: 'old-tab' });
  const h = harness({ caches: old.caches, clients }); await h.install();
  await h.message('SKIP_WAITING'); await h.activate(); h.state.online = false;
  for (const url of ['js/app.js?v=test-old', 'data/vault.js?v=20260914-1', 'manifest.webmanifest']) {
    assert((await (await h.request(url, { clientId: 'old-tab' })).text()).startsWith('test-old'), url);
  }
  assert.equal((await h.request('js/app.js?v=' + version, { clientId: 'old-tab' })).status, 503);
  assert((await (await h.request(scope, { mode: 'navigate', resultingClientId: 'new-tab' })).text()).startsWith(version));
  assert((await (await h.request('data/vault.js?v=20260914-1', { clientId: 'new-tab' })).text()).startsWith(version));
  assert.equal(h.state.claims, 0);
});

test('worker restart preserves client release pins and activation preserves older live releases', async () => {
  const clients = [{ id: 'a', url: scope }];
  const a = harness({ version: 'test-a', clients }); await a.install(); await a.activate();
  await a.request(scope, { mode: 'navigate', resultingClientId: 'a' });
  const b = harness({ version: 'test-b', caches: a.caches, clients }); await b.install(); await b.activate();
  const c = harness({ version: 'test-c', caches: a.caches, clients }); await c.install(); await c.activate();
  assert(a.caches.all.has(releaseName('test-a')), 'A live tab can be more than one release old');
  const restarted = harness({ version: 'test-c', caches: a.caches, clients });
  assert((await (await restarted.request('manifest.webmanifest', { clientId: 'a' })).text()).startsWith('test-a'));
  clients.length = 0;
  const d = harness({ version: 'test-d', caches: a.caches, clients }); await d.install(); await d.activate();
  assert.deepEqual((await a.caches.keys()).filter(name => name.startsWith(prefix + 'release:')).sort(),
    [releaseName('test-c'), releaseName('test-d')].sort());
  const meta = a.caches.all.get(d.config.META_CACHE);
  assert(![...meta.keys()].some(url => url.startsWith(d.config.CLIENT_PREFIX)), 'Closed-client metadata is bounded');
});

test('activation cleanup never deletes another scope cache even with a similar prefix', async () => {
  const h = harness();
  const foreign = ['workbox-precache-other-app',
    'hksi-offline:' + encodeURIComponent('https://example.github.io/other-repo/') + ':release:old',
    'hksi-offline:' + encodeURIComponent('https://example.github.io/hksi-study-neighbor/') + ':release:old'];
  for (const name of foreign) await (await h.caches.open(name)).put(scope + 'sentinel', new Response('unchanged'));
  await h.install(); await h.activate();
  for (const name of foreign) {
    assert(h.caches.all.has(name)); assert(!h.caches.deleted.includes(name));
    assert.equal(await (await (await h.caches.open(name)).match(scope + 'sentinel')).text(), 'unchanged');
  }
});

test('every persistent entry is a fixed static resource or minimal release-routing metadata', async () => {
  const h = harness(); await h.install(); await h.activate();
  await h.request(scope + '?password=synthetic-never-store', { mode: 'navigate', resultingClientId: 'tab-id' });
  for (const [name, entries] of h.caches.all) {
    for (const [url, response] of entries) {
      assert(url.startsWith(scope)); assert(!url.includes('password'));
      if (name === h.config.META_CACHE) {
        assert.deepEqual(Object.keys(await response.clone().json()), ['cache']);
      } else assert(h.config.CORE_URLS.includes(url) || url === h.config.MANIFEST_URL);
    }
  }
});

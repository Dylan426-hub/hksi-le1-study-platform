// UI/controller tests with synthetic DOM, files, timers and service workers.
// Never reads the real vault, password, browser storage or learning records.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../js/install.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../css/mobile.css'), 'utf8');
const FONT_KEY = 'hksi-le1-font-size';
const plain = value => JSON.parse(JSON.stringify(value));
const validStatus = { type: 'HKSI_OFFLINE_STATUS', ready: true, version: 'synthetic-v1' };
const syntheticBackup = JSON.stringify({ schemaVersion: 1, progress: { attempts: { synthetic: { n: 1 } } }, study: { notes: { synthetic: { text: 'Fixture note' } } } });

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, fields = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }
}

function worker(options = {}) {
  const instance = new Events();
  instance.state = options.state || 'activated';
  instance.status = options.status === undefined ? validStatus : options.status;
  instance.messages = [];
  instance.respond = options.respond !== false;
  instance.pendingPorts = [];
  instance.postMessage = (message, ports = []) => {
    instance.messages.push(plain(message));
    if (options.throwPost) throw new Error('Synthetic postMessage failure');
    if (message.type === 'STATUS') {
      if (instance.respond) queueMicrotask(() => ports[0].postMessage(instance.status));
      else instance.pendingPorts.push(ports[0]);
    }
  };
  instance.transition = state => { instance.state = state; instance.emit('statechange'); };
  return instance;
}

function harness(options = {}) {
  const calls = { register: [], updates: 0, reloads: 0, prepares: 0, exports: 0, inspect: [], restores: [], confirmations: [], reads: [], storage: [], preferences: [] };
  const timers = new Map();
  let timerId = 0, now = 0;
  const document = new Events();
  class Element extends Events {
    constructor(tag) {
      super(); this.tagName = tag.toUpperCase(); this.attributes = {}; this.children = [];
      this.hidden = false; this.disabled = false; this.open = false; this.isConnected = false;
      this.textContent = ''; this.value = ''; this.parentNode = null; this.nodes = new Map();
    }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'open') this.open = true; }
    getAttribute(key) { return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null; }
    removeAttribute(key) { delete this.attributes[key]; if (key === 'open') this.open = false; }
    appendChild(node) { this.children.push(node); node.parentNode = this; node.isConnected = this.isConnected; return node; }
    focus() { document.activeElement = this; }
    closest(selector) {
      const key = /^\[([^\]]+)\]$/.exec(selector)?.[1];
      if (key && Object.hasOwn(this.attributes, key)) return this;
      return this.parentNode?.closest(selector) || null;
    }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
        const attrs = [...match[2].matchAll(/\b(data-[a-z0-9-]+)(?:="([^"]*)")?/g)];
        if (!attrs.length) continue;
        const node = new Element(match[1]); node.hidden = /\bhidden\b/.test(match[2]); node.disabled = /\bdisabled\b/.test(match[2]);
        this.appendChild(node);
        for (const attr of attrs) { node.setAttribute(attr[1], attr[2] || ''); this.nodes.set('[' + attr[1] + ']', node); }
      }
    }
    get innerHTML() { return this.html; }
    querySelector(selector) { return this.nodes.get(selector) || null; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    getBoundingClientRect() { return { left: 20, top: 20, right: 300, bottom: 600 }; }
  }
  document.body = new Element('body'); document.body.isConnected = true;
  document.documentElement = new Element('html'); document.documentElement.style = {};
  document.createElement = tag => new Element(tag);
  document.contains = node => !!node?.isConnected;
  document.activeElement = document.body;
  const entry = document.body.appendChild(new Element('button')); entry.setAttribute('data-pwa-open', '');
  const active = options.active === null ? null : options.active || worker();
  const waiting = options.waiting || null;
  const reg = new Events();
  Object.assign(reg, { active, waiting, installing: options.installing || null,
    update() { calls.updates++; return options.updateError ? Promise.reject(new Error('Synthetic update failure')) : Promise.resolve(); } });
  const serviceWorker = new Events();
  serviceWorker.register = (...args) => {
    calls.register.push(plain(args));
    if (options.registrationError) return Promise.reject(new Error('Synthetic registration failure'));
    return options.registrationPromise || Promise.resolve(reg);
  };
  const navigator = { onLine: options.online !== false, standalone: !!options.standalone,
    storage: { persist: () => Promise.resolve(options.persistent !== false) } };
  if (options.supported !== false) navigator.serviceWorker = serviceWorker;
  class MessageChannel {
    constructor() {
      const first = { onmessage: null, closed: false, close() { this.closed = true; } };
      this.port1 = first;
      this.port2 = { postMessage(data) { if (!first.closed && first.onmessage) first.onmessage({ data }); }, close() {} };
    }
  }
  class FileReader {
    readAsText(file, encoding) {
      calls.reads.push({ size: file.size, encoding });
      const run = () => {
        if (file.failure) { this[file.failure](); return; }
        this.result = file.content; this.onload();
      };
      if (options.deferFile) file.completeRead = run; else queueMicrotask(run);
    }
  }
  const window = new Events();
  Object.assign(window, {
    isSecureContext: options.secure !== false, MessageChannel,
    matchMedia: () => ({ matches: !!options.standalone }),
    location: { reload() { calls.reloads++; } },
    confirm(message) { calls.confirmations.push(message); return options.confirm !== false; },
    HKSIMigration: { MAX_FILE_BYTES: 8 * 1024 * 1024 },
    HKSIApp: {
      isUnlocked: () => options.unlocked !== false,
      prepareReload() { calls.prepares++; return typeof options.prepare === 'function' ? options.prepare(calls.prepares) : options.prepare !== false; },
      exportBackup() { calls.exports++; if (options.exportError) throw new Error('Synthetic export failure'); return true; },
      inspectBackup(raw) { calls.inspect.push(raw); if (options.inspectError) throw new Error('Synthetic invalid backup'); return JSON.parse(raw); },
      restoreBackup(raw) { calls.restores.push(raw); if (options.restoreError) throw new Error('Synthetic storage failure'); return true; }
    }
  });
  // Only the whitelisted, non-sensitive font preference may be persisted here.
  const preferences = new Map([['unrelated-setting', 'synthetic-untouched']]);
  if (options.fontPreference !== undefined) preferences.set(FONT_KEY, options.fontPreference);
  function validateKey(key) {
    if (key !== FONT_KEY) { calls.storage.push(key); throw new Error('Forbidden storage key: ' + key); }
  }
  const fontStorage = {
    getItem(key) {
      validateKey(key); calls.preferences.push({ method: 'get', key });
      if (options.fontReadError) throw new Error('Synthetic preference read failure');
      return preferences.has(key) ? preferences.get(key) : null;
    },
    setItem(key, value) {
      validateKey(key); calls.preferences.push({ method: 'set', key, value });
      if (options.fontWriteError) throw new Error('Synthetic preference write failure');
      preferences.set(key, String(value));
    }
  };
  function getFontStorage() {
    if (options.fontAccessError) throw new Error('Synthetic blocked storage access');
    return fontStorage;
  }
  Object.defineProperty(window, 'localStorage', { get: getFontStorage });
  // All session storage or secret-data access remains forbidden.
  for (const key of ['sessionStorage', 'VAULT', 'HKSI_QUESTIONS']) {
    Object.defineProperty(window, key, { get() { calls.storage.push(key); throw new Error('Forbidden access: ' + key); } });
  }
  const context = vm.createContext({ window, document, navigator, MessageChannel, FileReader, console,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  Object.defineProperty(context, 'localStorage', { get: getFontStorage });
  for (const key of ['sessionStorage']) {
    Object.defineProperty(context, key, { get() { calls.storage.push(key); throw new Error('Forbidden access: ' + key); } });
  }
  vm.runInContext(source, context, { filename: 'install.js' });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const panel = () => document.body.children.find(node => node.tagName === 'DIALOG');
  const node = attr => panel().querySelector('[' + attr + ']');
  return {
    calls, window, navigator, document, active, reg, entry, panel, node, timers, preferences,
    flush,
    async open() { entry.focus(); document.emit('click', { target: entry }); await flush(); return panel(); },
    async click(attr) { panel().emit('click', { target: node(attr) }); await flush(); },
    async font(value) { const select = node('data-install-font-size'); select.value = value; select.emit('change'); await flush(); },
    async import(file) { const input = node('data-install-import'); input.value = 'synthetic-selection'; input.files = file ? [file] : []; input.emit('change'); await flush(); },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    },
    status() { return node('data-offline-status').textContent; },
    state() { return node('data-offline-status').getAttribute('data-state'); },
    notice() { return node('data-install-notice').textContent; }
  };
}

test('registration and an installing worker alone never claim offline readiness', async () => {
  const installing = worker({ state: 'installing' });
  const h = harness({ active: null, installing }); await h.open();
  assert.equal(h.state(), 'pending'); assert(!h.status().includes('離線資料已備妥'));
  assert.equal(h.calls.reloads, 0); assert.equal(installing.messages.length, 0);
  assert.deepEqual(h.calls.register, [['./sw.js', { scope: './', updateViaCache: 'none' }]]);
  installing.transition('installed'); await h.flush();
  assert.notEqual(h.state(), 'ready'); assert.equal(h.calls.reloads, 0);
});

test('typed worker STATUS response is required, not registration/controllerchange events', async () => {
  const active = worker({ respond: false }); const h = harness({ active }); await h.open();
  assert.equal(h.state(), 'pending');
  for (const port of active.pendingPorts) port.postMessage(validStatus);
  await h.flush(); assert.equal(h.state(), 'ready'); assert(h.status().includes('離線資料已備妥'));
  assert.equal(h.node('data-install-version').textContent, '本機離線版本：synthetic-v1');
  assert(active.messages.every(message => Object.keys(message).length === 1 && message.type === 'STATUS'));
  assert.equal(h.calls.reloads, 0); assert.equal(h.timers.size, 0);
});

test('invalid STATUS types and fields cannot report offline readiness', async () => {
  const responses = [null, {}, { ...validStatus, type: 'OTHER' }, { ...validStatus, ready: 'true' }, { ...validStatus, version: 123 }];
  for (const status of responses) {
    const h = harness({ active: worker({ status }) }); await h.open();
    assert.equal(h.state(), 'error'); assert(!h.status().includes('離線資料已備妥'));
    assert.equal(h.calls.reloads, 0);
  }
});

test('incomplete, timed out and failed STATUS checks stay explicitly unready', async () => {
  const incomplete = harness({ active: worker({ status: { ...validStatus, ready: false } }) }); await incomplete.open();
  assert.equal(incomplete.state(), 'error'); assert(incomplete.status().includes('不完整'));
  const timedout = harness({ active: worker({ respond: false }) }); await timedout.open(); await timedout.advance(5000);
  assert.equal(timedout.state(), 'error'); assert(timedout.status().includes('未能核對'));
  const failed = harness({ active: worker({ throwPost: true }) }); await failed.open();
  assert.equal(failed.state(), 'error'); assert.equal(failed.timers.size, 0);
});

test('unsupported/insecure/failed registration reports usable online fallback without reload', async () => {
  for (const config of [{ supported: false }, { secure: false }, { registrationError: true }]) {
    const h = harness(config); await h.open();
    assert.equal(h.state(), 'error'); assert.equal(h.calls.reloads, 0);
    assert(h.status().includes('支援') || h.status().includes('未完成'));
  }
});

test('opening repeatedly reuses one dialog and one registration, close restores connected opener focus', async () => {
  const h = harness(); const first = await h.open();
  assert.equal(h.document.activeElement, h.node('data-install-close'));
  await h.click('data-install-close'); assert.equal(first.open, false); assert.equal(h.document.activeElement, h.entry);
  assert.equal(await h.open(), first); assert.equal(h.calls.register.length, 1);
  first.close(); assert.equal(h.document.activeElement, h.entry);
  await h.open(); h.entry.isConnected = false; first.close();
  assert.notEqual(h.document.activeElement, h.entry, 'A removed opener must not receive focus');
});

test('click inside dialog padding does not close; click outside dialog bounds closes', async () => {
  const h = harness(); await h.open();
  h.panel().emit('click', { target: h.panel(), clientX: 40, clientY: 40 }); assert.equal(h.panel().open, true);
  h.panel().emit('click', { target: h.panel(), clientX: 5, clientY: 5 }); assert.equal(h.panel().open, false);
  assert.equal(h.document.activeElement, h.entry);
});

test('newly waiting update and manual update check never force activation or reload', async () => {
  const waiting = worker({ state: 'installed' }); const h = harness({ waiting }); await h.open();
  assert.equal(h.node('data-install-apply').hidden, false);
  assert.equal(waiting.messages.length, 0); assert.equal(h.calls.reloads, 0);
  await h.click('data-install-check'); assert.equal(h.calls.updates, 1);
  assert(h.notice().includes('按「保存進度並更新」'));
  assert.equal(waiting.messages.length, 0); assert.equal(h.calls.reloads, 0);
});

test('first activation and background updatefound do not reload the current quiz', async () => {
  const installing = worker({ state: 'installing' }); const h = harness({ installing }); await h.open();
  h.reg.emit('updatefound'); installing.transition('installed'); await h.flush();
  installing.transition('activated'); await h.flush();
  assert.equal(h.calls.prepares, 0); assert.equal(h.calls.reloads, 0);
  assert(!installing.messages.some(message => message.type === 'SKIP_WAITING'));
});

test('explicit confirmed update saves before SKIP_WAITING and reloads once after activation', async () => {
  const waiting = worker({ state: 'installed' }); const h = harness({ waiting }); await h.open();
  await h.click('data-install-apply'); assert.equal(h.calls.confirmations.length, 1); assert.equal(h.calls.prepares, 1);
  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]); assert.equal(h.calls.reloads, 0);
  assert.equal(h.node('data-install-apply').disabled, true); assert.equal(h.node('data-install-import').disabled, true);
  waiting.transition('activated'); await h.flush(); assert.equal(h.calls.prepares, 2); assert.equal(h.calls.reloads, 1);
  waiting.transition('activated'); await h.flush(); assert.equal(h.calls.reloads, 1);
});

test('cancelled update and failed prepareReload cannot activate or reload', async () => {
  for (const config of [{ confirm: false }, { prepare: false }]) {
    const waiting = worker({ state: 'installed' }); const h = harness({ ...config, waiting }); await h.open();
    await h.click('data-install-apply'); assert.equal(waiting.messages.length, 0); assert.equal(h.calls.reloads, 0);
    assert.equal(h.node('data-install-apply').disabled, false);
    if (config.prepare === false) assert(h.notice().includes('未開始更新'));
  }
});

test('save failure at activation prevents reload; timeout and redundant worker preserve the page', async () => {
  const waiting = worker({ state: 'installed' }); const h = harness({ waiting, prepare: count => count === 1 }); await h.open();
  await h.click('data-install-apply'); waiting.transition('activated'); await h.flush();
  assert.equal(h.calls.reloads, 0); assert(h.notice().includes('沒有重新開啟'));
  const stalled = harness({ waiting: worker({ state: 'installed' }) }); await stalled.open(); await stalled.click('data-install-apply'); await stalled.advance(15000);
  assert.equal(stalled.calls.reloads, 0); assert(stalled.notice().includes('頁面及進度已保留'));
  const redundant = worker({ state: 'installed' }); const failed = harness({ waiting: redundant }); await failed.open(); await failed.click('data-install-apply');
  redundant.transition('redundant'); await failed.flush(); assert.equal(failed.calls.reloads, 0); assert(failed.notice().includes('未能啟用'));
});

test('failed update check retains verified offline capability and reports the network error', async () => {
  const h = harness({ updateError: true }); await h.open(); await h.click('data-install-check');
  assert.equal(h.state(), 'ready'); assert(h.notice().includes('無法連線'));
  assert.equal(h.node('data-install-notice').getAttribute('data-state'), 'error'); assert.equal(h.calls.reloads, 0);
});

test('install prompt is deferred until explicit click and never reloads the study page', async () => {
  const h = harness(); await h.open(); let prompts = 0;
  assert.equal(h.node('data-install-native').hidden, true);
  const event = h.window.emit('beforeinstallprompt', { prompt() { prompts++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(event.defaultPrevented, true); assert.equal(prompts, 0); assert.equal(h.node('data-install-native').hidden, false);
  await h.click('data-install-native'); assert.equal(prompts, 1); assert.equal(h.node('data-install-native').hidden, true);
  assert(h.notice().includes('已送出安裝請求')); assert.equal(h.calls.reloads, 0);
  h.window.emit('appinstalled'); assert.equal(h.calls.reloads, 0);
});

test('standalone mode and online/offline changes keep the verified status accurate', async () => {
  const h = harness({ standalone: true }); await h.open();
  assert(h.node('data-install-mode').textContent.includes('主屏幕 App 模式'));
  h.window.emit('beforeinstallprompt', { prompt() { throw new Error('Must not auto-prompt'); } });
  assert.equal(h.node('data-install-native').hidden, true);
  h.navigator.onLine = false; h.window.emit('offline'); assert(h.status().includes('目前離線'));
  h.navigator.onLine = true; h.active.status = { ...validStatus, ready: false }; h.window.emit('online'); await h.flush();
  assert.equal(h.state(), 'error'); assert(h.status().includes('不完整'));
});

test('locked UI disables migration/export and rejects import without reading any file', async () => {
  const h = harness({ unlocked: false }); await h.open();
  assert.equal(h.node('data-install-import').disabled, true); assert.equal(h.node('data-install-export').disabled, true);
  assert.equal(h.node('data-install-unlock').hidden, false);
  await h.click('data-install-export'); await h.import({ size: 100, content: syntheticBackup });
  assert.equal(h.calls.exports, 0); assert.equal(h.calls.reads.length, 0); assert.equal(h.calls.restores.length, 0);
  assert.equal(h.node('data-install-import').value, ''); assert(h.notice().includes('請先輸入口令'));
});

test('export invokes the app boundary but never stores or reads passwords or learning persistence', async () => {
  const h = harness(); await h.open(); await h.click('data-install-export');
  assert.equal(h.calls.exports, 1); assert(h.notice().includes('已請求下載'));
  assert.equal(h.calls.reloads, 0); assert.deepEqual(h.calls.storage, []);
  const failing = harness({ exportError: true }); await failing.open(); await failing.click('data-install-export');
  assert(failing.notice().includes('無法產生下載')); assert.equal(failing.calls.reloads, 0);
});

test('confirmed synthetic import validates first, delegates restore, clears selection and reloads', async () => {
  const h = harness(); await h.open(); await h.import({ size: Buffer.byteLength(syntheticBackup), content: syntheticBackup });
  assert.deepEqual(h.calls.inspect, [syntheticBackup]); assert.deepEqual(h.calls.restores, [syntheticBackup]);
  assert(h.calls.confirmations[0].includes('1 道作答記錄、1 篇筆記'));
  assert.equal(h.node('data-install-import').value, ''); assert.equal(h.calls.reloads, 1);
  assert.deepEqual(h.calls.storage, []); assert(h.calls.reads.every(item => item.encoding === 'UTF-8'));
});

test('cancelled, empty and oversized import do not restore or reload', async () => {
  const cancelled = harness({ confirm: false }); await cancelled.open(); await cancelled.import({ size: 100, content: syntheticBackup });
  assert.equal(cancelled.calls.inspect.length, 1); assert.equal(cancelled.calls.restores.length, 0); assert.equal(cancelled.calls.reloads, 0);
  const h = harness(); await h.open();
  for (const file of [null, { size: 0, content: '' }, { size: 8 * 1024 * 1024 + 1, content: syntheticBackup }]) await h.import(file);
  assert.equal(h.calls.reads.length, 0); assert.equal(h.calls.restores.length, 0); assert.equal(h.calls.reloads, 0);
});

test('invalid backup, restore failure and file read errors never reload or claim success', async () => {
  for (const config of [{ inspectError: true }, { restoreError: true }]) {
    const h = harness(config); await h.open(); await h.import({ size: 100, content: syntheticBackup });
    assert.equal(h.calls.reloads, 0); assert.equal(h.node('data-install-notice').getAttribute('data-state'), 'error');
    assert(!h.notice().includes('已遷入，正在'));
  }
  for (const failure of ['onerror', 'onabort']) {
    const h = harness(); await h.open(); await h.import({ size: 100, content: syntheticBackup, failure });
    assert.equal(h.calls.inspect.length, 0); assert.equal(h.calls.restores.length, 0); assert.equal(h.calls.reloads, 0);
    assert(h.notice().includes('沒有遷入任何資料'));
  }
});

test('requesting storage persistence never stores a password or falsely guarantees data safety', async () => {
  const h = harness(); await h.open(); await h.click('data-install-persist');
  assert(h.notice().includes('手動清除或刪除 App 仍可能移除資料')); assert.deepEqual(h.calls.storage, []);
  const denied = harness({ persistent: false }); await denied.open(); await denied.click('data-install-persist');
  assert(denied.notice().includes('尚未允許')); assert.equal(denied.node('data-install-notice').getAttribute('data-state'), 'error');
});

test('font preference restores only the four allowed sizes without writing on load', async () => {
  for (const value of ['100', '125', '150', '200']) {
    const h = harness({ fontPreference: value }); await h.open();
    assert.equal(h.document.documentElement.style.fontSize, value + '%');
    assert.equal(h.node('data-install-font-size').value, value);
    assert.deepEqual(h.calls.preferences, [{ method: 'get', key: FONT_KEY }]);
    assert.equal(h.node('data-install-font-notice').hidden, true);
    assert.equal(h.calls.reloads, 0); assert.deepEqual(h.calls.storage, []);
  }
});

test('font changes apply immediately and persist only the dedicated non-sensitive preference', async () => {
  const h = harness({ unlocked: false }); await h.open();
  assert.equal(h.document.documentElement.style.fontSize, '100%');
  for (const value of ['125', '150', '200', '100']) {
    await h.font(value);
    assert.equal(h.document.documentElement.style.fontSize, value + '%');
    assert.equal(h.preferences.get(FONT_KEY), value); assert.equal(h.node('data-install-font-size').value, value);
  }
  assert(h.calls.preferences.every(call => call.key === FONT_KEY));
  assert.equal(h.preferences.get('unrelated-setting'), 'synthetic-untouched');
  assert.equal(h.calls.reloads, 0); assert.equal(h.calls.prepares, 0); assert.deepEqual(h.calls.storage, []);
  await h.click('data-install-close'); await h.open(); assert.equal(h.node('data-install-font-size').value, '100');
});

test('missing and invalid saved font values fall back safely without mutating stored values', async () => {
  for (const value of [undefined, '', '0', '300', '200%', '200; color:red', ' 125', '__proto__', 'NaN']) {
    const h = harness({ fontPreference: value }); await h.open();
    assert.equal(h.document.documentElement.style.fontSize, '100%');
    assert.equal(h.node('data-install-font-size').value, '100');
    assert(!h.calls.preferences.some(call => call.method === 'set'));
    assert.equal(h.preferences.get(FONT_KEY), value);
  }
});

test('tampered font selection is rejected without applying CSS or writing preferences', async () => {
  const h = harness({ fontPreference: '150' }); await h.open();
  for (const value of ['900', '200%', '150; color:red', null, 200]) {
    await h.font(value);
    assert.equal(h.document.documentElement.style.fontSize, '150%');
    assert.equal(h.node('data-install-font-size').value, '150');
    assert.equal(h.preferences.get(FONT_KEY), '150');
  }
  assert(!h.calls.preferences.some(call => call.method === 'set'));
});

test('font storage read/access failures retain a working default and do not block offline status', async () => {
  for (const config of [{ fontReadError: true }, { fontAccessError: true }]) {
    const h = harness(config); await h.open();
    assert.equal(h.document.documentElement.style.fontSize, '100%'); assert.equal(h.state(), 'ready');
    assert(h.node('data-install-font-notice').textContent.includes('未能讀取'));
    assert.equal(h.node('data-install-font-notice').hidden, false);
    await h.font('200'); assert.equal(h.document.documentElement.style.fontSize, '200%');
    if (config.fontAccessError) assert(h.node('data-install-font-notice').textContent.includes('未能儲存'));
    else assert.equal(h.node('data-install-font-notice').hidden, true);
    assert.equal(h.calls.reloads, 0); assert.deepEqual(h.calls.storage, []);
  }
});

test('font write failure keeps the chosen size for this page, warns and preserves prior storage', async () => {
  const h = harness({ fontPreference: '125', fontWriteError: true }); await h.open(); await h.font('200');
  assert.equal(h.document.documentElement.style.fontSize, '200%'); assert.equal(h.node('data-install-font-size').value, '200');
  assert.equal(h.preferences.get(FONT_KEY), '125'); assert.equal(h.preferences.get('unrelated-setting'), 'synthetic-untouched');
  assert(h.node('data-install-font-notice').textContent.includes('已套用，但未能儲存'));
  assert.equal(h.node('data-install-font-notice').hidden, false); assert.equal(h.state(), 'ready');
  assert.equal(h.calls.reloads, 0); assert.deepEqual(h.calls.storage, []);
});

test('module CSS preserves hidden controls and iPhone tap/input sizes', () => {
  assert(/\.install-panel\s+\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));
  assert(/\.iconbtn\s*\{[^}]*width:\s*44px\s*!important[^}]*height:\s*44px\s*!important/s.test(css));
  assert(/font-size:\s*max\(16px,\s*1rem\)/.test(css));
  assert(/\.app-entry\s*\{[^}]*width:\s*100%[^}]*text-align:\s*left[^}]*color:\s*inherit/s.test(css));
  assert(/prefers-reduced-motion:\s*reduce/.test(css));
});

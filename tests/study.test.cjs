/* Run with Node.js: node site/tests/study.test.cjs
 * Isolated VM checks using synthetic questions, cards and browser APIs.
 * Does not decrypt the question bank or access real browser storage.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../js/study.js'), 'utf8');
const KEY = 'hksi-le1-study-v1';
const DAY = 86400000;

function harness(options = {}) {
  const listeners = Object.create(null);
  const storage = Object.create(null);
  const downloads = [];
  const blobs = new Map();
  let saveFails = false;
  let confirmResult = true;
  let html = '';
  let nextBlobId = 1;
  let opened = null;
  if (options.seed !== undefined) storage[KEY] = options.seed;

  const document = {
    body: { appendChild() {}, removeChild() {} },
    addEventListener(name, callback) {
      (listeners[name] || (listeners[name] = [])).push(callback);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement(tag) {
      assert.equal(tag, 'a', 'Only synthetic anchor creation is expected');
      let parsed;
      return {
        style: {},
        set href(value) { parsed = new URL(value); },
        get href() { return parsed.href; },
        get protocol() { return parsed.protocol; },
        get hostname() { return parsed.hostname; },
        get port() { return parsed.port; },
        get username() { return parsed.username; },
        get password() { return parsed.password; },
        click() { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); }
      };
    }
  };
  const window = {
    localStorage: {
      getItem(key) { return storage[key] === undefined ? null : storage[key]; },
      setItem(key, value) {
        if (saveFails) throw new Error('Synthetic quota error');
        storage[key] = value;
      }
    },
    confirm() { return confirmResult; },
    URL: {
      createObjectURL(blob) {
        const url = 'blob:https://study.example.test/' + nextBlobId++;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL() {}
    },
    setTimeout() {}
  };
  function FileReader() {}
  FileReader.prototype.readAsText = function (file) {
    if (file.readError) { this.onerror(); return; }
    this.result = file.content;
    this.onload();
  };

  const questions = options.questions || [
    { id: 'q1', ch: 1, q: '虛構測試題 <script>alert(1)</script>', code: 'TEST-1' },
    { id: 'q2', ch: 2, q: '另一道虛構測試題', code: 'TEST-2' }
  ];
  const cards = options.cards || [
    {
      id: 'c1', ch: 1, front: '測試卡片正面', back: '測試答案與例外 <img src=x>',
      revision: 'v1', checkedAt: '2026-09-14', questionIds: ['q1'],
      sourceRefs: [
        { title: 'Official-domain test', url: 'https://www.sfc.hk/test', locator: '虛構定位標籤' },
        { title: 'Host-spoof test', url: 'https://www.sfc.hk.example.test/test' }
      ]
    },
    { id: 'c2', ch: 2, front: '第二張測試卡片', back: '第二個測試答案', revision: 'v1' }
  ];

  vm.runInNewContext(source, { window, document, Blob, Date, FileReader }, { filename: 'study.js' });
  const api = window.StudyTools;
  function init() {
    api.init({
      questions, cards,
      redraw() { html = api.render(); },
      openQuestion(id) { opened = id; }
    });
  }
  init();

  function emit(type, act, id, value, files) {
    const element = {
      value, files, disabled: false,
      getAttribute(key) {
        return key === 'data-study-act' ? act : key === 'data-study-id' ? id : null;
      }
    };
    const event = { target: element, preventDefault() {}, stopPropagation() {} };
    (listeners[type] || []).forEach(callback => callback(event));
  }
  function click(act, id) { emit('click', act, id); }
  function input(id, value) { emit('input', 'note-text', id, value); }
  function importJSON(value, fileOptions = {}) {
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    const file = Object.assign({ size: Buffer.byteLength(content), content }, fileOptions);
    emit('change', 'import', null, '', [file]);
  }
  return {
    api, storage, questions, cards, downloads, listeners, init, emit, click, input, importJSON,
    getHTML() { return html; },
    read() { return storage[KEY] ? JSON.parse(storage[KEY]) : null; },
    setSaveFails(value) { saveFails = value; },
    setConfirm(value) { confirmResult = value; },
    openedQuestion() { return opened; }
  };
}

function backup(notes = {}, reviews = {}) {
  return { schemaVersion: 1, notes, reviews };
}

test('new cards are due, answer is hidden and grading is blocked before reveal', () => {
  const h = harness();
  assert.equal(h.api.countDue(), 2);
  assert.ok(!h.api.render().includes('測試答案與例外'));
  h.click('rate-good', 'c1');
  assert.equal(h.read(), null);
});

test('revealing an answer escapes markup and keeps official sources collapsed', () => {
  const h = harness();
  h.api.render();
  h.click('reveal', 'c1');
  const html = h.getHTML();
  assert.ok(html.includes('測試答案與例外 &lt;img src=x&gt;'));
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('<details class="study-sources">'));
  assert.ok(html.includes('核查日期：2026-09-14'));
  assert.ok(html.includes('非官方速記'));
});

test('official URL allowlist rejects host spoofing, credentials, HTTP and other domains', () => {
  const cards = [{
    id: 'c1', ch: 1, front: 'Synthetic front', back: 'Synthetic back', revision: 'v1',
    sourceRefs: [
      { title: 'Allowed SFC', url: 'https://www.sfc.hk/test' },
      { title: 'Allowed HKSI', url: 'https://www.hksi.org/test' },
      { title: 'Spoof', url: 'https://sfc.hk.example.test/test' },
      { title: 'HTTP', url: 'http://sfc.hk/test' },
      { title: 'Credential URL', url: 'https://reader@sfc.hk/test' },
      { title: 'Other', url: 'https://example.test/test' },
      { title: 'Script URL', url: 'javascript:alert(1)' }
    ]
  }];
  const h = harness({ cards });
  const html = h.api.render();
  assert.ok(html.includes('href="https://www.sfc.hk/test"'));
  assert.ok(html.includes('href="https://www.hksi.org/test"'));
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 2);
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('來源網址未通過官方網域檢查'));
});

test('successful grading schedules the selected interval and advances to the next card', () => {
  const h = harness();
  h.api.render();
  h.click('reveal', 'c1');
  const now = Date.now();
  h.click('rate-good', 'c1');
  const review = h.read().reviews.c1;
  assert.equal(review.intervalDays, 1);
  assert.equal(review.reps, 1);
  assert.ok(Math.abs(review.dueAt - (now + DAY)) < 1000);
  assert.equal(h.api.countDue(), 1);
  assert.ok(h.getHTML().includes('第二張測試卡片'));
  assert.ok(!h.getHTML().includes('第二個測試答案'));
});

test('familiar intervals grow through 1, 3, 7, 14, 28, 56 and cap at 60 days', () => {
  const h = harness();
  for (const expected of [1, 3, 7, 14, 28, 56, 60, 60]) {
    h.click('review-all');
    // Initially due cards sort first, so advance to c1 if c2 is still new.
    if (h.getHTML().includes('第二張測試卡片')) {
      h.click('reveal', 'c2');
      h.click('rate-good', 'c2');
    }
    h.click('reveal', 'c1');
    h.click('rate-good', 'c1');
    assert.equal(h.read().reviews.c1.intervalDays, expected);
  }
});

test('again and hard use ten minutes and one day', () => {
  const h = harness();
  h.api.render();
  h.click('reveal', 'c1');
  h.click('rate-again', 'c1');
  assert.equal(h.read().reviews.c1.intervalDays * DAY, 600000);
  h.click('reveal', 'c2');
  h.click('rate-hard', 'c2');
  assert.equal(h.read().reviews.c2.intervalDays, 1);
});

test('card revision changes mark the card due and reset its familiar interval', () => {
  const h = harness();
  h.api.render();
  h.click('reveal', 'c1');
  h.click('rate-good', 'c1');
  h.cards[0].revision = 'v2';
  h.init();
  assert.equal(h.api.countDue(), 2);
  h.click('review-due');
  assert.ok(h.getHTML().includes('卡片內容已更新'));
  h.click('reveal', 'c1');
  h.click('rate-good', 'c1');
  assert.equal(h.read().reviews.c1.intervalDays, 1);
  assert.equal(h.read().reviews.c1.revision, 'v2');
});

test('notes autosave, reason is optional and all HTML values are escaped', () => {
  const h = harness();
  h.input('q1', '<script>synthetic note</script>');
  h.emit('change', 'note-reason', 'q1', 'condition');
  const note = h.read().notes.q1;
  assert.equal(note.text, '<script>synthetic note</script>');
  assert.equal(note.reason, 'condition');
  assert.ok(h.api.noteHTML({ id: 'q1' }).includes('&lt;script&gt;synthetic note&lt;/script&gt;'));
  assert.equal(h.api.noteHTML({ id: 'unknown' }), '');
  h.click('tab-notes');
  assert.ok(!h.getHTML().includes('<script>alert(1)</script>'));
  assert.ok(h.getHTML().includes('條件或例外混淆'));
});

test('quota failure keeps note drafts visible and retry saves them', () => {
  const h = harness();
  h.input('q1', 'persisted note');
  h.setSaveFails(true);
  h.input('q1', 'unsaved draft');
  assert.equal(h.read().notes.q1.text, 'persisted note');
  assert.ok(h.api.noteHTML({ id: 'q1' }).includes('unsaved draft'));
  assert.ok(h.api.noteHTML({ id: 'q1' }).includes('尚未寫入'));
  h.setSaveFails(false);
  h.click('retry-save');
  assert.equal(h.read().notes.q1.text, 'unsaved draft');
});

test('a failed review save does not advance or create a persisted review', () => {
  const h = harness();
  h.api.render();
  h.click('reveal', 'c1');
  h.setSaveFails(true);
  h.click('rate-good', 'c1');
  assert.equal(h.read(), null);
  assert.ok(h.api.render().includes('本次速記評分未保存'));
  assert.ok(h.api.render().includes('測試答案與例外'));
  h.setSaveFails(false);
  h.click('rate-good', 'c1');
  assert.equal(h.read().reviews.c1.reps, 1);
});

test('malformed JSON, unexpected schema fields and invalid data reject the whole import', () => {
  const h = harness();
  h.input('q1', 'keep original');
  const before = h.storage[KEY];
  const badFiles = [
    '{not JSON',
    { schemaVersion: 2, notes: {}, reviews: {} },
    { schemaVersion: 1, notes: {}, reviews: {}, extra: true },
    backup({ q2: { text: 'invalid reason', reason: 'unrecognised', updatedAt: Date.now() } }),
    backup({ q2: { text: 'future', reason: '', updatedAt: Date.now() + DAY } }),
    backup({}, { c1: { dueAt: Date.now(), intervalDays: -1, reps: 1, revision: 'v1' } }),
    backup({}, { c1: { dueAt: Date.now() + DAY, intervalDays: 1, reps: 0, revision: 'v1' } }),
    '{"schemaVersion":1,"notes":{"__proto__":{"text":"bad","reason":"","updatedAt":1}},"reviews":{}}'
  ];
  for (const incoming of badFiles) {
    h.importJSON(incoming);
    assert.equal(h.storage[KEY], before);
    assert.ok(h.api.render().includes('備份校驗失敗'));
  }
});

test('import merges only newer known notes and preserves existing notes', () => {
  const h = harness();
  h.input('q1', 'newer local note');
  const incoming = backup({
    q1: { text: 'older import', reason: '', updatedAt: Date.now() - 10000 },
    q2: { text: 'known imported note', reason: 'other', updatedAt: Date.now() },
    unknown: { text: 'unknown imported note', reason: '', updatedAt: Date.now() }
  });
  h.importJSON(incoming);
  assert.equal(h.read().notes.q1.text, 'newer local note');
  assert.equal(h.read().notes.q2.text, 'known imported note');
  assert.equal(h.read().notes.unknown, undefined);
  assert.ok(h.api.render().includes('合併 1 筆'));
});

test('review imports choose newer review action rather than a larger due date', () => {
  const now = Date.now();
  const h = harness({ seed: JSON.stringify(backup({}, {
    c1: { dueAt: now - 10000 + 60 * DAY, intervalDays: 60, reps: 8, revision: 'v1' }
  })) });
  h.importJSON(backup({}, {
    c1: { dueAt: now + DAY, intervalDays: 1, reps: 9, revision: 'v1' },
    unknown: { dueAt: now + DAY, intervalDays: 1, reps: 1, revision: 'v1' }
  }));
  assert.equal(h.read().reviews.c1.intervalDays, 1);
  assert.equal(h.read().reviews.c1.reps, 9);
  assert.equal(h.read().reviews.unknown, undefined);
});

test('imports over one megabyte and unreadable files do not alter storage', () => {
  const h = harness();
  h.input('q1', 'keep note');
  const before = h.storage[KEY];
  h.importJSON('{}', { size: 1048577 });
  assert.equal(h.storage[KEY], before);
  assert.ok(h.api.render().includes('超過 1 MB'));
  h.importJSON('{}', { readError: true });
  assert.equal(h.storage[KEY], before);
  assert.ok(h.api.render().includes('備份讀取失敗'));
});

test('failed import persistence leaves the pre-import data intact', () => {
  const h = harness();
  h.input('q1', 'keep note');
  const before = h.storage[KEY];
  h.setSaveFails(true);
  h.importJSON(backup({ q2: { text: 'not saved', reason: '', updatedAt: Date.now() } }));
  assert.equal(h.storage[KEY], before);
  assert.ok(h.api.render().includes('匯入尚未完成'));
  assert.ok(!h.api.noteHTML({ id: 'q2' }).includes('not saved'));
});

test('deletion requires confirmation and a prior backup can restore the deleted note', () => {
  const h = harness();
  h.input('q1', 'restorable note');
  const saved = h.read();
  h.setConfirm(false);
  h.click('delete-note', 'q1');
  assert.equal(h.read().notes.q1.text, 'restorable note');
  h.setConfirm(true);
  h.click('delete-note', 'q1');
  assert.equal(h.read().notes.q1, undefined);
  h.importJSON(saved);
  assert.equal(h.read().notes.q1.text, 'restorable note');
});

test('corrupt local storage is protected against overwrite', () => {
  const h = harness({ seed: '{invalid' });
  h.input('q1', 'temporary page note');
  assert.equal(h.storage[KEY], '{invalid');
  assert.ok(h.api.render().includes('停止寫入'));
  assert.ok(h.api.noteHTML({ id: 'q1' }).includes('temporary page note'));
});

test('unknown local IDs are retained in storage but never shown as personal notes', () => {
  const h = harness({ seed: JSON.stringify(backup({
    unknown: { text: 'retain but do not display', reason: '', updatedAt: Date.now() }
  })) });
  h.input('q1', 'known note');
  h.click('tab-notes');
  assert.equal(h.read().notes.unknown.text, 'retain but do not display');
  assert.ok(!h.getHTML().includes('retain but do not display'));
});

test('export produces the exact backup schema including unsaved note drafts', async () => {
  const h = harness();
  h.setSaveFails(true);
  h.input('q1', 'export this unsaved draft');
  h.click('export');
  assert.equal(h.downloads.length, 1);
  const exported = JSON.parse(await h.downloads[0].blob.text());
  assert.deepEqual(Object.keys(exported).sort(), ['notes', 'reviews', 'schemaVersion']);
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.notes.q1.text, 'export this unsaved draft');
  assert.ok(h.downloads[0].filename.endsWith('.json'));
});

test('question links only invoke the callback for known IDs', () => {
  const h = harness();
  h.click('open-question', 'unknown');
  assert.equal(h.openedQuestion(), null);
  h.click('open-question', 'q1');
  assert.equal(h.openedQuestion(), 'q1');
});

test('repeated initialisation does not duplicate listeners or read unrelated storage', () => {
  const h = harness();
  h.init(); h.init();
  assert.equal(h.listeners.click.length, 1);
  assert.equal(h.listeners.input.length, 1);
  assert.equal(h.listeners.change.length, 1);
  assert.equal(h.listeners.keydown.length, 1);
  h.input('q1', 'one note');
  assert.deepEqual(Object.keys(h.storage), [KEY]);
});

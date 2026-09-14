// Synthetic fixtures only. The migration module cannot read or write browser data.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const modulePath = path.resolve(__dirname, '../js/migration.js');
const window = {};
for (const key of ['localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest']) {
  Object.defineProperty(window, key, { get() { throw new Error('Forbidden access: ' + key); } });
}
vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), { window }, { filename: modulePath });
const api = window.HKSIMigration;
const AT = 1800000000000;
const DAY = 86400000;
const QIDS = ['synthetic-a', 'synthetic-b', 'synthetic-retired'];
const CIDS = ['synthetic-card', 'synthetic-old-card'];
const plain = o => JSON.parse(JSON.stringify(o));
function blank() {
  return {
    schemaVersion: 1, exportedAt: new Date(AT).toISOString(), study: null,
    progress: {
      view: 'home', theme: 'light', lang: 'both', attempts: {}, favorites: [], wrongRemoved: [], examHistory: [], archivedSessions: [],
      practice: { phase: 'setup', chs: [], srcs: ['bank', 'past2006', 'sample2023'], scope: 'all', order: 'seq', queue: [], idx: 0, sel: null, graded: false, roundRight: 0, roundDone: 0 },
      exam: { phase: 'setup', mode: 'real', chs: [], count: 60, minutes: 90, timed: true, src: null, queue: [], idx: 0, answers: {}, flags: {}, endAt: 0, remainingMs: 0, paused: false, gridOpen: false, result: null, showAll: false, sessionId: null },
      note: { ch: 0, open: {}, tab: 'ch' }, noteQuestionId: null, search: { q: '' }, confirmSubmit: false
    }
  };
}
function validate(b) { return api.validate(b, QIDS, CIDS); }
function populated() {
  const b = blank(), p = b.progress;
  p.view = 'question-note'; p.theme = 'dark'; p.lang = 'en'; p.noteQuestionId = QIDS[2]; p.note = { ch: 2, open: { 0: true, 3: false }, tab: 'num' };
  p.attempts[QIDS[2]] = { c: false, n: 3, r: 1, at: AT - 1000, questionRevision: 'synthetic-old-r1', selectedOption: 'D', gradingRevision: 'synthetic-grade', origin: 'exam', sessionId: 'synthetic-session' };
  p.favorites = [QIDS[2]]; p.wrongRemoved = [QIDS[0]];
  p.examHistory = [{ at: AT - 10000, label: 'Synthetic archived result', right: 1, answered: 1, count: 2, pct: 50, pass: false, sessionId: 'synthetic-history', legacyRepairedAt: AT - 5000, legacyRepairedCount: 1 }];
  p.archivedSessions = [{ kind: 'practice', archivedAt: AT - 1000, reason: 'Synthetic archive', session: { ...plain(p.practice), phase: 'run', queue: [QIDS[2]], idx: 0, answers: { [QIDS[2]]: 'D' }, sel: 'D', graded: true, roundDone: 1, roundRight: 0, legacyAnswersIncomplete: false } }];
  p.practice = { ...p.practice, phase: 'run', queue: QIDS.slice(0, 2), idx: 1, answers: { [QIDS[0]]: 'A' }, roundDone: 1, roundRight: 1, legacyAnswersIncomplete: false };
  b.study = { schemaVersion: 1, notes: { [QIDS[2]]: { text: 'Synthetic note <script>text only</script>', reason: 'condition', updatedAt: AT - 1000 } }, reviews: { [CIDS[1]]: { dueAt: AT + DAY, intervalDays: 1, reps: 2, revision: 'synthetic-legacy' } } };
  return b;
}
function running() {
  const b = blank();
  Object.assign(b.progress.exam, { phase: 'run', queue: QIDS.slice(0, 2), answers: { [QIDS[0]]: 'B' }, flags: { [QIDS[1]]: 1 }, endAt: AT + 40000, remainingMs: 45000, sessionId: 'synthetic-run', label: 'Synthetic exam' });
  return b;
}
function completed(legacy = false) {
  const b = running(), e = b.progress.exam;
  Object.assign(e, { phase: 'result', endAt: 0, remainingMs: 0, result: { right: 1, count: 2, pct: 50, pass: false, auto: false, byCh: [{ ch: 1, total: 2, right: 1 }] } });
  if (!legacy) { Object.assign(e.result, { answered: 1, unanswered: 1 }); e.result.byCh[0].answered = 1; }
  return b;
}
test('a complete synthetic backup roundtrips all learning records and legacy IDs', () => {
  const b = populated();
  assert.deepEqual(plain(validate(JSON.stringify(b))), { progress: b.progress, study: b.study });
  assert.deepEqual(plain(api.validate(b, new Set(QIDS), new Set(CIDS))), { progress: b.progress, study: b.study });
});
test('validation is immutable and returns independent objects', () => {
  const b = populated(), before = JSON.stringify(b), out = validate(b);
  out.progress.attempts[QIDS[2]].n = 999; out.study.notes[QIDS[2]].text = 'changed';
  assert.equal(JSON.stringify(b), before);
});
test('search and submission-confirmation UI reset without changing any score', () => {
  const b = populated(); b.progress.search.q = 'Synthetic query'; b.progress.confirmSubmit = true;
  const out = plain(validate(b));
  assert.deepEqual(out.progress.search, { q: '' }); assert.equal(out.progress.confirmSubmit, false);
  assert.deepEqual(out.progress.attempts, b.progress.attempts); assert.deepEqual(out.progress.examHistory, b.progress.examHistory);
});
test('active exam restores paused using saved remainingMs without scoring', () => {
  const b = running(), before = JSON.stringify(b), out = validate(b);
  assert.equal(out.progress.exam.paused, true); assert.equal(out.progress.exam.endAt, 0); assert.equal(out.progress.exam.remainingMs, 45000);
  assert.deepEqual(plain(out.progress.exam.answers), b.progress.exam.answers); assert.equal(out.progress.examHistory.length, 0); assert.deepEqual(plain(out.progress.attempts), {});
  assert.equal(JSON.stringify(b), before);
});
test('legacy missing remainingMs uses exportedAt, not the current wall clock', () => {
  const b = running(); delete b.progress.exam.remainingMs; delete b.progress.exam.paused; delete b.progress.exam.sessionId;
  const e = validate(b).progress.exam;
  assert.equal(e.remainingMs, 40000); assert.equal(e.paused, true); assert.equal(e.sessionId, 'legacy-' + AT);
});
test('expired and untimed running exams remain paused and unscored', () => {
  const b = running(); delete b.progress.exam.remainingMs; b.progress.exam.endAt = AT - 1000;
  let out = validate(b); assert.equal(out.progress.exam.remainingMs, 0); assert.equal(out.progress.exam.phase, 'run'); assert.equal(out.progress.exam.result, null);
  b.progress.exam.timed = false; b.progress.exam.endAt = 0;
  out = validate(b); assert.equal(out.progress.exam.remainingMs, 0); assert.equal(out.progress.exam.paused, true);
});
test('archived exams retain their original clock and answers', () => {
  const b = populated(), e = running().progress.exam;
  b.progress.archivedSessions.push({ kind: 'exam', archivedAt: AT, reason: 'Synthetic previous exam', session: e });
  assert.deepEqual(plain(validate(b).progress.archivedSessions[1].session), e);
});
test('modern and legacy result schemas preserve original scores without adding answered', () => {
  for (const legacy of [false, true]) {
    const b = completed(legacy), out = validate(b);
    assert.deepEqual(plain(out.progress.exam), b.progress.exam);
    assert.equal(Object.hasOwn(out.progress.exam.result, 'answered'), !legacy);
  }
});
test('old practice missing full answers is retained and blocked from continued grading', () => {
  const b = blank(); Object.assign(b.progress.practice, { phase: 'run', queue: QIDS.slice(0, 2), idx: 1, roundDone: 1, roundRight: 1 });
  const p = validate(b).progress.practice;
  assert.equal(p.legacyAnswersIncomplete, true); assert.equal(p.roundDone, 1); assert.equal(Object.hasOwn(p, 'answers'), false);
});
test('completed setup practice retains residual answer history exactly', () => {
  const b = blank(); Object.assign(b.progress.practice, { phase: 'setup', queue: [], idx: 2, roundDone: 2, roundRight: 1, answers: { [QIDS[0]]: 'A', [QIDS[1]]: 'D' } });
  assert.deepEqual(plain(validate(b).progress.practice), b.progress.practice);
});
test('null study and saved-null sessions are supported without synthesis', () => {
  const b = blank(); b.progress.practice = null; b.progress.exam = null;
  const out = validate(b); assert.equal(out.study, null); assert.equal(out.progress.practice, null); assert.equal(out.progress.exam, null);
});
test('all current application views are accepted', () => {
  for (const view of ['home', 'practice', 'exam', 'official', 'wrong', 'favs', 'notes', 'note', 'search', 'updates', 'study', 'question-note']) {
    const b = blank(); b.progress.view = view; assert.equal(validate(b).progress.view, view);
  }
});
test('unknown top-level, nested, version and incomplete formats fail', () => {
  const mutations = [b => b.extra = 1, b => b.schemaVersion = 2, b => b.progress.attempts = [], b => delete b.exportedAt,
    b => b.progress.exam.unknown = 1, b => b.progress.note.text = 'not a note store', b => b.study = { schemaVersion: 1, notes: {}, reviews: {}, unknown: 1 }];
  for (const mutate of mutations) { const b = blank(); mutate(b); assert.throws(() => validate(b), /不合法或不支援/); }
  assert.throws(() => validate('{broken'), /JSON 格式/); assert.throws(() => validate({ schemaVersion: 1, notes: {}, reviews: {} }), /完整備份格式/);
});
test('unknown question and card IDs reject the entire file', () => {
  const mutations = [b => b.progress.favorites.push('synthetic-unknown'), b => b.progress.attempts.unknown = b.progress.attempts[QIDS[2]],
    b => b.progress.practice.queue.push('synthetic-unknown'), b => b.study.notes.unknown = b.study.notes[QIDS[2]],
    b => b.study.reviews.unknown = b.study.reviews[CIDS[1]], b => b.progress.noteQuestionId = 'synthetic-unknown'];
  for (const mutate of mutations) { const b = populated(); mutate(b); assert.throws(() => validate(b)); }
});
test('invalid counters, selections, totals, dates and remaining-time fields fail', () => {
  const mutations = [b => b.progress.attempts[QIDS[2]].n = 1.5, b => b.progress.attempts[QIDS[2]].r = 4,
    b => b.progress.attempts[QIDS[2]].n = 1000001, b => b.progress.attempts[QIDS[2]].c = 'false', b => b.progress.attempts[QIDS[2]].at = AT + DAY,
    b => b.progress.practice.answers[QIDS[0]] = 'E', b => b.progress.practice.roundRight = 3,
    b => b.progress.examHistory[0].pct = 51, b => b.progress.exam.remainingMs = -1, b => b.progress.exam.remainingMs = '1000',
    b => b.study.reviews[CIDS[1]].intervalDays = 61, b => b.study.reviews[CIDS[1]].reps = 0,
    b => b.exportedAt = '2026-02-30T00:00:00.000Z'];
  for (const mutate of mutations) { const b = populated(); mutate(b); assert.throws(() => validate(b)); }
});
test('duplicate IDs and answer/queue mismatch are rejected', () => {
  const b = populated(); b.progress.favorites.push(QIDS[2]); assert.throws(() => validate(b));
  const e = running(); e.progress.exam.answers[QIDS[2]] = 'A'; assert.throws(() => validate(e));
  const r = completed(); r.progress.exam.result.byCh[0].total = 1; assert.throws(() => validate(r));
});
test('prototype-pollution keys are forbidden at every nesting depth', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const b = blank(); Object.defineProperty(b.progress.note.open, key, { value: true, enumerable: true });
    assert.throws(() => validate(JSON.stringify(b)), /備份欄位/); assert.equal({}.polluted, undefined);
  }
});
test('non-JSON objects, getters, cycles and sparse arrays fail without evaluating getters', () => {
  const b = blank(); Object.defineProperty(b.progress, 'surprise', { enumerable: true, get() { assert.fail('Getter executed'); } }); assert.throws(() => validate(b));
  const cyclic = blank(); cyclic.progress.search.q = cyclic; assert.throws(() => validate(cyclic));
  const sparse = blank(); sparse.progress.favorites = Array(2); assert.throws(() => validate(sparse));
  const typed = blank(); typed.progress.search.q = new Date(); assert.throws(() => validate(typed));
});
test('oversized files, lists, histories and notes fail at documented limits', () => {
  assert.equal(api.MAX_FILE_BYTES, 8 * 1024 * 1024);
  assert.throws(() => validate(' '.repeat(api.MAX_FILE_BYTES + 1)), /8 MB/);
  const many = blank(); many.progress.favorites = Array(20001).fill(QIDS[0]); assert.throws(() => validate(many));
  const histories = populated(); histories.progress.examHistory = Array(1001).fill(histories.progress.examHistory[0]); assert.throws(() => validate(histories));
  const notes = populated(); notes.study.notes[QIDS[2]].text = '字'.repeat(20001); assert.throws(() => validate(notes));
});
test('empty destination detection accepts absent stores and valid empty state', () => {
  assert.equal(api.hasUserData(null, null), false); assert.equal(api.hasUserData(undefined, undefined), false);
  assert.equal(api.hasUserData(blank().progress, null), false);
  assert.equal(api.hasUserData(blank().progress, { schemaVersion: 1, notes: {}, reviews: {} }), false);
  const p = blank().progress; p.practice = null; p.exam = null; delete p.search; delete p.confirmSubmit;
  assert.equal(api.hasUserData(p, null), false);
});
test('any learning record, archive, ongoing session or stale setup answers block restore', () => {
  const mutations = [p => p.attempts[QIDS[0]] = {}, p => p.favorites.push(QIDS[0]), p => p.wrongRemoved.push(QIDS[0]), p => p.examHistory.push({}),
    p => p.archivedSessions.push({}), p => p.practice.phase = 'run', p => p.exam.phase = 'run', p => p.practice.answers = { [QIDS[0]]: 'A' },
    p => p.exam.answers = { [QIDS[0]]: 'D' }, p => p.noteQuestionId = QIDS[0]];
  for (const mutate of mutations) { const p = blank().progress; mutate(p); assert.equal(api.hasUserData(p, null), true); }
  assert.equal(api.hasUserData(null, populated().study), true);
  assert.equal(api.hasUserData(null, { schemaVersion: 1, notes: {}, reviews: { synthetic: {} } }), true);
});
test('incomplete or corrupt destination data fail closed, including false-like values', () => {
  for (const bad of [{}, [], false, '', 0, 'broken']) assert.equal(api.hasUserData(bad, null), true);
  for (const bad of [{}, [], false, 0, { schemaVersion: 1, notes: null, reviews: {} }]) assert.equal(api.hasUserData(null, bad), true);
  for (const mutate of [p => delete p.attempts, p => p.favorites = null, p => p.exam = {}, p => p.practice.queue = null, p => p.unknown = true, p => p.theme = 'unknown']) {
    const p = blank().progress; mutate(p); assert.equal(api.hasUserData(p, null), true);
  }
});
test('browser-import fixture contains only the scoped ID and synthetic learning data', () => {
  const content = fs.readFileSync(path.resolve(__dirname, 'fixtures/iphone-backup.json'), 'utf8');
  const out = api.validate(content, ['b279-r20260914'], []);
  assert.equal(Object.keys(out.progress.attempts).length, 1); assert.equal(Object.keys(out.study.notes).length, 1);
  assert.equal(out.progress.exam.paused, true); assert.equal(out.progress.exam.remainingMs, 45000);
  assert.equal(out.progress.examHistory.length, 0); assert.equal(out.progress.exam.result, null);
  assert(!/password|passphrase|口令/.test(content));
});

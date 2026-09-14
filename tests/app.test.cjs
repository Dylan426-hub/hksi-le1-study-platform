// Read-only production check: inject exports only into a disposable VM source string.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const APP = path.resolve(__dirname, '../js/app.js');
const STUDY = path.resolve(__dirname, '../js/study.js');
const MIGRATION = path.resolve(__dirname, '../js/migration.js');
const source = fs.readFileSync(APP, 'utf8');
const names = ['State', 'initData', 'load', 'start', 'save', 'eligible', 'updatedQuestions', 'blockedSession', 'stats', 'recordAttempt', 'practicePool', 'startPractice', 'vPracticeRun', 'answerPractice', 'blueprintSample', 'examRemainingMs', 'pauseExam', 'resumeExam', 'startExam', 'submitExam', 'handleAct', 'render', 'qCard', 'searchHits', 'reconcileExamClock', 'prepareAppReload', 'inspectBackup', 'restoreBackup'];
const sentinel = '  load();\n  if (!localStorage.getItem(KEY)';
assert(source.includes(sentinel), 'Test injection marker is present');
const injected = source.replace(sentinel, '  window.__test = {' + names.join(',') + '};\n  return;\n  load();\n  if (!localStorage.getItem(KEY)');
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function question(id, reviewStatus, ch = 1, src = 'bank') { return { id, reviewStatus, ch, src, q: 'Synthetic test question ' + id, A: 'One', B: 'Two', C: 'Three', D: 'Four', ans: 'A', revision: 'test-r1', ex: 'Synthetic explanation', checkedAt: '2026-09-14', sourceRefs: [] }; }
function harness(saved, useStudy = true, savedStudy) {
  let now = 1800000000000;
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const values = new Map();
  if (saved) values.set('hksi-le1-v1', JSON.stringify(saved));
  if (savedStudy) values.set('hksi-le1-study-v1', JSON.stringify(savedStudy));
  const localStorage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const devents = {}, wevents = {}, intervals = new Map(), timeouts = new Map();
  let sequence = 0;
  let renderedHTML = '', currentNoteEditor = null, installPanelOpen = false;
  const app = { get innerHTML() { return renderedHTML; }, set innerHTML(html) { renderedHTML = html; currentNoteEditor = /<details\b[^>]*\bdata-study-note(?:\s|>)/.test(html) ? { open: false } : null; } }, clock = { textContent: '', className: '' };
  const doc = { hidden: false, title: '', body: { appendChild() {} }, documentElement: { setAttribute() {} },
    addEventListener(type, cb, capture) { (devents[type] ||= []).push({ cb, capture: !!capture }); }, getElementById(id) { return id === 'app' ? app : id === 'clock' ? clock : null; },
    querySelector(selector) { return selector === '.install-panel[open]' ? (installPanelOpen ? { open: true } : null) : selector === 'details[data-study-note]' ? currentNoteEditor : null; }, querySelectorAll() { return []; }, createElement() { return { click() {}, remove() {}, appendChild() {} }; } };
  const study = { initCalls: [], noteCalls: [], renders: 0, init(args) { this.initCalls.push(args); }, countDue() { return 0; }, noteHTML(q) { this.noteCalls.push(q.id); return '<aside>SYNTHETIC_NOTE_HOOK</aside>'; }, render() { this.renders++; return '<article>SYNTHETIC_STUDY_RENDER</article>'; } };
  const win = { scrollY: 0, scrollTo() {}, alert() {}, confirm() { return true; }, addEventListener(type, cb) { (wevents[type] ||= []).push(cb); },
    HKSI_QUESTIONS: [question('old', 'retired'), question('quarantine', 'quarantined'), question('new', 'checked-public'), question('active', 'legacy', 2), question('official', 'legacy', 2, 'sample2023')],
    HKSI_CHAPTERS: [{ n: 1, zh: 'Test chapter one' }, { n: 2, zh: 'Test chapter two' }, { n: 4, zh: 'Synthetic chapter four' }], HKSI_META: { exam: { count: 3, minutes: 6, passPct: 70 } },
    HKSI_NOTES: [{ ch: 4, sections: [{ heading: 'Synthetic section zero', points: [{ t: 'Synthetic point zero' }] }, { heading: 'Synthetic section one', points: [{ t: 'Synthetic point one' }] }], sourceRefs: [] }],
    HKSI_CARDS: [{ id: 'card-new', ch: 1, front: 'Synthetic front', back: 'Synthetic answer', revision: 'test-r1', checkedAt: '2026-09-14', questionIds: ['new'], sourceRefs: [] }, { id: 'card-two', ch: 2, front: 'Second front', back: 'Second answer', revision: 'test-r1', sourceRefs: [] }], localStorage };
  if (useStudy && useStudy !== 'actual') win.StudyTools = study;
  const context = vm.createContext({ window: win, document: doc, localStorage, sessionStorage: localStorage, URL, Blob, TextEncoder, TextDecoder, Uint8Array, console, Date: FakeDate, setTimeout: cb => { const id = ++sequence; timeouts.set(id, cb); return id; }, clearTimeout: id => timeouts.delete(id), setInterval: cb => { const id = ++sequence; intervals.set(id, cb); return id; }, clearInterval: id => intervals.delete(id) });
  if (useStudy === 'actual') vm.runInContext(fs.readFileSync(STUDY, 'utf8'), context, { filename: STUDY });
  vm.runInContext(fs.readFileSync(MIGRATION, 'utf8'), context, { filename: MIGRATION });
  vm.runInContext(injected, context, { filename: APP });
  const api = win.__test;
  api.initData();
  return { api, state: api.State, window: win, document: doc, app, study, intervals, values, get noteEditor() { return currentNoteEditor; }, get now() { return now; }, setInstallPanelOpen(value) { installPanelOpen = !!value; }, advance(ms) { now += ms; }, emitDocument(type, event = {}) { let stopped = false; const ev = { preventDefault() {}, stopPropagation() { stopped = true; }, ...event }; for (const listener of (devents[type] || []).slice().sort((a,b) => Number(b.capture) - Number(a.capture))) { listener.cb(ev); if (stopped) break; } }, emitWindow(type) { (wevents[type] || []).forEach(cb => cb({})); } };
}
function studyTarget(act, id, tagName = 'BUTTON', value = '') { const attrs = { 'data-study-act': act, 'data-study-id': id }; return { tagName, value, getAttribute: k => attrs[k] || null, hasAttribute: k => Object.hasOwn(attrs,k), parentNode: null }; }
function appTarget(act, arg, tagName = 'BUTTON') { const attrs = { 'data-act': act, 'data-arg': arg }; return { tagName, getAttribute: k => attrs[k] || null, hasAttribute: k => Object.hasOwn(attrs,k), parentNode: null }; }
function assertReadOnlyOptions(html) {
  const options = html.match(/<button\b[^>]*class="opt(?:\s[^"]*)?"[^>]*>/g) || [];
  assert.equal(options.length, 4, 'Question view retains exactly four answer options');
  options.forEach(option => { assert(option.includes('data-act="noop"'), 'Read-only option uses no-op action'); assert(/\sdisabled(?:\s|>)/.test(option), 'Read-only option is disabled'); });
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
test('eligible excludes retired, quarantined and missing IDs', () => {
  const h = harness(); assert.deepEqual(plain(h.api.practicePool()), ['new', 'active', 'official']);
  assert.deepEqual(plain(h.api.updatedQuestions()).map(q => q.id), ['new']);
  assert.equal(h.api.eligible(undefined), false);
});
test('statistics exclude old records without mutating attempts or favorites', () => {
  const h = harness(); const s = h.state;
  s.attempts = { old: { n: 2, r: 1, c: false }, quarantine: { n: 3, r: 3, c: true }, new: { n: 1, r: 0, c: false } }; s.favorites = ['old', 'quarantine', 'new'];
  const before = JSON.stringify(s.attempts); const stats = plain(h.api.stats());
  assert.equal(stats.total, 3); assert.equal(stats.done, 1); assert.equal(stats.right, 0); assert.deepEqual(stats.wrongBook, ['new']); assert.deepEqual(stats.favs, ['new']);
  assert.equal(JSON.stringify(s.attempts), before); assert.equal(s.favorites.length, 3); h.api.save(); assert.equal(JSON.parse(h.values.get('hksi-le1-v1')).attempts.old.n, 2);
});
test('old attempts cannot be credited to the independent replacement ID', () => {
  const h = harness(); h.state.attempts.old = { n: 1, r: 1, c: true }; h.state.practice.scope = 'new';
  assert(h.api.practicePool().includes('new')); assert.equal(h.api.stats().done, 0);
});
test('recordAttempt refuses retired, quarantine and missing IDs', () => {
  const h = harness(); ['old', 'quarantine', 'missing'].forEach(id => h.api.recordAttempt(id, true)); assert.deepEqual(plain(h.state.attempts), {});
});
test('practice direct start filters retired, quarantine and missing IDs', () => {
  const h = harness(); h.api.startPractice(['old', 'new', 'quarantine', 'missing']); assert.deepEqual(plain(h.state.practice.queue), ['new']);
});
test('blueprint exam sample excludes all ineligible and non-bank IDs', () => {
  const h = harness(); const ids = h.api.blueprintSample(100, []); assert.deepEqual(plain(ids).sort(), ['active', 'new']);
});
test('exam direct start filters retired, quarantine and missing IDs', () => {
  const h = harness(); h.api.startExam('custom', ['old', 'new', 'quarantine', 'missing'], 1, 'test'); assert.deepEqual(plain(h.state.exam.queue), ['new']);
});
test('blocked practice does not advance, score or expose answer choices', () => {
  const h = harness(); Object.assign(h.state.practice, { phase: 'run', queue: ['old', 'new'], idx: 0 });
  h.api.answerPractice('A'); h.api.handleAct('p-next'); assert.equal(h.state.practice.idx, 0); assert.deepEqual(plain(h.state.attempts), {});
  const html = h.api.vPracticeRun(); assert(html.includes('archive-session')); assert(!html.includes('data-act="p-answer"'));
});
test('blocked exam submit and resume cannot create a result or attempts', () => {
  const h = harness(); Object.assign(h.state.exam, { phase: 'run', queue: ['old', 'new'], idx: 0, answers: { new: 'A' }, paused: true });
  h.api.submitExam(false); assert.equal(h.api.resumeExam(), false); h.api.handleAct('e-submit-force');
  assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true); assert.deepEqual(plain(h.state.attempts), {}); assert.equal(h.state.examHistory.length, 0);
});
test('restoring an expired blocked exam pauses without auto-grading', () => {
  const h = harness({ view: 'exam', exam: { phase: 'run', queue: ['old', 'new'], idx: 0, answers: { new: 'A' }, flags: {}, timed: true, paused: false, endAt: 1700000000000 } });
  h.api.load(); h.api.start(); assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true); assert.equal(h.state.exam.endAt, 0); assert.equal(h.state.examHistory.length, 0);
});
test('explicit practice archive preserves its queue and answers before replacement', () => {
  const h = harness(); Object.assign(h.state.practice, { phase: 'run', queue: ['old', 'new'], answers: { old: 'B' }, idx: 1 }); const old = plain(h.state.practice);
  h.api.handleAct('archive-session', 'practice'); assert.deepEqual(plain(h.state.archivedSessions[0].session), old); assert.equal(h.state.practice.phase, 'setup');
  h.api.handleAct('updated-practice'); assert.deepEqual(plain(h.state.practice.queue), ['new']); assert.deepEqual(plain(h.state.archivedSessions[0].session), old);
});
test('explicit exam archive preserves its queue and answers before replacement', () => {
  const h = harness(); Object.assign(h.state.exam, { phase: 'run', queue: ['old', 'new'], answers: { old: 'B' }, idx: 1, paused: true }); const old = plain(h.state.exam);
  h.api.handleAct('archive-session', 'exam'); assert.deepEqual(plain(h.state.archivedSessions[0].session), old); assert.equal(h.state.exam.phase, 'setup');
  h.api.startExam('custom', ['new'], 1, 'test'); assert.deepEqual(plain(h.state.archivedSessions[0].session), old);
});
test('visibility background pauses and stops timer; return does not auto-resume', () => {
  const h = harness(); h.api.startExam('custom', ['new'], 1, 'test'); h.advance(10000); h.document.hidden = true; h.emitDocument('visibilitychange');
  assert.equal(h.state.exam.paused, true); assert.equal(h.state.exam.remainingMs, 50000); assert.equal(h.intervals.size, 0);
  h.advance(600000); h.document.hidden = false; h.emitDocument('visibilitychange'); assert.equal(h.state.exam.paused, true); assert.equal(h.api.examRemainingMs(), 50000); assert.equal(h.state.exam.phase, 'run');
  h.api.resumeExam(); assert.equal(h.api.examRemainingMs(), 50000); h.advance(1000); assert.equal(h.api.examRemainingMs(), 49000);
});
test('pagehide persists paused exam; pageshow and focus cannot spend paused time', () => {
  const h = harness(); h.api.startExam('custom', ['new'], 1, 'test'); h.advance(15000); h.emitWindow('pagehide');
  const saved = JSON.parse(h.values.get('hksi-le1-v1')); assert.equal(saved.exam.paused, true); assert.equal(saved.exam.remainingMs, 45000); assert.equal(saved.exam.endAt, 0);
  h.advance(600000); h.emitWindow('pageshow'); h.emitWindow('focus'); assert.equal(h.api.examRemainingMs(), 45000); assert.equal(h.state.exam.phase, 'run');
});
test('pagehide does not grade blocked session', () => {
  const h = harness(); Object.assign(h.state.exam, { phase: 'run', queue: ['old'], answers: { old: 'A' }, timed: true, paused: true }); h.emitWindow('pagehide'); assert.equal(h.state.examHistory.length, 0); assert.equal(JSON.parse(h.values.get('hksi-le1-v1')).exam.queue[0], 'old');
});
test('practice answer / previous / answer cannot double count', () => {
  const h = harness(); h.api.startPractice(['new', 'active']); h.api.answerPractice('A'); h.api.handleAct('p-next'); h.api.answerPractice('B'); h.api.handleAct('p-prev'); h.api.answerPractice('B');
  assert.equal(h.state.attempts.new.n, 1); assert.equal(h.state.practice.roundDone, 2); assert.equal(h.state.practice.roundRight, 1); assert.equal(h.state.practice.answers.new, 'A'); assert.equal(h.state.practice.sel, 'A');
});
test('practice answers survive a save and restoration', () => {
  const h = harness(); h.api.startPractice(['new', 'active']); h.api.answerPractice('A'); h.api.handleAct('p-next');
  const fresh = harness(JSON.parse(h.values.get('hksi-le1-v1'))); fresh.api.load(); fresh.api.start(); fresh.api.handleAct('p-prev'); fresh.api.answerPractice('B');
  assert.equal(fresh.state.attempts.new.n, 1); assert.equal(fresh.state.practice.answers.new, 'A');
});
test('old graded current practice answer is migrated into answers map', () => {
  const h = harness({ view: 'practice', practice: { phase: 'run', queue: ['new', 'active'], idx: 0, sel: 'A', graded: true, roundDone: 1, roundRight: 1 }, attempts: { new: { n: 1, r: 1, c: true } } }); h.api.load(); h.api.start();
  assert.equal(h.state.practice.answers.new, 'A'); h.api.handleAct('p-next'); h.api.handleAct('p-prev'); h.api.answerPractice('B'); assert.equal(h.state.attempts.new.n, 1);
});
test('exam only records actually answered IDs and prevents duplicate submission', () => {
  const h = harness(); h.api.startExam('custom', ['new', 'active'], 1, 'test'); h.api.handleAct('e-answer', 'A'); h.api.submitExam(false); h.api.submitExam(false);
  assert.equal(h.state.attempts.new.n, 1); assert.equal(h.state.attempts.active, undefined); assert.equal(h.state.exam.result.answered, 1); assert.equal(h.state.examHistory.length, 1);
});
test('study hook receives init data, renders and attaches only after grading', () => {
  const h = harness(); assert.equal(h.study.initCalls.length, 1); assert.equal(h.study.initCalls[0].questions.length, 5);
  h.api.startPractice(['new']); assert.equal(h.study.noteCalls.length, 0); h.api.answerPractice('A'); assert(h.app.innerHTML.includes('SYNTHETIC_NOTE_HOOK'));
  h.api.handleAct('nav', 'study'); assert(h.app.innerHTML.includes('SYNTHETIC_STUDY_RENDER')); h.study.initCalls[0].openQuestion('active'); assert.deepEqual(plain(h.state.practice.queue), ['active']);
});
test('absent StudyTools does not prevent app rendering or scoring', () => {
  const h = harness(undefined, false); h.api.render(); h.api.startPractice(['new']); h.api.answerPractice('A'); assert.equal(h.state.attempts.new.n, 1);
});
test('search cannot expose retired and quarantined questions as practice links', () => {
  const h = harness(); h.state.search.q = 'Synthetic'; assert.deepEqual(plain(h.api.searchHits()), ['new', 'active', 'official']);
});
test('actual notes module input persists safely without changing attempts', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new']); h.api.answerPractice('A'); const before = JSON.stringify(h.state.attempts);
  h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', '<script>SYNTHETIC</script> & condition') });
  h.emitDocument('change', { target: studyTarget('note-reason', 'new', 'SELECT', 'condition') });
  const saved = JSON.parse(h.values.get('hksi-le1-study-v1')); assert.equal(saved.notes.new.text, '<script>SYNTHETIC</script> & condition'); assert.equal(saved.notes.new.reason, 'condition');
  assert.equal(JSON.stringify(h.state.attempts), before); h.api.render(); assert(h.app.innerHTML.includes('&lt;script&gt;SYNTHETIC&lt;/script&gt; &amp; condition')); assert(!h.app.innerHTML.includes('<script>SYNTHETIC'));
});
test('actual note textarea keyboard does not answer practice or navigate', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new','active']); const target = studyTarget('note-text', 'new', 'TEXTAREA', 'A');
  h.emitDocument('keydown', { target, key: 'A' }); h.emitDocument('keydown', { target, key: 'ArrowRight' });
  assert.equal(h.state.practice.idx, 0); assert.equal(h.state.practice.graded, false); assert.deepEqual(plain(h.state.attempts), {});
});
test('actual study rating does not count as question practice and waits for reveal', () => {
  const h = harness(undefined, 'actual'); h.api.handleAct('nav','study'); assert.equal(h.window.StudyTools.countDue(), 2);
  h.emitDocument('click', { target: studyTarget('rate-good','card-new') }); assert.equal(h.values.has('hksi-le1-study-v1'), false);
  h.emitDocument('click', { target: studyTarget('reveal','card-new') }); h.emitDocument('click', { target: studyTarget('rate-good','card-new') });
  const saved = JSON.parse(h.values.get('hksi-le1-study-v1')); assert.equal(saved.reviews['card-new'].intervalDays, 1); assert.equal(saved.reviews['card-new'].reps, 1); assert.equal(h.window.StudyTools.countDue(), 1); assert.deepEqual(plain(h.state.attempts), {});
  h.emitDocument('click', { target: studyTarget('rate-good','card-new') }); assert.equal(JSON.parse(h.values.get('hksi-le1-study-v1')).reviews['card-new'].reps, 1);
});
test('actual related question hook safely opens an eligible practice item', () => {
  const h = harness(undefined, 'actual'); h.api.handleAct('nav','study'); h.emitDocument('click', { target: studyTarget('reveal','card-new') });
  h.emitDocument('click', { target: studyTarget('open-question','new') }); assert.equal(h.state.view,'practice'); assert.deepEqual(plain(h.state.practice.queue),['new']); assert.deepEqual(plain(h.state.attempts), {});
});
test('actual edit-question-note opens the read-only editor without replacing practice', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new', 'active']); h.api.answerPractice('A');
  h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic saved note') }); h.api.handleAct('p-next');
  const practice = plain(h.state.practice), attempts = plain(h.state.attempts), archives = plain(h.state.archivedSessions);
  h.api.handleAct('nav', 'study'); h.emitDocument('click', { target: studyTarget('tab-notes') });
  assert(h.app.innerHTML.includes('data-study-act="edit-question-note"')); assert(h.app.innerHTML.includes('Synthetic saved note'));
  h.emitDocument('click', { target: studyTarget('edit-question-note', 'new') });
  assert.equal(h.state.view, 'question-note'); assert.equal(h.state.noteQuestionId, 'new'); assert.equal(h.noteEditor.open, true);
  assert.deepEqual(plain(h.state.practice), practice); assert.deepEqual(plain(h.state.attempts), attempts); assert.deepEqual(plain(h.state.archivedSessions), archives);
  assert(h.app.innerHTML.includes('Synthetic saved note')); assertReadOnlyOptions(h.app.innerHTML);
});
test('read-only question option and keyboard events cannot score the pending practice', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new', 'active']);
  const practice = plain(h.state.practice); h.emitDocument('click', { target: studyTarget('edit-question-note', 'new') });
  h.emitDocument('click', { target: appTarget('noop', 'B') });
  for (const key of ['A', '1', 'Enter', 'ArrowRight', 'ArrowLeft']) h.emitDocument('keydown', { target: { tagName: 'DIV', parentNode: null }, key });
  assert.equal(h.state.view, 'question-note'); assert.deepEqual(plain(h.state.attempts), {}); assert.deepEqual(plain(h.state.practice), practice); assertReadOnlyOptions(h.app.innerHTML);
});
test('question-note view, opened editor, saved note and pending practice restore after reload', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new', 'active']); h.api.answerPractice('A'); h.api.handleAct('p-next');
  h.emitDocument('click', { target: studyTarget('edit-question-note', 'new') });
  h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic note to restore') });
  const saved = JSON.parse(h.values.get('hksi-le1-v1')), notes = JSON.parse(h.values.get('hksi-le1-study-v1'));
  const fresh = harness(saved, 'actual', notes); fresh.api.load(); fresh.api.start();
  assert.equal(fresh.state.view, 'question-note'); assert.equal(fresh.state.noteQuestionId, 'new'); assert.equal(fresh.noteEditor.open, true);
  assert(fresh.app.innerHTML.includes('Synthetic note to restore')); assert.deepEqual(plain(fresh.state.practice), plain(h.state.practice)); assert.deepEqual(plain(fresh.state.attempts), plain(h.state.attempts));
  assertReadOnlyOptions(fresh.app.innerHTML);
});
test('retired question retains editable notes while all options and keyboard grading stay disabled', () => {
  const savedNote = { schemaVersion: 1, notes: { old: { text: 'Synthetic retired note', reason: 'condition', updatedAt: 1799999990000 } }, reviews: {} };
  const h = harness(undefined, 'actual', savedNote); h.state.attempts.old = { n: 2, r: 1, c: false, selectedOption: 'B' }; h.api.startPractice(['new', 'active']);
  const practice = plain(h.state.practice), attempts = plain(h.state.attempts);
  h.api.handleAct('nav', 'study'); h.emitDocument('click', { target: studyTarget('tab-notes') }); assert(h.app.innerHTML.includes('Synthetic retired note'));
  h.emitDocument('click', { target: studyTarget('edit-question-note', 'old') });
  assert.equal(h.state.view, 'question-note'); assert.equal(h.state.noteQuestionId, 'old'); assert.equal(h.noteEditor.open, true);
  assert(h.app.innerHTML.includes('此題已停用')); assert(h.app.innerHTML.includes('Synthetic retired note')); assertReadOnlyOptions(h.app.innerHTML);
  h.emitDocument('click', { target: appTarget('noop', 'A') }); h.emitDocument('keydown', { target: { tagName: 'DIV', parentNode: null }, key: 'A' });
  h.emitDocument('input', { target: studyTarget('note-text', 'old', 'TEXTAREA', 'Updated synthetic retired note') });
  assert.equal(JSON.parse(h.values.get('hksi-le1-study-v1')).notes.old.text, 'Updated synthetic retired note');
  assert.deepEqual(plain(h.state.attempts), attempts); assert.deepEqual(plain(h.state.practice), practice); assert.equal(h.api.stats().done, 0);
});
test('returning from question-note to study leaves pending practice and attempts unchanged', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new', 'active']); const practice = plain(h.state.practice);
  h.emitDocument('click', { target: studyTarget('edit-question-note', 'new') }); h.emitDocument('click', { target: appTarget('study-back') });
  assert.equal(h.state.view, 'study'); assert.deepEqual(plain(h.state.practice), practice); assert.deepEqual(plain(h.state.attempts), {});
});
test('unknown note editor request does not change current view or practice', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new', 'active']); const practice = plain(h.state.practice);
  h.emitDocument('click', { target: studyTarget('edit-question-note', 'missing') });
  assert.equal(h.state.view, 'practice'); assert.deepEqual(plain(h.state.practice), practice); assert.deepEqual(plain(h.state.attempts), {});
});
test('actual note delete does not discard question attempts', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new']); h.api.answerPractice('A'); h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic note') });
  h.emitDocument('click', { target: studyTarget('delete-note','new') }); assert.equal(JSON.parse(h.values.get('hksi-le1-study-v1')).notes.new, undefined); assert.equal(h.state.attempts.new.n,1);
});
test('actual study note and review keys are disjoint from app progress', () => {
  const h = harness(undefined, 'actual'); h.api.startPractice(['new']); h.api.answerPractice('A'); h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic') });
  const study = JSON.parse(h.values.get('hksi-le1-study-v1')); const progress = JSON.parse(h.values.get('hksi-le1-v1')); assert(study.notes.new); assert(progress.attempts.new); assert.equal(study.attempts,undefined); assert.equal(progress.notes,undefined);
});
test('updated-practice cannot discard an unarchived blocked practice', () => {
  const h = harness(); Object.assign(h.state.practice, { phase: 'run', queue: ['old', 'new'], answers: { old: 'B' }, idx: 1 }); const old = plain(h.state.practice);
  h.api.handleAct('updated-practice'); assert(h.state.archivedSessions.some(a => JSON.stringify(plain(a.session)) === JSON.stringify(old)), 'Old practice queue and answers were overwritten without archive');
});
test('chapter start cannot discard an unarchived blocked practice', () => {
  const h = harness(); Object.assign(h.state.practice, { phase: 'run', queue: ['old', 'new'], answers: { old: 'B' }, idx: 1 }); const old = plain(h.state.practice);
  h.api.handleAct('ch-practice', '1'); h.api.handleAct('p-start'); assert(h.state.archivedSessions.some(a => JSON.stringify(plain(a.session)) === JSON.stringify(old)), 'Chapter start discarded old session without archive');
});
test('official launch cannot discard an unarchived blocked exam', () => {
  const h = harness(); Object.assign(h.state.exam, { phase: 'run', queue: ['old', 'new'], answers: { old: 'B' }, idx: 1, paused: true }); const old = plain(h.state.exam);
  h.api.handleAct('nav', 'official'); h.api.handleAct('o-start', 'sample2023:free'); assert(h.state.archivedSessions.some(a => JSON.stringify(plain(a.session)) === JSON.stringify(old)), 'Official launch overwrote old exam without archive');
});
test('legacy answered earlier practice item cannot be counted again after reload', () => {
  const h = harness({ view: 'practice', practice: { phase: 'run', queue: ['new', 'active'], idx: 1, sel: null, graded: false, roundDone: 1, roundRight: 1 }, attempts: { new: { n: 1, r: 1, c: true } } }); h.api.load(); h.api.start(); h.api.handleAct('p-prev'); h.api.answerPractice('B');
  assert.equal(h.state.attempts.new.n, 1, 'Earlier legacy answer was not migrated or locked, so review recorded a second attempt');
});
test('chapter four detail and collapsed sections persist immediately and after pagehide reload', () => {
  const h = harness(); h.api.handleAct('n-open', '4');
  let saved = JSON.parse(h.values.get('hksi-le1-v1') || '{}');
  assert.equal(saved.view, 'note'); assert.equal(saved.note.ch, 4);
  h.api.handleAct('n-sec', '0'); h.api.handleAct('n-sec', '1'); h.api.handleAct('n-sec', '1');
  saved = JSON.parse(h.values.get('hksi-le1-v1'));
  assert.deepEqual(saved.note, { ch: 4, tab: 'ch', open: { 0: false, 1: true } });
  h.emitWindow('pagehide');
  const fresh = harness(JSON.parse(h.values.get('hksi-le1-v1'))); fresh.api.load(); fresh.api.start();
  assert.equal(fresh.state.view, 'note'); assert.deepEqual(plain(fresh.state.note), saved.note);
  assert(fresh.app.innerHTML.includes('Synthetic chapter four')); assert(fresh.app.innerHTML.includes('Synthetic point zero'));
  assert(fresh.app.innerHTML.includes('class="notesec"><button data-act="n-sec" data-arg="0"'));
  assert(fresh.app.innerHTML.includes('class="notesec open"><button data-act="n-sec" data-arg="1"'));
  assert(!fresh.app.innerHTML.includes('第0章'));
});
test('chapter notes tab and back navigation save before pagehide', () => {
  const h = harness(); h.api.handleAct('nav', 'notes'); h.api.handleAct('n-tab', 'num');
  let saved = JSON.parse(h.values.get('hksi-le1-v1')); assert.equal(saved.view, 'notes'); assert.equal(saved.note.tab, 'num');
  h.api.handleAct('n-open', '4'); h.api.handleAct('n-back');
  saved = JSON.parse(h.values.get('hksi-le1-v1')); assert.equal(saved.view, 'notes'); assert.equal(saved.note.ch, 4); assert.equal(saved.note.tab, 'num');
  const fresh = harness(saved); fresh.api.load(); fresh.api.start(); assert.equal(fresh.state.view, 'notes'); assert.equal(fresh.state.note.tab, 'num');
});
test('chapter note restoration validates number, enum, object and boolean fields', () => {
  for (const note of [null, 'invalid', [], { ch: '4', tab: 'other', open: [] }, { ch: -1, tab: null, open: 'invalid' }, { ch: 4.5 }]) {
    const h = harness({ note }); h.api.load(); assert.deepEqual(plain(h.state.note), { ch: 0, open: {}, tab: 'ch' });
  }
  const h = harness({ note: { ch: 4, tab: 'num', open: JSON.parse('{"0":false,"1":true,"2":"false","3":1,"bad":false,"__proto__":false}') } }); h.api.load();
  assert.deepEqual(plain(h.state.note), { ch: 4, open: { 0: false, 1: true }, tab: 'num' });
});

// Build backups only through synthetic app/study fixtures. Never read the vault.
const PROGRESS_KEY = 'hksi-le1-v1', STUDY_KEY = 'hksi-le1-study-v1';
function syntheticFullBackup(withExam = false) {
  const donor = harness(undefined, 'actual');
  donor.api.startPractice(['new', 'active']); donor.api.answerPractice('A');
  donor.state.favorites = ['new'];
  donor.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic migration note') });
  donor.emitDocument('change', { target: studyTarget('note-reason', 'new', 'SELECT', 'condition') });
  donor.api.handleAct('nav', 'study');
  donor.emitDocument('click', { target: studyTarget('reveal', 'card-new') });
  donor.emitDocument('click', { target: studyTarget('rate-good', 'card-new') });
  if (withExam) {
    donor.api.startExam('custom', ['new', 'active'], 1, 'Synthetic migration exam');
    donor.api.handleAct('e-answer', 'B'); donor.advance(12000); donor.api.pauseExam();
  }
  return { schemaVersion: 1, exportedAt: new Date(donor.now).toISOString(),
    progress: plain(donor.state), study: JSON.parse(donor.values.get(STUDY_KEY)) };
}

test('public app bridge exposes the tested migration and reload operations', () => {
  const h = harness();
  assert.equal(h.window.HKSIApp.isUnlocked(), true);
  assert.equal(h.window.HKSIApp.prepareReload, h.api.prepareAppReload);
  assert.equal(h.window.HKSIApp.inspectBackup, h.api.inspectBackup);
  assert.equal(h.window.HKSIApp.restoreBackup, h.api.restoreBackup);
});

test('prepareReload pauses and saves a running exam without grading', () => {
  const h = harness(); h.api.startExam('custom', ['new', 'active'], 1, 'Synthetic reload exam');
  h.api.handleAct('e-answer', 'B'); h.advance(12000);
  const attempts = plain(h.state.attempts), history = plain(h.state.examHistory);
  assert.equal(h.window.HKSIApp.prepareReload(), true);
  assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true);
  assert.equal(h.state.exam.remainingMs, 48000); assert.equal(h.state.exam.endAt, 0); assert.equal(h.intervals.size, 0);
  assert.deepEqual(plain(h.state.attempts), attempts); assert.deepEqual(plain(h.state.examHistory), history);
  const saved = JSON.parse(h.values.get(PROGRESS_KEY));
  assert.equal(saved.exam.paused, true); assert.equal(saved.exam.remainingMs, 48000);
  assert.deepEqual(saved.exam.answers, { new: 'B' }); assert.equal(saved.exam.result, null);
});

test('prepareReload never grades an expired exam and preserves an already paused clock', () => {
  const h = harness(); h.api.startExam('custom', ['new'], 1, 'Synthetic expired reload');
  h.api.handleAct('e-answer', 'A'); h.advance(61000);
  assert.equal(h.window.HKSIApp.prepareReload(), true);
  assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true); assert.equal(h.state.exam.remainingMs, 0);
  assert.equal(h.state.exam.result, null); assert.equal(h.state.examHistory.length, 0); assert.deepEqual(plain(h.state.attempts), {});
  const paused = harness(); paused.api.startExam('custom', ['new'], 1, 'Synthetic paused reload');
  paused.advance(7000); paused.api.pauseExam(); paused.advance(600000);
  assert.equal(paused.window.HKSIApp.prepareReload(), true); assert.equal(paused.state.exam.remainingMs, 53000);
});

test('failed persistence makes prepareReload return false while keeping the exam ungraded', () => {
  const h = harness(); h.api.startExam('custom', ['new'], 1, 'Synthetic failed reload');
  h.api.handleAct('e-answer', 'A'); h.advance(10000);
  const before = h.values.get(PROGRESS_KEY);
  h.window.localStorage.setItem = () => { throw new Error('Synthetic storage quota'); };
  assert.equal(h.window.HKSIApp.prepareReload(), false, 'Caller must block reload after a failed save');
  assert.equal(h.values.get(PROGRESS_KEY), before);
  assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true); assert.equal(h.state.exam.remainingMs, 50000);
  assert.equal(h.intervals.size, 0); assert.equal(h.state.examHistory.length, 0); assert.deepEqual(plain(h.state.attempts), {});
  h.api.render(); assert(h.app.innerHTML.includes('學習進度未能保存'));
});

test('actual study saved nonempty notes allow reload without rewriting the notes', () => {
  const h = harness(undefined, 'actual');
  h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic saved reload note') });
  const savedNotes = h.values.get(STUDY_KEY);
  assert.equal(JSON.parse(savedNotes).notes.new.text, 'Synthetic saved reload note');
  assert.equal(h.window.StudyTools.canMigrateIntoEmpty(), false, 'Nonempty notes still prohibit replacement import');
  assert.equal(h.window.StudyTools.canReloadSafely(), true);
  assert.equal(h.window.HKSIApp.prepareReload(), true);
  assert.equal(h.values.get(STUDY_KEY), savedNotes); assert(h.values.has(PROGRESS_KEY));
});

test('actual study unsaved notes block reload despite a saved paused exam until note retry succeeds', () => {
  const h = harness(undefined, 'actual'); h.api.startExam('custom', ['new', 'active'], 1, 'Synthetic dirty-note reload');
  h.api.handleAct('e-answer', 'B'); h.advance(10000);
  const setItem = h.window.localStorage.setItem;
  h.window.localStorage.setItem = (key, value) => {
    if (key === STUDY_KEY) throw new Error('Synthetic notes-only storage quota');
    return setItem(key, value);
  };
  h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic unsaved reload note') });
  assert.equal(h.window.StudyTools.canReloadSafely(), false); assert.equal(h.values.has(STUDY_KEY), false);
  assert.equal(h.window.HKSIApp.prepareReload(), false, 'Successful app save cannot discard an unsaved note');
  const savedExam = JSON.parse(h.values.get(PROGRESS_KEY)).exam;
  assert.equal(savedExam.phase, 'run'); assert.equal(savedExam.paused, true); assert.equal(savedExam.remainingMs, 50000);
  assert.equal(savedExam.endAt, 0); assert.deepEqual(savedExam.answers, { new: 'B' }); assert.equal(savedExam.result, null);
  assert.equal(h.state.exam.paused, true); assert.equal(h.intervals.size, 0);
  assert.deepEqual(plain(h.state.attempts), {}); assert.equal(h.state.examHistory.length, 0);
  assert(h.window.StudyTools.noteHTML(h.window.HKSI_QUESTIONS[2]).includes('Synthetic unsaved reload note'));
  h.window.localStorage.setItem = setItem;
  h.emitDocument('click', { target: studyTarget('retry-save', 'new') });
  assert.equal(JSON.parse(h.values.get(STUDY_KEY)).notes.new.text, 'Synthetic unsaved reload note');
  assert.equal(h.window.StudyTools.canReloadSafely(), true);
  h.advance(600000); assert.equal(h.window.HKSIApp.prepareReload(), true);
  assert.equal(h.state.exam.remainingMs, 50000); assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true);
  assert.deepEqual(plain(h.state.attempts), {}); assert.equal(h.state.examHistory.length, 0);
});

test('inspection is read-only and full import into an empty installation preserves attempts and notes', () => {
  const backup = syntheticFullBackup(), inputBefore = JSON.stringify(backup);
  const h = harness(undefined, 'actual'), stateBefore = plain(h.state);
  const inspected = h.window.HKSIApp.inspectBackup(JSON.stringify(backup));
  assert.deepEqual(plain(inspected.progress.attempts), backup.progress.attempts);
  assert.deepEqual(plain(inspected.study), backup.study);
  assert.equal(h.values.size, 0); assert.deepEqual(plain(h.state), stateBefore);
  assert.equal(h.window.HKSIApp.restoreBackup(backup), true);
  assert.equal(JSON.stringify(backup), inputBefore, 'Import must not mutate the source backup');
  assert.deepEqual(plain(h.state.attempts), backup.progress.attempts);
  assert.deepEqual(plain(h.state.favorites), backup.progress.favorites);
  assert.equal(h.state.view, 'home'); assert.equal(h.state.confirmSubmit, false);
  assert.deepEqual(JSON.parse(h.values.get(STUDY_KEY)), backup.study);
  assert.deepEqual(JSON.parse(h.values.get(PROGRESS_KEY)).attempts, backup.progress.attempts);
  const fresh = harness(JSON.parse(h.values.get(PROGRESS_KEY)), 'actual', JSON.parse(h.values.get(STUDY_KEY)));
  fresh.api.load(); fresh.api.start(); fresh.api.handleAct('nav', 'study');
  fresh.emitDocument('click', { target: studyTarget('tab-notes') });
  assert(fresh.app.innerHTML.includes('Synthetic migration note'));
  assert.deepEqual(plain(fresh.state.attempts), backup.progress.attempts);
});

test('in-memory learning data refuses import even when persistent progress is empty', () => {
  const backup = syntheticFullBackup(), h = harness();
  h.api.recordAttempt('active', false, 'practice', null, 'C');
  assert.equal(h.values.has(PROGRESS_KEY), false);
  const before = plain(h.state);
  assert.throws(() => h.window.HKSIApp.inspectBackup(backup), /已有學習資料/);
  assert.throws(() => h.window.HKSIApp.restoreBackup(backup), /已有學習資料/);
  assert.deepEqual(plain(h.state), before); assert.equal(h.values.size, 0);
});

test('persisted progress or study notes refuse overwrite even before they are loaded into State', () => {
  const backup = syntheticFullBackup();
  for (const kind of ['progress', 'study']) {
    const h = kind === 'progress' ? harness(backup.progress) : harness(undefined, true, backup.study);
    assert.deepEqual(plain(h.state.attempts), {});
    const stored = [...h.values.entries()], state = plain(h.state);
    assert.throws(() => h.window.HKSIApp.restoreBackup(backup), /已有學習資料/);
    assert.deepEqual([...h.values.entries()], stored); assert.deepEqual(plain(h.state), state);
  }
});

test('second-key write failure rolls back both persisted keys and leaves in-memory State unchanged', () => {
  const backup = syntheticFullBackup(), h = harness(); h.api.save();
  h.values.set(STUDY_KEY, JSON.stringify({ schemaVersion: 1, notes: {}, reviews: {} }));
  h.values.set('synthetic-unrelated-key', 'unchanged');
  const stored = [...h.values.entries()], state = plain(h.state), setItem = h.window.localStorage.setItem;
  const writes = [];
  h.window.localStorage.setItem = (key, value) => {
    writes.push(key); if (writes.length === 2) throw new Error('Synthetic second-key quota failure');
    return setItem(key, value);
  };
  assert.throws(() => h.window.HKSIApp.restoreBackup(backup), /原有資料已還原/);
  assert.deepEqual(writes.slice(0, 2), [STUDY_KEY, PROGRESS_KEY]);
  assert.deepEqual([...h.values.entries()], stored); assert.deepEqual(plain(h.state), state);
});

test('imported paused exam survives pagehide and restart without losing answers or grading', () => {
  const backup = syntheticFullBackup(true), h = harness(undefined, 'actual');
  assert.equal(h.window.HKSIApp.restoreBackup(backup), true);
  const attempts = plain(h.state.attempts), answers = plain(h.state.exam.answers);
  assert.equal(h.state.exam.paused, true); assert.equal(h.state.exam.remainingMs, 48000); assert.equal(h.state.exam.endAt, 0);
  h.advance(600000); h.emitWindow('pagehide'); h.emitWindow('pageshow'); h.emitWindow('focus');
  assert.equal(h.state.exam.phase, 'run'); assert.equal(h.state.exam.paused, true); assert.equal(h.state.exam.remainingMs, 48000);
  assert.equal(h.state.exam.result, null); assert.equal(h.state.examHistory.length, 0); assert.deepEqual(plain(h.state.attempts), attempts);
  assert.deepEqual(plain(h.state.exam.answers), answers);
  const saved = JSON.parse(h.values.get(PROGRESS_KEY));
  assert.equal(saved.exam.paused, true); assert.equal(saved.exam.remainingMs, 48000); assert.deepEqual(saved.exam.answers, answers);
  const fresh = harness(saved, 'actual', JSON.parse(h.values.get(STUDY_KEY))); fresh.api.load(); fresh.api.start();
  assert.equal(fresh.state.exam.paused, true); assert.equal(fresh.state.exam.remainingMs, 48000);
  assert.deepEqual(plain(fresh.state.exam.answers), answers); assert.deepEqual(plain(fresh.state.attempts), attempts);
});

test('null practice and exam backup sessions become safe setup states before pagehide or rendering', () => {
  const backup = syntheticFullBackup(); backup.progress.practice = null; backup.progress.exam = null;
  const h = harness(undefined, 'actual'); assert.equal(h.window.HKSIApp.restoreBackup(backup), true);
  assert.equal(h.state.practice.phase, 'setup'); assert.deepEqual(plain(h.state.practice.queue), []);
  assert.equal(h.state.exam.phase, 'setup'); assert.deepEqual(plain(h.state.exam.queue), []);
  assert.doesNotThrow(() => { h.api.render(); h.emitWindow('pagehide'); h.emitWindow('pageshow'); });
  assert.equal(h.window.HKSIApp.prepareReload(), true);
  assert.deepEqual(JSON.parse(h.values.get(PROGRESS_KEY)).attempts, backup.progress.attempts);
});

test('empty persisted strings fail closed instead of being treated as a new installation', () => {
  const backup = syntheticFullBackup();
  for (const key of [PROGRESS_KEY, STUDY_KEY]) {
    for (const value of ['', '  ']) {
      const h = harness(undefined, 'actual'); h.values.set(key, value);
      const stored = [...h.values.entries()], state = plain(h.state);
      assert.throws(() => h.window.HKSIApp.inspectBackup(backup));
      assert.throws(() => h.window.HKSIApp.restoreBackup(backup));
      assert.deepEqual([...h.values.entries()], stored); assert.deepEqual(plain(h.state), state);
    }
  }
});

test('completed practice setup state keeps residual answers through import, pagehide and reload', () => {
  const donor = harness(undefined, 'actual'); donor.api.startPractice(['new', 'active']);
  donor.api.answerPractice('A'); donor.api.handleAct('p-next'); donor.api.answerPractice('B');
  donor.api.handleAct('p-next'); donor.api.handleAct('p-quit');
  assert.equal(donor.state.practice.phase, 'setup'); assert.deepEqual(plain(donor.state.practice.queue), []);
  const practice = plain(donor.state.practice), attempts = plain(donor.state.attempts);
  assert.deepEqual(practice.answers, { new: 'A', active: 'B' }); assert.equal(practice.roundDone, 2);
  const backup = { schemaVersion: 1, exportedAt: new Date(donor.now).toISOString(), progress: plain(donor.state), study: null };
  const h = harness(undefined, 'actual'); assert.equal(h.window.HKSIApp.restoreBackup(backup), true);
  h.emitWindow('pagehide');
  const saved = JSON.parse(h.values.get(PROGRESS_KEY));
  assert.deepEqual(saved.practice, practice); assert.deepEqual(saved.attempts, attempts);
  const fresh = harness(saved, 'actual'); fresh.api.load(); fresh.api.start(); fresh.emitWindow('pagehide');
  assert.deepEqual(plain(fresh.state.practice), practice); assert.deepEqual(plain(fresh.state.attempts), attempts);
  assert.deepEqual(JSON.parse(fresh.values.get(PROGRESS_KEY)).practice, practice);
});

test('an empty saved and reloaded installation remains eligible for migration', () => {
  const h = harness(undefined, 'actual'); h.api.save();
  const fresh = harness(JSON.parse(h.values.get(PROGRESS_KEY)), 'actual'); fresh.api.load(); fresh.api.start();
  assert.equal(fresh.state.exam.phase, 'setup'); assert.equal(fresh.state.exam.sessionId, null);
  assert.equal(fresh.window.StudyTools.canMigrateIntoEmpty(), true);
  assert.doesNotThrow(() => fresh.window.HKSIApp.inspectBackup(syntheticFullBackup()));
});

test('actual study dirty notes block migration even when no note was successfully persisted', () => {
  const h = harness(undefined, 'actual'), backup = syntheticFullBackup();
  assert.equal(h.window.StudyTools.canMigrateIntoEmpty(), true);
  const setItem = h.window.localStorage.setItem;
  h.window.localStorage.setItem = (key, value) => {
    if (key === STUDY_KEY) throw new Error('Synthetic note quota');
    return setItem(key, value);
  };
  h.emitDocument('input', { target: studyTarget('note-text', 'new', 'TEXTAREA', 'Synthetic unsaved note') });
  assert.equal(h.values.has(STUDY_KEY), false); assert.deepEqual(plain(h.state.attempts), {});
  const noteBefore = h.window.StudyTools.noteHTML(h.window.HKSI_QUESTIONS[2]), state = plain(h.state);
  assert(noteBefore.includes('Synthetic unsaved note')); assert(noteBefore.includes('尚未寫入本機'));
  assert.equal(h.window.StudyTools.canMigrateIntoEmpty(), false);
  assert.throws(() => h.window.HKSIApp.restoreBackup(backup), /已有筆記、速記進度或未保存內容/);
  assert.equal(h.values.size, 0); assert.deepEqual(plain(h.state), state);
  assert.equal(h.window.StudyTools.noteHTML(h.window.HKSI_QUESTIONS[2]), noteBefore, 'Read-only import guard cannot change unsaved notes');
});

test('actual study read-blocked state refuses migration even after the raw stored value is replaced', () => {
  const h = harness(undefined, 'actual', { invalidSyntheticStudy: true });
  h.values.set(STUDY_KEY, JSON.stringify({ schemaVersion: 1, notes: {}, reviews: {} }));
  const stored = [...h.values.entries()], state = plain(h.state);
  assert.equal(h.window.StudyTools.canMigrateIntoEmpty(), false);
  assert.throws(() => h.window.HKSIApp.inspectBackup(syntheticFullBackup()), /已有筆記、速記進度或未保存內容/);
  assert.deepEqual([...h.values.entries()], stored); assert.deepEqual(plain(h.state), state);
  assert(h.window.StudyTools.noteHTML(h.window.HKSI_QUESTIONS[2]).includes('本機儲存不可用'));
});

test('actual study in-memory notes and reviews each block migration after their persistent key disappears', () => {
  const backup = syntheticFullBackup();
  for (const kind of ['notes', 'reviews']) {
    const existingStudy = { schemaVersion: 1, notes: kind === 'notes' ? backup.study.notes : {},
      reviews: kind === 'reviews' ? backup.study.reviews : {} };
    const h = harness(undefined, 'actual', existingStudy); h.values.delete(STUDY_KEY);
    assert.deepEqual(plain(h.state.attempts), {}); assert.equal(h.window.StudyTools.canMigrateIntoEmpty(), false);
    const state = plain(h.state), countDue = h.window.StudyTools.countDue();
    assert.throws(() => h.window.HKSIApp.restoreBackup(backup), /已有筆記、速記進度或未保存內容/);
    assert.equal(h.values.size, 0); assert.deepEqual(plain(h.state), state); assert.equal(h.window.StudyTools.countDue(), countDue);
  }
});

test('installation modal keyboard events cannot answer, advance or score an underlying session', () => {
  for (const kind of ['practice', 'exam']) {
    const h = harness();
    if (kind === 'practice') h.api.startPractice(['new', 'active']);
    else h.api.startExam('custom', ['new', 'active'], 1, 'Synthetic modal exam');
    h.setInstallPanelOpen(true); const before = plain(h.state);
    for (const key of ['A', '1', 'Enter', 'ArrowRight', 'ArrowLeft']) {
      h.emitDocument('keydown', { target: { tagName: 'DIV', parentNode: null }, key });
    }
    assert.deepEqual(plain(h.state), before); assert.deepEqual(plain(h.state.attempts), {});
    h.setInstallPanelOpen(false); h.emitDocument('keydown', { target: { tagName: 'DIV', parentNode: null }, key: 'A' });
    if (kind === 'practice') assert.equal(h.state.attempts.new.n, 1);
    else { assert.equal(h.state.exam.answers.new, 'A'); assert.deepEqual(plain(h.state.attempts), {}); }
  }
});
let passed = 0, failed = 0;
console.log('SOURCE_SHA256 ' + crypto.createHash('sha256').update(source).digest('hex'));
for (const [name, fn] of tests) { try { fn(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n  ' + error.message); } }
console.log(JSON.stringify({ passed, failed, total: tests.length }));
process.exitCode = failed ? 1 : 0;

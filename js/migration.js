/* Full learning backups: pure validation only; no storage or network access. */
(function () {
  'use strict';

  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_RECORDS = 20000, MAX_HISTORY = 1000, MAX_COUNTER = 1000000;
  var DAY = 86400000, MAX_TIME = 8640000000000000;
  var PROGRESS_KEYS = ['view', 'theme', 'lang', 'attempts', 'favorites', 'wrongRemoved', 'examHistory', 'archivedSessions', 'practice', 'exam', 'note', 'noteQuestionId', 'search', 'confirmSubmit'];
  var PRACTICE_KEYS = ['phase', 'chs', 'srcs', 'scope', 'order', 'queue', 'idx', 'sel', 'graded', 'roundRight', 'roundDone', 'answers', 'legacyAnswersIncomplete'];
  var EXAM_KEYS = ['phase', 'mode', 'chs', 'count', 'minutes', 'timed', 'src', 'queue', 'idx', 'answers', 'flags', 'endAt', 'remainingMs', 'paused', 'gridOpen', 'result', 'showAll', 'sessionId', 'label', 'legacyAnswersIncomplete'];
  var SOURCES = ['bank', 'past2006', 'sample2023'];
  function fail(label) { throw new Error(label + '不合法或不支援，未匯入任何資料。'); }
  function owns(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function plain(o) { return !!o && Object.prototype.toString.call(o) === '[object Object]' && !Array.isArray(o); }
  function forbidden(k) { return k === '__proto__' || k === 'prototype' || k === 'constructor'; }
  function number(n, min, max, integer, label) {
    if (typeof n !== 'number' || !isFinite(n) || n < min || n > max || (integer && Math.floor(n) !== n)) fail(label);
    return n;
  }
  function text(s, max, label, nonempty) {
    if (typeof s !== 'string' || s.length > max || (nonempty && !s.length)) fail(label);
    return s;
  }
  function bool(b, label) { if (typeof b !== 'boolean') fail(label); return b; }
  function choice(v, choices, label) { if (choices.indexOf(v) < 0) fail(label); return v; }
  function keys(o, allowed, required, label) {
    if (!plain(o) || Object.keys(o).some(function (k) { return allowed.indexOf(k) < 0; }) ||
        required.some(function (k) { return !owns(o, k); })) fail(label);
    return o;
  }
  function timestamp(n, at, label, zero) { return number(n, zero ? 0 : 1, Math.min(MAX_TIME, at + 300000), false, label); }
  function revision(v, label) {
    if (typeof v === 'number') return number(v, -MAX_TIME, MAX_TIME, false, label);
    return text(v, 160, label, false);
  }
  function safeId(id) {
    return (typeof id === 'string' && id.length > 0 && id.length <= 160 && !forbidden(id)) ||
      (typeof id === 'number' && isFinite(id) && id >= 0 && Math.floor(id) === id && id <= 9007199254740991);
  }
  function knownSet(input, label) {
    var ids = Array.isArray(input) ? input : input && Object.prototype.toString.call(input) === '[object Set]' ? Array.from(input) : null;
    if (!ids || ids.length > MAX_RECORDS) fail(label);
    var out = Object.create(null);
    ids.forEach(function (id) { if (!safeId(id)) fail(label); out[String(id)] = true; });
    return out;
  }
  function idValue(id, known, label) { if (!safeId(id) || !owns(known, String(id))) fail(label); return id; }
  function list(input, max, fn, label, unique) {
    if (!Array.isArray(input) || input.length > max) fail(label);
    var seen = Object.create(null);
    return input.map(function (v) {
      var result = fn(v), key = String(result);
      if (unique && owns(seen, key)) fail(label);
      seen[key] = true;
      return result;
    });
  }
  function idList(input, known, label) { return list(input, MAX_RECORDS, function (id) { return idValue(id, known, label); }, label, true); }
  function chapters(input) { return list(input, 1000, function (v) { return number(v, 1, 1000, true, '章節'); }, '章節', true); }
  function map(input, known, fn, label) {
    if (!plain(input) || Object.keys(input).length > MAX_RECORDS) fail(label);
    var out = {};
    Object.keys(input).forEach(function (id) { idValue(id, known, label); out[id] = fn(input[id], id); });
    return out;
  }
  function answerMap(input, known) { return map(input, known, function (v) { return choice(v, ['A', 'B', 'C', 'D'], '答案'); }, '答案記錄'); }
  function subset(input, queue, label) {
    var set = Object.create(null); queue.forEach(function (id) { set[String(id)] = true; });
    if (Object.keys(input).some(function (id) { return !owns(set, id); })) fail(label);
  }
  function byteLength(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) n++;
      else if (c < 2048) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) { n += 4; i++; }
      else n += 3;
      if (n > MAX_FILE_BYTES) fail('備份大小（上限 8 MB）');
    }
    return n;
  }
  function parse(input) {
    var value = input;
    if (typeof value === 'string') {
      if (value.length > MAX_FILE_BYTES) fail('備份大小（上限 8 MB）');
      byteLength(value);
      try { value = JSON.parse(value); } catch (e) { fail('JSON 格式'); }
    }
    var count = 0, stack = [];
    function walk(v, depth) {
      if (++count > 250000 || depth > 16) fail('備份結構或數量');
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'number') { if (!isFinite(v)) fail('數值'); return; }
      if (typeof v === 'string') { text(v, 20000, '文字長度', false); return; }
      if ((!plain(v) && !Array.isArray(v)) || stack.indexOf(v) >= 0) fail('備份結構');
      var proto = Object.getPrototypeOf(v);
      if (!Array.isArray(v) && proto !== null && Object.getPrototypeOf(proto) !== null) fail('備份物件');
      var names = Object.getOwnPropertyNames(v);
      if (Object.getOwnPropertySymbols(v).length || names.length > MAX_RECORDS + 1) fail('備份欄位或數量');
      if (Array.isArray(v) && (v.length > MAX_RECORDS || Object.keys(v).length !== v.length)) fail('備份清單');
      stack.push(v);
      names.forEach(function (k) {
        if (Array.isArray(v) && k === 'length') return;
        var d = Object.getOwnPropertyDescriptor(v, k);
        if (forbidden(k) || !d.enumerable || !owns(d, 'value') || (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(k))) fail('備份欄位');
        walk(d.value, depth + 1);
      });
      stack.pop();
    }
    walk(value, 0);
    byteLength(JSON.stringify(value));
    return value;
  }
  function attempt(a, at) {
    keys(a, ['c', 'n', 'r', 'at', 'questionRevision', 'selectedOption', 'gradingRevision', 'origin', 'sessionId'], ['c', 'n', 'r', 'at'], '作答記錄');
    var out = { c: bool(a.c, '作答正誤'), n: number(a.n, 1, MAX_COUNTER, true, '作答次數'), r: number(a.r, 0, a.n, true, '答對次數'), at: timestamp(a.at, at, '作答時間') };
    if ((out.c && !out.r) || (!out.c && out.r === out.n)) fail('作答次數');
    ['questionRevision', 'gradingRevision'].forEach(function (k) { if (owns(a, k)) out[k] = revision(a[k], '作答版本'); });
    if (owns(a, 'selectedOption')) out.selectedOption = choice(a.selectedOption, [null, 'A', 'B', 'C', 'D'], '所選答案');
    if (owns(a, 'origin')) out.origin = choice(a.origin, ['practice', 'exam'], '作答來源');
    if (owns(a, 'sessionId')) out.sessionId = text(a.sessionId, 160, '會話編號', true);
    return out;
  }
  function repaired(input, out, at) {
    if (owns(input, 'legacyRepairedAt')) out.legacyRepairedAt = timestamp(input.legacyRepairedAt, at, '舊版修復時間');
    if (owns(input, 'legacyRepairedCount')) out.legacyRepairedCount = number(input.legacyRepairedCount, 0, MAX_RECORDS, true, '舊版修復數量');
  }
  function score(s, at, isResult) {
    var common = ['right', 'answered', 'count', 'pct', 'pass', 'legacyRepairedAt', 'legacyRepairedCount'];
    keys(s, common.concat(isResult ? ['unanswered', 'auto', 'byCh'] : ['at', 'label', 'sessionId']),
      ['right', 'count', 'pct', 'pass'].concat(isResult ? ['auto', 'byCh'] : ['at', 'label']), '模考成績');
    var out = { right: number(s.right, 0, MAX_RECORDS, true, '模考答對數'), count: number(s.count, 1, MAX_RECORDS, true, '模考題數'), pct: number(s.pct, 0, 100, true, '模考百分比'), pass: bool(s.pass, '合格記錄') };
    if (out.right > out.count || out.pct !== Math.round(out.right / out.count * 100)) fail('模考成績數值');
    if (owns(s, 'answered')) out.answered = number(s.answered, out.right, out.count, true, '模考已答數');
    if (isResult) {
      out.auto = bool(s.auto, '自動提交記錄');
      if (owns(s, 'unanswered')) {
        out.unanswered = number(s.unanswered, 0, out.count, true, '模考未答數');
        if (!owns(out, 'answered') || out.unanswered + out.answered !== out.count) fail('模考答題數');
      }
      var seen = Object.create(null), total = 0, right = 0, answered = 0, allAnswered = true;
      out.byCh = list(s.byCh, 1000, function (row) {
        keys(row, ['ch', 'total', 'answered', 'right'], ['ch', 'total', 'right'], '章節成績');
        var c = { ch: number(row.ch, 1, 1000, true, '章節'), total: number(row.total, 1, out.count, true, '章節題數'), right: number(row.right, 0, row.total, true, '章節答對數') };
        if (owns(seen, c.ch)) fail('重複章節成績'); seen[c.ch] = true;
        if (owns(row, 'answered')) { c.answered = number(row.answered, c.right, c.total, true, '章節已答數'); answered += c.answered; } else allAnswered = false;
        total += c.total; right += c.right; return c;
      }, '章節成績', false);
      if (total !== out.count || right !== out.right || (owns(out, 'answered') && allAnswered && answered !== out.answered)) fail('章節成績合計');
    } else {
      out.at = timestamp(s.at, at, '模考時間'); out.label = text(s.label, 500, '模考名稱', false);
      if (owns(s, 'sessionId')) out.sessionId = text(s.sessionId, 160, '會話編號', true);
    }
    repaired(s, out, at);
    return out;
  }
  function practice(p, known) {
    keys(p, PRACTICE_KEYS, ['phase', 'queue', 'idx', 'sel', 'graded', 'roundRight', 'roundDone'], '練習會話');
    var out = { phase: choice(p.phase, ['setup', 'run'], '練習狀態'), chs: owns(p, 'chs') ? chapters(p.chs) : [],
      srcs: owns(p, 'srcs') ? list(p.srcs, 3, function (s) { return choice(s, SOURCES, '題庫來源'); }, '題庫來源', true) : SOURCES.slice(),
      scope: owns(p, 'scope') ? choice(p.scope, ['all', 'updated', 'new', 'wrong', 'fav'], '練習範圍') : 'all',
      order: owns(p, 'order') ? choice(p.order, ['seq', 'rnd'], '練習順序') : 'seq', queue: idList(p.queue, known, '練習題目'),
      idx: number(p.idx, 0, MAX_RECORDS, true, '練習位置'), sel: choice(p.sel, [null, 'A', 'B', 'C', 'D'], '練習答案'), graded: bool(p.graded, '練習計分狀態'),
      roundRight: number(p.roundRight, 0, MAX_COUNTER, true, '本輪答對數'), roundDone: number(p.roundDone, 0, MAX_COUNTER, true, '本輪已答數') };
    if (out.roundRight > out.roundDone) fail('本輪作答數');
    if (owns(p, 'answers')) out.answers = answerMap(p.answers, known);
    if (owns(p, 'legacyAnswersIncomplete')) out.legacyAnswersIncomplete = bool(p.legacyAnswersIncomplete, '舊版答案狀態');
    if (out.phase === 'run') {
      if (!out.queue.length || out.idx > out.queue.length) fail('練習位置');
      if (!owns(out, 'answers') && out.roundDone > 0) out.legacyAnswersIncomplete = true;
      if (out.answers) {
        subset(out.answers, out.queue, '練習答案題目');
        if (!out.legacyAnswersIncomplete && Object.keys(out.answers).length !== out.roundDone) fail('本輪答案數');
        if (out.graded && out.idx < out.queue.length && out.answers[out.queue[out.idx]] !== out.sel) fail('目前練習答案');
      }
    }
    return out;
  }
  function exam(e, known, at, active) {
    keys(e, EXAM_KEYS, ['phase', 'queue', 'idx', 'timed', 'endAt', 'answers', 'flags', 'result'], '模考會話');
    var out = { phase: choice(e.phase, ['setup', 'run', 'result'], '模考狀態'), mode: owns(e, 'mode') ? choice(e.mode, ['real', 'quick', 'custom', 'official'], '模考模式') : 'real',
      chs: owns(e, 'chs') ? chapters(e.chs) : [], count: owns(e, 'count') ? number(e.count, 1, MAX_RECORDS, true, '模考設定題數') : 60,
      minutes: owns(e, 'minutes') ? number(e.minutes, 0, 10080, false, '模考分鐘') : 90, timed: bool(e.timed, '模考計時設定'),
      src: owns(e, 'src') ? choice(e.src, [null].concat(SOURCES), '模考來源') : null,
      queue: idList(e.queue, known, '模考題目'), idx: number(e.idx, 0, MAX_RECORDS, true, '模考位置'), answers: answerMap(e.answers, known),
      flags: map(e.flags, known, function (v) { return choice(v, [1, true], '模考標記'); }, '模考標記題目'),
      endAt: number(e.endAt, 0, Math.min(MAX_TIME, at + 8 * DAY), false, '模考截止時間'),
      paused: owns(e, 'paused') ? bool(e.paused, '模考暫停狀態') : false,
      gridOpen: owns(e, 'gridOpen') ? bool(e.gridOpen, '答題卡狀態') : false,
      result: e.result === null ? null : score(e.result, at, true), showAll: owns(e, 'showAll') ? bool(e.showAll, '解析顯示狀態') : false,
      sessionId: owns(e, 'sessionId') && e.sessionId !== null ? text(e.sessionId, 160, '會話編號', true) : null };
    if (owns(e, 'remainingMs')) out.remainingMs = number(e.remainingMs, 0, 7 * DAY, false, '模考剩餘時間');
    if (owns(e, 'label')) out.label = text(e.label, 500, '模考名稱', false);
    if (owns(e, 'legacyAnswersIncomplete')) out.legacyAnswersIncomplete = bool(e.legacyAnswersIncomplete, '舊版答案狀態');
    if (out.phase !== 'setup') {
      if (!out.queue.length || out.idx >= out.queue.length) fail('模考位置');
      subset(out.answers, out.queue, '模考答案題目'); subset(out.flags, out.queue, '模考標記題目');
    }
    if ((out.phase === 'result') !== (out.result !== null)) fail('模考成績狀態');
    if (out.result && (out.result.count !== out.queue.length || (owns(out.result, 'answered') && out.result.answered !== Object.keys(out.answers).length))) fail('模考成績題數');
    if (active && out.phase === 'run') {
      if (!owns(out, 'remainingMs')) out.remainingMs = out.timed ? Math.max(0, out.endAt - at) : 0;
      if (out.remainingMs > 7 * DAY) fail('模考剩餘時間');
      out.paused = true; out.endAt = 0;
      if (!out.sessionId) out.sessionId = 'legacy-' + at;
    }
    return out;
  }
  function noteSettings(n) {
    keys(n, ['ch', 'open', 'tab'], ['ch', 'open', 'tab'], '筆記瀏覽設定');
    var out = { ch: number(n.ch, 0, 1000, true, '筆記章節'), open: {}, tab: choice(n.tab, ['ch', 'num'], '筆記分頁') };
    if (!plain(n.open) || Object.keys(n.open).length > MAX_RECORDS) fail('筆記展開設定');
    Object.keys(n.open).forEach(function (id) {
      if (!/^(0|[1-9]\d*)$/.test(id) || +id > MAX_RECORDS) fail('筆記段落');
      out.open[id] = bool(n.open[id], '筆記展開設定');
    });
    return out;
  }
  function studyData(s, qids, cards, at) {
    if (s === null) return null;
    keys(s, ['schemaVersion', 'notes', 'reviews'], ['schemaVersion', 'notes', 'reviews'], '筆記備份');
    if (s.schemaVersion !== 1) fail('筆記備份版本');
    return { schemaVersion: 1, notes: map(s.notes, qids, function (n) {
      keys(n, ['text', 'reason', 'updatedAt'], ['text', 'reason', 'updatedAt'], '個人筆記');
      return { text: text(n.text, 20000, '單題筆記長度', false), reason: choice(n.reason, ['', 'concept', 'condition', 'number', 'reading', 'careless', 'other'], '筆記錯因'), updatedAt: timestamp(n.updatedAt, at, '筆記更新時間') };
    }, '筆記題目'), reviews: map(s.reviews, cards, function (r) {
      keys(r, ['dueAt', 'intervalDays', 'reps', 'revision'], ['dueAt', 'intervalDays', 'reps', 'revision'], '速記進度');
      var out = { dueAt: number(r.dueAt, 0, Math.min(MAX_TIME, at + 61 * DAY), false, '速記到期時間'), intervalDays: number(r.intervalDays, 0, 60, false, '速記間隔'), reps: number(r.reps, 0, MAX_COUNTER, true, '速記次數'), revision: revision(r.revision, '速記版本') };
      if (!((out.dueAt === 0 && out.intervalDays === 0 && out.reps === 0) ||
          (out.dueAt > 0 && out.intervalDays > 0 && out.reps > 0 && out.dueAt - out.intervalDays * DAY > 0 && out.dueAt - out.intervalDays * DAY <= at + 300000))) fail('速記時間與次數');
      return out;
    }, '速記卡片') };
  }
  function validate(input, knownQuestionIds, knownCardIds) {
    var raw = parse(input), qids = knownSet(knownQuestionIds, '題庫編號'), cards = knownSet(knownCardIds, '卡片編號');
    keys(raw, ['schemaVersion', 'exportedAt', 'study', 'progress'], ['schemaVersion', 'exportedAt', 'study', 'progress'], '完整備份格式');
    if (raw.schemaVersion !== 1) fail('完整備份版本');
    if (typeof raw.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.exportedAt)) fail('匯出時間');
    var at = Date.parse(raw.exportedAt);
    if (!isFinite(at) || at <= 0 || new Date(at).toISOString() !== raw.exportedAt) fail('匯出時間');
    var p = keys(raw.progress, PROGRESS_KEYS, ['view', 'theme', 'lang', 'attempts', 'favorites', 'wrongRemoved', 'examHistory', 'practice', 'exam', 'note'], '學習進度');
    var out = { view: choice(p.view, ['home', 'practice', 'exam', 'official', 'wrong', 'favs', 'notes', 'note', 'search', 'updates', 'study', 'question-note'], '頁面'),
      theme: choice(p.theme, ['light', 'dark'], '主題'), lang: choice(p.lang, ['both', 'zh', 'en'], '語言'),
      attempts: map(p.attempts, qids, function (a) { return attempt(a, at); }, '作答題目'), favorites: idList(p.favorites, qids, '收藏題目'), wrongRemoved: idList(p.wrongRemoved, qids, '移除錯題'),
      examHistory: list(p.examHistory, MAX_HISTORY, function (s) { return score(s, at, false); }, '模考歷史數量', false), archivedSessions: [],
      practice: p.practice === null ? null : practice(p.practice, qids), exam: p.exam === null ? null : exam(p.exam, qids, at, true),
      note: noteSettings(p.note), noteQuestionId: owns(p, 'noteQuestionId') && p.noteQuestionId !== null ? idValue(p.noteQuestionId, qids, '筆記題目') : null,
      search: { q: '' }, confirmSubmit: false };
    if (owns(p, 'archivedSessions')) out.archivedSessions = list(p.archivedSessions, MAX_HISTORY, function (a) {
      keys(a, ['kind', 'archivedAt', 'reason', 'session'], ['kind', 'archivedAt', 'reason', 'session'], '封存會話');
      var kind = choice(a.kind, ['practice', 'exam'], '封存類型');
      return { kind: kind, archivedAt: timestamp(a.archivedAt, at, '封存時間'), reason: text(a.reason, 500, '封存原因', false), session: kind === 'practice' ? practice(a.session, qids) : exam(a.session, qids, at, false) };
    }, '封存會話數量', false);
    if (owns(p, 'search')) { keys(p.search, ['q'], ['q'], '搜尋欄位'); text(p.search.q, 20000, '搜尋文字', false); }
    if (owns(p, 'confirmSubmit')) bool(p.confirmSubmit, '提交確認狀態');
    return { progress: out, study: studyData(raw.study, qids, cards, at) };
  }
  function hasUserData(progress, study) {
    try {
      if (progress !== null && progress !== undefined) {
        if (!plain(progress)) return true;
        var records = ['attempts', 'favorites', 'wrongRemoved', 'examHistory', 'archivedSessions'];
        for (var i = 0; i < records.length; i++) {
          var k = records[i], v = progress[k], array = k !== 'attempts';
          if (!owns(progress, k) || (array ? !Array.isArray(v) : !plain(v)) || Object.keys(v).length) return true;
        }
        if (progress.noteQuestionId != null) return true;
        for (var j = 0; j < 2; j++) {
          var kind = j ? 'exam' : 'practice', s = progress[kind];
          if (!owns(progress, kind)) return true;
          if (s === null) continue;
          if (!plain(s) || s.phase !== 'setup' || !Array.isArray(s.queue) || s.queue.length || s.idx !== 0) return true;
          if (owns(s, 'answers') && (!plain(s.answers) || Object.keys(s.answers).length)) return true;
          if (j ? (!plain(s.flags) || Object.keys(s.flags).length || s.result !== null || s.sessionId != null) :
              (s.roundDone !== 0 || s.roundRight !== 0 || s.sel !== null || s.graded !== false)) return true;
        }
        validate({ schemaVersion: 1, exportedAt: '2199-01-01T00:00:00.000Z', progress: progress, study: null }, [], []);
      }
      if (study !== null && study !== undefined) {
        study = parse(study);
        keys(study, ['schemaVersion', 'notes', 'reviews'], ['schemaVersion', 'notes', 'reviews'], '筆記資料');
        if (study.schemaVersion !== 1 || !plain(study.notes) || !plain(study.reviews) || Object.keys(study.notes).length || Object.keys(study.reviews).length) return true;
      }
      return false;
    } catch (e) { return true; }
  }

  window.HKSIMigration = { validate: validate, hasUserData: hasUserData, MAX_FILE_BYTES: MAX_FILE_BYTES };
})();

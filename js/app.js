/* ============================================================
 * HKSI LE 卷一备考站 · 前端
 * 题库与全部文案在加密数据包中，解锁后注入 window.HKSI_*。
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'hksi-le1-v1';
  var PASS_KEY = 'hksi-le1-pass';
  var restoredView = false;
  var storageError = '';

  /* 数据在 initData() 装填 */
  var META, CHAPTERS, QUESTIONS, NOTES, byId, chMap;
  var BRAND = { docTitle: '学习平台', homeTitle: '学习平台', homeSub: '', footer: '' };

  function initData() {
    META = window.HKSI_META || {};
    if (META.brand) BRAND = META.brand;
    try { document.title = BRAND.docTitle; } catch (e) { }
    CHAPTERS = window.HKSI_CHAPTERS || [];
    QUESTIONS = window.HKSI_QUESTIONS || [];
    NOTES = window.HKSI_NOTES || [];
    byId = {}; QUESTIONS.forEach(function (q) { byId[q.id] = q; });
    chMap = {}; CHAPTERS.forEach(function (c) { chMap[c.n] = c; });
    if (window.StudyTools) window.StudyTools.init({ questions: QUESTIONS, cards: window.HKSI_CARDS || [],
      openQuestion: function (id, options) {
        if (options && options.edit) {
          State.noteQuestionId = id; State.view = 'question-note'; save(); render();
        } else startPractice([id]);
      }, redraw: render });
  }
  function eligible(q) { return !!q && q.reviewStatus !== 'retired' && q.reviewStatus !== 'quarantined'; }
  function updatedQuestions() { return QUESTIONS.filter(function (q) { return eligible(q) && q.reviewStatus === 'checked-public'; }); }
  function blockedSession(s) { return !!s.legacyAnswersIncomplete || !!(s.queue && s.queue.some(function (id) { return !eligible(byId[id]); })); }
  function examCfg() { return (META && META.exam) || { count: 60, minutes: 90, passPct: 70 }; }
  function srcName(s) { return ((META && META.srcNames) || {})[s] || s; }
  function availableSources() {
    var seen = {};
    QUESTIONS.forEach(function (q) { seen[q.src] = true; });
    return ['bank', 'past2006', 'sample2023'].filter(function (s) { return seen[s]; });
  }

  /* ---------- 状态 ---------- */
  var State = {
    view: 'home', theme: 'light', lang: 'both',
    attempts: {},          /* qid -> {c:最近是否对, n:次数, r:对的次数, at:ts} */
    favorites: [], wrongRemoved: [], examHistory: [], archivedSessions: [],
    practice: { phase: 'setup', chs: [], srcs: ['bank', 'past2006', 'sample2023'], scope: 'all', order: 'seq', queue: [], idx: 0, sel: null, graded: false, roundRight: 0, roundDone: 0 },
    exam: { phase: 'setup', mode: 'real', chs: [], count: 60, minutes: 90, timed: true, src: null, queue: [], idx: 0, answers: {}, flags: {}, endAt: 0, remainingMs: 0, paused: false, gridOpen: false, result: null, showAll: false, sessionId: null },
    note: { ch: 0, open: {}, tab: 'ch' }, noteQuestionId: null,
    search: { q: '' },
    confirmSubmit: false
  };
  var timerId = null;

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function toggleArr(arr, v) { var i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' : '') + pad2(m) + ':' + pad2(s % 60);
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function hasEn(q) { return !!(q.en && q.en.q); }
  function owns(o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); }

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (typeof o.view === 'string') { State.view = o.view; restoredView = true; }
      ['attempts', 'favorites', 'wrongRemoved', 'examHistory', 'archivedSessions', 'theme', 'lang', 'noteQuestionId'].forEach(function (k) {
        if (o[k] != null) State[k] = o[k];
      });
      if (o.note && typeof o.note === 'object' && !Array.isArray(o.note)) {
        if (typeof o.note.ch === 'number' && isFinite(o.note.ch) && o.note.ch >= 0 && Math.floor(o.note.ch) === o.note.ch) State.note.ch = o.note.ch;
        if (o.note.tab === 'ch' || o.note.tab === 'num') State.note.tab = o.note.tab;
        if (o.note.open && typeof o.note.open === 'object' && !Array.isArray(o.note.open)) {
          State.note.open = {};
          Object.keys(o.note.open).forEach(function (id) {
            if (/^(0|[1-9]\d*)$/.test(id) && typeof o.note.open[id] === 'boolean') State.note.open[id] = o.note.open[id];
          });
        }
      }
      if (o.practice && Array.isArray(o.practice.queue) && (o.practice.phase === 'setup' || (o.practice.phase === 'run' && o.practice.queue.length))) State.practice = o.practice;
      if (o.exam && (o.exam.phase === 'setup' || o.exam.phase === 'run' || o.exam.phase === 'result')) {
        State.exam = o.exam;
        State.exam.answers = State.exam.answers || {};
        State.exam.flags = State.exam.flags || {};
        State.exam.paused = !!State.exam.paused;
        if (typeof State.exam.remainingMs !== 'number') {
          State.exam.remainingMs = State.exam.timed ? Math.max(0, (State.exam.endAt || 0) - Date.now()) : 0;
        }
        if (State.exam.phase !== 'setup' && !State.exam.sessionId) State.exam.sessionId = 'legacy-' + (State.exam.endAt || Date.now());
      }
    } catch (e) { /* 忽略损坏的本地存储 */ }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        view: State.view, note: State.note, noteQuestionId: State.noteQuestionId,
        attempts: State.attempts, favorites: State.favorites, wrongRemoved: State.wrongRemoved,
        examHistory: State.examHistory, archivedSessions: State.archivedSessions, theme: State.theme, lang: State.lang,
        practice: State.practice,
        exam: State.exam
      }));
      storageError = '';
      return true;
    } catch (e) {
      storageError = '學習進度未能保存。請勿關閉頁面，先匯出備份並檢查瀏覽器儲存空間。';
      return false;
    }
  }
  function exportProgress() {
    var data = { schemaVersion: 1, exportedAt: new Date().toISOString(), study: null, progress: State };
    try { data.study = JSON.parse(localStorage.getItem('hksi-le1-study-v1') || 'null'); } catch (err) { }
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a'); a.href = url; a.download = 'hksi-learning-backup-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return true;
  }
  function prepareAppReload() {
    var e = State.exam;
    if (e.phase === 'run') {
      e.remainingMs = e.paused ? e.remainingMs : Math.max(0, (e.endAt || 0) - Date.now());
      e.paused = true; e.endAt = 0; stopTimer();
    }
    var progressSaved = save();
    return progressSaved && (!window.StudyTools || !window.StudyTools.canReloadSafely || window.StudyTools.canReloadSafely());
  }
  function inspectBackup(input) {
    if (!byId || !window.HKSIMigration) throw new Error('請先輸入口令，再遷入備份。');
    var rawProgress = localStorage.getItem(KEY), rawStudy = localStorage.getItem('hksi-le1-study-v1');
    var storedProgress = rawProgress !== null ? JSON.parse(rawProgress) : null;
    var storedStudy = rawStudy !== null ? JSON.parse(rawStudy) : null;
    if (window.StudyTools && window.StudyTools.canMigrateIntoEmpty && !window.StudyTools.canMigrateIntoEmpty()) {
      throw new Error('已有筆記、速記進度或未保存內容，不能整批覆蓋。請先保留現有資料。');
    }
    if (window.HKSIMigration.hasUserData(State, storedStudy) || window.HKSIMigration.hasUserData(storedProgress, storedStudy)) {
      throw new Error('這個安裝已有學習資料，不能整批覆蓋。請保留現有資料；筆記可用「我的筆記」中的合併匯入。');
    }
    return window.HKSIMigration.validate(input, QUESTIONS.map(function (q) { return q.id; }),
      (window.HKSI_CARDS || []).map(function (c) { return c.id; }));
  }
  function restoreBackup(input) {
    var incoming = inspectBackup(input), oldProgress = localStorage.getItem(KEY), oldStudy = localStorage.getItem('hksi-le1-study-v1');
    var next = incoming.progress;
    next.practice = next.practice || JSON.parse(JSON.stringify(State.practice));
    next.exam = next.exam || JSON.parse(JSON.stringify(State.exam));
    next.view = 'home'; next.confirmSubmit = false;
    try {
      if (incoming.study) localStorage.setItem('hksi-le1-study-v1', JSON.stringify(incoming.study));
      else localStorage.removeItem('hksi-le1-study-v1');
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      try {
        if (oldStudy === null) localStorage.removeItem('hksi-le1-study-v1'); else localStorage.setItem('hksi-le1-study-v1', oldStudy);
        if (oldProgress === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, oldProgress);
      } catch (rollbackError) { throw new Error('儲存失敗，部分空白設定未能還原。請保留原始備份，勿開始作答，重新開啟後再檢查。'); }
      throw new Error('儲存空間不足或被限制，未完成遷入。原有資料已還原。');
    }
    Object.keys(next).forEach(function (key) { State[key] = next[key]; });
    stopTimer();
    return true;
  }
  function sourceLinks(refs) {
    return (refs || []).map(function (s) {
      try {
        var u = new URL(s.url);
        if (u.protocol !== 'https:' || !/(^|\.)(sfc\.hk|hksi\.org)$/.test(u.hostname)) return '';
        return '<div><a target="_blank" rel="noopener noreferrer" href="' + esc(u.href) + '">' + esc(s.title) + '</a> · ' + esc(s.locator || '') + '</div>';
      } catch (e) { return ''; }
    }).join('');
  }
  function blockedSessionHTML(kind) {
    return topbar('舊版練習已保留', null, 'home2') + '<div class="wrap"><div class="card"><div class="card-t">舊版會話需要重新開始</div>' +
      '<p>本次練習含已停用題，或舊版未保存完整的本輪答案，不能安全繼續計分。現有答案和作答紀錄會保留；開始新版練習時，這次進度會另行封存。</p>' +
      '<button class="btn brand block" data-act="archive-session" data-arg="' + kind + '">封存並設定新版練習</button>' +
      '<button class="btn block" data-act="export-progress">匯出完整學習備份</button></div></div>';
  }
  function archivePracticeBeforeReplace() {
    var p = State.practice;
    if (p.phase === 'run' && p.queue.length && p.idx < p.queue.length) {
      State.archivedSessions.push({ kind: 'practice', archivedAt: Date.now(), reason: '開始另一組練習', session: JSON.parse(JSON.stringify(p)) });
    }
  }

  /* ---------- 图标 ---------- */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H19v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H19"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 3.5L16 11H5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
    check: '<path d="m5 12.5 5 5L19 7"/>',
    doc: '<path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    warn: '<path d="M12 3 2.5 20h19z"/><path d="M12 9.5V14M12 16.8v.4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    hash: '<path d="M9 3 7 21M17 3l-2 18M4 8.5h17M3 15.5h17"/>'
  };
  function ic(name, size, cls) {
    return '<svg class="' + (cls || '') + '" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  /* ---------- 统计 ---------- */
  function stats() {
    var done = 0, right = 0;
    var active = QUESTIONS.filter(eligible);
    active.forEach(function (q) {
      var a = State.attempts[q.id];
      if (a && a.n) { done++; if (a.c) right++; }
    });
    var wrongBook = active.filter(function (q) {
      var a = State.attempts[q.id];
      return a && a.n && !a.c && State.wrongRemoved.indexOf(q.id) < 0;
    }).map(function (q) { return q.id; });
    var chs = CHAPTERS.map(function (c) {
      var qs = active.filter(function (q) { return q.ch === c.n; });
      var d = 0, r = 0;
      qs.forEach(function (q) { var a = State.attempts[q.id]; if (a && a.n) { d++; if (a.c) r++; } });
      return { n: c.n, zh: c.zh, total: qs.length, done: d, right: r, pct: pct(d, qs.length), acc: pct(r, d) };
    });
    return {
      total: active.length, done: done, right: right,
      donePct: pct(done, active.length), acc: pct(right, done),
      wrongBook: wrongBook,
      favs: State.favorites.filter(function (id) { return eligible(byId[id]); }),
      chs: chs
    };
  }
  function recordAttempt(qid, correct, origin, sessionId, selectedOption) {
    if (!eligible(byId[qid])) return;
    var a = State.attempts[qid] || { n: 0, r: 0 };
    a.n++; if (correct) a.r++;
    a.c = correct; a.at = Date.now();
    a.questionRevision = byId[qid].revision || 'legacy';
    a.selectedOption = selectedOption || null;
    a.gradingRevision = '20260914-1';
    if (origin) a.origin = origin;
    if (sessionId) a.sessionId = sessionId;
    else if (origin === 'practice') delete a.sessionId;
    State.attempts[qid] = a;
    if (!correct) State.wrongRemoved = State.wrongRemoved.filter(function (id) { return id !== qid; });
  }

  /* 旧版曾把整份模考的未答题全部记为错题。旧数据没有保存未答题 ID，
     因此只提供显式修复：保留可确定答对的题，撤回同一提交批次中的错误记录。 */
  function legacyPollutionCandidate() {
    var active = State.exam;
    var lastHistoryIndex = State.examHistory.length - 1;
    var lastHistory = State.examHistory[lastHistoryIndex];
    if (active.phase === 'result' && active.queue && active.answers && active.result && active.result.answered == null &&
        !active.result.legacyRepairedAt && lastHistory && !lastHistory.legacyRepairedAt) {
      var exactIds = active.queue.filter(function (id) {
        var a = State.attempts[id];
        return !owns(active.answers, id) && a && a.n === 1 && !a.origin && a.c === false &&
          Math.abs((a.at || 0) - lastHistory.at) <= 2000;
      });
      if (exactIds.length) return { historyIndex: lastHistoryIndex, ids: exactIds, history: lastHistory, exact: true };
    }
    for (var i = State.examHistory.length - 1; i >= 0; i--) {
      var h = State.examHistory[i];
      if (!h || h.answered != null || h.legacyRepairedAt || !h.at || !h.count) continue;
      var ids = Object.keys(State.attempts).filter(function (id) {
        var a = State.attempts[id];
        return a && a.n === 1 && !a.origin && a.c === false && Math.abs((a.at || 0) - h.at) <= 2000;
      });
      if (ids.length >= Math.max(10, h.count - 5)) return { historyIndex: i, ids: ids, history: h, exact: false };
    }
    return null;
  }
  function repairLegacyPollution() {
    var c = legacyPollutionCandidate();
    if (!c) { window.alert('沒有找到可修復的舊版誤記。'); return; }
    var msg = '將撤回最近一次舊版模考中 ' + c.ids.length + ' 道' + (c.exact ? '未作答但被誤記的題目。' : '疑似誤記的錯題。') + '\n\n' +
      (c.exact ? '本次仍保留完整答題資料，可以精確修復。' : '舊版沒有保存「未作答」題目的身份，因此本次真正答錯的題目也可能一併撤回；能確定答對的題目會保留。') + '是否繼續？';
    if (!window.confirm(msg)) return;
    try { localStorage.setItem(KEY + '-before-legacy-repair-' + Date.now(), localStorage.getItem(KEY) || ''); }
    catch (e) { window.alert('未能建立備份，未修改舊紀錄。請先匯出備份並釋放儲存空間。'); return; }
    c.ids.forEach(function (id) {
      var a = State.attempts[id];
      if (a && a.n === 1) delete State.attempts[id];
    });
    State.wrongRemoved = State.wrongRemoved.filter(function (id) { return c.ids.indexOf(id) < 0; });
    if (State.examHistory[c.historyIndex]) {
      State.examHistory[c.historyIndex].legacyRepairedAt = Date.now();
      State.examHistory[c.historyIndex].legacyRepairedCount = c.ids.length;
    }
    if (c.exact && State.exam.result) {
      State.exam.result.legacyRepairedAt = Date.now();
      State.exam.result.legacyRepairedCount = c.ids.length;
    }
    save(); render();
    window.alert('已撤回 ' + c.ids.length + ' 道舊版疑似誤記。');
  }

  /* ---------- 小组件 ---------- */
  function ring(p, size, color, big, small, light) {
    var sw = Math.max(5, Math.round(size * .1));
    var r = (size - sw) / 2, c = 2 * Math.PI * r;
    var track = light ? 'rgba(255,255,255,.25)' : 'var(--bg-soft)';
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + track + '" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" ' +
      'stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - Math.min(100, p) / 100)) + '" ' +
      'transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>' +
      '<div class="mid"><div class="v">' + big + '</div><div class="l">' + small + '</div></div></div>';
  }
  function chChip(n) { return '<span class="chip brand">第' + n + '章</span>'; }
  function srcChip(s) { return '<span class="chip">' + esc(srcName(s)) + '</span>'; }
  function flagChip(q) {
    if (q.flag === 'fixed') return '<span class="chip warn">答案已依手冊修正</span>';
    if (q.flag === 'dispute') return '<span class="chip warn">答案存疑</span>';
    if (q.flag === 'dated') return '<span class="chip warn">規例已更新</span>';
    return '';
  }
  function bar(p, ok) { return '<div class="bar' + (ok ? ' ok' : '') + '"><i style="width:' + p + '%"></i></div>'; }

  /* ---------- 顶栏 / 底栏 ---------- */
  function topbar(title, sub, backAct, extra) {
    return '<div class="topbar"><div class="topbar-in">' +
      (backAct ? '<button class="iconbtn" aria-label="返回" data-act="' + backAct + '">' + ic('back', 19) + '</button>' : '') +
      '<div class="t">' + esc(title) + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</div>' +
      (extra || '') +
      '<button class="iconbtn" aria-label="切換顏色主題" data-act="theme">' + ic(State.theme === 'dark' ? 'sun' : 'moon', 18) + '</button>' +
      '</div></div>';
  }
  function tabbar() {
    var st = stats();
    var tabs = [
      ['home', 'home', '首頁'], ['practice', 'bolt', '刷題'], ['exam', 'clock', '模考'],
      ['notes', 'book', '要點'], ['wrong', 'x', '錯題' + (st.wrongBook.length ? ' ' + st.wrongBook.length : '')]
    ];
    return '<div class="tabbar"><div class="tabbar-in">' + tabs.map(function (t) {
      return '<button class="tab' + (State.view === t[0] ? ' on' : '') + '" data-act="nav" data-arg="' + t[0] + '">' +
        ic(t[1], 20) + '<span>' + t[2] + '</span></button>';
    }).join('') + '</div></div>';
  }

  /* ============================================================
     首页
     ============================================================ */
  function vHome() {
    var st = stats(), ec = examCfg();
    var officialCount = QUESTIONS.filter(function (q) { return q.src === 'past2006' || q.src === 'sample2023'; }).length;
    var noteCount = NOTES.length;
    var repair = legacyPollutionCandidate();
    var h = topbar(BRAND.homeTitle, BRAND.homeSub, null,
      '<button class="iconbtn" aria-label="搜尋題目" data-act="nav" data-arg="search">' + ic('search', 18) + '</button>');
    h += '<div class="wrap">';
    h += '<div class="hero">' +
      ring(st.donePct, 96, '#fff', st.donePct + '%', '已刷', true) +
      '<div style="flex:1;min-width:0"><div class="hero-t">HKSI LE 試卷一</div>' +
      '<div class="hero-s">' + ec.count + ' 題 · ' + ec.minutes + ' 分鐘 · ' + ec.passPct + '% 合格</div>' +
      '<div class="hero-facts">' +
      '<div class="hf"><b>' + st.done + '</b>已做 / ' + st.total + '</div>' +
      '<div class="hf"><b>' + st.acc + '%</b>最近作答正確率</div>' +
      '<div class="hf"><b>' + st.wrongBook.length + '</b>錯題待清</div>' +
      '</div></div></div>';

    h += '<div class="navgrid">' + [
      ['practice', 'bolt', '刷題', st.total + ' 題', 0],
      ['exam', 'clock', '模擬考', ec.count + '題 / ' + ec.minutes + '分鐘', 0],
      [officialCount ? 'official' : 'study', officialCount ? 'doc' : 'layers', officialCount ? '官方卷' : '速記與筆記', officialCount ? officialCount + ' 題' : '待複習 ' + (window.StudyTools ? window.StudyTools.countDue() : 0), 0],
      ['notes', 'book', '章節要點', noteCount ? noteCount + ' 章' : '暫未提供', 0],
      ['wrong', 'x', '錯題本', '待清 ' + st.wrongBook.length, st.wrongBook.length],
      ['favs', 'star', '收藏', st.favs.length + ' 題', 0]
    ].map(function (n) {
      return '<button class="navitem" data-act="nav" data-arg="' + n[0] + '">' + ic(n[1], 22) +
        '<div class="nt">' + n[2] + '</div><div class="ns">' + n[3] + '</div></button>';
    }).join('') + '</div>';

    h += '<button class="app-entry" type="button" data-pwa-open><span class="app-entry-copy"><strong>iPhone 安裝、離線與備份</strong><span>加入主屏幕 · 檢查離線資料 · 遷入學習記錄</span></span>' + ic('chev', 18) + '</button>';

    h += '<div class="card update-card"><div class="card-t">2026-09-14 題庫與復習更新</div>' +
      '<p>' + updatedQuestions().length + ' 道題已按公開官方規則重寫；其餘舊題未完成逐題核驗。已停用題不再抽入練習，原有作答紀錄仍保留。</p>' +
      '<div class="update-actions"><button class="btn brand" data-act="updated-practice">練習更新題</button>' +
      '<button class="btn" data-act="nav" data-arg="study">速記與我的筆記' + (window.StudyTools ? ' · 待複習 ' + window.StudyTools.countDue() : '') + '</button>' +
      '<button class="btn" data-act="nav" data-arg="updates">查看修訂與來源</button></div></div>';
    if (State.practice.phase === 'run' && State.practice.queue.length) h += '<div class="card"><button class="btn block" data-act="nav" data-arg="practice">繼續上次練習</button></div>';

    if (State.exam.phase === 'run' && State.exam.queue.length) {
      var ae = State.exam, aa = Object.keys(ae.answers || {}).length;
      h += '<div class="card active-exam"><div class="card-t">' + ic('clock', 18) + '未完成的模擬考</div>' +
        '<div class="muted">' + esc(ae.label || '模擬考') + ' · 已答 ' + aa + '/' + ae.queue.length +
        (ae.timed ? ' · 剩餘 ' + fmtClock(examRemainingMs()) : ' · 不計時') + '</div>' +
        '<button class="btn brand block" style="margin-top:12px" data-act="e-continue">繼續模擬考</button>' +
        '<button class="btn danger block" style="margin-top:8px" data-act="e-discard">放棄本次</button></div>';
    }
    if (repair) {
      h += '<div class="card repair-card"><div class="card-t">' + ic('warn', 18) + '修復舊版模考誤記</div>' +
        '<div class="muted">找到最近一次舊版模考中 ' + repair.ids.length + ' 道' + (repair.exact ? '未作答誤記' : '疑似誤記錯題') + '。</div>' +
        '<button class="btn block" style="margin-top:12px" data-act="repair-legacy">檢查並修復</button></div>';
    }

    h += '<div class="card"><div class="card-t">' + ic('layers', 18) + '章節已做覆蓋率</div>';
    h += st.chs.map(function (c) {
      return '<div class="chrow" data-act="ch-practice" data-arg="' + c.n + '">' +
        '<div class="cn">' + c.n + '</div>' +
        '<div class="cmain"><div class="ct">' + esc(c.zh) + '</div><div class="cbar">' + bar(c.pct) + '</div></div>' +
        '<div class="cnum">' + c.done + '/' + c.total + (c.done ? ' · ' + c.acc + '%' : '') + '</div></div>';
    }).join('') + '</div>';

    if (State.examHistory.length) {
      h += '<div class="card"><div class="card-t">' + ic('clock', 18) + '最近模考</div>';
      h += State.examHistory.slice(-5).reverse().map(function (r) {
        var d = new Date(r.at);
        return '<div class="result-row"><div class="rn">' + esc(r.label) + ' <span class="faint">' +
          (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '</span></div>' +
          '<div class="rv"><span class="chip ' + (r.pass ? 'ok' : 'bad') + '">' + r.pct + '%</span></div></div>';
      }).join('') + '</div>';
    }
    h += '<div class="faint" style="text-align:center;margin-top:22px;white-space:pre-wrap">題庫：' +
      esc(srcName('bank')) + '\n已做不等於已掌握；舊版停用題不計入目前覆蓋率。\n非官方學習工具 · 進度只保存在本瀏覽器</div>' +
      '<button class="btn block" style="margin-top:12px" data-act="export-progress">匯出完整學習備份</button>';
    h += '</div>' + tabbar();
    return h;
  }

  /* ============================================================
     题目渲染（刷题 / 模考 / 复盘共用）
     ============================================================ */
  function stemHTML(q) {
    var h = esc(q.q);
    if (hasEn(q) && State.lang !== 'zh') {
      if (State.lang === 'en') h = esc(q.en.q);
      else h += '<span class="en">' + esc(q.en.q) + '</span>';
    }
    return h;
  }
  function optHTML(q, k) {
    var zh = q[k], en = hasEn(q) && q.en[k];
    var body;
    if (en && State.lang === 'en') body = esc(en);
    else {
      body = esc(zh);
      if (en && State.lang === 'both') body += '<span class="en">' + esc(en) + '</span>';
    }
    return body;
  }
  /* graded: null=未判, 否则 {sel} */
  function qCard(q, sel, graded, opts) {
    opts = opts || {};
    var fav = State.favorites.indexOf(q.id) >= 0;
    var h = '<div class="card">';
    h += '<div class="qmeta">' + chChip(q.ch) + '<span class="chip' + (q.reviewStatus === 'checked-public' ? ' ok' : '') + '">' +
      (q.reviewStatus === 'checked-public' ? '公開官方資料改編' : !eligible(q) ? '舊版停用題' : '舊題 · 待逐題核查') + '</span>' +
      (q.code ? '<span class="chip">' + esc(q.code) + '</span>' : '') +
      (graded ? flagChip(q) : '') +
      (hasEn(q) ? '<button class="chip brand" data-act="lang" style="border:0;cursor:pointer;font-family:inherit">' +
        (State.lang === 'zh' ? '中' : State.lang === 'en' ? 'EN' : '中+EN') + '</button>' : '') +
      '<span style="flex:1"></span>' +
      '<button class="iconbtn' + (fav ? ' on' : '') + '" aria-label="' + (fav ? '取消收藏此題' : '收藏此題') + '" aria-pressed="' + fav + '" style="width:32px;height:32px" data-act="fav" data-arg="' + q.id + '">' + ic('star', 16) + '</button>' +
      '</div>';
    h += '<div class="qstem">' + stemHTML(q) + '</div>';
    h += '<div class="opts">' + ['A', 'B', 'C', 'D'].map(function (k) {
      var cls = 'opt';
      if (graded) {
        if (k === q.ans) cls += ' right';
        else if (sel === k) cls += ' wrong';
      } else if (sel === k) cls += ' sel';
      return '<button class="' + cls + '" data-act="' + (opts.answerAct || 'p-answer') + '" data-arg="' + k + '" ' +
        (graded && opts.lockGraded ? 'disabled' : '') + '>' +
        '<span class="k">' + k + '</span><span style="flex:1">' + optHTML(q, k) + '</span></button>';
    }).join('') + '</div>';
    if (graded && opts.showExplain) {
      var warn = !!q.flag;
      h += '<div class="explain' + (warn ? ' warnbox' : '') + '">' +
        '<div class="ex-t">' + (warn ? ic('warn', 15) : ic('check', 15)) +
        (sel === q.ans ? '答對了' : sel ? '答錯了 · 正確答案 ' + q.ans : '正確答案 ' + q.ans) + '</div>' +
        (q.note ? '<div style="margin-bottom:6px"><b>' + esc(q.note) + '</b></div>' : '') +
        (q.ex ? '<div>' + esc(q.ex) + '</div>' : '<div class="faint">此題暫無解析</div>') +
        '<div class="ref">' + (q.ref ? esc(q.ref) + ' · ' : '') +
        (q.reviewStatus === 'checked-public' ? '規則核查 ' + esc(q.checkedAt) + '；非官方試題，手冊逐題對照待核。' : '舊版解析未經本輪逐題核驗，不能作為現行規則的唯一依據。') +
        sourceLinks(q.sourceRefs) + '</div>' +
        '</div>';
      if (window.StudyTools) h += window.StudyTools.noteHTML(q);
    }
    h += '</div>';
    return h;
  }

  /* ============================================================
     刷题
     ============================================================ */
  function practicePool() {
    var p = State.practice, st = stats();
    return QUESTIONS.filter(function (q) {
      if (!eligible(q)) return false;
      if (p.scope === 'updated' && q.reviewStatus !== 'checked-public') return false;
      if (p.chs.length && p.chs.indexOf(q.ch) < 0) return false;
      if (p.srcs.length && p.srcs.indexOf(q.src) < 0) return false;
      var a = State.attempts[q.id];
      if (p.scope === 'new' && a && a.n) return false;
      if (p.scope === 'wrong' && st.wrongBook.indexOf(q.id) < 0) return false;
      if (p.scope === 'fav' && State.favorites.indexOf(q.id) < 0) return false;
      return true;
    }).map(function (q) { return q.id; });
  }
  function vPracticeSetup() {
    var p = State.practice;
    var pool = practicePool();
    var h = topbar('刷題', null, 'home2');
    h += '<div class="wrap">';
    h += '<div class="card"><div class="card-t">章節</div><div class="pickgrid">' +
      '<button class="pick' + (!p.chs.length ? ' on' : '') + '" data-act="p-ch" data-arg="0">全部</button>' +
      CHAPTERS.map(function (c) {
        return '<button class="pick' + (p.chs.indexOf(c.n) >= 0 ? ' on' : '') + '" data-act="p-ch" data-arg="' + c.n + '">' +
          c.n + '. ' + esc(c.zh.length > 9 ? c.zh.slice(0, 8) + '…' : c.zh) + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="card"><div class="card-t">來源</div><div class="pickgrid">' +
      availableSources().map(function (s) {
        return '<button class="pick' + (p.srcs.indexOf(s) >= 0 ? ' on' : '') + '" data-act="p-src" data-arg="' + s + '">' + esc(srcName(s)) + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="card"><div class="card-t">範圍與順序</div>' +
      '<div class="seg" style="margin-bottom:10px">' + [['all', '可用題'], ['updated', '本次更新'], ['new', '未做'], ['wrong', '錯題'], ['fav', '收藏']].map(function (s) {
        return '<button class="' + (p.scope === s[0] ? 'on' : '') + '" data-act="p-scope" data-arg="' + s[0] + '">' + s[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="seg">' + [['seq', '順序'], ['rnd', '隨機']].map(function (s) {
        return '<button class="' + (p.order === s[0] ? 'on' : '') + '" data-act="p-order" data-arg="' + s[0] + '">' + s[1] + '</button>';
      }).join('') + '</div></div>';
    h += '<button class="btn brand block" style="margin-top:16px" data-act="p-start" ' + (pool.length ? '' : 'disabled') + '>開始（' + pool.length + ' 題）</button>';
    h += '</div>' + tabbar();
    return h;
  }
  function startPractice(queue, idx) {
    var p = State.practice;
    queue = queue.filter(function (id) { return eligible(byId[id]); });
    if (!queue.length) { window.alert('此題已停用，請從「本次更新」選擇新版題目。'); return; }
    archivePracticeBeforeReplace();
    p.phase = 'run'; p.queue = queue; p.idx = idx || 0; p.answers = {}; p.legacyAnswersIncomplete = false;
    p.sel = null; p.graded = false; p.roundRight = 0; p.roundDone = 0;
    State.view = 'practice'; save(); render();
  }
  function vPracticeRun() {
    var p = State.practice;
    if (blockedSession(p)) return blockedSessionHTML('practice');
    if (p.idx >= p.queue.length) return vPracticeDone();
    var q = byId[p.queue[p.idx]];
    var previous = (p.answers || {})[q && q.id];
    if (previous) { p.sel = previous; p.graded = true; }
    if (!q) { p.idx++; return vPracticeRun(); }
    var h = topbar('刷題', (p.idx + 1) + ' / ' + p.queue.length, 'p-quit');
    h += '<div class="wrap">';
    h += '<div style="margin-top:14px">' + bar(pct(p.idx, p.queue.length)) + '</div>';
    h += qCard(q, p.sel, p.graded, { showExplain: true, lockGraded: true, answerAct: 'p-answer' });
    h += '<div class="qnav">' +
      '<button class="btn" data-act="p-prev" ' + (p.idx ? '' : 'disabled') + '>上一題</button>' +
      '<div class="pos">' + (p.roundDone ? '本輪 ' + p.roundRight + '/' + p.roundDone : '') + '</div>' +
      '<button class="btn ' + (p.graded ? 'brand' : '') + '" data-act="p-next">' + (p.graded ? '下一題' : '跳過') + '</button>' +
      '</div>';
    h += '<div class="faint" style="text-align:center;margin-top:10px">鍵盤：A–D / 1–4 作答，←→ 切換</div>';
    h += '</div>';
    return h;
  }
  function vPracticeDone() {
    var p = State.practice;
    var h = topbar('本輪完成', null, 'p-quit');
    h += '<div class="wrap"><div class="card result-hero">' +
      ring(pct(p.roundRight, p.roundDone || 1), 110, 'var(--brand)', p.roundRight + '/' + (p.roundDone || 0), '答對') +
      '<div class="verdict">' + (p.roundDone ? '正確率 ' + pct(p.roundRight, p.roundDone) + '%' : '本輪未作答') + '</div>' +
      '</div>' +
      '<button class="btn brand block" style="margin-top:14px" data-act="p-quit">返回</button>' +
      '</div>';
    return h;
  }

  /* ============================================================
     模拟考（含官方卷）
     ============================================================ */
  /* 全真模式：按题库各章占比（最大余额法）抽样 */
  function blueprintSample(count, chs) {
    var pool = QUESTIONS.filter(function (q) {
      return eligible(q) && q.src === 'bank' && (!chs.length || chs.indexOf(q.ch) >= 0);
    });
    var byCh = {};
    pool.forEach(function (q) { (byCh[q.ch] = byCh[q.ch] || []).push(q); });
    var keys = Object.keys(byCh);
    var total = pool.length;
    count = Math.min(count, total);
    if (!count) return [];
    var quota = {}, rem = [];
    var used = 0;
    keys.forEach(function (ch) {
      var exact = count * byCh[ch].length / total;
      quota[ch] = Math.floor(exact); used += quota[ch];
      rem.push([ch, exact - quota[ch]]);
    });
    rem.sort(function (a, b) { return b[1] - a[1]; });
    for (var i = 0; used < count && i < rem.length; i++, used++) quota[rem[i][0]]++;
    var out = [];
    keys.forEach(function (ch) {
      out = out.concat(shuffle(byCh[ch]).slice(0, quota[ch]));
    });
    return shuffle(out).map(function (q) { return q.id; });
  }
  function examRemainingMs() {
    var e = State.exam;
    if (!e.timed) return 0;
    return e.paused ? Math.max(0, e.remainingMs || 0) : Math.max(0, (e.endAt || 0) - Date.now());
  }
  function pauseExam() {
    var e = State.exam;
    if (e.phase !== 'run' || e.paused) return true;
    if (e.timed) {
      var left = examRemainingMs();
      if (left <= 0) { submitExam(true); return false; }
      e.remainingMs = left;
      e.endAt = 0;
    }
    e.paused = true;
    stopTimer(); save();
    return true;
  }
  function resumeExam() {
    var e = State.exam;
    if (blockedSession(e)) { e.paused = true; render(); return false; }
    if (e.phase !== 'run' || !e.paused) return true;
    if (e.timed) {
      if (!(e.remainingMs > 0)) { submitExam(true); return false; }
      e.endAt = Date.now() + e.remainingMs;
    }
    e.paused = false;
    save();
    return true;
  }
  function clearExam() {
    var e = State.exam;
    stopTimer();
    e.phase = 'setup'; e.queue = []; e.idx = 0; e.answers = {}; e.flags = {};
    e.result = null; e.endAt = 0; e.remainingMs = 0; e.paused = false; e.sessionId = null;
    State.confirmSubmit = false;
  }
  function reconcileExamClock() {
    var e = State.exam;
    if (!byId) return;
    if (e.phase === 'run' && e.timed && !e.paused && examRemainingMs() <= 0) submitExam(true);
  }
  function vExamSetup() {
    var e = State.exam, ec = examCfg();
    var customAvailable = QUESTIONS.filter(function (q) {
      return eligible(q) && q.src === 'bank' && (!e.chs.length || e.chs.indexOf(q.ch) >= 0);
    }).length;
    var h = topbar('模擬考', null, 'home2');
    h += '<div class="wrap">';
    h += '<div class="card"><div class="card-t">' + ic('target', 18) + '模式</div>' +
      '<div class="seg">' + [['real', ec.count + '題模考'], ['quick', '快速 30題'], ['custom', '自訂']].map(function (s) {
        return '<button class="' + (e.mode === s[0] ? 'on' : '') + '" data-act="e-mode" data-arg="' + s[0] + '">' + s[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="muted" style="margin-top:10px">' +
      (e.mode === 'real' ? ec.count + ' 題 · ' + ec.minutes + ' 分鐘 · ' + ec.passPct + '% 合格，按可用題庫章節比例抽題，並非官方試卷。'
        : e.mode === 'quick' ? '30 題 · 45 分鐘，章節比例抽題，快速自測。'
          : '自選章節，題數與時間按比例縮放。') + '</div>';
    if (e.mode === 'custom') {
      h += '<div class="pickgrid" style="margin-top:12px">' +
        '<button class="pick' + (!e.chs.length ? ' on' : '') + '" data-act="e-ch" data-arg="0">全部章節</button>' +
        CHAPTERS.map(function (c) {
          return '<button class="pick' + (e.chs.indexOf(c.n) >= 0 ? ' on' : '') + '" data-act="e-ch" data-arg="' + c.n + '">' + c.n + '</button>';
        }).join('') + '</div>' +
        '<div class="seg" style="margin-top:12px">' + [20, 30, 60].map(function (n) {
          return '<button class="' + (e.count === n ? 'on' : '') + '" data-act="e-count" data-arg="' + n + '">' + n + ' 題</button>';
        }).join('') + '</div>' +
        '<div class="muted" style="margin-top:10px">目前範圍可用 ' + customAvailable + ' 題；選擇超出時會按實際題量出卷。</div>';
    }
    h += '<p class="muted" style="margin-top:10px">本網站模考可暫停。切換到其他頁面或關閉分頁時會保存並暫停；返回後按「繼續」才恢復計時。瀏覽器被強制結束時可能無法保存最後的變更。</p></div>';
    h += '<button class="btn brand block" style="margin-top:16px" data-act="e-start">開始模擬考</button>';
    if (State.examHistory.length) {
      h += '<div class="card"><div class="card-t">歷史成績</div>' +
        State.examHistory.slice(-8).reverse().map(function (r) {
          var d = new Date(r.at);
          return '<div class="result-row"><div class="rn">' + esc(r.label) + ' <span class="faint">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></div>' +
            '<div class="rv">' + r.right + '/' + r.count + ' · <b style="color:var(--' + (r.pass ? 'ok' : 'bad') + ')">' + r.pct + '%</b></div></div>';
        }).join('') + '</div>';
    }
    h += '</div>' + tabbar();
    return h;
  }
  function startExam(mode, queue, minutes, label, src) {
    var e = State.exam;
    queue = queue.filter(function (id) { return eligible(byId[id]); });
    if (!queue.length) return;
    if (e.phase === 'run' && e.queue.length) State.archivedSessions.push({kind:'exam', archivedAt:Date.now(), reason:'開始另一份模考', session:JSON.parse(JSON.stringify(e))});
    e.phase = 'run'; e.mode = mode; e.src = src || null;
    e.queue = queue; e.idx = 0; e.answers = {}; e.flags = {};
    e.timed = minutes > 0;
    e.minutes = minutes || 0;
    e.remainingMs = minutes > 0 ? minutes * 60000 : 0;
    e.endAt = minutes > 0 ? Date.now() + e.remainingMs : 0;
    e.paused = false;
    e.sessionId = 'exam-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    e.gridOpen = false; e.result = null; e.label = label; e.showAll = false;
    State.confirmSubmit = false;
    State.view = 'exam'; save(); render();
  }
  function submitExam(auto) {
    var e = State.exam, ec = examCfg();
    if (e.phase !== 'run' || blockedSession(e)) return;
    stopTimer();
    var right = 0, answered = 0, byCh = {};
    e.queue.forEach(function (id) {
      var q = byId[id]; if (!q) return;
      var c = byCh[q.ch] = byCh[q.ch] || { total: 0, answered: 0, right: 0 };
      c.total++;
      var hasAnswer = owns(e.answers, id);
      var ok = hasAnswer && e.answers[id] === q.ans;
      if (hasAnswer) { answered++; c.answered++; }
      if (ok) { right++; c.right++; }
      if (hasAnswer) recordAttempt(id, ok, 'exam', e.sessionId, e.answers[id]);
    });
    var p = pct(right, e.queue.length);
    e.result = {
      right: right, answered: answered, unanswered: e.queue.length - answered,
      count: e.queue.length, pct: p, pass: p >= ec.passPct, auto: !!auto,
      byCh: Object.keys(byCh).sort(function (a, b) { return a - b; }).map(function (ch) {
        return { ch: +ch, total: byCh[ch].total, answered: byCh[ch].answered, right: byCh[ch].right };
      })
    };
    e.phase = 'result';
    e.paused = false; e.remainingMs = 0; e.endAt = 0;
    State.examHistory.push({ at: Date.now(), label: e.label, right: right, answered: answered, count: e.queue.length, pct: p, pass: p >= ec.passPct, sessionId: e.sessionId });
    if (State.examHistory.length > 30) State.examHistory = State.examHistory.slice(-30);
    save(); render();
  }
  function vExamRun() {
    var e = State.exam;
    if (blockedSession(e)) return blockedSessionHTML('exam');
    var q = byId[e.queue[e.idx]];
    var answered = Object.keys(e.answers).length;
    var h = topbar(e.label || '模擬考', e.paused ? '已暫停' : (e.idx + 1) + ' / ' + e.queue.length, 'e-quit',
      e.paused ? '' : '<button class="iconbtn' + (e.flags[q.id] ? ' on' : '') + '" data-act="e-flag">' + ic('flag', 17) + '</button>' +
      '<button class="iconbtn" data-act="e-grid">' + ic('grid', 17) + '</button>');
    h += '<div class="wrap">';
    if (e.paused) {
      h += '<div class="card result-hero pause-card">' + ic('pause', 38) +
        '<div class="verdict">模擬考已暫停</div>' +
        (e.timed ? '<div class="pause-time">剩餘 ' + fmtClock(examRemainingMs()) + '</div>' : '<div class="muted">不計時模式</div>') +
        '<div class="muted" style="margin-top:8px">已答 ' + answered + '/' + e.queue.length + '；暫停期間不會扣時，也不能作答。</div>' +
        '<button class="btn brand block" style="margin-top:18px" data-act="e-resume">' + ic('play', 16) + '繼續模擬考</button>' +
        '<button class="btn block" style="margin-top:10px" data-act="e-save-exit">保存並返回首頁</button>' +
        '<button class="btn danger block" style="margin-top:10px" data-act="e-discard">放棄本次</button>' +
        '</div></div>';
      return h;
    }
    h += '<div class="exambar">' +
      (e.timed ? '<div class="clock" id="clock">' + fmtClock(examRemainingMs()) + '</div>' : '<div class="chip">不計時</div>') +
      '<div class="muted" style="flex:1">已答 ' + answered + '/' + e.queue.length + '</div>' +
      '<button class="btn sm" data-act="e-pause">' + ic('pause', 14) + '暫停</button>' +
      '<button class="btn sm brand" data-act="e-submit">交卷</button></div>';
    if (State.confirmSubmit) {
      h += '<div class="card" style="border-color:var(--warn)"><b>還有 ' + (e.queue.length - answered) + ' 題未作答</b>' +
        '<div class="muted" style="margin:6px 0 12px">確定要交卷嗎？未答題目不會得分，但不會加入已做或錯題本。</div>' +
        '<div style="display:flex;gap:10px"><button class="btn" data-act="e-submit-cancel" style="flex:1">繼續作答</button>' +
        '<button class="btn danger" data-act="e-submit-force" style="flex:1">確定交卷</button></div></div>';
    }
    if (e.gridOpen) {
      h += '<div class="card"><div class="gridwrap">' + e.queue.map(function (id, i) {
        var cls = 'gcell';
        if (e.answers[id]) cls += ' done';
        if (e.flags[id]) cls += ' flag';
        if (i === e.idx) cls += ' cur';
        return '<button class="' + cls + '" data-act="e-jump" data-arg="' + i + '">' + (i + 1) + '</button>';
      }).join('') + '</div></div>';
    }
    h += qCard(q, e.answers[q.id] || null, false, { answerAct: 'e-answer' });
    h += '<div class="qnav">' +
      '<button class="btn" data-act="e-prev" ' + (e.idx ? '' : 'disabled') + '>上一題</button>' +
      '<div class="pos">' + (e.idx + 1) + '/' + e.queue.length + '</div>' +
      '<button class="btn brand" data-act="e-next" ' + (e.idx < e.queue.length - 1 ? '' : 'disabled') + '>下一題</button>' +
      '</div>';
    h += '</div>';
    return h;
  }
  function vExamResult() {
    var e = State.exam, r = e.result, ec = examCfg();
    var resultAnswered = r.answered == null ? Object.keys(e.answers || {}).length : r.answered;
    var resultUnanswered = r.unanswered == null ? Math.max(0, r.count - resultAnswered) : r.unanswered;
    var h = topbar('成績單', e.label, 'e-quit');
    h += '<div class="wrap">';
    if (blockedSession(e)) h += '<div class="card">歷史成績含已停用題，按當時答案保留，不能代表新版題目掌握度。</div>';
    h += '<div class="card result-hero">' +
      ring(r.pct, 130, r.pass ? 'var(--ok)' : 'var(--bad)', r.pct + '%', r.right + '/' + r.count) +
      '<div class="verdict ' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '合格 ✓' : '未達 ' + ec.passPct + '%') + '</div>' +
      '<div class="muted" style="margin-top:6px">已答 ' + resultAnswered + '/' + r.count +
      (resultUnanswered ? ' · 未答 ' + resultUnanswered : '') + '</div>' +
      (r.auto ? '<div class="faint" style="margin-top:4px">時間到自動交卷</div>' : '') +
      '</div>';
    h += '<div class="card"><div class="card-t">章節表現</div>' + r.byCh.map(function (c) {
      var cm = chMap[c.ch] || { zh: '' };
      var a = pct(c.right, c.total);
      return '<div class="result-row"><div class="rn">第' + c.ch + '章 ' + esc(cm.zh) + '</div>' +
        '<div class="rv">' + c.right + '/' + c.total + ' · <b style="color:var(--' + (a >= ec.passPct ? 'ok' : 'bad') + ')">' + a + '%</b></div></div>';
    }).join('') + '</div>';
    var wrongs = e.queue.filter(function (id) { var q = byId[id]; return q && owns(e.answers, id) && e.answers[id] !== q.ans; });
    h += '<div class="card"><div class="card-t">' + ic('x', 17) + '複盤（' + (e.showAll ? '全部 ' + e.queue.length : '錯題 ' + wrongs.length) + '）' +
      '<span style="flex:1"></span><button class="btn sm" data-act="e-showall">' + (e.showAll ? '只看錯題' : '看全部') + '</button></div></div>';
    (e.showAll ? e.queue : wrongs).forEach(function (id) {
      var q = byId[id]; if (!q) return;
      h += qCard(q, e.answers[id] || null, true, { showExplain: true, lockGraded: true, answerAct: 'noop' });
    });
    h += '<button class="btn brand block" style="margin-top:14px" data-act="e-quit">完成</button>';
    h += '</div>';
    return h;
  }

  /* ---------- 官方卷 ---------- */
  function vOfficial() {
    var h = topbar('官方練習卷', null, 'home2');
    h += '<div class="wrap">';
    var rendered = 0;
    [['past2006', '歷屆試題（2006年12月）', '繁體中文 · 附官方答案', '真實歷屆考卷，部分規例其後有修訂，解析中已標註。'],
     ['sample2023', '官方樣本試卷（2023）', '中英對照 · 附官方答案', '香港證券及投資學會官方 Sample Practice Test，最貼近現行考試。']]
      .forEach(function (s) {
        var qs = QUESTIONS.filter(function (q) { return q.src === s[0]; });
        if (!qs.length) return;
        rendered++;
        h += '<div class="card"><div class="card-t">' + ic('doc', 18) + esc(s[1]) + '</div>' +
          '<div class="muted">' + esc(s[2]) + ' · ' + qs.length + ' 題</div>' +
          '<div class="faint" style="margin:6px 0 12px">' + esc(s[3]) + '</div>' +
          '<div style="display:flex;gap:10px">' +
          '<button class="btn brand" style="flex:1" data-act="o-start" data-arg="' + s[0] + ':timed">計時模考</button>' +
          '<button class="btn" style="flex:1" data-act="o-start" data-arg="' + s[0] + ':free">不計時</button>' +
          '</div></div>';
      });
    if (!rendered) h += '<div class="empty">' + ic('doc', 34) + '目前版本尚未提供官方練習卷</div>';
    h += '</div>' + tabbar();
    return h;
  }

  /* ============================================================
     章节要点
     ============================================================ */
  function vUpdates() {
    var excluded = QUESTIONS.filter(function (q) { return !eligible(q); });
    var h = topbar('修訂與資料來源', '2026-09-14', 'home2') + '<div class="wrap"><div class="card">' +
      '<p>本次重寫 ' + updatedQuestions().length + ' 題，另有 ' + excluded.filter(function(q) { return q.reviewStatus === 'quarantined'; }).length +
      ' 道問題題待複核。原題與原有作答保留，但不再進入目前練習與覆蓋率。新版題目使用獨立編號，需重新作答。</p>' +
      '<p>考試基準為 HKSI Paper 1 第 3.5 版（2026-06-30 起）。本輪核查公開官方規則，未完成全部題目與官方手冊的對照。</p>' +
      sourceLinks([{title:'HKSI 手冊更新與考試依據', url:'https://www.hksi.org/en/qualification/examinations/licensing-examination-for-securities-and-futures-intermediaries/updating-your-study-guides/'}]) + '</div>';
    updatedQuestions().forEach(function(q) {
      h += '<div class="card"><div class="card-t">' + esc(q.id) + ' · 第' + q.ch + '章</div><p>' + esc(q.changeSummary) + '</p>' +
        sourceLinks(q.sourceRefs) + '<button class="btn" data-act="l-open" data-arg="' + esc(q.id) + '">練習此題</button></div>';
    });
    h += '<details class="card"><summary>已停用題目 ' + excluded.length + ' 道</summary>' + excluded.map(function(q) {
      return '<p>' + esc(q.id) + '：' + esc(q.reviewReason || '規則或選項待核查') + (q.replacedBy ? '；新版 ' + esc(q.replacedBy) : '') + '</p>';
    }).join('') + '</details></div>' + tabbar();
    return h;
  }
  function vNotes() {
    var nv = State.note;
    var h = topbar('章節要點', null, 'home2');
    h += '<div class="wrap">';
    h += '<div class="card"><p>目前提供發牌與CPT、紀錄保存及投資者賠償的首批要點，並非九章完整筆記。核查日期：2026-09-14。</p>' +
      '<button class="btn brand" data-act="nav" data-arg="study">速記復習與我的筆記</button></div>';
    if (!NOTES.length) {
      h += '<div class="empty">' + ic('book', 34) + '目前版本尚未提供章節要點</div></div>' + tabbar();
      return h;
    }
    h += '<div class="seg" style="margin-top:14px">' +
      '<button class="' + (nv.tab === 'ch' ? 'on' : '') + '" data-act="n-tab" data-arg="ch">章節</button>' +
      '<button class="' + (nv.tab === 'num' ? 'on' : '') + '" data-act="n-tab" data-arg="num">關鍵數字</button></div>';
    if (nv.tab === 'ch') {
      h += '<div class="card">' + CHAPTERS.map(function (c) {
        var note = NOTES.filter(function (n) { return n.ch === c.n; })[0];
        var np = note ? note.sections.reduce(function (s, x) { return s + x.points.length; }, 0) : 0;
        return '<div class="chrow" data-act="n-open" data-arg="' + c.n + '">' +
          '<div class="cn">' + c.n + '</div>' +
          '<div class="cmain"><div class="ct">' + esc(c.zh) + '</div>' +
          '<div class="faint">' + esc(c.en || '') + '</div></div>' +
          '<div class="cnum">' + (np ? np + ' 條' : '—') + '</div></div>';
      }).join('') + '</div>';
    } else {
      var kn = [];
      NOTES.forEach(function (n) {
        (n.keyNumbers || []).forEach(function (k) { kn.push({ ch: n.ch, label: k.label, value: k.value }); });
      });
      h += '<div class="card"><div class="muted" style="margin-bottom:8px">本批已核查的數字要點；請連同適用對象、條件及例外閱讀。</div>' +
        '<table class="numtable">' + kn.map(function (k) {
          return '<tr><td><span class="chip brand" style="margin-right:6px">' + k.ch + '</span>' + esc(k.label) + '</td><td>' + esc(k.value) + '</td></tr>';
        }).join('') + '</table></div>';
    }
    h += '</div>' + tabbar();
    return h;
  }
  function vNoteDetail() {
    var nv = State.note;
    var c = chMap[nv.ch] || {};
    var note = NOTES.filter(function (n) { return n.ch === nv.ch; })[0];
    var h = topbar('第' + nv.ch + '章', c.zh, 'n-back');
    h += '<div class="wrap">';
    if (!note) {
      h += '<div class="empty">' + ic('book', 34) + '本章要點暫未生成</div>';
    } else {
      h += '<button class="btn brand block" style="margin-top:14px" data-act="ch-practice" data-arg="' + nv.ch + '">刷本章題目</button>';
      note.sections.forEach(function (s, i) {
        var open = nv.open[i] !== false;
        h += '<div class="notesec' + (open ? ' open' : '') + '"><button data-act="n-sec" data-arg="' + i + '">' +
          '<span style="flex:1">' + esc(s.heading) + '</span><span class="faint">' + s.points.length + '</span>' + ic('chev', 16) + '</button>' +
          '<div class="body">' + s.points.map(function (p) {
            return '<div class="pt' + (p.src === '手冊' ? ' src-m' : '') + '">' + esc(p.t) + '</div>';
          }).join('') + '</div></div>';
      });
      if (note.keyNumbers && note.keyNumbers.length) {
        h += '<div class="card"><div class="card-t">' + ic('hash', 17) + '關鍵數字</div><table class="numtable">' +
          note.keyNumbers.map(function (k) { return '<tr><td>' + esc(k.label) + '</td><td>' + esc(k.value) + '</td></tr>'; }).join('') +
          '</table></div>';
      }
      if (note.examTraps && note.examTraps.length) {
        h += '<div class="card"><div class="card-t">' + ic('warn', 17) + '易錯陷阱</div>' +
          note.examTraps.map(function (t) { return '<div class="trap">' + ic('warn', 14) + '<span>' + esc(t) + '</span></div>'; }).join('') + '</div>';
      }
      h += '<div class="card"><div class="card-t">官方依據</div>' + sourceLinks(note.sourceRefs) +
        '<p class="faint">公開官方規則核查 · 非官方教材 · 手冊逐題對照待核</p></div>';
    }
    h += '</div>';
    return h;
  }

  function vQuestionNote() {
    var q = byId[State.noteQuestionId], a = State.attempts[State.noteQuestionId];
    var h = topbar('題目筆記', '查看解析與編輯筆記，不新增作答記錄', 'study-back') + '<div class="wrap">';
    if (!q) return h + '<div class="empty">這道題目目前無法讀取，已保存的筆記未被刪除。</div></div>';
    if (!eligible(q)) h += '<div class="card">此題已停用；以下保留舊版題目及解析供整理筆記，不作為現行規則依據。</div>';
    return h + qCard(q, a && a.selectedOption, true, { lockGraded: true, showExplain: true, answerAct: 'noop' }) + '</div>';
  }

  /* ============================================================
     错题本 / 收藏 / 搜索
     ============================================================ */
  function qListRows(ids, removeAct) {
    return ids.map(function (id) {
      var q = byId[id]; if (!q) return '';
      var a = State.attempts[id];
      return '<div class="qlrow" data-act="l-open" data-arg="' + id + '">' +
        '<div class="qlt">' + esc(q.q.split('\n')[0]) + '</div>' +
        '<div class="qlm">' + chChip(q.ch) + srcChip(q.src) +
        (a && a.n ? '<span class="chip ' + (a.c ? 'ok' : 'bad') + '">' + (a.c ? '已答對' : '答錯 ' + (a.n - a.r) + ' 次') + '</span>' : '') +
        '<span style="flex:1"></span>' +
        (removeAct ? '<button class="iconbtn" style="width:30px;height:30px" data-act="' + removeAct + '" data-arg="' + id + '">' + ic('trash', 14) + '</button>' : '') +
        '</div></div>';
    }).join('');
  }
  function vWrong() {
    var st = stats();
    var repair = legacyPollutionCandidate();
    var h = topbar('錯題本', st.wrongBook.length + ' 題', 'home2');
    h += '<div class="wrap">';
    if (repair) {
      h += '<div class="card repair-card"><div class="card-t">' + ic('warn', 18) + '舊版模考可能誤記</div>' +
        '<div class="muted">可撤回最近一次舊版模考中的 ' + repair.ids.length + ' 道' + (repair.exact ? '未作答誤記' : '疑似誤記錯題') + '。</div>' +
        '<button class="btn block" style="margin-top:12px" data-act="repair-legacy">檢查並修復</button></div>';
    }
    if (!st.wrongBook.length) {
      h += '<div class="empty">' + ic('check', 34) + '目前沒有待重做的錯題</div>';
    } else {
      h += '<button class="btn brand block" style="margin-top:14px" data-act="w-redo">重刷全部錯題</button>';
      h += '<div class="card">' + qListRows(st.wrongBook, 'w-remove') + '</div>';
      h += '<div class="faint" style="text-align:center;margin-top:10px">重新答對後自動移出錯題本</div>';
    }
    h += '</div>' + tabbar();
    return h;
  }
  function vFavs() {
    var st = stats();
    var h = topbar('收藏', st.favs.length + ' 題', 'home2');
    h += '<div class="wrap">';
    if (!st.favs.length) h += '<div class="empty">' + ic('star', 34) + '刷題時點星號收藏重點題</div>';
    else {
      h += '<button class="btn brand block" style="margin-top:14px" data-act="f-redo">刷收藏題</button>';
      h += '<div class="card">' + qListRows(st.favs, 'fav') + '</div>';
    }
    h += '</div>' + tabbar();
    return h;
  }
  function searchHits() {
    var kw = State.search.q.trim().toLowerCase();
    if (kw.length < 2) return [];
    return QUESTIONS.filter(function (q) {
      if (!eligible(q)) return false;
      var t = (q.q + ' ' + q.A + ' ' + q.B + ' ' + q.C + ' ' + q.D + ' ' + (q.ex || '') + (hasEn(q) ? ' ' + q.en.q : '')).toLowerCase();
      return t.indexOf(kw) >= 0;
    }).slice(0, 60).map(function (q) { return q.id; });
  }
  function vSearch() {
    var h = topbar('搜索', null, 'home2');
    h += '<div class="wrap">';
    h += '<div class="searchbox"><input id="searchin" placeholder="搜題幹 / 選項 / 解析（≥2字）" value="' + esc(State.search.q) + '"></div>';
    var hits = searchHits();
    if (State.search.q.trim().length >= 2) {
      h += '<div class="card">' + (hits.length ? qListRows(hits) : '<div class="empty">沒有匹配的題目</div>') + '</div>';
    }
    h += '</div>' + tabbar();
    return h;
  }

  /* ============================================================
     渲染 & 计时
     ============================================================ */
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function tickExam() {
    var e = State.exam;
    if (e.phase !== 'run' || !e.timed || e.paused) { stopTimer(); return; }
    var left = examRemainingMs();
    if (left <= 0) { submitExam(true); return; }
    var el = document.getElementById('clock');
    if (el) {
      el.textContent = fmtClock(left);
      el.className = 'clock' + (left < 5 * 60000 ? ' low' : '');
    }
  }
  function render(preserveScroll) {
    var oldScroll = window.scrollY;
    var el = document.getElementById('app');
    document.documentElement.setAttribute('data-theme', State.theme);
    stopTimer();
    var v = State.view, h = '';
    if (v === 'home') h = vHome();
    else if (v === 'practice') h = State.practice.phase === 'run' ? vPracticeRun() : vPracticeSetup();
    else if (v === 'exam') h = State.exam.phase === 'run' ? vExamRun() : State.exam.phase === 'result' ? vExamResult() : vExamSetup();
    else if (v === 'official') h = vOfficial();
    else if (v === 'notes') h = vNotes();
    else if (v === 'note') h = vNoteDetail();
    else if (v === 'question-note') h = vQuestionNote();
    else if (v === 'wrong') h = vWrong();
    else if (v === 'favs') h = vFavs();
    else if (v === 'search') h = vSearch();
    else if (v === 'updates') h = vUpdates();
    else if (v === 'study' && window.StudyTools) h = topbar('速記與我的筆記', null, 'home2') + '<div class="wrap">' + window.StudyTools.render() + '</div>' + tabbar();
    else { State.view = 'home'; h = vHome(); }
    if (storageError) h = '<div class="storage-warning" role="alert">' + esc(storageError) + ' <button class="btn sm" data-act="export-progress">匯出備份</button></div>' + h;
    el.innerHTML = h;
    if (v === 'question-note') {
      var noteEditor = document.querySelector('details[data-study-note]');
      if (noteEditor) noteEditor.open = true;
    }
    if (State.view === 'exam' && State.exam.phase === 'run' && State.exam.timed && !State.exam.paused) {
      tickExam(); timerId = setInterval(tickExam, 500);
    }
    if (State.view === 'search') {
      var si = document.getElementById('searchin');
      if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
    }
    window.scrollTo(0, preserveScroll === true ? oldScroll : 0);
  }

  /* ============================================================
     事件
     ============================================================ */
  function answerPractice(k) {
    var p = State.practice;
    if (p.graded || blockedSession(p) || !/^[A-D]$/.test(k)) return;
    var q = byId[p.queue[p.idx]];
    if (!eligible(q)) return;
    p.answers = p.answers || {};
    if (owns(p.answers, q.id)) return;
    p.answers[q.id] = k;
    p.sel = k; p.graded = true;
    p.roundDone++;
    var ok = k === q.ans;
    if (ok) p.roundRight++;
    recordAttempt(q.id, ok, 'practice', null, k);
    save(); render();
    var card = document.querySelector('.explain');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function handleAct(act, arg, target) {
    var p = State.practice, e = State.exam;
    switch (act) {
      case 'nav':
        if (State.view === 'exam' && e.phase === 'run' && arg !== 'exam') {
          if (!pauseExam()) break;
        }
        if (arg === 'practice' && p.phase !== 'run') { p.phase = 'setup'; }
        if (arg === 'exam' && e.phase === 'result') { /* 保留成绩单 */ }
        State.view = arg; save(); render(); break;
      case 'home2': State.view = 'home'; save(); render(); break;
      case 'study-back': State.view = 'study'; save(); render(); break;
      case 'theme': State.theme = State.theme === 'dark' ? 'light' : 'dark'; save(); render(); break;
      case 'lang':
        State.lang = State.lang === 'both' ? 'zh' : State.lang === 'zh' ? 'en' : 'both';
        save(); render(); break;
      case 'fav': toggleArr(State.favorites, arg); save(); render(true); break;
      case 'export-progress': exportProgress(); break;
      case 'updated-practice': startPractice(updatedQuestions().map(function (q) { return q.id; })); break;
      case 'archive-session': {
        var old = arg === 'exam' ? e : p;
        State.archivedSessions.push({ kind: arg, archivedAt: Date.now(), reason: '題庫修訂', session: JSON.parse(JSON.stringify(old)) });
        if (arg === 'exam') clearExam(); else { p.phase = 'setup'; p.queue = []; }
        State.view = arg; save(); render(); break;
      }

      /* 刷题 */
      case 'p-ch':
        if (arg === '0') p.chs = [];
        else toggleArr(p.chs, +arg);
        render(); break;
      case 'p-src': toggleArr(p.srcs, arg); if (!p.srcs.length) p.srcs = ['bank']; render(); break;
      case 'p-scope': p.scope = arg; render(); break;
      case 'p-order': p.order = arg; render(); break;
      case 'p-start': {
        var pool = practicePool();
        startPractice(p.order === 'rnd' ? shuffle(pool) : pool);
        break;
      }
      case 'p-answer': answerPractice(arg); break;
      case 'p-next':
        if (!blockedSession(p) && p.idx < p.queue.length) { p.idx++; p.sel = null; p.graded = false; save(); render(); } break;
      case 'p-prev':
        if (p.idx) { p.idx--; p.sel = null; p.graded = false; save(); render(); } break;
      case 'p-quit':
        if (p.idx >= p.queue.length) { p.phase = 'setup'; p.queue = []; }
        State.view = 'home'; save(); render(); break;
      case 'ch-practice':
        archivePracticeBeforeReplace(); p.queue = [];
        p.chs = [+arg]; p.srcs = ['bank', 'past2006', 'sample2023']; p.scope = 'all'; p.phase = 'setup';
        State.view = 'practice'; save(); render(); break;

      /* 模拟考 */
      case 'e-mode': e.mode = arg; e.count = arg === 'quick' ? 30 : examCfg().count; render(); break;
      case 'e-ch': if (arg === '0') e.chs = []; else toggleArr(e.chs, +arg); render(); break;
      case 'e-count': e.count = +arg; render(); break;
      case 'e-start': {
        var ec = examCfg();
        var cnt = e.mode === 'real' ? ec.count : e.mode === 'quick' ? 30 : e.count;
        var chs = e.mode === 'custom' ? e.chs : [];
        var queue = blueprintSample(cnt, chs);
        var mins = e.mode === 'real' ? ec.minutes : Math.round(queue.length * ec.minutes / ec.count);
        var label = e.mode === 'real' ? '60題模考' : e.mode === 'quick' ? '快速模考' : '自訂模考';
        startExam(e.mode, queue, mins, label);
        break;
      }
      case 'o-start': {
        var parts = arg.split(':');
        var qs = QUESTIONS.filter(function (q) { return q.src === parts[0]; }).map(function (q) { return q.id; });
        var mins2 = parts[1] === 'timed' ? Math.round(qs.length * examCfg().minutes / examCfg().count) : 0;
        startExam('official', qs, mins2, srcName(parts[0]), parts[0]);
        break;
      }
      case 'e-answer':
        if (e.paused || blockedSession(e) || !/^[A-D]$/.test(arg)) break;
        reconcileExamClock();
        if (e.phase !== 'run') break;
        e.answers[byId[e.queue[e.idx]].id] = arg;
        save(); render(); break;
      case 'e-prev': if (!e.paused && e.idx) { e.idx--; save(); render(); } break;
      case 'e-next': if (!e.paused && e.idx < e.queue.length - 1) { e.idx++; save(); render(); } break;
      case 'e-jump': if (!e.paused) { e.idx = +arg; e.gridOpen = false; save(); render(); } break;
      case 'e-grid': if (!e.paused) { e.gridOpen = !e.gridOpen; save(); render(); } break;
      case 'e-flag': {
        if (e.paused) break;
        var qid = byId[e.queue[e.idx]].id;
        if (e.flags[qid]) delete e.flags[qid]; else e.flags[qid] = 1;
        save(); render(); break;
      }
      case 'e-submit':
        if (e.paused) break;
        reconcileExamClock();
        if (e.phase !== 'run') break;
        if (Object.keys(e.answers).length < e.queue.length) { State.confirmSubmit = true; render(); }
        else submitExam(false);
        break;
      case 'e-submit-cancel': State.confirmSubmit = false; render(); break;
      case 'e-submit-force':
        State.confirmSubmit = false;
        reconcileExamClock();
        if (e.phase === 'run') submitExam(false);
        break;
      case 'e-pause': if (pauseExam()) render(); break;
      case 'e-resume':
      case 'e-continue':
        State.view = 'exam';
        if (resumeExam()) render();
        break;
      case 'e-save-exit':
        if (!e.paused && !pauseExam()) break;
        State.view = 'home'; save(); render(); break;
      case 'e-discard':
        if (!window.confirm('放棄本次模擬考？目前答案不會寫入已做、錯題本或成績紀錄。')) break;
        clearExam(); State.view = 'home'; save(); render(); break;
      case 'e-showall': e.showAll = !e.showAll; render(); break;
      case 'e-quit':
        if (e.phase === 'run') {
          if (!e.paused && !pauseExam()) break;
          State.view = 'home'; save(); render(); break;
        }
        clearExam(); State.view = 'home'; save(); render(); break;

      case 'repair-legacy': repairLegacyPollution(); break;

      /* 要点 */
      case 'n-tab': State.note.tab = arg; save(); render(); break;
      case 'n-open': State.note.ch = +arg; State.note.open = {}; State.view = 'note'; save(); render(); break;
      case 'n-back': State.view = 'notes'; save(); render(); break;
      case 'n-sec': {
        var o = State.note.open;
        o[arg] = o[arg] === false ? true : false;
        save(); render(true); break;
      }

      /* 列表 */
      case 'w-redo': startPractice(shuffle(stats().wrongBook)); break;
      case 'w-remove': toggleArr(State.wrongRemoved, arg); save(); render(); break;
      case 'f-redo': startPractice(stats().favs.slice()); break;
      case 'l-open': startPractice([arg]); break;
      case 'noop': break;
    }
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== document.body && !t.getAttribute('data-act')) t = t.parentNode;
    if (!t || t === document.body) return;
    handleAct(t.getAttribute('data-act'), t.getAttribute('data-arg'), t);
  });
  document.addEventListener('input', function (ev) {
    if (ev.target && ev.target.id === 'searchin') {
      State.search.q = ev.target.value;
      /* 只重绘结果区，避免输入框失焦：简单起见整页重绘并复焦 */
      var hits = searchHits();
      var card = document.querySelector('.wrap .card');
      var html = State.search.q.trim().length >= 2
        ? (hits.length ? qListRows(hits) : '<div class="empty">沒有匹配的題目</div>') : '';
      if (card) card.innerHTML = html;
      else if (html) {
        var w = document.querySelector('.wrap');
        var d = document.createElement('div'); d.className = 'card'; d.innerHTML = html;
        w.appendChild(d);
      }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (document.querySelector('.install-panel[open]')) return;
    if (ev.target && /INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY/.test(ev.target.tagName)) return;
    var k = ev.key.toUpperCase();
    var map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
    var letter = map[k] || (/^[A-D]$/.test(k) ? k : null);
    if (State.view === 'practice' && State.practice.phase === 'run') {
      if (letter) answerPractice(letter);
      else if (ev.key === 'ArrowRight' || ev.key === 'Enter') handleAct('p-next');
      else if (ev.key === 'ArrowLeft') handleAct('p-prev');
    } else if (State.view === 'exam' && State.exam.phase === 'run') {
      if (letter) handleAct('e-answer', letter);
      else if (ev.key === 'ArrowRight') handleAct('e-next');
      else if (ev.key === 'ArrowLeft') handleAct('e-prev');
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (!byId) return;
    if (document.hidden && State.exam.phase === 'run' && !blockedSession(State.exam)) { pauseExam(); }
    else if (!document.hidden) { reconcileExamClock(); if (State.view === 'exam') render(); }
  });
  window.addEventListener('focus', reconcileExamClock);
  window.addEventListener('pageshow', reconcileExamClock);
  window.addEventListener('pagehide', function () {
    if (!byId) return;
    if (State.exam.phase === 'run' && !blockedSession(State.exam)) pauseExam();
    else save();
  });

  /* ============================================================
     解锁（加密模式）—— openssl Salted__ 格式，PBKDF2+AES-CBC
     ============================================================ */
  var Lock = { busy: false, err: '', noCrypto: false };
  function b64ToBytes(b64) {
    var s = atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function unlock(pw) {
    var raw = b64ToBytes(window.VAULT);
    var magic = '';
    for (var i = 0; i < 8; i++) magic += String.fromCharCode(raw[i]);
    if (magic !== 'Salted__') return Promise.reject(new Error('数据包格式异常'));
    var salt = raw.slice(8, 16), ct = raw.slice(16);
    var iter = window.VAULT_ITER || 310000;
    var subtle = window.crypto && window.crypto.subtle;
    return subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, 384);
      })
      .then(function (bits) {
        var kb = new Uint8Array(bits);
        return subtle.importKey('raw', kb.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt'])
          .then(function (key) {
            return subtle.decrypt({ name: 'AES-CBC', iv: kb.slice(32, 48) }, key, ct);
          });
      })
      .then(function (buf) {
        var text = new TextDecoder().decode(buf);
        if (text.slice(0, 4) !== 'HK26') throw new Error('口令错误');
        var d = JSON.parse(text.slice(4));
        Object.keys(d).forEach(function (k) { window[k] = d[k]; });
      });
  }
  function lockHTML() {
    return '<div class="lock"><div class="lock-card">' +
      '<div class="lock-badge">' + ic('target', 26) + '</div>' +
      '<div class="lock-t">HKSI LE 試卷一</div>' +
      '<div class="lock-s">刷題 · 模考 · 筆記與速記</div>' +
      (Lock.noCrypto
        ? '<div class="lock-err">此環境不支援解密。<br>請用 HTTPS 網址開啟，不能直接開啟本機 HTML 檔案。</div>'
        : '<form id="lockform" autocomplete="on">' +
        '<input id="pw" name="password" type="password" aria-label="網站口令" placeholder="輸入網站口令" autocomplete="current-password" autocapitalize="none" spellcheck="false" ' + (Lock.busy ? 'disabled' : '') + '>' +
        (Lock.err ? '<div class="lock-err">' + esc(Lock.err) + '</div>' : '') +
        '<button class="btn brand block" type="submit" style="margin-top:12px" ' + (Lock.busy ? 'disabled' : '') + '>' +
        (Lock.busy ? '正在驗證口令…' : '進入') + '</button></form>') +
      '<button class="btn block app-utility" type="button" data-pwa-open>iPhone 安裝與離線設定</button>' +
      '<div class="lock-f">非官方學習工具 · 請尊重資料版權</div>' +
      '</div></div>';
  }
  function renderLock() {
    var el = document.getElementById('app');
    document.documentElement.setAttribute('data-theme', State.theme);
    el.innerHTML = lockHTML();
    var f = document.getElementById('lockform');
    if (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        tryUnlock(document.getElementById('pw').value);
      });
      var i = document.getElementById('pw');
      if (i && !Lock.busy) i.focus();
    }
  }
  function tryUnlock(pw) {
    if (!pw) { Lock.err = '請輸入網站口令'; renderLock(); return; }
    Lock.busy = true; Lock.err = ''; renderLock();
    unlock(pw).then(function () {
      try { sessionStorage.setItem(PASS_KEY, pw); } catch (e) { }
      start();
    }).catch(function () {
      Lock.busy = false; Lock.err = '口令不正確，請再試一次。';
      try { sessionStorage.removeItem(PASS_KEY); } catch (e) { }
      renderLock();
    });
  }

  /* ---------- 启动 ---------- */
  function start() {
    initData();
    var p = State.practice;
    if (p.phase === 'run' && !p.answers && p.roundDone > 0) p.legacyAnswersIncomplete = true;
    p.answers = p.answers || {};
    if (p.phase === 'run' && p.graded && p.sel && p.queue[p.idx]) p.answers[p.queue[p.idx]] = p.sel;
    /* 恢复中断的模考：暂停时不扣时；运行中则按绝对截止时间继续。 */
    var e = State.exam;
    if (e.phase === 'run' && blockedSession(e)) {
      e.remainingMs = e.paused ? e.remainingMs : Math.max(0, (e.endAt || 0) - Date.now());
      e.endAt = 0; e.paused = true;
    }
    if (e.phase === 'run' && !restoredView) State.view = 'exam';
    if (e.phase === 'run' && e.timed && !e.paused && Date.now() >= e.endAt) submitExam(true);
    else render();
  }
  window.HKSIApp = {
    isUnlocked: function () { return !!byId; }, prepareReload: prepareAppReload,
    exportBackup: exportProgress, inspectBackup: inspectBackup, restoreBackup: restoreBackup
  };
  load();
  if (!localStorage.getItem(KEY) && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    State.theme = 'dark';
  }
  if (window.HKSI_QUESTIONS) {
    start();
  } else if (window.VAULT) {
    if (!(window.crypto && window.crypto.subtle)) { Lock.noCrypto = true; renderLock(); }
    else {
      var saved = null;
      try { saved = sessionStorage.getItem(PASS_KEY); } catch (e) { }
      if (saved) { Lock.busy = true; renderLock(); unlock(saved).then(start).catch(function () { Lock.busy = false; renderLock(); }); }
      else renderLock();
    }
  } else {
    document.getElementById('app').innerHTML = '<div class="empty">题库未加载</div>';
  }
})();

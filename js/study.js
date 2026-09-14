/* Personal notes and recall cards. No network requests or password storage. */
(function () {
  'use strict';

  var KEY = 'hksi-le1-study-v1';
  var DAY = 86400000;
  var MAX_FILE = 1024 * 1024;
  var MAX_NOTE = 20000;
  var REASONS = [
    ['', '未分類'], ['concept', '概念未掌握'], ['condition', '條件或例外混淆'],
    ['number', '數字或期限記錯'], ['reading', '題意判讀'], ['careless', '粗心'], ['other', '其他']
  ];
  var ctx = {}, ready = false, loaded = false, listening = false;
  var questions = Object.create(null), cards = Object.create(null), cardList = [];
  var data = emptyData(), dirty = false, readBlocked = false;
  var notice = { type: '', text: '' };
  var ui = { tab: 'review', search: '', mode: 'due', queue: null, index: 0, revealed: false, sessionDone: 0 };

  function emptyData() { return { schemaVersion: 1, notes: Object.create(null), reviews: Object.create(null) }; }
  function owns(o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); }
  function plain(o) { return !!o && Object.prototype.toString.call(o) === '[object Object]' && !Array.isArray(o); }
  function safeId(id) {
    return (typeof id === 'string' || typeof id === 'number') && String(id).length > 0 && String(id).length <= 160 &&
      !/^(?:__proto__|prototype|constructor)$/.test(String(id));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function copyData(d) {
    var out = emptyData();
    Object.keys(d.notes).forEach(function (id) { var n = d.notes[id]; out.notes[id] = { text: n.text, reason: n.reason, updatedAt: n.updatedAt }; });
    Object.keys(d.reviews).forEach(function (id) { var r = d.reviews[id]; out.reviews[id] = { dueAt: r.dueAt, intervalDays: r.intervalDays, reps: r.reps, revision: r.revision }; });
    return out;
  }
  function reasonLabel(value) {
    for (var i = 0; i < REASONS.length; i++) if (REASONS[i][0] === value) return REASONS[i][1];
    return '未分類';
  }
  function knownReason(value) {
    return REASONS.some(function (r) { return r[0] === value; });
  }
  function onlyKeys(o, allowed) {
    return plain(o) && Object.keys(o).every(function (k) { return allowed.indexOf(k) >= 0; });
  }
  function validNote(n, now) {
    return onlyKeys(n, ['text', 'reason', 'updatedAt']) && typeof n.text === 'string' && n.text.length <= MAX_NOTE &&
      typeof n.reason === 'string' && knownReason(n.reason) && finite(n.updatedAt) && n.updatedAt > 0 && n.updatedAt <= now + 300000;
  }
  function validReview(r, now) {
    return onlyKeys(r, ['dueAt', 'intervalDays', 'reps', 'revision']) && finite(r.dueAt) && r.dueAt >= 0 &&
      r.dueAt <= now + 61 * DAY && finite(r.intervalDays) && r.intervalDays >= 0 && r.intervalDays <= 60 &&
      finite(r.reps) && r.reps >= 0 && r.reps <= 1000000 && Math.floor(r.reps) === r.reps &&
      (typeof r.revision === 'string' || typeof r.revision === 'number') && String(r.revision).length <= 160 &&
      (typeof r.revision !== 'number' || finite(r.revision)) &&
      ((r.dueAt === 0 && r.intervalDays === 0 && r.reps === 0) ||
        (r.dueAt > 0 && r.intervalDays > 0 && r.reps > 0 && r.dueAt - r.intervalDays * DAY > 0 && r.dueAt - r.intervalDays * DAY <= now + 300000));
  }
  function validate(raw) {
    var now = Date.now(), out = emptyData();
    if (!onlyKeys(raw, ['schemaVersion', 'notes', 'reviews']) || raw.schemaVersion !== 1 || !plain(raw.notes) || !plain(raw.reviews)) {
      throw new Error('備份格式或版本不支援。');
    }
    Object.keys(raw.notes).forEach(function (id) {
      if (!safeId(id) || !validNote(raw.notes[id], now)) throw new Error('筆記欄位或時間不合法，未匯入任何資料。');
      var n = raw.notes[id]; out.notes[id] = { text: n.text, reason: n.reason, updatedAt: n.updatedAt };
    });
    Object.keys(raw.reviews).forEach(function (id) {
      if (!safeId(id) || !validReview(raw.reviews[id], now)) throw new Error('速記進度欄位或時間不合法，未匯入任何資料。');
      var r = raw.reviews[id]; out.reviews[id] = { dueAt: r.dueAt, intervalDays: r.intervalDays, reps: r.reps, revision: r.revision };
    });
    return out;
  }
  function stamp(ts) {
    if (!ts) return '未安排';
    var d = new Date(ts);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function setNotice(type, message) {
    notice = { type: type, text: message };
    var nodes = document.querySelectorAll('[data-study-notice]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].className = 'study-notice' + (type ? ' ' + type : '');
      nodes[i].textContent = message;
      nodes[i].hidden = !message;
    }
    refreshNoteStatuses();
  }
  function noticeHTML() {
    return '<div class="study-notice ' + esc(notice.type) + '" data-study-notice role="status" aria-live="polite"' +
      (notice.text ? '' : ' hidden') + '>' + esc(notice.text) + '</div>';
  }
  function persist(next) {
    if (readBlocked) {
      setNotice('error', '現有本機資料未能安全讀取，已停止寫入以免覆蓋。請先匯出現有資料備份，再檢查瀏覽器儲存權限或資料格式。');
      return false;
    }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      dirty = false;
      return true;
    } catch (e) {
      setNotice('error', '未能保存至本瀏覽器：儲存空間不足或儲存權限受限。請勿關閉頁面；可先匯出備份，再釋出空間或重試。');
      return false;
    }
  }
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw !== null) data = validate(JSON.parse(raw));
    } catch (e) {
      readBlocked = true;
      notice = { type: 'error', text: '本機筆記資料未能讀取，現有資料沒有被覆蓋。請先匯出現有資料，再檢查瀏覽器儲存權限或資料格式。' };
    }
    loaded = true;
  }
  function init(options) {
    ctx = options || {};
    questions = Object.create(null); cards = Object.create(null); cardList = [];
    (Array.isArray(ctx.questions) ? ctx.questions : []).forEach(function (q) {
      if (q && safeId(q.id)) questions[String(q.id)] = q;
    });
    (Array.isArray(ctx.cards) ? ctx.cards : []).forEach(function (card) {
      if (card && safeId(card.id) && !owns(cards, String(card.id)) && typeof card.front === 'string' && typeof card.back === 'string') {
        cards[String(card.id)] = card; cardList.push(card);
      }
    });
    if (!loaded) load();
    ready = true;
    if (ui.queue) ui.queue = ui.queue.filter(function (id) { return owns(cards, id); });
    if (!listening) { attachEvents(); listening = true; }
  }
  function noteStatus(id) {
    if (readBlocked) return '本機儲存不可用；輸入只保留至本頁關閉，請匯出備份。';
    if (dirty) return '有變更尚未寫入本機；請勿關閉頁面，可先匯出備份。';
    var n = data.notes[id];
    return n ? '已儲存於本瀏覽器 · ' + stamp(n.updatedAt) : '輸入後自動儲存在本瀏覽器。';
  }
  function refreshNoteStatuses() {
    var nodes = document.querySelectorAll('[data-study-note-status]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = noteStatus(nodes[i].getAttribute('data-study-id'));
      nodes[i].className = 'study-note-status' + (dirty || readBlocked ? ' error' : '');
    }
  }
  function noteHTML(q) {
    if (!ready || !q || !safeId(q.id) || !owns(questions, String(q.id))) return '';
    var id = String(q.id), n = data.notes[id] || { text: '', reason: '' };
    return '<details class="study-note" data-study-note data-study-id="' + esc(id) + '">' +
      '<summary>個人筆記' + (n.text || n.reason ? ' · 已記錄' : '') + '</summary>' +
      '<div class="study-note-body">' + noticeHTML() + '<label>這題的筆記<textarea class="study-textarea" rows="4" maxlength="' + MAX_NOTE +
      '" data-study-act="note-text" data-study-id="' + esc(id) + '" placeholder="記下容易混淆的條件、例外或解題方法。">' + esc(n.text) + '</textarea></label>' +
      '<label class="study-reason">錯因（可選）<select data-study-act="note-reason" data-study-id="' + esc(id) + '">' +
      REASONS.map(function (r) { return '<option value="' + esc(r[0]) + '"' + (n.reason === r[0] ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join('') +
      '</select></label><div class="study-note-status' + (dirty || readBlocked ? ' error' : '') + '" data-study-note-status data-study-id="' + esc(id) +
      '" role="status" aria-live="polite">' + esc(noteStatus(id)) + '</div>' +
      '<div class="study-actions"><button type="button" class="btn sm" data-study-act="retry-save">重試保存</button>' +
      '<button type="button" class="btn sm" data-study-act="export">匯出筆記與速記進度</button>' +
      '<button type="button" class="btn sm danger" data-study-act="delete-note" data-study-id="' + esc(id) + '">刪除此題筆記</button></div>' +
      '<p class="faint study-privacy">筆記只存本瀏覽器，備份不含網站口令；同一瀏覽器使用者可讀取這些筆記。</p></div></details>';
  }
  function saveNote(id, kind, value) {
    if (!owns(questions, id)) return;
    var n = data.notes[id] || { text: '', reason: '', updatedAt: 0 };
    if (kind === 'text') {
      if (value.length > MAX_NOTE) { setNotice('error', '單題筆記最多 20,000 字，超出部分尚未保存。'); return; }
      n.text = value;
    } else if (knownReason(value)) n.reason = value;
    else return;
    n.updatedAt = Date.now(); data.notes[id] = n; dirty = true;
    if (persist(data)) setNotice('ok', '筆記已儲存於本瀏覽器。');
    refreshNoteStatuses();
    var elements = document.querySelectorAll('[data-study-note]');
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].getAttribute('data-study-id') === id) {
        var summary = elements[i].querySelector('summary');
        if (summary) summary.textContent = '個人筆記' + (n.text || n.reason ? ' · 已記錄' : '');
      }
    }
  }
  function sameRevision(card, review) { return review && String(review.revision) === String(card.revision == null ? '' : card.revision); }
  function isDue(card, now) { var r = data.reviews[String(card.id)]; return !sameRevision(card, r) || r.dueAt <= now; }
  function countDue() {
    if (!ready) return 0;
    var now = Date.now();
    return cardList.filter(function (card) { return isDue(card, now); }).length;
  }
  function nextDays(old) {
    var steps = [1, 3, 7, 14, 28, 56, 60];
    for (var i = 0; i < steps.length; i++) if (steps[i] > old) return steps[i];
    return 60;
  }
  function makeQueue(mode) {
    var now = Date.now();
    ui.mode = mode; ui.index = 0; ui.revealed = false; ui.sessionDone = 0;
    ui.queue = cardList.filter(function (card) { return mode === 'all' || isDue(card, now); }).sort(function (a, b) {
      var aDue = isDue(a, now), bDue = isDue(b, now);
      if (aDue !== bDue) return aDue ? -1 : 1;
      var ar = data.reviews[String(a.id)], br = data.reviews[String(b.id)];
      var at = sameRevision(a, ar) ? ar.dueAt : 0, bt = sameRevision(b, br) ? br.dueAt : 0;
      return at - bt;
    }).map(function (card) { return String(card.id); });
  }
  function safeSourceUrl(url) {
    if (typeof url !== 'string' || !/^https:\/\/(?:[a-z0-9-]+\.)*(?:sfc\.hk|hksi\.org)(?::443)?(?:[/?#]|$)/i.test(url)) return '';
    try {
      var a = document.createElement('a'); a.href = url;
      var host = a.hostname.toLowerCase();
      if (a.protocol !== 'https:' || !/(^|\.)(sfc\.hk|hksi\.org)$/.test(host) || (a.port && a.port !== '443') || a.username || a.password) return '';
      return a.href;
    } catch (e) { return ''; }
  }
  function sourceHTML(card) {
    var refs = Array.isArray(card.sourceRefs) ? card.sourceRefs : [];
    return '<details class="study-sources"><summary>官方來源與定位（' + refs.length + '）</summary>' +
      (refs.length ? '<ul>' + refs.map(function (ref) {
        ref = ref || {};
        var url = safeSourceUrl(ref.url), title = typeof ref.title === 'string' ? ref.title : '官方來源';
        return '<li>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(title) + '</a>' : esc(title) + '（來源網址未通過官方網域檢查）') +
          (ref.locator ? '<div class="muted study-preserve">' + esc(ref.locator) + '</div>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted">此卡未提供可核對的官方來源，請勿單靠此卡判斷規則。</p>') + '</details>';
  }
  function checkDate(card) {
    var value = card.checkedAt || card.verifiedAt || '';
    if (typeof value === 'number' && finite(value) && value > 0) return stamp(value).split(' ')[0];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return '未提供';
  }
  function reviewHTML() {
    if (!ui.queue) makeQueue('due');
    var due = countDue(), current = ui.queue[ui.index], card = current && cards[current];
    var h = '<section class="card study-review-controls"><div class="study-heading"><h2>速記復習</h2><span class="chip brand">待複習 ' + due + ' / ' + cardList.length + '</span></div>' +
      '<p class="muted">先自行回憶，再顯示答案。完成後按熟悉程度安排下一次複習。</p>' +
      '<div class="study-actions"><button type="button" class="btn sm' + (ui.mode === 'due' ? ' brand' : '') + '" data-study-act="review-due">複習到期卡片</button>' +
      '<button type="button" class="btn sm' + (ui.mode === 'all' ? ' brand' : '') + '" data-study-act="review-all">複習全部（含未到期）</button></div></section>';
    if (!card) {
      return h + '<section class="card study-empty"><h3>' + (cardList.length ? '本輪沒有剩餘卡片' : '暫無速記卡片') + '</h3>' +
        '<p class="muted">' + (ui.sessionDone ? '本輪已複習 ' + ui.sessionDone + ' 張。' : '') +
        (cardList.length ? '到期後可按「複習到期卡片」，或選擇複習全部。' : '速記資料載入後會在這裡顯示。') + '</p></section>';
    }
    var review = data.reviews[current], changed = review && !sameRevision(card, review);
    var old = sameRevision(card, review) ? review.intervalDays : 0;
    h += '<section class="card study-flashcard" aria-label="速記卡片"><div class="study-heading"><span class="chip">第 ' + esc(card.ch) + ' 章</span>' +
      '<span class="muted">' + (ui.index + 1) + ' / ' + ui.queue.length + '</span></div>' +
      (changed ? '<p class="study-update">卡片內容已更新，需重新複習。</p>' : '') +
      '<p class="faint study-card-status">' + (isDue(card, Date.now()) ? (!review ? '新卡片' : changed ? '修訂後待複習' : '已到期') : '尚未到期 · ' + esc(stamp(review.dueAt))) + '</p>' +
      '<h3 class="study-front study-preserve" tabindex="-1" data-study-front>' + esc(card.front) + '</h3>';
    if (!ui.revealed) h += '<button type="button" class="btn brand block study-reveal" data-study-act="reveal" data-study-id="' + esc(current) + '">顯示答案</button>';
    else {
      h += '<div class="study-answer" tabindex="-1" data-study-answer><h4>答案與適用條件</h4><div class="study-preserve">' + esc(card.back) + '</div></div>' +
        '<div class="study-rating" aria-label="安排下次複習"><button type="button" class="btn" data-study-act="rate-again" data-study-id="' + esc(current) + '">再練<span>10 分鐘後</span></button>' +
        '<button type="button" class="btn" data-study-act="rate-hard" data-study-id="' + esc(current) + '">不熟<span>1 天後</span></button>' +
        '<button type="button" class="btn brand" data-study-act="rate-good" data-study-id="' + esc(current) + '">熟悉<span>' + nextDays(old) + ' 天後</span></button></div>';
      var qids = (Array.isArray(card.questionIds) ? card.questionIds : []).filter(function (id) { return safeId(id) && owns(questions, String(id)); });
      if (qids.length) h += '<div class="study-related"><span class="muted">相關題目：</span>' + qids.map(function (id) {
        var q = questions[String(id)];
        return '<button type="button" class="btn sm" data-study-act="open-question" data-study-id="' + esc(id) + '">' + esc(q.code || id) + '</button>';
      }).join('') + '</div>';
    }
    return h + '<p class="faint study-disclaimer">非官方速記，不能替代官方溫習手冊。核查日期：' + esc(checkDate(card)) + '。規則須連同條件及例外閱讀。</p>' + sourceHTML(card) + '</section>';
  }
  function questionText(q) { return String(q.q || (q.zh && q.zh.q) || q.title || q.id); }
  function noteEntries() {
    var query = ui.search.trim().toLowerCase();
    return Object.keys(data.notes).filter(function (id) {
      var n = data.notes[id], q = questions[id];
      if (!q || (!n.text.trim() && !n.reason)) return false;
      return !query || (n.text + '\n' + reasonLabel(n.reason) + '\n' + questionText(q) + '\n' + (q.code || id)).toLowerCase().indexOf(query) >= 0;
    }).sort(function (a, b) { return data.notes[b].updatedAt - data.notes[a].updatedAt; });
  }
  function noteResultsHTML() {
    var ids = noteEntries();
    if (!ids.length) return '<div class="card study-empty"><p>' + (ui.search.trim() ? '沒有符合搜尋的筆記。' : '暫無個人筆記。') + '</p><p class="muted">答題解析下方可新增筆記和錯因。</p></div>';
    return '<p class="muted study-result-count">' + ids.length + ' 題筆記</p>' + ids.map(function (id) {
      var q = questions[id], n = data.notes[id];
      return '<article class="card study-note-item"><div class="study-heading"><span class="chip">第 ' + esc(q.ch) + ' 章</span><span class="faint">' + esc(q.code || id) + '</span></div>' +
        '<h3 class="study-note-question">' + esc(questionText(q)) + '</h3>' +
        (n.reason ? '<span class="chip warn">錯因：' + esc(reasonLabel(n.reason)) + '</span>' : '') +
        (n.text ? '<p class="study-note-preview study-preserve">' + esc(n.text) + '</p>' : '') +
        '<p class="faint">更新於 ' + esc(stamp(n.updatedAt)) + '</p>' +
        '<div class="study-actions"><button type="button" class="btn sm brand" data-study-act="edit-question-note" data-study-id="' + esc(id) + '">查看原題並編輯筆記</button>' +
        '<button type="button" class="btn sm danger" data-study-act="delete-note" data-study-id="' + esc(id) + '">刪除筆記</button></div></article>';
    }).join('');
  }
  function notesHTML() {
    return '<section class="card"><h2>我的筆記</h2><label class="study-search-label">搜尋筆記、錯因或題目<input type="search" class="study-search" data-study-act="note-search" value="' + esc(ui.search) +
      '" placeholder="輸入關鍵字" autocomplete="off"></label></section><div data-study-note-results>' + noteResultsHTML() + '</div>';
  }
  function render() {
    if (!ready) return '<div class="card"><p>題庫載入後可使用筆記與速記。</p></div>';
    return '<div class="study-root">' + noticeHTML() +
      '<div class="seg study-tabs" aria-label="學習工具"><button type="button" class="' + (ui.tab === 'review' ? 'on' : '') + '" data-study-act="tab-review" aria-pressed="' + (ui.tab === 'review') + '">速記復習</button>' +
      '<button type="button" class="' + (ui.tab === 'notes' ? 'on' : '') + '" data-study-act="tab-notes" aria-pressed="' + (ui.tab === 'notes') + '">我的筆記</button></div>' +
      (ui.tab === 'notes' ? notesHTML() : reviewHTML()) +
      '<section class="card study-backup"><h2>本機資料備份</h2><p class="muted">筆記及速記進度只存在本瀏覽器，不會上傳或跨裝置同步；備份不含網站口令。清除網站資料或使用私密瀏覽可能導致資料遺失；同一瀏覽器使用者可讀取。</p>' +
      '<div class="study-actions"><button type="button" class="btn" data-study-act="export">匯出筆記與速記進度</button>' +
      '<label class="btn study-import-label">匯入備份<input type="file" accept=".json,application/json" data-study-act="import" aria-label="匯入備份 JSON"></label>' +
      '<button type="button" class="btn sm" data-study-act="retry-save">重試保存</button></div>' +
      '<p class="faint study-import-help">JSON 上限 1 MB。只合併本題庫已知題目與卡片中較新的有效記錄；無效檔案不會覆蓋資料。請只匯入自己的備份。</p></section></div>';
  }
  function redraw(focusSelector) {
    if (typeof ctx.redraw === 'function') ctx.redraw();
    if (focusSelector) {
      var focus = document.querySelector(focusSelector);
      if (focus) { try { focus.focus({ preventScroll: true }); } catch (e) { focus.focus(); } }
    }
  }
  function rate(id, kind) {
    if (!ui.revealed || !ui.queue || ui.queue[ui.index] !== id || !owns(cards, id)) return;
    var card = cards[id], previous = data.reviews[id], old = sameRevision(card, previous) ? previous.intervalDays : 0;
    var days = kind === 'again' ? 10 / 1440 : kind === 'hard' ? 1 : nextDays(old);
    var next = copyData(data);
    next.reviews[id] = { dueAt: Date.now() + days * DAY, intervalDays: days, reps: Math.min(1000000, (previous ? previous.reps : 0) + 1), revision: card.revision == null ? '' : card.revision };
    if (!persist(next)) { setNotice('error', notice.text + ' 本次速記評分未保存，卡片仍保留在這裡，請重試。'); return; }
    data = next; ui.index++; ui.sessionDone++; ui.revealed = false;
    setNotice('ok', '速記進度已儲存；下次複習：' + stamp(next.reviews[id].dueAt) + '。');
    redraw('[data-study-front]');
  }
  function deleteNote(id) {
    if (!owns(questions, id) || !owns(data.notes, id)) { setNotice('', '這題尚未有筆記。'); return; }
    if (!window.confirm('刪除這題的個人筆記及錯因？\n如需還原，請先匯出備份；刪除後可匯入先前的備份恢復。')) return;
    var next = copyData(data); delete next.notes[id];
    if (!persist(next)) return;
    data = next; setNotice('ok', '已刪除此題筆記。可匯入刪除前的備份恢復。');
    var editors = document.querySelectorAll('[data-study-note]');
    for (var i = 0; i < editors.length; i++) {
      if (editors[i].getAttribute('data-study-id') === id) {
        var textarea = editors[i].querySelector('textarea'), select = editors[i].querySelector('select'), summary = editors[i].querySelector('summary');
        if (textarea) textarea.value = ''; if (select) select.value = ''; if (summary) summary.textContent = '個人筆記';
      }
    }
    var results = document.querySelector('[data-study-note-results]');
    if (results) results.innerHTML = noteResultsHTML();
    refreshNoteStatuses();
  }
  function downloadJSON(text, filename) {
    var url = '', a;
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      url = window.URL.createObjectURL(blob);
      a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 30000);
      return true;
    } catch (e) {
      if (url) window.URL.revokeObjectURL(url);
      if (a && a.parentNode) a.parentNode.removeChild(a);
      setNotice('error', '未能產生下載檔案，請保持頁面開啟並檢查瀏覽器下載權限。');
      return false;
    }
  }
  function exportData() {
    var text, filename = 'hksi-notes-reviews-' + new Date().toISOString().slice(0, 10);
    if (readBlocked) {
      try {
        text = window.localStorage.getItem(KEY);
        if (text && downloadJSON(text, filename + '-raw.json')) setNotice('error', '已請求下載原始本機資料。格式可能損壞，請保留作修復用途；本頁新輸入尚未包含在這個原始檔案。');
        else if (!text) setNotice('error', '本機原始資料無法取得；將嘗試匯出目前頁面中的筆記。');
      } catch (e) { setNotice('error', '本機資料讀取受限；將嘗試匯出目前頁面中的筆記。'); }
      if (Object.keys(data.notes).length || Object.keys(data.reviews).length) downloadJSON(JSON.stringify(data, null, 2), filename + '-current-page.json');
      return;
    }
    text = JSON.stringify(data);
    if (downloadJSON(text, filename + '.json')) {
      var large = new Blob([text]).size > MAX_FILE;
      setNotice(large ? 'error' : 'ok', large ? '已請求下載完整備份，但檔案超過 1 MB，不能直接匯入；請保留檔案並縮減筆記後另存可匯入備份。' :
        '已請求下載備份' + (dirty ? '（包含尚未寫入本機的筆記）' : '') + '。請確認檔案已下載；備份內含個人筆記，請妥善保存。');
    }
  }
  function reviewTime(r) { return r.dueAt - r.intervalDays * DAY; }
  function mergeImport(incoming) {
    var next = copyData(data), merged = 0, skipped = 0;
    Object.keys(incoming.notes).forEach(function (id) {
      var n = incoming.notes[id];
      if (!owns(questions, id)) { skipped++; return; }
      if (!owns(next.notes, id) || n.updatedAt > next.notes[id].updatedAt) { next.notes[id] = n; merged++; }
      else skipped++;
    });
    Object.keys(incoming.reviews).forEach(function (id) {
      var r = incoming.reviews[id], prior = next.reviews[id];
      if (!owns(cards, id)) { skipped++; return; }
      if (!prior || reviewTime(r) > reviewTime(prior) || (reviewTime(r) === reviewTime(prior) && sameRevision(cards[id], r) && !sameRevision(cards[id], prior))) {
        next.reviews[id] = r; merged++;
      } else skipped++;
    });
    if (!persist(next)) { setNotice('error', notice.text + ' 匯入尚未完成，原資料未被此檔案覆蓋。'); return; }
    data = next; ui.queue = null; ui.revealed = false;
    setNotice('ok', '匯入完成：合併 ' + merged + ' 筆，略過 ' + skipped + ' 筆未知、較舊或相同記錄。');
    redraw();
  }
  function importFile(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) { setNotice('error', '備份超過 1 MB，未匯入任何資料。'); return; }
    if (!file.size) { setNotice('error', '備份檔案是空的，未匯入任何資料。'); return; }
    if (!window.confirm('只匯入你自己的備份。將按記錄時間合併較新的筆記與速記進度；建議先匯出目前資料。是否繼續？')) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        if (typeof reader.result !== 'string') throw new Error('備份不能讀取。');
        var parsed = JSON.parse(reader.result.replace(/^\uFEFF/, ''));
        mergeImport(validate(parsed));
      } catch (e) { setNotice('error', '備份校驗失敗：' + (e && e.message ? e.message : '檔案不是有效 JSON。') + ' 現有資料未被覆蓋。'); }
    };
    reader.onerror = function () { setNotice('error', '備份讀取失敗，未匯入任何資料。'); };
    reader.onabort = function () { setNotice('error', '備份讀取已取消，未匯入任何資料。'); };
    try { reader.readAsText(file, 'UTF-8'); } catch (e) { setNotice('error', '備份讀取失敗，未匯入任何資料。'); }
  }
  function actionElement(target) {
    while (target && target !== document.body) {
      if (target.getAttribute && target.getAttribute('data-study-act')) return target;
      target = target.parentNode;
    }
    return null;
  }
  function attachEvents() {
    document.addEventListener('click', function (ev) {
      if (!ready) return;
      var el = actionElement(ev.target); if (!el || el.disabled) return;
      var act = el.getAttribute('data-study-act'), id = el.getAttribute('data-study-id');
      if (/^(?:note-text|note-reason|note-search|import)$/.test(act)) return;
      ev.preventDefault();
      if (act === 'tab-review' || act === 'tab-notes') { ui.tab = act === 'tab-review' ? 'review' : 'notes'; redraw('[data-study-act="' + act + '"]'); }
      else if (act === 'review-due' || act === 'review-all') { makeQueue(act === 'review-all' ? 'all' : 'due'); redraw('[data-study-front]'); }
      else if (act === 'reveal' && ui.queue && ui.queue[ui.index] === id) { ui.revealed = true; redraw('[data-study-answer]'); }
      else if (/^rate-(again|hard|good)$/.test(act)) rate(id, act.slice(5));
      else if (act === 'open-question' && owns(questions, id) && typeof ctx.openQuestion === 'function') ctx.openQuestion(questions[id].id);
      else if (act === 'edit-question-note' && owns(questions, id) && typeof ctx.openQuestion === 'function') ctx.openQuestion(questions[id].id, { edit: true });
      else if (act === 'delete-note') deleteNote(id);
      else if (act === 'export') exportData();
      else if (act === 'retry-save') {
        if (readBlocked) {
          setNotice('error', '為避免覆蓋未能讀取的資料，目前不能重試寫入。請先匯出原始備份，再檢查資料格式或瀏覽器權限並重新載入。');
        } else if (persist(data)) setNotice('ok', '筆記及速記進度已儲存於本瀏覽器。');
      }
    });
    document.addEventListener('input', function (ev) {
      if (!ready || !ev.target || !ev.target.getAttribute) return;
      var el = ev.target, act = el.getAttribute('data-study-act');
      if (act === 'note-text') saveNote(el.getAttribute('data-study-id'), 'text', el.value);
      else if (act === 'note-search') {
        ui.search = el.value;
        var results = document.querySelector('[data-study-note-results]');
        if (results) results.innerHTML = noteResultsHTML();
      }
    });
    document.addEventListener('change', function (ev) {
      if (!ready || !ev.target || !ev.target.getAttribute) return;
      var el = ev.target, act = el.getAttribute('data-study-act');
      if (act === 'note-reason') saveNote(el.getAttribute('data-study-id'), 'reason', el.value);
      else if (act === 'import') importFile(el);
    });
    document.addEventListener('keydown', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.getAttribute && (el.hasAttribute('data-study-act') || el.hasAttribute('data-study-note'))) { ev.stopPropagation(); return; }
        el = el.parentNode;
      }
    }, true);
  }

  window.StudyTools = { init: init, noteHTML: noteHTML, render: render, countDue: countDue,
    canReloadSafely: function () { return !dirty; },
    canMigrateIntoEmpty: function () {
      return loaded && !dirty && !readBlocked && !Object.keys(data.notes).length && !Object.keys(data.reviews).length;
    }
  };
}());

/* Home-screen installation and offline status. Never stores the website password. */
(function () {
  'use strict';
  var registration = null, registering = null, panel = null, opener = null;
  var offlineReady = false, offlineVersion = '', checking = false, statusError = '';
  var deferredPrompt = null, applying = false, reloaded = false;
  var APPLE_HELP = 'https://support.apple.com/zh-hk/guide/iphone/iphea86e5236/ios';
  var FONT_KEY = 'hksi-le1-font-size', FONT_SIZES = ['100', '125', '150', '200'];
  var fontSize = '100', fontNotice = '';

  function restoreFontSize() {
    try {
      var saved = window.localStorage.getItem(FONT_KEY);
      if (FONT_SIZES.indexOf(saved) !== -1) fontSize = saved;
    } catch (error) {
      fontNotice = '未能讀取文字大小設定，已使用 100%。仍可在本頁調整。';
    }
    document.documentElement.style.fontSize = fontSize + '%';
  }
  function updateFontUI() {
    if (!panel) return;
    panel.querySelector('[data-install-font-size]').value = fontSize;
    var notice = panel.querySelector('[data-install-font-notice]');
    notice.textContent = fontNotice; notice.hidden = !fontNotice;
  }
  function changeFontSize(event) {
    var next = event.target.value;
    if (FONT_SIZES.indexOf(next) === -1) { updateFontUI(); return; }
    fontSize = next; document.documentElement.style.fontSize = fontSize + '%';
    fontNotice = '';
    try { window.localStorage.setItem(FONT_KEY, fontSize); }
    catch (error) { fontNotice = '文字大小已套用，但未能儲存；下次開啟可能恢復預設。'; }
    updateFontUI();
  }

  function standalone() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function setNotice(message, error) {
    if (!panel) return;
    var node = panel.querySelector('[data-install-notice]');
    node.textContent = message; node.hidden = !message;
    node.setAttribute('data-state', error ? 'error' : 'ready');
  }
  function updateUI() {
    if (!panel) return;
    updateFontUI();
    var status = panel.querySelector('[data-offline-status]');
    var online = navigator.onLine !== false;
    status.setAttribute('data-state', offlineReady ? 'ready' : statusError ? 'error' : 'pending');
    status.textContent = offlineReady
      ? (online ? '離線資料已備妥' : '目前離線 · 已有完整離線資料') + '。可離線輸入口令、刷題及復習；官方來源連結仍需網路。'
      : statusError || (checking ? '正在準備並核對離線資料，完成前請保持連線。' : '尚未確認離線資料完整。請連線後按「檢查離線與更新」。');
    panel.querySelector('[data-install-mode]').textContent = standalone()
      ? '目前以主屏幕 App 模式開啟。' : '這是可加入主屏幕的網頁 App，不需 App Store。';
    panel.querySelector('[data-install-version]').textContent = offlineVersion ? '本機離線版本：' + offlineVersion : '';
    var unlocked = !!(window.HKSIApp && window.HKSIApp.isUnlocked());
    panel.querySelector('[data-install-export]').disabled = !unlocked;
    panel.querySelector('[data-install-import]').disabled = !unlocked || applying;
    panel.querySelector('[data-install-unlock]').hidden = unlocked;
    panel.querySelector('[data-install-native]').hidden = !deferredPrompt || standalone();
    panel.querySelector('[data-install-apply]').hidden = !(registration && registration.waiting);
    panel.querySelector('[data-install-apply]').disabled = applying;
    panel.querySelector('[data-install-check]').disabled = checking || applying;
  }
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('dialog');
    panel.className = 'install-panel'; panel.setAttribute('aria-labelledby', 'install-title');
    panel.innerHTML = '<div class="install-head"><h2 id="install-title">iPhone 安裝與離線</h2>' +
      '<button type="button" class="iconbtn" data-install-close aria-label="關閉安裝設定">×</button></div>' +
      '<div class="install-body"><p data-install-mode></p>' +
      '<div class="install-status" role="status" aria-live="polite" data-offline-status></div>' +
      '<p class="install-note" data-install-version></p>' +
      '<div class="install-actions"><button type="button" class="btn" data-install-check>檢查離線與更新</button>' +
      '<button type="button" class="btn brand" data-install-apply hidden>保存進度並更新</button>' +
      '<button type="button" class="btn brand" data-install-native hidden>安裝 App</button></div>' +
      '<section class="install-reading"><h3>閱讀設定</h3><label for="install-font-size">閱讀文字大小</label>' +
      '<select id="install-font-size" data-install-font-size aria-describedby="install-font-help">' +
      '<option value="100">100%（預設）</option><option value="125">125%（較大）</option>' +
      '<option value="150">150%（大）</option><option value="200">200%（特大）</option></select>' +
      '<p class="install-note" id="install-font-help">即時調整本 App 文字，僅保存在本瀏覽器；不會改動題目或學習進度。</p>' +
      '<p class="install-status" data-install-font-notice data-state="error" role="status" aria-live="polite" hidden></p></section>' +
      '<details open><summary>加入 iPhone 主屏幕</summary><ol class="install-step">' +
      '<li>用 iPhone 的 Safari 開啟本網站；若在微信中，先選擇用 Safari 開啟。</li>' +
      '<li>點「分享」（部分介面先點「⋯」），再點「加入主畫面／添加到主屏幕」。找不到時，從分享選單的「編輯動作」加入。</li>' +
      '<li>如出現「作為網頁 App 開啟」，保持開啟，再點「新增／添加」。</li>' +
      '<li>回主屏幕點「HKSI P1」。首次保持連線，打開此設定確認「離線資料已備妥」，再離線使用。</li></ol>' +
      '<a href="' + APPLE_HELP + '" target="_blank" rel="noopener noreferrer">Apple 安裝步驟</a></details>' +
      '<section><h3>遷入你的學習記錄</h3><p>電腦、Safari 和主屏幕 App 的記錄不保證共用。先在原來的版本匯出完整備份，經「檔案」或 AirDrop 傳到 iPhone，再在主屏幕 App 遷入。</p>' +
      '<p class="install-note">只允許遷入沒有學習資料的新安裝，不會合併或覆蓋已有作答。若已有資料，仍可在「我的筆記」合併筆記備份。</p>' +
      '<p data-install-unlock class="install-note">請先關閉此設定並輸入口令，才可匯出或遷入記錄。</p>' +
      '<div class="install-actions"><button type="button" class="btn" data-install-export>匯出完整學習備份</button>' +
      '<label class="btn study-import-label">遷入完整備份<input type="file" accept="application/json,.json" aria-label="遷入完整學習備份 JSON" data-install-import></label></div>' +
      '<p class="install-note">選擇 hksi-learning-backup 開頭的 JSON（最多 8 MB）。備份不含網站口令，但包含個人筆記，請妥善保存。這不是雲端同步。</p></section>' +
      '<section><h3>儲存與口令</h3><p>口令仍然需要；可以使用 Safari 密碼自動填寫。本 App 不會把口令永久保存在本機設定中。離線副本只包含加密題庫和程式。</p>' +
      '<p class="install-note">刪除 App、清除網站資料、私密瀏覽或裝置儲存空間不足，都可能令記錄或離線副本遺失。請定期匯出備份。</p>' +
      '<button type="button" class="btn" data-install-persist>請求保留本機資料</button></section>' +
      '<div class="install-status" data-install-notice role="status" aria-live="polite" hidden></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('close', function () { if (opener && document.contains(opener)) opener.focus(); });
    panel.addEventListener('click', function (ev) {
      if (ev.target === panel) { var b = panel.getBoundingClientRect(); if (ev.clientX < b.left || ev.clientX > b.right || ev.clientY < b.top || ev.clientY > b.bottom) closePanel(); }
      if (ev.target.closest('[data-install-close]')) closePanel();
      else if (ev.target.closest('[data-install-check]')) checkUpdates();
      else if (ev.target.closest('[data-install-apply]')) applyUpdate();
      else if (ev.target.closest('[data-install-native]')) promptInstall();
      else if (ev.target.closest('[data-install-export]')) exportBackup();
      else if (ev.target.closest('[data-install-persist]')) persistStorage();
    });
    panel.querySelector('[data-install-import]').addEventListener('change', importBackup);
    panel.querySelector('[data-install-font-size]').addEventListener('change', changeFontSize);
  }
  function closePanel() {
    if (panel.close) panel.close(); else { panel.removeAttribute('open'); if (opener) opener.focus(); }
  }
  function openPanel(target) {
    ensurePanel(); opener = target || document.activeElement; updateUI();
    if (!panel.open) { if (panel.showModal) panel.showModal(); else panel.setAttribute('open', ''); }
    panel.querySelector('[data-install-close]').focus();
    registerWorker().then(verifyOffline).catch(function () {});
  }
  function workerStatus(worker) {
    return new Promise(function (resolve, reject) {
      if (!worker || !window.MessageChannel) { reject(new Error('無法核對離線資料。')); return; }
      var channel = new MessageChannel();
      var timer = setTimeout(function () { channel.port1.close(); reject(new Error('離線資料檢查逾時，請連線後重試。')); }, 5000);
      channel.port1.onmessage = function (event) {
        clearTimeout(timer); channel.port1.close();
        var data = event.data;
        if (!data || data.type !== 'HKSI_OFFLINE_STATUS' || typeof data.ready !== 'boolean' || typeof data.version !== 'string') reject(new Error('離線狀態無法確認。'));
        else resolve(data);
      };
      try { worker.postMessage({ type: 'STATUS' }, [channel.port2]); }
      catch (err) { clearTimeout(timer); channel.port1.close(); reject(err); }
    });
  }
  function verifyOffline() {
    if (!registration || !registration.active) { updateUI(); return Promise.resolve(false); }
    return workerStatus(registration.active).then(function (data) {
      offlineReady = data.ready; offlineVersion = data.version; checking = false;
      statusError = data.ready ? '' : '本機離線資料不完整，暫時不能保證離線使用。請保持連線。';
      updateUI(); return offlineReady;
    }).catch(function () {
      offlineReady = false; checking = false; statusError = '未能核對本機離線資料。請保持連線，稍後再檢查。'; updateUI(); return false;
    });
  }
  function watchWorker(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'activated') { checking = false; verifyOffline(); }
      else if (worker.state === 'installed') { checking = false; updateUI(); }
      else if (worker.state === 'redundant') {
        checking = false;
        if (!offlineReady) statusError = '離線資料下載未完成。請連線後重試；仍可使用已載入的網站。';
        updateUI();
      }
    });
  }
  function registerWorker() {
    if (registration) return Promise.resolve(registration);
    if (registering) return registering;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      statusError = '這個瀏覽環境不支援離線安裝。請在 Safari 使用 HTTPS 網址開啟；目前仍可線上使用。'; updateUI();
      return Promise.reject(new Error('Service worker unavailable'));
    }
    checking = true; statusError = ''; updateUI();
    registering = navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(function (reg) {
      registration = reg; watchWorker(reg.installing);
      reg.addEventListener('updatefound', function () { checking = true; watchWorker(reg.installing); updateUI(); });
      if (reg.active) verifyOffline();
      else if (!reg.installing) checking = false;
      updateUI(); return reg;
    }).catch(function (error) {
      checking = false; registering = null; statusError = '離線安裝未完成。請保持連線並稍後重試；目前仍可使用網站。'; updateUI(); throw error;
    });
    return registering;
  }
  function checkUpdates() {
    checking = true; statusError = ''; setNotice('', false); updateUI();
    registerWorker().then(function (reg) {
      return reg.update().then(function () {
        return verifyOffline().then(function () {
          checking = false; updateUI();
          setNotice(reg.waiting ? '有新版可用。按「保存進度並更新」才會重新開啟；模考會先暫停。' : reg.installing ? '新版資料正在下載，完成後會顯示更新按鈕。' : '已完成檢查。目前沒有等待套用的新版本。', false);
        });
      });
    }).catch(function () {
      checking = false; updateUI(); setNotice('目前無法連線檢查新版。已有完整離線資料時仍可繼續使用。', true);
    });
  }
  function reloadForUpdate() {
    if (reloaded) return;
    if (window.HKSIApp && !window.HKSIApp.prepareReload()) { applying = false; updateUI(); setNotice('進度未能保存，沒有重新開啟。請先匯出備份。', true); return; }
    reloaded = true; window.location.reload();
  }
  function applyUpdate() {
    var worker = registration && registration.waiting;
    if (!worker || applying) return;
    if (!window.confirm('保存目前進度、暫停模考，並重新開啟新版？')) return;
    if (window.HKSIApp && !window.HKSIApp.prepareReload()) { setNotice('進度未能保存，未開始更新。請先匯出備份。', true); return; }
    applying = true; updateUI();
    worker.addEventListener('statechange', function () {
      if (worker.state === 'activated') reloadForUpdate();
      else if (worker.state === 'redundant') { applying = false; updateUI(); setNotice('新版未能啟用，請稍後重試。', true); }
    });
    worker.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(function () {
      if (applying && !reloaded) { applying = false; updateUI(); setNotice('更新尚未完成，頁面及進度已保留。請稍後再檢查。', true); }
    }, 15000);
  }
  function promptInstall() {
    if (!deferredPrompt) return;
    var prompt = deferredPrompt; deferredPrompt = null; updateUI();
    prompt.prompt().then(function () { return prompt.userChoice; }).then(function (choice) {
      setNotice(choice && choice.outcome === 'accepted' ? '已送出安裝請求；請在裝置上確認是否新增圖示。' : '未安裝，仍可繼續使用網站。', false);
    }).catch(function () { setNotice('無法顯示安裝提示，請使用瀏覽器的加入主屏幕功能。', true); });
  }
  function exportBackup() {
    if (!window.HKSIApp || !window.HKSIApp.isUnlocked()) return;
    try { window.HKSIApp.exportBackup(); setNotice('已請求下載完整備份。請確認檔案已儲存，再傳送到你的 iPhone。', false); }
    catch (err) { setNotice('無法產生下載檔案。請檢查 Safari 的下載權限，並保持頁面開啟。', true); }
  }
  function importBackup(event) {
    var input = event.target, file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    if (!window.HKSIMigration || !window.HKSIApp || !window.HKSIApp.isUnlocked()) { setNotice('請先輸入口令，再遷入備份。', true); return; }
    if (!file.size || file.size > window.HKSIMigration.MAX_FILE_BYTES) { setNotice('請選擇非空白、8 MB 以下的完整 JSON 備份。', true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var backup = window.HKSIApp.inspectBackup(reader.result);
        var count = Object.keys(backup.progress.attempts || {}).length;
        var notes = Object.keys(backup.study && backup.study.notes || {}).length;
        if (!window.confirm('這份備份包含 ' + count + ' 道作答記錄、' + notes + ' 篇筆記。只會遷入目前的空白安裝，未完成模考會暫停。確認遷入並重新開啟？')) return;
        window.HKSIApp.restoreBackup(reader.result);
        setNotice('已遷入，正在重新開啟。', false); window.location.reload();
      } catch (error) { setNotice(error && error.message || '備份不能遷入；現有資料未被覆蓋。', true); }
    };
    reader.onerror = reader.onabort = function () { setNotice('備份讀取失敗或已取消，沒有遷入任何資料。', true); };
    reader.readAsText(file, 'UTF-8');
  }
  function persistStorage() {
    if (!navigator.storage || !navigator.storage.persist) { setNotice('此瀏覽器不提供儲存保留請求，請自行匯出備份。', true); return; }
    navigator.storage.persist().then(function (ok) {
      setNotice(ok ? '瀏覽器已允許較持久的本機儲存；手動清除或刪除 App 仍可能移除資料，請繼續備份。' : '瀏覽器尚未允許持久儲存。從主屏幕開啟後可再試，並定期匯出備份。', !ok);
    }).catch(function () { setNotice('未能取得儲存保留許可，請定期匯出備份。', true); });
  }
  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-pwa-open]');
    if (target) { event.preventDefault(); openPanel(target); }
  });
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); deferredPrompt = event; updateUI(); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; updateUI(); });
  window.addEventListener('online', function () { updateUI(); if (panel && panel.open) verifyOffline(); });
  window.addEventListener('offline', updateUI);
  window.HKSIInstall = { open: openPanel };
  restoreFontSize();
  registerWorker().catch(function () {});
}());

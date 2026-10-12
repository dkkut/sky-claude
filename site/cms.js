/* Сайт Sky: содержимое из админки Sky (ссылки, скачивание, статус) и формы (апелляции, заявки на релиз).
   Данные приходят с /api/site/* (тот же домен, nginx проксирует в api). Если API недоступен, страница остаётся как есть. */
(function () {
  'use strict';
  var API = '/api/site';
  var lang = function () { try { return window.currentLang || localStorage.getItem('sky:lang') || 'ru'; } catch (e) { return 'ru'; } };
  var T = function (ru, en) { return lang() === 'en' ? en : ru; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var toast = function (m, t) { if (typeof window.showToast === 'function') window.showToast(m, t); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── Ссылки ─────────────────────────────────────────────── */
  function applyLinks(links) {
    $$('[data-cms-link]').forEach(function (el) {
      var u = links[el.getAttribute('data-cms-link')];
      if (u === undefined) return;
      if (!u) { el.style.display = 'none'; return; }
      el.setAttribute('href', u); el.style.display = '';
    });
  }

  /* ── Скачивание ─────────────────────────────────────────── */
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
  function applyDownloads(list) {
    var grid = $('#cms-platforms'); if (!grid || !list.length) return;
    grid.innerHTML = list.map(function (d) {
      var soon = d.status === 'soon';
      var ver = [d.info, d.version ? 'v' + String(d.version).replace(/^v/i, '') : '', soon ? T('Скоро', 'Soon') : ''].filter(Boolean).join(' · ');
      var ext = /^https?:/.test(d.href || '') ;
      var btn = (!soon && d.href)
        ? '<a class="plat-btn" href="' + esc(d.href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (d.file ? ' download' : '') + ' style="display:block;text-align:center;text-decoration:none">' + esc(d.button || T('Скачать', 'Download')) + '</a>'
        : '<button class="plat-btn" disabled>' + esc(d.button || T('Скоро', 'Soon')) + '</button>';
      var meta = d.file ? '<div class="plat-ver" style="font-size:11px;margin-top:6px;opacity:.7" title="SHA-256: ' + esc(d.file.sha256) + '">' + esc(d.file.name) + ' · ' + fmtSize(d.file.size) + '</div>' : '';
      return '<div class="card platform-card' + (soon ? ' coming-soon' : '') + '" data-platform="' + esc(d.platform) + '"><div class="plat-icon">' + esc(d.icon) + '</div><div class="plat-name">' + esc(d.title) + '</div><div class="plat-ver" id="plat-' + esc(d.platform) + '-ver">' + esc(ver) + '</div>' + meta + btn + '</div>';
    }).join('');
    var anyApp = list.some(function (d) { return d.status === 'available' && d.platform !== 'web'; });
    var note = $('#dl-note-text'); if (note && anyApp) note.textContent = T('Приложения доступны для скачивания.', 'Apps are available for download.');
  }
  // Прежний wireDownloads вешал на кнопки заглушки («в разработке») — теперь кнопки настоящие.
  window.wireDownloads = function () {
    var subBtn = $('#page-downloads .btn-primary'); var subInput = $('#page-downloads .form-input');
    if (subBtn && subInput) subBtn.onclick = function () { toast(T('Подписка на уведомления пока не подключена — следите за новостями в наших соцсетях.', 'Notifications are not connected yet — follow our social channels.'), 'amber'); };
  };

  /* ── Статус ─────────────────────────────────────────────── */
  var STATE = {
    operational: { ru: 'Работает', en: 'Operational', c: '#22c55e' }, degraded: { ru: 'Сбои', en: 'Degraded', c: '#f59e0b' },
    outage: { ru: 'Не работает', en: 'Outage', c: '#ef4444' }, maintenance: { ru: 'Технические работы', en: 'Maintenance', c: '#4f6ef7' }, dev: { ru: 'В разработке', en: 'In development', c: '#94a3b8' },
  };
  var OVERALL = { operational: ['Все системы работают', 'All systems operational'], degraded: ['Частичные сбои', 'Partial degradation'], outage: ['Есть неполадки', 'Service outage'], maintenance: ['Идут технические работы', 'Maintenance in progress'], dev: ['Платформа в стадии разработки', 'Platform in development'] };
  function dot(c) { return '<span class="nav-status-dot" style="background:' + c + ';box-shadow:0 0 8px ' + c + '"></span>'; }
  function applyStatus(st) {
    var list = $('#cms-status-list'); if (!list || !st.components.length) return;
    list.innerHTML = st.components.map(function (c) {
      var s = STATE[c.state] || STATE.dev;
      return '<div class="sky-status-row"><div class="sky-status-name"><span class="sky-status-icon">' + esc(c.icon) + '</span>' + esc(c.name) + '</div><div class="sky-status-badge">' + dot(s.c) + esc(T(s.ru, s.en)) + (c.note ? ' <span style="opacity:.65;font-weight:400">· ' + esc(c.note) + '</span>' : '') + '</div></div>';
    }).join('');
    var o = STATE[st.overall] || STATE.dev; var ot = OVERALL[st.overall] || OVERALL.dev;
    var over = $('#cms-status-overall'); if (over) over.innerHTML = dot(o.c) + esc(st.headline || T(ot[0], ot[1]));
    var note = $('#cms-status-note'); if (note) { note.textContent = st.note || ''; note.style.display = st.note ? '' : 'none'; }
    $$('.nav-status-btn .nav-status-dot').forEach(function (d) { d.style.background = o.c; d.style.boxShadow = '0 0 8px ' + o.c; });
  }

  /* ── Технические работы: баннер поверх сайта, включается из админки ── */
  function applyMaintenance(m) {
    var el = document.getElementById('cms-maint');
    if (!m || !m.active) { if (el) { el.remove(); document.documentElement.style.overflow = ''; } return; }
    if (!el) { el = document.createElement('div'); el.id = 'cms-maint'; document.body.appendChild(el); }
    var until = '';
    if (m.until) { try { until = new Date(m.until).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); } catch (e) { until = ''; } }
    el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg,#0b0d14);';
    el.innerHTML = '<div style="max-width:420px;text-align:center"><div style="width:72px;height:72px;margin:0 auto 20px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:34px;background:rgba(79,110,247,.1);border:1px solid rgba(79,110,247,.25)">🔧</div>' +
      '<h2 style="font-family:Syne,sans-serif;font-size:24px;margin:0 0 10px;color:var(--t1,#fff)">' + esc(m.title || T('Технические работы', 'Maintenance')) + '</h2>' +
      '<p style="color:var(--t2,#aab);line-height:1.6;margin:0 0 8px">' + esc(m.text || T('Проводим плановое обслуживание. Скоро всё заработает — попробуйте зайти позже.', 'We are doing scheduled maintenance. Everything will be back soon — please try again later.')) + '</p>' +
      (until ? '<p style="color:var(--t3,#889);font-size:13px;margin:0 0 8px">' + T('Ориентировочно до ', 'Expected until ') + esc(until) + '</p>' : '') +
      '<button id="cms-maint-retry" style="margin-top:14px;padding:11px 22px;border-radius:14px;border:0;background:#4f6ef7;color:#fff;font-weight:700;cursor:pointer">' + T('Проверить снова', 'Check again') + '</button></div>';
    document.documentElement.style.overflow = 'hidden';
    var b = document.getElementById('cms-maint-retry'); if (b) b.onclick = function () { load(); };
  }
  function load() {
    return fetch(API + '/public', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      applyMaintenance(d.maintenance);
      applyLinks(d.links || {}); applyDownloads(d.downloads || []); applyStatus(d.status || { components: [] });
    }).catch(function () { /* сайт остаётся как есть */ });
  }
  load();
  setInterval(load, 60000);

  /* ── Формы ──────────────────────────────────────────────── */
  var ERR = {
    bad_email: ['Проверьте адрес почты.', 'Check your email address.'], text_too_short: ['Опишите ситуацию подробнее (не короче 10 знаков).', 'Please describe the situation in more detail (10+ characters).'],
    title_required: ['Укажите название.', 'Enter a title.'], too_many_requests: ['Слишком много попыток. Попробуйте позже.', 'Too many attempts. Try again later.'],
    bad_kind: ['Выберите тип.', 'Choose a type.'], file_too_large: ['Файл слишком большой.', 'The file is too large.'], unsupported_type: ['Этот тип файла не подходит.', 'This file type is not supported.'],
    too_many_files: ['Слишком много файлов.', 'Too many files.'], not_found: ['Не найдено. Проверьте номер и почту.', 'Not found. Check the number and email.'],
  };
  var errText = function (code) { var e = ERR[code]; return e ? T(e[0], e[1]) : T('Не получилось. Попробуйте ещё раз.', 'Something went wrong. Please try again.'); };
  var KIND = { 'Блокировка аккаунта': 'account_block', 'Удаление контента': 'content_removal', 'Проблема с заказом': 'order', 'Финансовый спор': 'finance', 'Отклонение релиза': 'release_rejected', 'Другое': 'other' };

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; }); });
  }
  function uploadFile(owner, code, token, role, file, onPct) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open('POST', API + '/upload?owner=' + owner + '&code=' + encodeURIComponent(code) + '&token=' + encodeURIComponent(token) + '&role=' + role + '&name=' + encodeURIComponent(file.name));
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(Math.round(e.loaded / e.total * 100)); };
      x.onload = function () { var j = {}; try { j = JSON.parse(x.responseText); } catch (e) { /* нет тела */ } resolve(x.status === 200 ? { ok: true } : { ok: false, error: x.status === 413 ? 'file_too_large' : j.error }); };
      x.onerror = function () { resolve({ ok: false, error: 'network' }); };
      x.send(file);
    });
  }

  /* Поля формы собираются по подписям (label) — вёрстка остаётся прежней. */
  function collect(root) {
    var fields = {}; var files = []; var problems = []; var email = ''; var title = '';
    $$('.form-group', root).forEach(function (g) {
      var lab = $('.form-label', g); if (!lab) return;
      var name = lab.textContent.replace('*', '').trim(); var req = lab.textContent.indexOf('*') >= 0;
      var fileIn = $('input[type=file]', g);
      if (fileIn) { Array.prototype.forEach.call(fileIn.files || [], function (f) { files.push({ role: fileIn.getAttribute('data-role') || 'file', file: f }); }); if (req && !(fileIn.files && fileIn.files.length)) problems.push(name); return; }
      var c = $('input:not([type=checkbox]), select, textarea', g); if (!c) return;
      var v = (c.value || '').trim();
      if (req && !v) problems.push(name);
      if (c.type === 'email') email = v; else if (v) fields[name] = v;
    });
    return { fields: fields, files: files, problems: problems, email: email };
  }
  function msgBox(root) { var m = $('.cms-msg', root); if (!m) { m = document.createElement('div'); m.className = 'cms-msg'; m.style.cssText = 'margin-top:12px;font-size:13px;line-height:1.5;color:var(--t2)'; var btn = $('button.btn-primary', root); btn.parentNode.insertBefore(m, btn.nextSibling); } return m; }
  function done(root, code, failed) {
    var warn = failed.length ? '<p style="color:#f59e0b;margin-top:10px">' + T('Не все файлы загрузились: ', 'Some files failed to upload: ') + esc(failed.join(', ')) + '. ' + T('Заявка создана — напишите нам, и мы примем файлы другим способом.', 'The request was created — contact us and we will take the files another way.') + '</p>' : '';
    root.innerHTML = '<div style="text-align:center;padding:24px 8px"><div style="font-size:42px">✅</div><h3 style="font-family:Syne,sans-serif;margin:10px 0">' + T('Заявка принята', 'Request received') + '</h3><p style="color:var(--t2)">' + T('Ваш номер:', 'Your number:') + '</p><p style="font-family:\'DM Mono\',monospace;font-size:22px;font-weight:700;margin:6px 0 12px" id="cms-code">' + esc(code) + '</p><p style="color:var(--t2);font-size:13px">' + T('Сохраните номер: по нему и вашей почте можно проверить статус на странице «Апелляции». Ответ придёт на почту.', 'Keep this number: with your email you can check the status on the Appeals page. We will reply by email.') + '</p>' + warn + '</div>';
    try { localStorage.setItem('sky:cms:last', code); } catch (e) { /* без памяти */ }
  }

  function wireForm(root, build, relax) {
    var btn = $('button.btn-primary', root); if (!btn || btn.getAttribute('data-wired')) return; btn.setAttribute('data-wired', '1');
    // ловушка для ботов: поле, которое человек не видит
    var hp = document.createElement('input'); hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true'); hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0'; root.appendChild(hp);
    var label = btn.textContent;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var m = msgBox(root); m.style.color = 'var(--t2)'; m.textContent = '';
      var c = collect(root); if (relax) relax(c);
      if (c.problems.length) { m.style.color = '#ef4444'; m.textContent = T('Заполните обязательные поля: ', 'Fill in the required fields: ') + c.problems.join(', '); return; }
      var agree = $('input[type=checkbox]', root); if (agree && !agree.checked) { m.style.color = '#ef4444'; m.textContent = T('Нужно подтвердить согласие.', 'Please confirm your agreement.'); return; }
      var req = build(c); if (req.error) { m.style.color = '#ef4444'; m.textContent = req.error; return; }
      req.body.website = hp.value; req.body.lang = lang() === 'en' ? 'en' : 'ru';
      btn.disabled = true; btn.textContent = T('Отправляем…', 'Sending…');
      post(req.path, req.body).then(function (j) {
        if (!j.code) { btn.disabled = false; btn.textContent = label; m.style.color = '#ef4444'; m.textContent = errText(j.error || (j.__status === 429 ? 'too_many_requests' : '')); return; }
        var failed = []; var i = 0;
        (function next() {
          if (i >= c.files.length) { done(root, j.code, failed); return; }
          var f = c.files[i++];
          btn.textContent = T('Загружаем файл ', 'Uploading ') + i + '/' + c.files.length + '… 0%';
          uploadFile(req.owner, j.code, j.token, f.role, f.file, function (p) { btn.textContent = T('Загружаем файл ', 'Uploading ') + i + '/' + c.files.length + '… ' + p + '%'; }).then(function (r) { if (!r.ok) failed.push(f.file.name + ' (' + errText(r.error) + ')'); next(); });
        })();
      }).catch(function () { btn.disabled = false; btn.textContent = label; m.style.color = '#ef4444'; m.textContent = T('Нет связи с сервером.', 'No connection to the server.'); });
    });
  }

  function init() {
    // роли файловых зон
    $$('[data-cms-form="release-music"] input[type=file]').forEach(function (i) { i.setAttribute('data-role', /audio/.test(i.accept) ? 'audio' : 'cover'); });
    $$('[data-cms-form="release-film"] input[type=file]').forEach(function (i) { i.setAttribute('data-role', 'video'); });
    // выбранный файл виден в зоне загрузки
    $$('.upload-zone input[type=file]').forEach(function (i) { i.addEventListener('change', function () { var t = $('.uz-text', i.parentNode); if (t && i.files && i.files.length) t.textContent = Array.prototype.map.call(i.files, function (f) { return f.name; }).join(', '); }); });

    var ap = $('[data-cms-form="appeal"]');
    if (ap) wireForm(ap, function (c) {
      var kindName = ($('.appeal-type.sel .at-name') || {}).textContent || ''; var kind = KIND[kindName.trim()] || 'other';
      var f = c.fields; var username = f['Ваш username в Sky'] || ''; var ref = f['Номер решения / ID блокировки'] || ''; var body = f['Опишите ситуацию'] || '';
      return { path: '/appeals', owner: 'appeal', body: { kind: kind, username: username, email: c.email, ref: ref, body: body } };
    });
    [['release-music', 'music', 'Название трека'], ['release-film', 'film', 'Название']].forEach(function (cfg) {
      var root = $('[data-cms-form="' + cfg[0] + '"]'); if (!root) return;
      wireForm(root, function (c) { var title = c.fields[cfg[2]] || ''; var fields = {}; Object.keys(c.fields).forEach(function (k) { if (k !== cfg[2]) fields[k] = c.fields[k]; }); return { path: '/releases', owner: 'release', body: { kind: cfg[1], email: c.email, title: title, fields: fields } }; },
        // Кино: вместо видеофайла можно дать ссылку на файл (Google Drive, WeTransfer…)
        cfg[1] === 'film' ? function (c) { if (c.fields['Ссылка на файл (Google Drive, WeTransfer и т.д.)']) c.problems = c.problems.filter(function (n) { return n !== 'Видеофайл'; }); } : null);
    });

    // Проверка статуса по номеру и почте
    var page = $('#page-appeals .container'); var form = ap;
    if (page && form && !$('#cms-check')) {
      var box = document.createElement('div'); box.id = 'cms-check'; box.className = 'card animate'; box.style.cssText = 'padding:24px;max-width:680px;margin:0 0 20px';
      box.innerHTML = '<div style="font-family:Syne,sans-serif;font-size:16px;font-weight:700;margin-bottom:12px">' + T('Проверить статус заявки', 'Check request status') + '</div><div style="display:flex;gap:10px;flex-wrap:wrap"><input class="form-input" id="cms-chk-code" placeholder="SKY-XXXX-XXXX" style="flex:1;min-width:160px"/><input class="form-input" id="cms-chk-email" type="email" placeholder="email" style="flex:1;min-width:160px"/><button class="btn btn-ghost" id="cms-chk-btn">' + T('Проверить', 'Check') + '</button></div><div id="cms-chk-res" style="margin-top:12px;font-size:13px;line-height:1.5;color:var(--t2)"></div>';
      form.parentNode.insertBefore(box, form);
      try { var last = localStorage.getItem('sky:cms:last'); if (last) $('#cms-chk-code').value = last; } catch (e) { /* без памяти */ }
      var NAMES = { new: ['Получена', 'Received'], review: ['На рассмотрении', 'Under review'], accepted: ['Удовлетворена', 'Accepted'], approved: ['Одобрена', 'Approved'], rejected: ['Отклонена', 'Rejected'], closed: ['Закрыта', 'Closed'] };
      $('#cms-chk-btn').addEventListener('click', function () {
        var res = $('#cms-chk-res'); res.style.color = 'var(--t2)'; res.textContent = '…';
        post('/check', { code: $('#cms-chk-code').value, email: $('#cms-chk-email').value }).then(function (j) {
          if (!j.ok) { res.style.color = '#ef4444'; res.textContent = errText(j.error || (j.__status === 429 ? 'too_many_requests' : '')); return; }
          var n = NAMES[j.status] || [j.status, j.status];
          res.innerHTML = '<b>' + esc(T(n[0], n[1])) + '</b>' + (j.answer ? '<p style="margin-top:8px;white-space:pre-wrap">' + esc(j.answer) + '</p>' : '');
          var steps = $$('.status-step .step-dot', page); var fin = ['accepted', 'approved', 'rejected', 'closed'].indexOf(j.status) >= 0;
          steps.forEach(function (d, i) { d.className = 'step-dot' + (i === 0 || (i === 1 && fin) || (i === 2 && fin) || (i === 3 && fin) ? ' done' : (i === 1 ? ' active' : '')); if (d.className.indexOf('done') >= 0) d.textContent = '✓'; });
        });
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

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


  /* ── Тех. поддержка: форма создаёт настоящий тикет в основной очереди поддержки Sky; статус и переписка — по номеру и почте ── */
  var TOPICS = [['login', 'Вход и аккаунт', 'Sign-in and account'], ['blocked', 'Блокировка', 'Block'], ['payment', 'Платежи и Prime', 'Payments and Prime'], ['bug', 'Ошибка в приложении', 'App bug'], ['download', 'Скачивание и установка', 'Download and install'], ['idea', 'Предложение', 'Suggestion'], ['other', 'Другое', 'Other']];
  var PLATS = [['', 'Не указано', 'Not specified'], ['web', 'Веб-версия', 'Web'], ['android', 'Android', 'Android'], ['windows', 'Windows', 'Windows'], ['ios', 'iOS', 'iOS'], ['macos', 'macOS', 'macOS'], ['linux', 'Linux', 'Linux'], ['other', 'Другое', 'Other']];
  Object.assign(ERR, { bad_topic: ['Выберите тему.', 'Choose a topic.'], too_many: ['Слишком много обращений. Попробуйте позже.', 'Too many requests. Try again later.'], closed: ['Обращение закрыто — создайте новое.', 'This request is closed — please create a new one.'] });
  function opts(list) { return list.map(function (o) { return '<option value="' + o[0] + '">' + esc(T(o[1], o[2])) + '</option>'; }).join(''); }
  function field(id, label, inner) { return '<div class="form-group"><label class="form-label" for="' + id + '">' + esc(label) + '</label>' + inner + '</div>'; }
  function initSupport() {
    var root = $('#cms-support'); if (!root || root.getAttribute('data-ready')) return; root.setAttribute('data-ready', '1');
    var tips = [T('Платформа и версия приложения (Веб, Android, Windows…)', 'Platform and app version (Web, Android, Windows…)'), T('Что вы делали и что пошло не так — по шагам', 'What you were doing and what went wrong — step by step'), T('Текст ошибки на экране, если он есть', 'The error text on screen, if any'), T('Ваш @ник в Sky — чтобы мы нашли аккаунт (пароли и коды НЕ присылайте)', 'Your @username in Sky so we can find the account (never send passwords or codes)')];
    root.innerHTML =
      '<div class="card" style="padding:28px"><div style="font-family:Syne,sans-serif;font-size:20px;font-weight:700;margin-bottom:6px">' + T('Написать в техническую поддержку', 'Contact technical support') + '</div>' +
      '<p style="color:var(--t2);font-size:13px;line-height:1.6;margin-bottom:14px">' + T('Обращение попадает в ту же очередь поддержки, что и обращения из приложения. Войти в аккаунт для этого не нужно.', 'Your request goes to the same support queue as requests from the app. You do not need to sign in.') + '</p>' +
      '<div style="padding:14px 16px;border-radius:14px;background:rgba(79,110,247,0.07);border:1px solid rgba(79,110,247,0.2);margin-bottom:18px"><div style="font-size:12px;font-weight:700;margin-bottom:6px">' + T('Что указать, чтобы мы помогли быстрее', 'What to include so we can help faster') + '</div><ul style="margin:0;padding-left:18px;color:var(--t2);font-size:12.5px;line-height:1.7">' + tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
      '<div id="sp-form" style="display:flex;flex-direction:column;gap:14px">' +
      field('sp-email', T('Email для ответа', 'Email for the reply'), '<input class="form-input" id="sp-email" type="email" placeholder="your@email.com" autocomplete="email"/>') +
      field('sp-topic', T('Тема', 'Topic'), '<select class="form-input" id="sp-topic">' + opts(TOPICS) + '</select>') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' + field('sp-plat', T('Платформа', 'Platform'), '<select class="form-input" id="sp-plat">' + opts(PLATS) + '</select>') + field('sp-ver', T('Версия приложения', 'App version'), '<input class="form-input" id="sp-ver" placeholder="4.0.1" maxlength="40"/>') + '</div>' +
      field('sp-user', T('Ваш @ник в Sky (если есть)', 'Your @username in Sky (if any)'), '<input class="form-input" id="sp-user" placeholder="@username" maxlength="64"/>') +
      field('sp-subj', T('Кратко о проблеме', 'Short summary'), '<input class="form-input" id="sp-subj" maxlength="120"/>') +
      field('sp-body', T('Подробно', 'Details'), '<textarea class="form-input" id="sp-body" rows="6" maxlength="4000" placeholder="' + esc(T('Опишите ситуацию подробно…', 'Describe the situation in detail…')) + '"></textarea>') +
      '<button class="btn btn-primary" id="sp-send" style="width:100%">' + T('Отправить обращение →', 'Send request →') + '</button><div id="sp-msg" role="status" style="font-size:13px;line-height:1.5"></div></div></div>' +
      '<div class="card" style="padding:24px;margin-top:18px"><div style="font-family:Syne,sans-serif;font-size:16px;font-weight:700;margin-bottom:12px">' + T('Статус обращения и переписка', 'Request status and replies') + '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><input class="form-input" id="sp-code" placeholder="SUP-XXXX-XXXX" style="flex:1;min-width:160px"/><input class="form-input" id="sp-cemail" type="email" placeholder="email" style="flex:1;min-width:160px"/><button class="btn btn-ghost" id="sp-check">' + T('Проверить', 'Check') + '</button></div><div id="sp-thread" style="margin-top:14px"></div></div>';
    var msg = $('#sp-msg');
    var say = function (t, bad) { msg.style.color = bad ? '#ef4444' : 'var(--t2)'; msg.textContent = t; };
    try { var last = localStorage.getItem('sky:support:last'); if (last) { var o = JSON.parse(last); $('#sp-code').value = o.code || ''; $('#sp-cemail').value = o.email || ''; } } catch (e) { /* без памяти */ }
    var hp = document.createElement('input'); hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true'); hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0'; $('#sp-form').appendChild(hp);

    function render(j, email) {
      var box = $('#sp-thread');
      var thread = j.messages.map(function (m) { return '<div style="margin:8px 0;padding:10px 14px;border-radius:12px;background:' + (m.fromStaff ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)') + ';border:1px solid ' + (m.fromStaff ? 'rgba(52,211,153,0.25)' : 'var(--border,rgba(255,255,255,0.08))') + '"><div style="font-size:11px;color:var(--t3);margin-bottom:4px">' + esc(m.fromStaff ? T('Поддержка Sky', 'Sky support') : T('Вы', 'You')) + ' · ' + esc(new Date(m.createdAt).toLocaleString()) + '</div><div style="white-space:pre-wrap;font-size:13px;line-height:1.55">' + esc(m.body) + '</div></div>'; }).join('');
      box.innerHTML = '<div style="font-size:14px;margin-bottom:6px"><b>' + esc(j.code) + '</b> — ' + esc(statusText(j.status)) + '</div>' + thread +
        (j.status === 'closed' ? '<p style="color:var(--t3);font-size:12.5px">' + T('Обращение закрыто. Нужна помощь ещё — создайте новое.', 'This request is closed. Need more help — create a new one.') + '</p>'
          : '<textarea class="form-input" id="sp-reply" rows="3" maxlength="4000" placeholder="' + esc(T('Ваш ответ…', 'Your reply…')) + '" style="margin-top:8px"></textarea><button class="btn btn-ghost" id="sp-reply-btn" style="margin-top:8px">' + T('Ответить', 'Reply') + '</button><div id="sp-reply-msg" style="font-size:13px;margin-top:6px"></div>');
      var rb = $('#sp-reply-btn');
      if (rb) rb.addEventListener('click', function () {
        var rm = $('#sp-reply-msg'); rb.disabled = true;
        post('/support/reply', { code: j.code, email: email, body: $('#sp-reply').value }).then(function (r) {
          rb.disabled = false;
          if (!r.ok) { rm.style.color = '#ef4444'; rm.textContent = errText(r.error || (r.__status === 429 ? 'too_many_requests' : '')); return; }
          check(j.code, email);
        }).catch(function () { rb.disabled = false; rm.style.color = '#ef4444'; rm.textContent = T('Нет связи с сервером.', 'No connection to the server.'); });
      });
    }
    var ST = { open: ['Принято', 'Received'], in_progress: ['В работе', 'In progress'], waiting: ['Ждём вашего ответа', 'Waiting for your reply'], closed: ['Закрыто', 'Closed'] };
    function statusText(s) { var n = ST[s]; return n ? T(n[0], n[1]) : s; }
    function check(code, email) {
      var box = $('#sp-thread'); box.textContent = '…';
      post('/support/check', { code: code, email: email }).then(function (j) {
        if (!j.ok) { box.innerHTML = '<span style="color:#ef4444">' + esc(errText(j.error || (j.__status === 429 ? 'too_many_requests' : ''))) + '</span>'; return; }
        try { localStorage.setItem('sky:support:last', JSON.stringify({ code: code, email: email })); } catch (e) { /* без памяти */ }
        render(j, email);
      }).catch(function () { box.textContent = T('Нет связи с сервером.', 'No connection to the server.'); });
    }
    $('#sp-check').addEventListener('click', function () { check($('#sp-code').value, $('#sp-cemail').value); });
    var send = $('#sp-send'); var label = send.textContent;
    send.addEventListener('click', function (e) {
      e.preventDefault();
      var email = $('#sp-email').value.trim(); var body = $('#sp-body').value.trim();
      if (!email || body.length < 10) { say(T('Укажите почту и опишите ситуацию (не короче 10 знаков).', 'Enter your email and describe the situation (at least 10 characters).'), true); return; }
      send.disabled = true; send.textContent = T('Отправляем…', 'Sending…'); say('');
      post('/support', { email: email, topic: $('#sp-topic').value, platform: $('#sp-plat').value, version: $('#sp-ver').value, username: $('#sp-user').value, subject: $('#sp-subj').value, body: body, website: hp.value, lang: lang() === 'en' ? 'en' : 'ru' }).then(function (j) {
        send.disabled = false; send.textContent = label;
        if (!j.code) { say(errText(j.error || (j.__status === 429 ? 'too_many_requests' : '')), true); return; }
        $('#sp-form').innerHTML = '<div style="text-align:center;padding:18px 8px"><div style="font-size:42px">✅</div><h3 style="font-family:Syne,sans-serif;margin:10px 0">' + T('Обращение принято', 'Request received') + '</h3><p style="color:var(--t2)">' + T('Ваш номер:', 'Your number:') + '</p><p style="font-family:\'DM Mono\',monospace;font-size:22px;font-weight:700;margin:6px 0 12px">' + esc(j.code) + '</p><p style="color:var(--t2);font-size:13px">' + T('Сохраните номер: по нему и вашей почте ниже можно смотреть статус и отвечать. Ответ поддержки придёт и на почту.', 'Keep this number: with your email you can check the status and reply below. Our answer will also arrive by email.') + '</p></div>';
        $('#sp-code').value = j.code; $('#sp-cemail').value = email;
        try { localStorage.setItem('sky:support:last', JSON.stringify({ code: j.code, email: email })); } catch (e2) { /* без памяти */ }
      }).catch(function () { send.disabled = false; send.textContent = label; say(T('Нет связи с сервером.', 'No connection to the server.'), true); });
    });

    // Форма на странице «Контакты» тоже работает как обращение в поддержку (раньше кнопка ничего не отправляла).
    var cs = $('#form-send');
    if (cs && !cs.getAttribute('data-wired')) {
      cs.setAttribute('data-wired', '1');
      var card = cs.parentNode; var inputs = $$('input.form-input', card); var sel = $('select.form-input', card); var ta = $('textarea.form-input', card);
      var MAP = { 'Техническая проблема': 'bug', 'Вопрос по Prime': 'payment', 'Жалоба на пользователя': 'other', 'Партнёрство': 'other', 'Другое': 'other' };
      var cm = document.createElement('div'); cm.setAttribute('role', 'status'); cm.style.cssText = 'font-size:13px;line-height:1.5;margin-top:10px;color:var(--t2)'; cs.parentNode.appendChild(cm);
      var chp = document.createElement('input'); chp.type = 'text'; chp.name = 'website'; chp.tabIndex = -1; chp.autocomplete = 'off'; chp.setAttribute('aria-hidden', 'true'); chp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0'; card.appendChild(chp);
      var clabel = cs.textContent;
      cs.addEventListener('click', function (e) {
        e.preventDefault();
        var name = inputs[0] ? inputs[0].value.trim() : ''; var mail = inputs[1] ? inputs[1].value.trim() : ''; var text = ta ? ta.value.trim() : '';
        if (!mail || text.length < 10) { cm.style.color = '#ef4444'; cm.textContent = T('Укажите почту и сообщение (не короче 10 знаков).', 'Enter your email and a message (at least 10 characters).'); return; }
        cs.disabled = true; cs.textContent = T('Отправляем…', 'Sending…');
        post('/support', { email: mail, topic: MAP[(sel && sel.value) || ''] || 'other', subject: sel ? sel.value : '', body: (name ? (T('Имя: ', 'Name: ') + name + '\n\n') : '') + text, website: chp.value, lang: lang() === 'en' ? 'en' : 'ru' }).then(function (j) {
          cs.disabled = false; cs.textContent = clabel;
          if (!j.code) { cm.style.color = '#ef4444'; cm.textContent = errText(j.error || (j.__status === 429 ? 'too_many_requests' : '')); return; }
          cm.style.color = 'var(--green,#34d399)'; cm.textContent = T('Принято. Номер обращения: ', 'Received. Request number: ') + j.code + T(' — статус смотрите на странице «Поддержка».', ' — check the status on the Support page.');
          if (ta) ta.value = '';
          try { localStorage.setItem('sky:support:last', JSON.stringify({ code: j.code, email: mail })); } catch (e2) { /* без памяти */ }
        }).catch(function () { cs.disabled = false; cs.textContent = clabel; cm.style.color = '#ef4444'; cm.textContent = T('Нет связи с сервером.', 'No connection to the server.'); });
      });
    }
  }
  function init() {
    initSupport();
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

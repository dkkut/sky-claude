(function () {
  "use strict";

  /* ============================================================
     KutRent Market — клиент.
     Все данные — с сервера (/api/kutrent-market/*, тот же процесс,
     что и Sky API, см. server/routes/kutrentmarket.mjs). Ничего
     здесь не выдумывает получателя, заказ или его статус — то, что
     раньше в этом файле был MOCK-объект и localStorage, удалено:
     сервер — единственный источник правды.

     Поддержка (форма «Проблема с операцией?») уходит в ту же очередь
     обращений, что и у основного сайта (/api/kutrent-market/support →
     server/support.mjs, одна линия поддержки на весь Sky ID). Калитка
     беты — единственное, что осталось чисто клиентским: тот же самый
     простой ключ, что был в макете, не более.
     ============================================================ */

  function el(sel) { return document.querySelector(sel); }
  function els(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function fmt(n) { return Number(n).toLocaleString("ru-RU") + " ₽"; }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    function p(x) { return String(x).padStart(2, "0"); }
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function openOverlay(id) { document.getElementById(id).classList.add("open"); }
  function closeOverlay(id) { document.getElementById(id).classList.remove("open"); }

  els("[data-close]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeOverlay(btn.getAttribute("data-close")); });
  });
  els(".overlay").forEach(function (ov) {
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.classList.remove("open"); });
  });

  /* ============ API ============ */
  var API = "/api/kutrent-market";

  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    });
  }

  /* ============ Вход через Sky ID (SSO) ============
     Куки Sky-сессии и Market-сессии — на разных доменах, между собой
     никак не связаны. Личность переносит одноразовый токен в адресе:
     эта страница ("/sso-callback?token=...") гасит его на сервере и
     получает взамен обычную сессию сайта (cookie krm_sid), как любая
     другая — дальше работает одинаково независимо от того, как вошли. */
  var me = null; // {authenticator, username, name, balance, createdAt} — null, если не вошли

  function refreshMe() {
    return api("/me").then(function (r) {
      me = r.ok ? r.data : null;
      renderSkyTab();
      renderProfileHeader();
      maybePromptDocs();
      return me;
    });
  }

  function renderSkyTab() {
    var gate = el("#sky-login-gate");
    var logged = el("#sky-logged-in");
    if (!gate || !logged) return;
    if (me) {
      gate.style.display = "none";
      logged.style.display = "";
      el("#sky-me-username").textContent = "@" + me.username;
      el("#sky-me-authenticator").textContent = me.authenticator;
      el("#sky-me-balance").textContent = fmt(me.balance);
    } else {
      gate.style.display = "";
      logged.style.display = "none";
    }
    updateSkyCta();
  }

  function renderProfileHeader() {
    var letter = el("#profile-avatar-letter");
    var username = el("#profile-username");
    var auth = el("#profile-session-id");
    if (!letter || !username || !auth) return;
    if (me) {
      letter.textContent = me.username.charAt(0).toUpperCase();
      username.textContent = "@" + me.username;
      auth.textContent = me.authenticator;
    } else {
      letter.textContent = "?";
      username.textContent = "Вы не вошли";
      auth.textContent = "Authenticator —";
    }
  }

  function skyLoginUrl() {
    return api("/config").then(function (r) {
      if (!r.ok || !r.data.skyOrigin) { toast("Сайт Sky не настроен"); return null; }
      var returnUrl = location.origin + "/sso-callback";
      return r.data.skyOrigin + "/?module=kutrent-link&return=" + encodeURIComponent(returnUrl);
    });
  }

  var loginBtn = el("#sky-login-btn");
  if (loginBtn) {
    loginBtn.addEventListener("click", function () {
      loginBtn.disabled = true;
      skyLoginUrl().then(function (url) {
        loginBtn.disabled = false;
        if (url) window.location.href = url;
      });
    });
  }
  var logoutBtn = el("#sky-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      api("/logout", { method: "POST" }).then(function () { return refreshMe(); });
    });
  }

  (function handleSsoCallback() {
    if (location.pathname !== "/sso-callback") return;
    var token = new URLSearchParams(location.search).get("token");
    history.replaceState(null, "", "/");
    if (!token) return;
    api("/sso/consume", { method: "POST", body: { token: token } }).then(function (r) {
      if (r.ok) { toast("Вход выполнен"); setTab("sky"); }
      else toast("Ссылка для входа устарела, попробуйте снова");
      void refreshMe();
    });
  })();

  /* ============ Beta gate (клиентский, как и был) ============ */
  var BETA_KEY = "SKYBETA2026";

  (function initBetaGate() {
    var gate = document.getElementById("beta-gate");
    var input = document.getElementById("beta-key-input");
    var errorEl = document.getElementById("beta-gate-error");
    var submitBtn = document.getElementById("beta-key-submit");

    var alreadyIn = false;
    try { alreadyIn = localStorage.getItem("krm_beta_ok") === "1"; } catch (e) { /* storage unavailable */ }
    if (alreadyIn) { gate.classList.add("hidden"); }

    function tryKey() {
      var val = input.value.trim();
      if (val && val.toUpperCase() === BETA_KEY.toUpperCase()) {
        try { localStorage.setItem("krm_beta_ok", "1"); } catch (e) { /* ignore */ }
        errorEl.textContent = "";
        gate.classList.add("hidden");
      } else {
        errorEl.textContent = "Неверный ключ доступа";
        input.focus();
        input.select();
      }
    }
    submitBtn.addEventListener("click", tryKey);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryKey(); });
  })();

  /* ============ Tabs ============ */
  function setTab(tab) {
    el("#view-partners").style.display = tab === "partners" ? "" : "none";
    el("#view-sky").style.display = tab === "sky" ? "" : "none";
    el("#view-items").style.display = tab === "items" ? "" : "none";
    els('[data-tab]').forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === tab); });
  }
  els('[data-tab]').forEach(function (b) {
    b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
  });

  els('[data-open="orders"]').forEach(function (b) { b.addEventListener("click", function () { renderOrders(); openOverlay("overlay-orders"); }); });
  els('[data-open="support"]').forEach(function (b) { b.addEventListener("click", function () { openSupport(null); }); });
  els('[data-open="profile"]').forEach(function (b) { b.addEventListener("click", function () { renderProfile(); openOverlay("overlay-profile"); }); });
  els('[data-open="docs"]').forEach(function (b) { b.addEventListener("click", function () { renderDocsList(); openOverlay("overlay-docs"); }); });

  /* ============ Sky top-up ============ */
  var skyQuick = el("#sky-quick");
  var quickValues = [100, 300, 500, 1000, 2000, 5000];
  quickValues.forEach(function (v) {
    var b = document.createElement("button");
    b.textContent = v.toLocaleString("ru-RU") + " ₽";
    if (v === 100) b.classList.add("active");
    b.addEventListener("click", function () {
      el("#sky-amount").value = v;
      els("#sky-quick button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      syncSkySummary();
    });
    skyQuick.appendChild(b);
  });

  var skySubmitting = false;
  var lastSkyOrderId = null;

  function syncSkySummary() {
    var raw = el("#sky-amount").value.replace(/\D/g, "");
    var amount = parseInt(raw, 10) || 0;
    el("#sum-amount").textContent = fmt(amount);
    el("#sum-total").textContent = fmt(amount);
    updateSkyCta();
  }
  function updateSkyCta() {
    var amount = parseInt(el("#sky-amount").value.replace(/\D/g, ""), 10) || 0;
    var btn = el("#sky-submit");
    if (btn) btn.disabled = !(amount >= 10 && me && !skySubmitting);
  }

  el("#sky-amount").addEventListener("input", function (e) {
    e.target.value = e.target.value.replace(/\D/g, "");
    els("#sky-quick button").forEach(function (x) { x.classList.remove("active"); });
    var match = quickValues.find(function (v) { return String(v) === e.target.value; });
    if (match !== undefined) {
      els("#sky-quick button").forEach(function (x) { if (x.textContent.replace(/\D/g, "") === String(match)) x.classList.add("active"); });
    }
    syncSkySummary();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  el("#sky-submit").addEventListener("click", function () {
    if (el("#sky-submit").disabled || !me) return;
    // Получателя не отправляем — сервер зачисляет на счёт вошедшего
    // в этой сессии, по cookie, никак иначе.
    var amount = parseInt(el("#sky-amount").value.replace(/\D/g, ""), 10) || 0;
    var btn = el("#sky-submit");
    var originalText = btn.textContent;
    skySubmitting = true;
    btn.disabled = true;
    btn.textContent = "Создаём заказ…";

    api("/sky-topup", { method: "POST", body: { amount: amount } }).then(function (r) {
      skySubmitting = false;
      btn.textContent = originalText;
      if (!r.ok) {
        var reason = r.data && r.data.error === "invalid_amount" ? "Некорректная сумма"
          : r.data && r.data.error === "rate_limited" ? "Слишком много попыток, подождите немного"
            : r.data && r.data.error === "documents_required" ? "Сначала примите документы — открываем раздел"
              : r.status === 401 ? "Сессия истекла — войдите снова"
                : "Не удалось создать заказ";
        toast(reason);
        if (r.status === 401) void refreshMe();
        if (r.data && r.data.error === "documents_required") { renderDocsList(); openOverlay("overlay-docs"); }
        updateSkyCta();
        return;
      }
      var order = r.data.order;
      lastSkyOrderId = order.id;

      el("#sky-result-amount").textContent = fmt(order.amount);
      el("#sky-result-recipient").textContent = "себе, @" + (me ? me.username : "");
      el("#sky-result-id").textContent = "#" + order.id;
      el("#sky-result-status").textContent = STATUS_LABEL[order.status] || order.status;
      var reqSlot = el("#sky-result-requisites");
      reqSlot.innerHTML = "";
      reqSlot.appendChild(renderPaymentProofBlock(order, function (updated) {
        el("#sky-result-status").textContent = STATUS_LABEL[updated.status] || updated.status;
      }));
      openOverlay("overlay-sky-result");

      syncSkySummary();
    }).catch(function () {
      skySubmitting = false;
      btn.textContent = originalText;
      toast("Нет связи с сервером");
      updateSkyCta();
    });
  });
  el("#sky-view-order").addEventListener("click", function () {
    closeOverlay("overlay-sky-result");
    if (lastSkyOrderId) openOrderDetail(lastSkyOrderId);
  });

  syncSkySummary();
  void refreshMe();

  /* ============ Game server items — витрина без изменений (заглушка) ============ */
  var SERVER_LABEL = { gta: "GTA V сервер", mc: "Minecraft сервер" };
  els(".server-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      els(".server-card").forEach(function (x) { x.classList.remove("active"); });
      btn.classList.add("active");
      var server = btn.getAttribute("data-server");
      el("#items-placeholder-title").textContent = SERVER_LABEL[server] + " — раздел в разработке";
      el("#items-placeholder").style.display = "";
    });
  });

  /* ============ Orders (реальные, с сервера) ============ */
  var STATUS_LABEL = { pending: "Ожидание подтверждения", paid: "Оплачено", rejected: "Отклонено", cancelled: "Отменено" };
  var ordersCache = [];
  var requisitesCache = null;

  /* ============ Реквизиты расчётного счёта + номер телефона перевода ============
     После создания заказа показываем, куда переводить деньги, и даём
     указать номер телефона, с которого придёт перевод — администратор
     ищет по нему операцию в банке, прежде чем попросить владельца
     подтвердить (см. server/kutrentmarket.mjs::submitPaymentProof).
     Тот же блок используется и в карточке заказа из истории — номер
     можно указать не сразу, а позже, вернувшись к заказу. */
  var REQUISITES_FIELDS = [
    ["accountNumber", "Счёт получателя в банке получателя"],
    ["bankName", "Наименование Банка получателя"],
    ["bik", "БИК Банка получателя"],
    ["bankInn", "ИНН Банка получателя"],
    ["bankKpp", "КПП Банка получателя"],
    ["corrAccount", "К/С Банка получателя"],
    ["recipientName", "Получатель"],
  ];

  function getRequisites() {
    if (requisitesCache) return Promise.resolve(requisitesCache);
    return api("/requisites").then(function (r) {
      requisitesCache = (r.ok && r.data.requisites) || null;
      return requisitesCache;
    });
  }

  function requisitesHtml(req) {
    return '<div class="requisites-block">' +
      REQUISITES_FIELDS.map(function (f) {
        var val = (req && req[f[0]]) || "—";
        return '<div class="summary-row requisites-row"><span>' + f[1] + '</span>' +
          '<span class="requisites-value" data-copy="' + escapeHtml(val) + '">' + escapeHtml(val) + '</span></div>';
      }).join("") + '</div>';
  }

  /** Блок «реквизиты + номер телефона» для заказа, ещё не подтверждённого
   *  (pending/rejected). Возвращает узел; вызывающий сам решает, куда его
   *  вставить, и передаёт onSubmitted — обновить экран после отправки. */
  function renderPaymentProofBlock(order, onSubmitted) {
    var wrap = document.createElement("div");
    wrap.className = "payment-proof-block";
    wrap.innerHTML = '<p class="hint" style="margin:10px 0 6px;">Загружаем реквизиты…</p>';

    getRequisites().then(function (req) {
      var rejectedNote = order.status === "rejected"
        ? '<p class="hint" style="color:var(--danger,#e5484d);margin:10px 0 6px;">Мы не нашли перевод по прошлому номеру. Проверьте номер телефона и отправьте ещё раз.</p>'
        : "";
      var already = order.senderPhone
        ? '<div class="summary-row"><span>Телефон перевода</span><span>' + escapeHtml(order.senderPhone) + '</span></div>'
        : "";
      wrap.innerHTML =
        '<p class="hint" style="margin:10px 0 6px;">Переведите сумму заказа по реквизитам ниже, затем укажите номер телефона, с которого придёт перевод — мы сверим его с операцией в банке.</p>' +
        requisitesHtml(req) +
        rejectedNote + already +
        '<div class="proof-form" style="margin-top:10px;display:flex;gap:8px;">' +
        '<input class="text-input" id="proof-phone-input" type="tel" placeholder="+7 900 000-00-00" style="flex:1;" value="' + (order.senderPhone ? escapeHtml(order.senderPhone) : "") + '">' +
        '<button class="cta" id="proof-phone-submit">' + (order.senderPhone ? "Изменить" : "Отправить") + '</button>' +
        '</div>' +
        '<p class="hint" id="proof-phone-error" style="color:var(--danger,#e5484d);margin:6px 0 0;"></p>';

      wrap.querySelectorAll("[data-copy]").forEach(function (node) {
        node.style.cursor = "pointer";
        node.title = "Нажмите, чтобы скопировать";
        node.addEventListener("click", function () {
          var text = node.getAttribute("data-copy");
          if (navigator.clipboard && text && text !== "—") {
            navigator.clipboard.writeText(text).then(function () { toast("Скопировано"); });
          }
        });
      });

      var submitBtn = wrap.querySelector("#proof-phone-submit");
      submitBtn.addEventListener("click", function () {
        var phone = wrap.querySelector("#proof-phone-input").value.trim();
        var errEl = wrap.querySelector("#proof-phone-error");
        errEl.textContent = "";
        if (!phone) { errEl.textContent = "Укажите номер телефона"; return; }
        submitBtn.disabled = true;
        api("/orders/" + encodeURIComponent(order.id) + "/proof", { method: "POST", body: { phone: phone } })
          .then(function (r) {
            submitBtn.disabled = false;
            if (!r.ok || !r.data.order) {
              errEl.textContent = r.data && r.data.error === "bad_phone" ? "Проверьте номер телефона"
                : r.data && r.data.error === "already_paid" ? "Заказ уже оплачен"
                  : "Не удалось отправить, попробуйте ещё раз";
              return;
            }
            toast("Номер телефона отправлен — ждите подтверждения");
            if (onSubmitted) onSubmitted(r.data.order);
          });
      });
    });

    return wrap;
  }

  function renderOrders() {
    var body = el("#orders-body");
    body.innerHTML = '<div class="empty-state"><p>Загружаем…</p></div>';
    api("/orders").then(function (r) {
      if (r.status === 401) {
        body.innerHTML = '<div class="empty-state"><p>Войдите через Sky ID, чтобы увидеть свои операции</p></div>';
        return;
      }
      ordersCache = (r.ok && r.data.orders) || [];
      if (ordersCache.length === 0) {
        body.innerHTML = '<div class="empty-state"><p>Пока нет операций</p></div>';
        return;
      }
      body.innerHTML = '<div class="order-list"></div>';
      var list = body.querySelector(".order-list");
      ordersCache.forEach(function (o) {
        var item = document.createElement("button");
        item.className = "order-item";
        item.style.cssText = "width:100%;text-align:left;border-width:1px;cursor:pointer;background:var(--surface);color:inherit;";
        item.innerHTML =
          '<div class="order-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/></svg></div>' +
          '<div class="order-main"><strong>Пополнение Sky</strong><span>' + fmtDate(o.createdAt) + '</span></div>' +
          '<div class="order-right">' +
          '<div class="order-amount">+' + fmt(o.amount) + '</div>' +
          '<span class="status-pill ' + o.status + '">' + STATUS_LABEL[o.status] + '</span>' +
          '</div>';
        item.addEventListener("click", function () { openOrderDetail(o.id); });
        list.appendChild(item);
      });
    });
  }

  function openOrderDetail(id) {
    var o = ordersCache.find(function (x) { return x.id === id; });
    var body = el("#order-detail-body");
    function render(order) {
      body.innerHTML =
        '<div class="order-detail-card">' +
        '<div class="summary-row"><span>Тип</span><span>Пополнение Sky</span></div>' +
        '<div class="summary-row"><span>Номер</span><span>#' + order.id + '</span></div>' +
        '<div class="summary-row"><span>Сумма</span><span>+' + fmt(order.amount) + '</span></div>' +
        '<div class="summary-row"><span>Статус</span><span class="status-pill ' + order.status + '">' + STATUS_LABEL[order.status] + '</span></div>' +
        '<div class="summary-row"><span>Создан</span><span>' + fmtDate(order.createdAt) + '</span></div>' +
        (order.paidAt ? '<div class="summary-row"><span>Оплачен</span><span>' + fmtDate(order.paidAt) + '</span></div>' : '') +
        '</div>' +
        '<div id="order-detail-proof"></div>' +
        '<button class="cta ghost" id="order-support-btn" style="margin-top:10px;">Проблема с этим заказом?</button>';
      if (order.status === "pending" || order.status === "rejected") {
        body.querySelector("#order-detail-proof").appendChild(renderPaymentProofBlock(order, function (updated) {
          var idx = ordersCache.findIndex(function (x) { return x.id === updated.id; });
          if (idx !== -1) ordersCache[idx] = updated;
          render(updated);
        }));
      }
      body.querySelector("#order-support-btn").addEventListener("click", function () { openSupport(order); });
      openOverlay("overlay-order-detail");
    }
    if (o) { render(o); return; }
    api("/orders/" + encodeURIComponent(id)).then(function (r) {
      if (r.ok && r.data.order) render(r.data.order);
      else toast("Заказ не найден");
    });
  }
  var backToOrdersBtn = document.querySelector('[data-back-to="orders"]');
  if (backToOrdersBtn) {
    backToOrdersBtn.addEventListener("click", function () {
      closeOverlay("overlay-order-detail");
      openOverlay("overlay-orders");
    });
  }

  /* ============ Support ============
     Тикет уходит в server/support.mjs — ту же очередь (AdminQueue),
     что и обращения с основного сайта Sky: одна линия поддержки на
     весь Sky ID, не отдельная для Market. Вход обязателен — тикет
     пишется на profile_id, а анонимного обращения без Sky ID быть не
     может (как и раньше у остального на этой странице).

     Раньше здесь была только отправка: форма писала тикет и сама себе
     рисовала «спасибо», закрывалась — и всё. Когда администратор
     отвечал, ответ ложился в ту же переписку support_messages, но на
     этом сайте не было ни одного экрана, который бы её показал: ответ
     физически существовал на сервере и «никуда не доходил» до
     человека. Ниже — список обращений и переписка по каждому, тот же
     принцип, что у SupportScreen.tsx на основном сайте: открыли
     обращение — увидели всю историю, ответили — ответ лёг тем же
     сообщением, что и у администратора. */
  var SUPPORT_STATUS_LABEL = { open: "Открыто", in_progress: "В работе", waiting: "Ждём ответа", closed: "Закрыто" };
  var currentSupportOrder = null;
  var supportTicketsCache = [];
  var openSupportTicketId = null;
  var supportThreadTimer = null;

  function renderSupportList() {
    var body = el("#support-list-body");
    if (!me) {
      body.innerHTML = '<div class="empty-state"><p>Войдите через Sky ID, чтобы увидеть свои обращения</p></div>';
      return;
    }
    body.innerHTML = '<div class="empty-state"><p>Загружаем…</p></div>';
    api("/support").then(function (r) {
      supportTicketsCache = (r.ok && r.data.tickets) || [];
      if (supportTicketsCache.length === 0) {
        body.innerHTML = '<div class="empty-state"><p>Обращений пока нет</p></div>';
        return;
      }
      body.innerHTML = '<div class="order-list"></div>';
      var list = body.querySelector(".order-list");
      supportTicketsCache.forEach(function (t) {
        var item = document.createElement("button");
        item.className = "doc-list-item";
        item.innerHTML =
          '<div class="main"><strong>' + escapeHtml(t.subject) + '</strong><span>' + fmtDate(t.updatedAt) + '</span></div>' +
          '<span class="doc-status ' + (t.status === "closed" ? "accepted" : "pending") + '">' +
          escapeHtml(SUPPORT_STATUS_LABEL[t.status] || t.status) + '</span>';
        item.addEventListener("click", function () { openSupportThread(t.id); });
        list.appendChild(item);
      });
    });
  }

  function renderSupportMessages(ticket) {
    var box = el("#support-thread-messages");
    box.innerHTML = (ticket.messages || []).map(function (m) {
      var mine = !m.fromStaff;
      return '<div style="margin:0 0 10px;max-width:85%;' + (mine ? "margin-left:auto;text-align:right;" : "") + '">' +
        '<div style="display:inline-block;text-align:left;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;background:' +
        (mine ? "var(--accent-soft)" : "var(--surface)") + ';border:1px solid var(--border);">' +
        escapeHtml(m.body) + '</div>' +
        '<div class="hint" style="margin:3px 2px 0;">' + (mine ? "Вы" : "Поддержка") + ' · ' + fmtDate(m.createdAt) + '</div>' +
        '</div>';
    }).join("");
  }

  function renderSupportComposer(ticket) {
    var slot = el("#support-thread-composer");
    if (ticket.status === "closed") {
      slot.innerHTML = '<p class="hint" style="margin:0;">Обращение закрыто. Если вопрос остался — создайте новое.</p>';
      return;
    }
    slot.innerHTML =
      '<textarea class="text-input" id="support-reply-text" placeholder="Ответить" style="min-height:70px;"></textarea>' +
      '<button class="cta" id="support-reply-submit" style="margin-top:8px;">Отправить</button>';
    el("#support-reply-submit").addEventListener("click", function () {
      var text = el("#support-reply-text").value.trim();
      if (!text) return;
      var btn = el("#support-reply-submit");
      btn.disabled = true;
      api("/support/" + encodeURIComponent(ticket.id) + "/reply", { method: "POST", body: { text: text } })
        .then(function (r) {
          btn.disabled = false;
          if (!r.ok || !r.data.ticket) { toast("Не получилось отправить — попробуйте ещё раз"); return; }
          renderSupportThread(r.data.ticket);
        });
    });
  }

  function renderSupportThread(ticket) {
    el("#support-thread-title").textContent = ticket.subject;
    el("#support-thread-status").textContent = SUPPORT_STATUS_LABEL[ticket.status] || ticket.status;
    renderSupportMessages(ticket);
    renderSupportComposer(ticket);
  }

  function openSupportThread(id) {
    openSupportTicketId = id;
    el("#support-thread-title").textContent = "Загрузка…";
    el("#support-thread-messages").innerHTML = "";
    el("#support-thread-composer").innerHTML = "";
    openOverlay("overlay-support-thread");
    api("/support/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok || !r.data.ticket) { toast("Обращение не найдено"); closeOverlay("overlay-support-thread"); return; }
      renderSupportThread(r.data.ticket);
    });
    // Пока обращение открыто на экране, подтягиваем ответ поддержки сам —
    // иначе человек сидел бы в переписке и не узнал, что ему ответили,
    // пока не перезайдёт.
    clearInterval(supportThreadTimer);
    supportThreadTimer = setInterval(function () {
      if (openSupportTicketId !== id) { clearInterval(supportThreadTimer); return; }
      api("/support/" + encodeURIComponent(id)).then(function (r) {
        if (r.ok && r.data.ticket) renderSupportThread(r.data.ticket);
      });
    }, 20000);
  }

  els('[data-open="support-list"]').forEach(function (b) {
    b.addEventListener("click", function () { renderSupportList(); openOverlay("overlay-support-list"); });
  });
  var supportNewBtn = el("#support-new-btn");
  if (supportNewBtn) {
    supportNewBtn.addEventListener("click", function () {
      closeOverlay("overlay-support-list");
      openSupport(null);
    });
  }
  var backToSupportListBtn = document.querySelector('[data-back-to="support-list"]');
  if (backToSupportListBtn) {
    backToSupportListBtn.addEventListener("click", function () {
      openSupportTicketId = null;
      clearInterval(supportThreadTimer);
      closeOverlay("overlay-support-thread");
      renderSupportList();
      openOverlay("overlay-support-list");
    });
  }

  function openSupport(order) {
    currentSupportOrder = order || null;
    var attach = el("#support-attach");
    if (order) {
      attach.innerHTML =
        '<div class="attach-chip">Заказ #' + order.id + '</div>' +
        '<div class="attach-chip">+' + fmt(order.amount) + '</div>' +
        '<div class="attach-chip">' + STATUS_LABEL[order.status] + '</div>' +
        '<div class="attach-chip">' + fmtDate(order.createdAt) + '</div>';
    } else {
      attach.innerHTML = '<p class="hint">Опишите проблему — при необходимости уточним детали операции отдельно.</p>';
    }
    el("#support-text").value = "";
    openOverlay("overlay-support");
    if (!me) toast("Войдите через Sky ID, чтобы отправить обращение");
  }
  el("#support-submit").addEventListener("click", function () {
    var text = el("#support-text").value.trim();
    if (!text) { toast("Опишите проблему"); return; }
    if (!me) {
      closeOverlay("overlay-support");
      skyLoginUrl().then(function (url) { if (url) window.location.href = url; });
      return;
    }
    var btn = el("#support-submit");
    btn.disabled = true;
    api("/support", {
      method: "POST",
      body: { text: text, orderId: currentSupportOrder ? currentSupportOrder.id : undefined },
    }).then(function (r) {
      btn.disabled = false;
      if (!r.ok || !r.data.ticket) { toast("Не получилось отправить — попробуйте ещё раз"); return; }
      closeOverlay("overlay-support");
      toast("Обращение отправлено в поддержку Sky");
      // Открываем переписку сразу — иначе снова придётся объяснять, где
      // искать ответ, которого ждать может минуты, а может и дни.
      openSupportThread(r.data.ticket.id);
    });
  });

  /* ============ Profile (настоящий вход через Sky ID) ============ */
  function renderProfile() {
    void refreshMe();
  }

  /* ============ Документы (текст один на сервере, docs/ — см. server/agreements.mjs) ============
     Читать может кто угодно, даже не вошедший — это условия сайта, а не
     часть личного кабинета. Принять может только вошедший: согласие
     пишется на его настоящий Sky-профиль. */
  var docsCache = [];

  /* Очень упрощённый markdown → HTML: ровно то подмножество, что есть в
     текстах документов (## заголовки, - списки, абзацы). Ведущий `# ...`
     (общий заголовок документа) пропускаем — он уже показан в шапке
     шторки отдельно. Исходный текст экранируется целиком, собственного
     HTML в документах нет и быть не может. */
  function renderDocHtml(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    if (lines[0] && /^#\s+/.test(lines[0])) lines = lines.slice(1);
    var html = "";
    var para = [];
    var list = [];
    function flushPara() {
      if (para.length) { html += "<p>" + para.join(" ") + "</p>"; para = []; }
    }
    function flushList() {
      if (list.length) { html += "<ul>" + list.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>"; list = []; }
    }
    lines.forEach(function (raw) {
      var line = raw.trim();
      var heading = line.match(/^(#{1,3})\s+(.*)$/);
      var bullet = line.match(/^[-·]\s+(.*)$/);
      if (heading) {
        flushPara(); flushList();
        html += "<h3>" + escapeHtml(heading[2]) + "</h3>";
      } else if (bullet) {
        flushPara();
        list.push(escapeHtml(bullet[1]));
      } else if (!line) {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(escapeHtml(line));
      }
    });
    flushPara(); flushList();
    return html;
  }

  function renderDocsList() {
    var body = el("#docs-body");
    body.innerHTML = '<div class="empty-state"><p>Загружаем…</p></div>';
    Promise.all([
      api("/docs"),
      me ? api("/docs/accepted") : Promise.resolve({ ok: false, data: {} }),
    ]).then(function (results) {
      var listRes = results[0];
      var acceptedRes = results[1];
      docsCache = (listRes.ok && listRes.data.documents) || [];
      var accepted = (acceptedRes.ok && acceptedRes.data.accepted) || {};
      if (!docsCache.length) {
        body.innerHTML = '<div class="empty-state"><p>Документы не загрузились</p></div>';
        return;
      }
      body.innerHTML = "";
      docsCache.forEach(function (d) {
        var item = document.createElement("button");
        item.className = "doc-list-item";
        var statusHtml = me
          ? '<span class="doc-status ' + (accepted[d.code] ? "accepted" : "pending") + '">' + (accepted[d.code] ? "Принято" : "Не принято") + "</span>"
          : "";
        item.innerHTML =
          '<div class="main"><strong>' + escapeHtml(d.title) + '</strong><span>Редакция от ' + escapeHtml(d.revision) + '</span></div>' +
          statusHtml;
        item.addEventListener("click", function () { openDocDetail(d.code); });
        body.appendChild(item);
      });
    });
  }

  function openDocDetail(code) {
    var titleEl = el("#doc-detail-title");
    var revEl = el("#doc-detail-revision");
    var textEl = el("#doc-detail-text");
    var acceptEl = el("#doc-detail-accept");
    titleEl.textContent = "Загрузка…";
    revEl.textContent = "";
    textEl.innerHTML = "";
    acceptEl.innerHTML = "";
    openOverlay("overlay-doc-detail");

    api("/docs/" + encodeURIComponent(code)).then(function (r) {
      if (!r.ok) { titleEl.textContent = "Документ не найден"; return; }
      var doc = r.data;
      titleEl.textContent = doc.title;
      revEl.textContent = "Редакция от " + doc.revision;
      textEl.innerHTML = renderDocHtml(doc.text);

      if (!me) {
        acceptEl.innerHTML = '<p class="hint">Войдите через Sky ID, чтобы принять документ.</p>';
        return;
      }

      api("/docs/accepted").then(function (ar) {
        var already = ar.ok && ar.data.accepted && ar.data.accepted[code];
        if (already) {
          acceptEl.innerHTML = '<button class="cta ghost" disabled>Уже принято</button>';
          return;
        }
        var btn = document.createElement("button");
        btn.className = "cta";
        btn.textContent = "Принимаю";
        btn.addEventListener("click", function () {
          btn.disabled = true;
          btn.textContent = "Записываем…";
          api("/docs/" + encodeURIComponent(code) + "/accept", { method: "POST" }).then(function (dr) {
            if (dr.ok) {
              toast("Согласие записано");
              acceptEl.innerHTML = '<button class="cta ghost" disabled>Уже принято</button>';
            } else {
              btn.disabled = false;
              btn.textContent = "Принимаю";
              toast("Не удалось записать согласие");
            }
          });
        });
        acceptEl.appendChild(btn);
      });
    });
  }

  /*
   * Всплывающее окно принятия соглашений.
   *
   * Раньше раздел «Документы» открывался только по своей кнопке в
   * профиле или реактивно — после отказа сервера на /sky-topup с
   * documents_required (см. обработчик #sky-submit выше). Между входом
   * и первой попыткой пополнения человек мог пользоваться сайтом сколько
   * угодно, не увидев условия вовсе. Теперь при каждом подтверждённом
   * входе (первая загрузка страницы с живой сессией и сразу после
   * SSO-входа) сверяем, приняты ли оба документа, и если нет — окно
   * открывается само, без ожидания отказа на конкретном действии.
   *
   * Не хард-гейт: окно можно закрыть крестиком и продолжить читать
   * витрину — настоящую проверку всё равно делает сервер на
   * /sky-topup, это окно только не даёт условиям остаться незамеченными.
   */
  function maybePromptDocs() {
    if (!me) return;
    api("/docs/accepted").then(function (r) {
      if (!r.ok) return;
      var accepted = r.data.accepted || {};
      var pending = Object.keys(accepted).some(function (code) { return !accepted[code]; });
      if (pending) { renderDocsList(); openOverlay("overlay-docs"); }
    });
  }

  var backToDocsBtn = document.querySelector('[data-back-to="docs"]');
  if (backToDocsBtn) {
    backToDocsBtn.addEventListener("click", function () {
      closeOverlay("overlay-doc-detail");
      openOverlay("overlay-docs");
    });
  }

  /* ============ Init ============ */
  setTab("partners");
})();

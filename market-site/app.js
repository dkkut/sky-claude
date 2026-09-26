(function () {
  "use strict";

  /* ============================================================
     KutRent Market — клиент.
     Все данные — с сервера (/api/kutrent-market/*, тот же процесс,
     что и Sky API, см. server/routes/kutrentmarket.mjs). Ничего
     здесь не выдумывает получателя, заказ или его статус — то, что
     раньше в этом файле был MOCK-объект и localStorage, удалено:
     сервер — единственный источник правды.

     Поддержка (форма «Проблема с операцией?») и калитка беты —
     единственное, что осталось клиентским: у формы поддержки нет
     серверного приёмника (не входило в задачу), а калитка — тот же
     самый простой клиентский ключ, что был в макете, не более.
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

  /* ============ Partners: payli ============ */
  (function initPayli() {
    var btn = el("#payli-open");
    btn.addEventListener("click", function () {
      var url = btn.getAttribute("data-payli-url");
      if (!url) { toast("Ссылка на payli пока не настроена"); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    });
  })();

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

  var skyRecipient = null; // {username,name} — подтверждено сервером
  var skyChecking = false;
  var skySubmitting = false;
  var lastSkyOrderId = null;

  function syncSkySummary() {
    var raw = el("#sky-amount").value.replace(/\D/g, "");
    var amount = parseInt(raw, 10) || 0;
    el("#sum-amount").textContent = fmt(amount);
    el("#sum-total").textContent = fmt(amount);
    el("#sum-recipient").textContent = skyRecipient ? ("@" + skyRecipient.username) : "—";
    updateSkyCta();
  }
  function updateSkyCta() {
    var amount = parseInt(el("#sky-amount").value.replace(/\D/g, ""), 10) || 0;
    el("#sky-submit").disabled = !(amount >= 10 && skyRecipient && !skyChecking && !skySubmitting);
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

  var skyIdInput = el("#sky-id");
  var skyDebounce;
  skyIdInput.addEventListener("input", function () {
    var val = skyIdInput.value.trim();
    var resultBox = el("#recipient-result");
    clearTimeout(skyDebounce);
    skyRecipient = null;
    updateSkyCta();
    if (!val) {
      resultBox.innerHTML = "";
      syncSkySummary();
      return;
    }
    skyChecking = true;
    updateSkyCta();
    resultBox.innerHTML = '<div class="checking"><span class="spinner"></span>Проверяем получателя…</div>';
    skyDebounce = setTimeout(function () {
      api("/recipient?username=" + encodeURIComponent(val)).then(function (r) {
        skyChecking = false;
        if (r.ok && r.data.found) {
          skyRecipient = { username: r.data.username, name: r.data.name };
          resultBox.innerHTML =
            '<div class="recipient-box found">' +
            '<div class="recipient-avatar">' + r.data.username.charAt(0).toUpperCase() + '</div>' +
            '<div class="recipient-text"><strong>@' + escapeHtml(r.data.username) + '</strong><span>' + escapeHtml(r.data.name) + '</span></div>' +
            '<svg class="status-icon ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 13l4 4L19 7"/></svg>' +
            '</div>';
        } else {
          skyRecipient = null;
          resultBox.innerHTML =
            '<div class="recipient-box notfound">' +
            '<div class="recipient-text"><strong>Пользователь не найден</strong><span>Проверьте правильность Sky ID</span></div>' +
            '<svg class="status-icon err" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
            '</div>';
        }
        syncSkySummary();
      });
    }, 500);
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  el("#sky-submit").addEventListener("click", function () {
    if (el("#sky-submit").disabled || !skyRecipient) return;
    var amount = parseInt(el("#sky-amount").value.replace(/\D/g, ""), 10) || 0;
    var btn = el("#sky-submit");
    var originalText = btn.textContent;
    skySubmitting = true;
    btn.disabled = true;
    btn.textContent = "Создаём заказ…";

    api("/sky-topup", { method: "POST", body: { amount: amount, username: skyRecipient.username } }).then(function (r) {
      skySubmitting = false;
      btn.textContent = originalText;
      if (!r.ok) {
        var reason = r.data && r.data.error === "recipient_not_found" ? "Получатель не найден"
          : r.data && r.data.error === "invalid_amount" ? "Некорректная сумма"
            : r.data && r.data.error === "rate_limited" ? "Слишком много попыток, подождите немного"
              : "Не удалось создать заказ";
        toast(reason);
        updateSkyCta();
        return;
      }
      var order = r.data.order;
      lastSkyOrderId = order.id;

      el("#sky-result-amount").textContent = fmt(order.amount);
      el("#sky-result-recipient").textContent = "@" + order.recipientUsername;
      el("#sky-result-id").textContent = "#" + order.id;
      el("#sky-result-status").textContent = "Ожидает оплаты";
      openOverlay("overlay-sky-result");

      skyIdInput.value = "";
      skyRecipient = null;
      el("#recipient-result").innerHTML = "";
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
  var STATUS_LABEL = { pending: "Ожидает оплаты", paid: "Оплачено", cancelled: "Отменено" };
  var ordersCache = [];

  function renderOrders() {
    var body = el("#orders-body");
    body.innerHTML = '<div class="empty-state"><p>Загружаем…</p></div>';
    api("/orders").then(function (r) {
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
          '<div class="order-main"><strong>Пополнение Sky</strong><span>@' + escapeHtml(o.recipientUsername || "") + ' · ' + fmtDate(o.createdAt) + '</span></div>' +
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
        '<div class="summary-row"><span>Получатель</span><span>@' + escapeHtml(order.recipientUsername || "") + '</span></div>' +
        '<div class="summary-row"><span>Сумма</span><span>+' + fmt(order.amount) + '</span></div>' +
        '<div class="summary-row"><span>Статус</span><span class="status-pill ' + order.status + '">' + STATUS_LABEL[order.status] + '</span></div>' +
        '<div class="summary-row"><span>Создан</span><span>' + fmtDate(order.createdAt) + '</span></div>' +
        (order.paidAt ? '<div class="summary-row"><span>Оплачен</span><span>' + fmtDate(order.paidAt) + '</span></div>' : '') +
        '</div>' +
        '<button class="cta ghost" id="order-support-btn">Проблема с этим заказом?</button>';
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

  /* ============ Support (клиентская заглушка — нет серверного приёмника) ============ */
  function openSupport(order) {
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
  }
  el("#support-submit").addEventListener("click", function () {
    var text = el("#support-text").value.trim();
    if (!text) { toast("Опишите проблему"); return; }
    closeOverlay("overlay-support");
    toast("Спасибо, обращение записано");
  });

  /* ============ Profile (реальная сессия, не «Гость») ============ */
  function renderProfile() {
    api("/session").then(function (r) {
      if (!r.ok) return;
      el("#profile-session-id").textContent = "сессия " + r.data.sessionId.slice(0, 12) + "…";
    });
  }

  /* ============ Init ============ */
  setTab("partners");
})();

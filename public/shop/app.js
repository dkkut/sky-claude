/* Сайт каталога SkyKassa Business. Один файл без зависимостей: работает на Sky (/s/<адрес>) и на собственном сервере бизнеса.
   Цены и сумму заказа считает Sky: отсюда уходят только id позиций, количество и контакты. Оплата — на странице Sky. */
(function () {
  var C = window.SKY_SHOP || {};
  var API = (C.api || '').replace(/\/+$/, '');
  var slug = C.slug || (location.pathname.match(/^\/s\/([a-z0-9-]+)/) || [])[1] || '';
  var app = document.getElementById('app');
  var cart = {}; var data = null; var cat = '';
  var KEY = 'skyshop:' + slug;
  try { cart = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { cart = {}; }
  var ERR = { not_found: 'Витрина не найдена.', origin_not_allowed: 'Этот сайт не указан в настройках витрины.', shop_unavailable: 'Приём заказов временно недоступен.',
    empty_cart: 'Корзина пуста.', item_unavailable: 'Одной из позиций больше нет в наличии.', too_many_requests: 'Слишком много попыток. Попробуйте позже.',
    bad_field: 'Проверьте заполнение полей.', variant_required: 'Выберите вариант товара.', bad_amount: 'Сумма заказа вне допустимых пределов.' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rub(n) { return n.toLocaleString('ru-RU') + ' ₽'; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} }
  function api(path, opt) {
    return fetch(API + path, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function keyOf(id, v) { return id + '|' + (v || ''); }
  function itemById(id) { return (data.items || []).filter(function (i) { return i.id === id; })[0]; }
  function priceOf(it, v) { var x = (it.variants || []).filter(function (y) { return y.name === v; })[0]; return x && x.priceRub ? x.priceRub : it.priceRub; }
  function lines() {
    var out = [];
    Object.keys(cart).forEach(function (k) {
      var p = k.split('|'); var it = itemById(p[0]); if (!it || cart[k] < 1) return;
      out.push({ it: it, variant: p[1], qty: cart[k], price: priceOf(it, p[1]) });
    });
    return out;
  }
  function total() { return lines().reduce(function (s, l) { return s + l.price * l.qty; }, 0); }
  function count() { return lines().reduce(function (s, l) { return s + l.qty; }, 0); }

  function head() {
    var b = data.business;
    return '<header>' + (b.logoUrl ? '<img alt="" src="' + esc(API + b.logoUrl) + '">' : '') + '<div><h1>' + esc(b.name) + '</h1>' +
      (b.description ? '<div class="muted">' + esc(b.description) + '</div>' : '') + '</div></header>' +
      (data.notice ? '<div class="notice">' + esc(data.notice) + '</div>' : '');
  }

  function viewCatalog() {
    document.title = data.business.name;
    var h = head();
    if (data.state !== 'open') { app.innerHTML = h + '<div class="notice">' + (data.state === 'suspended' ? 'Витрина приостановлена.' : 'Каталог временно недоступен.') + '</div>'; return; }
    var cats = data.categories || [];
    if (cats.length) h += '<div class="cats"><button data-cat="" class="' + (cat ? '' : 'on') + '">Все</button>' + cats.map(function (c) { return '<button data-cat="' + esc(c) + '" class="' + (cat === c ? 'on' : '') + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    var items = data.items.filter(function (i) { return !cat || i.category === cat; });
    if (!items.length) h += '<p class="muted">Пока нет товаров.</p>';
    h += '<div class="grid">' + items.map(function (i) {
      var vs = i.variants || [];
      var from = vs.length ? Math.min.apply(null, vs.map(function (v) { return v.priceRub || i.priceRub; })) : i.priceRub;
      return '<div class="item">' + (i.photoUrl ? '<img class="ph" loading="lazy" alt="" src="' + esc(API + i.photoUrl) + '">' : '<div class="ph"></div>') +
        '<div class="b"><div>' + esc(i.title) + '</div>' + (i.description ? '<div class="muted" style="font-size:14px">' + esc(i.description) + '</div>' : '') +
        (i.leadTime ? '<div class="muted" style="font-size:13px">Срок: ' + esc(i.leadTime) + '</div>' : '') +
        '<div class="price">' + (vs.length > 1 ? 'от ' : '') + rub(from) + '</div>' +
        (vs.length ? '<select data-v="' + esc(i.id) + '">' + vs.map(function (v) { return '<option>' + esc(v.name) + '</option>'; }).join('') + '</select>' : '') +
        '<button class="primary" data-add="' + esc(i.id) + '">В корзину</button></div></div>';
    }).join('') + '</div>';
    var n = count();
    if (n) h += '<div class="bar"><div><div><b>' + rub(total()) + '</b> <span class="muted">· ' + n + ' шт.</span></div><button class="primary" id="tocart">Оформить</button></div></div>';
    app.innerHTML = h;
    Array.prototype.forEach.call(app.querySelectorAll('[data-cat]'), function (b) { b.onclick = function () { cat = b.getAttribute('data-cat'); viewCatalog(); }; });
    Array.prototype.forEach.call(app.querySelectorAll('[data-add]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-add'); var s = app.querySelector('select[data-v="' + id + '"]'); var k = keyOf(id, s ? s.value : '');
        cart[k] = Math.min(99, (cart[k] || 0) + 1); save(); viewCatalog();
      };
    });
    var tc = document.getElementById('tocart'); if (tc) tc.onclick = viewCart;
  }

  function viewCart() {
    var ls = lines();
    if (!ls.length) { viewCatalog(); return; }
    var h = head() + '<h2>Корзина</h2>' + ls.map(function (l) {
      var k = keyOf(l.it.id, l.variant);
      return '<div class="row"><div>' + esc(l.it.title) + (l.variant ? ' <span class="muted">(' + esc(l.variant) + ')</span>' : '') + '<div class="muted">' + rub(l.price) + '</div></div>' +
        '<div class="qty"><button data-m="' + esc(k) + '">−</button><b>' + l.qty + '</b><button data-p="' + esc(k) + '">+</button></div></div>';
    }).join('') +
      '<div class="row"><b>Итого</b><b>' + rub(total()) + '</b></div>' +
      '<h2>Ваши данные</h2><form id="f"><label>Имя</label><input name="name" required maxlength="80" autocomplete="name">' +
      '<label>Телефон</label><input name="phone" required maxlength="30" inputmode="tel" autocomplete="tel">' +
      '<label>Почта (необязательно)</label><input name="email" type="email" maxlength="120" autocomplete="email">' +
      '<label>Адрес или пожелания (необязательно)</label><textarea name="address" maxlength="200" rows="2"></textarea>' +
      '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<p class="muted" style="font-size:14px">Оплата — переводом продавцу по его реквизитам на следующей странице. Статус заказа подтверждает продавец.</p>' +
      '<p class="err" id="e"></p><div style="display:flex;gap:8px"><button type="button" id="back">Назад</button><button class="primary" id="go" style="flex:1">Оформить заказ</button></div></form>';
    app.innerHTML = h;
    Array.prototype.forEach.call(app.querySelectorAll('[data-m]'), function (b) { b.onclick = function () { var k = b.getAttribute('data-m'); cart[k] = (cart[k] || 0) - 1; if (cart[k] < 1) delete cart[k]; save(); viewCart(); }; });
    Array.prototype.forEach.call(app.querySelectorAll('[data-p]'), function (b) { b.onclick = function () { var k = b.getAttribute('data-p'); cart[k] = Math.min(99, (cart[k] || 0) + 1); save(); viewCart(); }; });
    document.getElementById('back').onclick = viewCatalog;
    document.getElementById('f').onsubmit = function (ev) {
      ev.preventDefault();
      var f = ev.target; var btn = document.getElementById('go'); var e = document.getElementById('e'); e.textContent = ''; btn.disabled = true;
      var body = { website: f.website.value, items: lines().map(function (l) { return { id: l.it.id, qty: l.qty, variant: l.variant || undefined }; }),
        contact: { name: f.name.value, phone: f.phone.value, email: f.email.value, address: f.address.value } };
      api('/api/kbiz/public/shop/' + encodeURIComponent(slug) + '/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
        if (!r.ok) { btn.disabled = false; e.textContent = ERR[r.error] || 'Не удалось оформить заказ.'; return; }
        cart = {}; save();
        try { localStorage.setItem(KEY + ':last', JSON.stringify({ id: r.id, key: r.key, number: r.number })); } catch (x) {}
        viewDone(r);
      }).catch(function () { btn.disabled = false; e.textContent = 'Нет связи. Попробуйте ещё раз.'; });
    };
  }

  function viewDone(r) {
    var payHref = r.payUrl;                       // страница оплаты всегда на Sky: реквизиты и статусы — там
    app.innerHTML = head() + '<h2>Заказ № ' + esc(r.number) + ' оформлен</h2><p>Сумма: <b>' + rub(r.totalRub) + '</b>. Теперь переведите её продавцу по реквизитам и сообщите об оплате на странице Sky.</p>' +
      '<p><a class="btn primary" style="display:inline-block;text-decoration:none;line-height:24px" href="' + esc(payHref) + '" rel="noopener">Перейти к оплате</a></p>' +
      '<p class="muted" style="font-size:14px">Сохраните страницу: статус заказа можно посмотреть позже.</p><p><button id="again">В каталог</button></p>';
    document.getElementById('again').onclick = viewCatalog;
  }

  api('/api/kbiz/public/shop/' + encodeURIComponent(slug)).then(function (r) {
    if (r.error) { app.innerHTML = '<div class="notice">' + esc(ERR[r.error] || 'Витрина недоступна.') + '</div>'; return; }
    data = r; viewCatalog();
  }).catch(function () { app.innerHTML = '<div class="notice">Нет связи с сервером.</div>'; });
})();

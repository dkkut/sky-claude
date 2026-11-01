/**
 * Дизайн-система писем Sky и три шаблона: информационная рассылка, Sky Prime, SkyMoney.
 *
 * Правила вёрстки (почтовые клиенты — не браузеры): таблицы, inline CSS, ширина 600 px и сжатие на телефоне через <style> (Gmail, Яндекс, Mail.ru
 * его понимают; Outlook остаётся на таблицах и сплошных цветах), кнопки — ячейки с цветом фона (видны при отключённых картинках), картинок по умолчанию
 * нет вовсе: логотип и «иллюстрации» нарисованы цветом и текстом, поэтому письмо читаемо и без загрузки изображений. Анимации не используются.
 *
 * Безопасность: ВСЁ, что приходит из переменных и полей админки, проходит esc() (HTML) или clean() (текст); ссылки — только https (safeUrl),
 * подстановка {имя} — только из разрешённого списка. Модуль чистый: ни базы, ни сети — отрисовка одного письма по данным.
 */

export const BRAND = {
  ink: '#14142b', muted: '#6b6f8a', line: '#e8eaf5', page: '#f3f5fb', card: '#ffffff',
  blue: '#4f6ef7', violet: '#8b5cf6', indigo: '#4f46e5', green: '#12a76a', greenBg: '#e6f7ef', amber: '#f5b43a',
};
const GRAD = `background:${BRAND.indigo};background-image:linear-gradient(135deg,#4f6ef7 0%,#8b5cf6 100%);`;
const GRAD_PRIME = `background:#1d1a4d;background-image:linear-gradient(135deg,#1d1a4d 0%,#4a2fa8 60%,#7c4dff 100%);`;
const FONT = `-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;

/* ─── безопасность ─── */
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;
/** Текст без управляющих знаков и «переворачивающих» направление символов. */
export const clean = (v, max = 4000) => String(v ?? '').replace(CTRL, '').slice(0, max);
export const esc = (v) => clean(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Только https без логина и пробелов; иначе пусто. */
export const safeUrl = (u) => {
  const s = clean(u, 1000).trim();
  if (!/^https:\/\/[^\s"'<>\\]+$/i.test(s)) return '';
  try { const x = new URL(s); return x.username || x.password ? '' : x.toString(); } catch { return ''; }
};

/** Разрешённые переменные по типам писем (всё остальное в фигурных скобках остаётся как есть и не подставляется). */
export const VARIABLES = {
  newsletter: ['username'],
  prime: ['username', 'subscription_name', 'expiration_date', 'days_remaining', 'renewal_amount', 'renewal_link'],
  money: ['username', 'amount', 'currency', 'transaction_id', 'payment_method', 'commission', 'total_amount', 'transaction_date'],
};
const subst = (tpl, vars, kind, mode) => (mode === 'html' ? esc(tpl) : clean(tpl, 6000)).replace(/\{([a-z_]+)\}/g, (m, k) => {
  if (!VARIABLES[kind]?.includes(k) || !(k in vars)) return m;
  return mode === 'html' ? esc(vars[k]) : clean(vars[k], 500);
});

/* ─── блоки ─── */
const preheaderBlock = (t) => `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(t)}${'&nbsp;&zwnj;'.repeat(40)}</div>`;

/** Адрес маленького логотипа Sky (public/email-logo.png, 160×160, ~28 КБ). Нужен абсолютный https-адрес приложения. */
export const logoOf = (ctx = {}) => { const a = safeUrl(ctx.appUrl); return a ? `${a.replace(/\/$/, '')}/email-logo.png` : ''; };

/** Логотип: настоящий значок Sky + название. Если картинки отключены — читается название; нет адреса приложения — запасной квадрат с буквой. */
const logo = (light = false, brand = 'Sky', logoUrl = '') => {
  const initial = esc(Array.from(brand)[0] || 'S');
  const mark = logoUrl
    ? `<td width="40" height="40" valign="middle" style="width:40px;height:40px;"><img src="${esc(logoUrl)}" width="40" height="40" alt="${initial}" style="display:block;width:40px;height:40px;border:0;outline:none;font:800 18px/40px ${FONT};color:${BRAND.indigo};text-align:center;"></td>`
    : `<td width="34" height="34" align="center" valign="middle" bgcolor="${light ? '#ffffff' : BRAND.indigo}" style="width:34px;height:34px;border-radius:11px;${light ? '' : GRAD}font:800 18px/34px ${FONT};color:${light ? BRAND.indigo : '#ffffff'};">${initial}</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${mark}
<td style="padding-left:10px;font:800 21px/40px ${FONT};letter-spacing:-0.3px;color:${light ? '#ffffff' : BRAND.ink};">${esc(brand)}</td></tr></table>`;
};

/** Кнопка, которая остаётся кнопкой и без картинок и в Outlook (цвет задан и на ячейке, и на ссылке). */
export const button = (label, url, { kind = 'primary', full = false } = {}) => {
  const href = safeUrl(url); if (!href) return '';
  const bg = kind === 'primary' ? BRAND.indigo : kind === 'light' ? '#ffffff' : '#eef0fd';
  const fg = kind === 'primary' ? '#ffffff' : kind === 'light' ? BRAND.indigo : BRAND.indigo;
  const style = kind === 'primary' ? GRAD : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full ? ' width="100%"' : ''}><tr><td align="center" bgcolor="${bg}" style="border-radius:14px;${style}"><a href="${esc(href)}" target="_blank" style="display:block;padding:14px 26px;font:700 15px/20px ${FONT};color:${fg};text-decoration:none;border-radius:14px;">${esc(label)}</a></td></tr></table>`;
};

export const paragraphs = (text, vars, kind) => String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
  const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => /^[•\-–]\s+/.test(l))) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">${lines.map((l) => `<tr><td width="22" valign="top" style="font:700 15px/24px ${FONT};color:${BRAND.indigo};">•</td><td style="font:400 15px/24px ${FONT};color:${BRAND.ink};padding-bottom:4px;">${subst(l.replace(/^[•\-–]\s+/, ''), vars, kind, 'html')}</td></tr>`).join('')}</table>`;
  }
  return `<p style="margin:0 0 16px;font:400 15px/24px ${FONT};color:${BRAND.ink};">${lines.map((l) => subst(l, vars, kind, 'html')).join('<br>')}</p>`;
}).join('');

const infoCard = (title, text, vars, kind) => `<td class="stack" width="50%" valign="top" style="padding:6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f6f7fe" style="background:#f6f7fe;border:1px solid ${BRAND.line};border-radius:16px;"><tr><td style="padding:16px 16px 14px;"><div style="font:700 15px/20px ${FONT};color:${BRAND.ink};margin-bottom:6px;">${subst(title, vars, kind, 'html')}</div><div style="font:400 13px/19px ${FONT};color:${BRAND.muted};">${subst(text, vars, kind, 'html')}</div></td></tr></table></td>`;

const cardsBlock = (cards, vars, kind) => {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && (c.title || c.text)).slice(0, 4);
  if (!list.length) return '';
  const rows = [];
  for (let i = 0; i < list.length; i += 2) rows.push(`<tr>${infoCard(list[i].title, list[i].text, vars, kind)}${list[i + 1] ? infoCard(list[i + 1].title, list[i + 1].text, vars, kind) : '<td class="stack" width="50%"></td>'}</tr>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px -6px 14px;width:calc(100% + 12px);">${rows.join('')}</table>`;
};

/** Единый футер: слоган, три кнопки, пояснение, почему пришло письмо, и (только у рекламных) отписка. */
export const footer = ({ links, marketing, unsubUrl, messageId }) => {
  const a = (label, url) => { const h = safeUrl(url); return h ? `<a href="${esc(h)}" target="_blank" style="color:${BRAND.indigo};text-decoration:none;font:600 13px/20px ${FONT};padding:0 10px;">${esc(label)}</a>` : ''; };
  const why = marketing
    ? `Вы получили это письмо, потому что подписаны на новости Sky. ${unsubUrl ? `<a href="${esc(safeUrl(unsubUrl))}" target="_blank" style="color:${BRAND.muted};text-decoration:underline;">Отписаться от рекламных рассылок</a>.` : ''}`
    : 'Это служебное уведомление об операциях и подписках вашего аккаунта — оно приходит независимо от настроек рассылок.';
  return `<tr><td style="padding:8px 8px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="padding:22px 12px 8px;">
<div style="font:800 16px/22px ${FONT};color:${BRAND.ink};">Sky — твоя экосистема.</div>
<div style="padding-top:12px;">${a('Открыть Sky', links.app)}${a('Поддержка', links.support)}${a('Политика конфиденциальности', links.privacy)}</div>
<div style="padding-top:14px;font:400 12px/18px ${FONT};color:${BRAND.muted};">${why}</div>
<div style="padding-top:8px;font:400 11px/16px ${FONT};color:#9a9db6;">Письмо отправлено автоматически, отвечать на него не нужно. № ${esc(messageId)}</div>
</td></tr></table></td></tr>`;
};

/** Общая рамка письма. */
export const shell = ({ title, preheader, hero, body, footerHtml, brand = 'Sky', logoUrl = '' }) => `<!doctype html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="x-apple-disable-message-reformatting"><title>${esc(title)}</title>
<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}.stack{display:block!important;width:100%!important}.big{font-size:38px!important;line-height:44px!important}.h1{font-size:26px!important;line-height:32px!important}}</style></head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-text-size-adjust:100%;">${preheaderBlock(preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.page}" style="background:${BRAND.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
<tr><td style="padding:0 8px 16px;">${logo(false, brand, logoUrl)}</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.card}" style="background:${BRAND.card};border-radius:26px;box-shadow:0 6px 28px rgba(60,60,140,0.10);overflow:hidden;">
${hero}${body}
</table></td></tr>
${footerHtml}
</table></td></tr></table></body></html>`;

/** Оформления шапки письма. Только цвета и расположение — без картинок, поэтому читаются и при отключённых изображениях. */
export const HERO_STYLES = {
  gradient: { name: 'Sky (индиго)', bg: '#4f46e5', grad: 'linear-gradient(135deg,#4f6ef7 0%,#8b5cf6 100%)', fg: '#ffffff', sub: 'rgba(255,255,255,0.88)', acc: 'rgba(255,255,255,0.78)' },
  aurora: { name: 'Северное сияние', bg: '#0ea5e9', grad: 'linear-gradient(135deg,#06b6d4 0%,#3b82f6 50%,#8b5cf6 100%)', fg: '#ffffff', sub: 'rgba(255,255,255,0.9)', acc: 'rgba(255,255,255,0.8)' },
  sunset: { name: 'Закат', bg: '#f43f5e', grad: 'linear-gradient(135deg,#f97316 0%,#f43f5e 55%,#d946ef 100%)', fg: '#ffffff', sub: 'rgba(255,255,255,0.92)', acc: 'rgba(255,255,255,0.85)' },
  night: { name: 'Ночь', bg: '#1d1a4d', grad: 'linear-gradient(135deg,#0f0c29 0%,#302b63 55%,#4a2fa8 100%)', fg: '#ffffff', sub: 'rgba(255,255,255,0.82)', acc: '#c4b5fd' },
  mint: { name: 'Мята', bg: '#10b981', grad: 'linear-gradient(135deg,#059669 0%,#10b981 55%,#2dd4bf 100%)', fg: '#ffffff', sub: 'rgba(255,255,255,0.92)', acc: 'rgba(255,255,255,0.85)' },
  rose: { name: 'Розовый', bg: '#ec4899', grad: 'linear-gradient(135deg,#ec4899 0%,#a855f7 100%)', fg: '#ffffff', sub: 'rgba(255,255,255,0.92)', acc: 'rgba(255,255,255,0.85)' },
  gold: { name: 'Золото', bg: '#f59e0b', grad: 'linear-gradient(135deg,#f59e0b 0%,#fbbf24 60%,#fde68a 100%)', fg: '#3b2a05', sub: 'rgba(59,42,5,0.82)', acc: 'rgba(59,42,5,0.7)' },
  light: { name: 'Светлая', bg: '#eef0ff', grad: '', fg: '#14142b', sub: '#6b6f8a', acc: '#4f46e5', bar: '#4f46e5' },
  ink: { name: 'Графит', bg: '#14142b', grad: '', fg: '#ffffff', sub: 'rgba(255,255,255,0.78)', acc: '#a5b4fc' },
};
/** Название сервиса в логотипе письма и в имени отправителя: по теме письма. */
export const brandOf = (c = {}) => clean(c.brand, 24).trim() || 'Sky';
export const heroStyleIds = Object.keys(HERO_STYLES);

export const heroBlock = ({ title, subtitle, accent, vars, kind, imageUrl, style = 'gradient', emoji = '', align = 'left' }) => {
  const img = safeUrl(imageUrl);
  const st = HERO_STYLES[style] ?? HERO_STYLES.gradient;
  const al = align === 'center' ? 'center' : 'left';
  const bgCss = `background:${st.bg};${st.grad ? `background-image:${st.grad};` : ''}`;
  const em = clean(emoji, 8).trim();
  return `<tr><td class="pad" align="${al}" bgcolor="${st.bg}" style="${bgCss}padding:34px 36px 32px;text-align:${al};${st.bar ? `border-top:4px solid ${st.bar};` : ''}">
${em ? `<div style="font:400 44px/52px ${FONT};padding-bottom:10px;">${esc(em)}</div>` : ''}<div style="font:600 12px/16px ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:${st.acc};padding-bottom:12px;">${esc(accent)}</div>
<div class="h1" style="font:800 30px/36px ${FONT};letter-spacing:-0.6px;color:${st.fg};">${subst(title, vars, kind, 'html')}</div>
${subtitle ? `<div style="padding-top:10px;font:400 16px/24px ${FONT};color:${st.sub};">${subst(subtitle, vars, kind, 'html')}</div>` : ''}
</td></tr>${img ? `<tr><td style="padding:0;line-height:0;"><img src="${esc(img)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>` : ''}`;
};

/* ─── своё оформление (HTML-файл администратора) ─── */
const OK_TAGS = new Set(['html','head','body','meta','title','style','table','thead','tbody','tfoot','tr','td','th','div','span','p','a','img','br','hr','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','b','em','i','u','s','small','center','font','blockquote','sup','sub','colgroup','col']);
const OK_ATTR = new Set(['style','class','id','width','height','align','valign','bgcolor','color','face','size','border','cellpadding','cellspacing','colspan','rowspan','href','src','alt','title','target','role','lang','dir','name','content','charset','background']);
const urlOk = (v) => /^\s*(\{\{[a-z_]+\}\}|https:\/\/|mailto:|tel:|#|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(v) && !/[\u0000-\u001f]/.test(v);
/** Убирает из чужого HTML всё, что выполняет код или тянет внешнее: скрипты, формы, фреймы, обработчики on*, javascript:, @import, не-https ссылки. */
export const sanitizeEmailHtml = (input) => {
  let h = clean(input, 300_000);
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<\s*(script|iframe|object|embed|form|noscript|template|svg|math|link|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/<\s*(script|iframe|object|embed|form|link|base|input|button|textarea|select)\b[^>]*>/gi, '');
  h = h.replace(/<\s*style\b([^>]*)>([\s\S]*?)<\s*\/\s*style\s*>/gi, (_m, _a, css) => {
    const safe = String(css).replace(/@import[^;]*;?/gi, '').replace(/expression\s*\([^)]*\)/gi, '').replace(/behavior\s*:[^;}]*/gi, '').replace(/-moz-binding\s*:[^;}]*/gi, '').replace(/url\(\s*(['"]?)(?!https:|data:image\/)[^)]*\)/gi, 'none').replace(/javascript:/gi, '');
    return `<style>${safe}</style>`;
  });
  return h.replace(/<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^>]*)>/g, (_m, slash, name, rest) => {
    const tag = name.toLowerCase();
    if (!OK_TAGS.has(tag)) return '';
    if (slash) return `</${tag}>`;
    const attrs = [];
    for (const m of rest.matchAll(/([\w:-]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const k = m[1].toLowerCase(); const v = (m[3] ?? m[4] ?? m[5] ?? '').trim();
      if (k.startsWith('on') || !OK_ATTR.has(k)) continue;
      if (['href', 'src', 'background'].includes(k) && !urlOk(v)) continue;
      if (k === 'style') { if (/(expression|javascript:|behavior|binding|@import)/i.test(v) || /url\(\s*['"]?(?!https:|data:image\/)/i.test(v)) continue; }
      if (tag === 'meta' && k === 'content' && /refresh|url=/i.test(v)) continue;
      attrs.push(`${k}="${v.replace(/"/g, '&quot;')}"`);
    }
    if (tag === 'a') attrs.push('target="_blank"', 'rel="noopener noreferrer"');
    return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  });
};

/** Подстановка в своё оформление: {{title}}, {{subtitle}}, {{label}}, {{emoji}}, {{username}}, {{body}}, {{cards}}, {{cta}}, {{cta_url}}, {{cta_label}}, {{image_url}}, {{app_url}}, {{unsubscribe_url}}, {{footer}}. */
export const renderCustomHtml = (design, parts) => {
  const clear = sanitizeEmailHtml(design);
  const footBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="padding:18px 12px;">${parts.footerInner}</td></tr></table>`;
  const map = { ...parts.html, footer: footBlock };
  let out = clear.replace(/\{\{([a-z_]+)\}\}/g, (m, k) => {
    if (k in map) return map[k];
    return '';
  });
  const hasFooter = /\{\{footer\}\}/.test(clear);
  if (!hasFooter) {
    // Отписка и пояснение «почему вы получили письмо» обязательны для рекламного письма — добавляем их всегда, если дизайн не поставил футер сам.
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${footBlock}</body>`) : `${out}${footBlock}`;
  }
  if (!/<html/i.test(out)) out = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${out}</body></html>`;
  return out;
};

export const bodyWrap = (inner) => `<tr><td class="pad" style="padding:30px 36px 34px;">${inner}</td></tr>`;

/* ─── ссылки футера ─── */
export const linksOf = (ctx) => ({ app: ctx.appUrl, support: ctx.supportUrl || ctx.appUrl, privacy: ctx.privacyUrl || ctx.appUrl });

/* ─── 1. Информационная рассылка ─── */
export const renderNewsletter = (content = {}, ctx = {}) => {
  const vars = { username: ctx.username || '' };
  const c = content;
  const title = clean(c.title, 200) || 'Новости Sky';
  const preheader = clean(ctx.preheader || c.subtitle || '', 200);
  const cta = c.cta?.label && safeUrl(c.cta.url) ? button(clean(c.cta.label, 60), c.cta.url, { kind: 'primary' }) : '';
  const hello = vars.username ? `<p style="margin:0 0 16px;font:600 15px/24px ${FONT};color:${BRAND.ink};">Здравствуйте, ${esc(vars.username)}!</p>` : '';
  const accent = clean(c.label, 40) || (brandOf(c) === 'Sky' ? 'Новости Sky' : brandOf(c));
  const bodyHtml = `${paragraphs(c.body, vars, 'newsletter')}`;
  const cardsHtml = cardsBlock(c.cards, vars, 'newsletter');
  const html = c.customHtml
    ? renderCustomHtml(c.customHtml, {
      html: {
        title: subst(title, vars, 'newsletter', 'html'), subtitle: subst(c.subtitle ?? '', vars, 'newsletter', 'html'), label: esc(accent), emoji: esc(clean(c.emoji, 8)),
        logo: logoOf(ctx) ? `<img src="${esc(logoOf(ctx))}" width="40" height="40" alt="Sky" style="display:block;border:0;">` : '', logo_url: esc(logoOf(ctx)),
        username: esc(vars.username), body: bodyHtml, cards: cardsHtml, cta, cta_url: esc(safeUrl(c.cta?.url) || '#'), cta_label: esc(clean(c.cta?.label, 60)),
        image_url: esc(safeUrl(c.imageUrl) || ''), app_url: esc(safeUrl(ctx.appUrl) || '#'), unsubscribe_url: esc(safeUrl(ctx.unsubUrl) || '#'), footer: '',
      },
      footerInner: `<div style="font:400 12px/18px ${FONT};color:${BRAND.muted};">Вы получили это письмо, потому что подписаны на новости Sky. ${ctx.unsubUrl ? `<a href="${esc(safeUrl(ctx.unsubUrl))}" target="_blank" style="color:${BRAND.muted};text-decoration:underline;">Отписаться от рекламных рассылок</a>.` : ''}<br>№ ${esc(ctx.messageId || '—')}</div>`,
    })
    : shell({
      title, preheader, brand: brandOf(c), logoUrl: logoOf(ctx),
      hero: heroBlock({ title, subtitle: c.subtitle, accent, vars, kind: 'newsletter', imageUrl: c.imageUrl, style: c.hero, emoji: c.emoji, align: c.align }),
      body: bodyWrap(`${hello}${bodyHtml}${cardsHtml}${cta ? `<div style="padding-top:6px;">${cta}</div>` : ''}`),
      footerHtml: footer({ links: linksOf(ctx), marketing: true, unsubUrl: ctx.unsubUrl, messageId: ctx.messageId || '—' }),
    });
  const text = [
    title, c.subtitle ? clean(c.subtitle) : '', '',
    vars.username ? `Здравствуйте, ${vars.username}!` : '',
    String(c.body ?? '').split('\n').map((l) => subst(l, vars, 'newsletter', 'text')).join('\n'), '',
    ...(Array.isArray(c.cards) ? c.cards.filter((x) => x && (x.title || x.text)).slice(0, 4).map((x) => `— ${subst(x.title, vars, 'newsletter', 'text')}: ${subst(x.text, vars, 'newsletter', 'text')}`) : []),
    c.cta?.label && safeUrl(c.cta.url) ? `\n${clean(c.cta.label, 60)}: ${safeUrl(c.cta.url)}` : '',
    '\n—\nSky — твоя экосистема.', `Открыть Sky: ${ctx.appUrl || ''}`,
    ctx.unsubUrl ? `Отписаться от рекламных рассылок: ${ctx.unsubUrl}` : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { html, text, brand: brandOf(c), subject: subst(ctx.subject || c.title || 'Новости Sky', vars, 'newsletter', 'text') };
};

/* ─── 2. Sky Prime ─── */
export const renderPrime = (content = {}, vars = {}, ctx = {}) => {
  const v = Object.fromEntries(VARIABLES.prime.map((k) => [k, clean(vars[k] ?? '', 300)]));
  const title = clean(content.title, 200) || 'Sky Prime';
  const preheader = clean(subst(ctx.preheader || content.subtitle || '', v, 'prime', 'text'), 200);
  const renewed = ctx.variant === 'renewed';
  const hero = `<tr><td class="pad" bgcolor="#1d1a4d" style="${GRAD_PRIME}padding:30px 36px 34px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td style="font:700 13px/18px ${FONT};letter-spacing:1.6px;text-transform:uppercase;color:${BRAND.amber};">★ ${esc(v.subscription_name || 'Sky Prime')}</td>
<td align="right" style="font:600 12px/18px ${FONT};color:rgba(255,255,255,0.6);">${renewed ? 'Продлено' : 'Подписка'}</td></tr></table>
<div class="h1" style="padding-top:18px;font:800 28px/34px ${FONT};letter-spacing:-0.5px;color:#ffffff;">${subst(title, v, 'prime', 'html')}</div>
${content.subtitle ? `<div style="padding-top:8px;font:400 15px/22px ${FONT};color:rgba(255,255,255,0.82);">${subst(content.subtitle, v, 'prime', 'html')}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:22px;"><tr>
<td class="stack" width="50%" valign="top" style="padding:0 6px 8px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#2c2870" style="background:#2c2870;border:1px solid rgba(255,255,255,0.14);border-radius:16px;"><tr><td style="padding:16px 18px;"><div style="font:600 11px/14px ${FONT};letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.6);">${renewed ? 'Действует до' : 'Окончание'}</div><div style="padding-top:6px;font:800 20px/26px ${FONT};color:#ffffff;">${esc(v.expiration_date)}</div></td></tr></table></td>
<td class="stack" width="50%" valign="top" style="padding:0 0 8px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#2c2870" style="background:#2c2870;border:1px solid rgba(255,255,255,0.14);border-radius:16px;"><tr><td style="padding:16px 18px;"><div style="font:600 11px/14px ${FONT};letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.6);">Осталось</div><div style="padding-top:6px;font:800 20px/26px ${FONT};color:${BRAND.amber};">${esc(v.days_remaining)}</div></td></tr></table></td>
</tr></table></td></tr>`;
  const hello = v.username ? `<p style="margin:0 0 16px;font:600 15px/24px ${FONT};color:${BRAND.ink};">Здравствуйте, ${esc(v.username)}!</p>` : '';
  const price = !renewed && v.renewal_amount ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f6f7fe" style="margin:0 0 20px;background:#f6f7fe;border:1px solid ${BRAND.line};border-radius:16px;"><tr><td style="padding:14px 18px;font:400 14px/20px ${FONT};color:${BRAND.muted};">Стоимость продления</td><td align="right" style="padding:14px 18px;font:800 16px/20px ${FONT};color:${BRAND.ink};">${esc(v.renewal_amount)}</td></tr></table>` : '';
  const cta = !renewed && content.cta?.label && safeUrl(v.renewal_link) ? button(clean(content.cta.label, 60), v.renewal_link, { kind: 'primary', full: true }) : '';
  const html = shell({
    brand: 'Sky Prime', logoUrl: logoOf(ctx), title, preheader, hero,
    body: bodyWrap(`${hello}${paragraphs(content.body, v, 'prime')}${price}${cta}`),
    footerHtml: footer({ links: linksOf(ctx), marketing: false, messageId: ctx.messageId || '—' }),
  });
  const text = [
    subst(title, v, 'prime', 'text'), '',
    v.username ? `Здравствуйте, ${v.username}!` : '',
    String(content.body ?? '').split('\n').map((l) => subst(l, v, 'prime', 'text')).join('\n'), '',
    `${renewed ? 'Действует до' : 'Окончание'}: ${v.expiration_date}`, `Осталось: ${v.days_remaining}`,
    !renewed && v.renewal_amount ? `Стоимость продления: ${v.renewal_amount}` : '',
    !renewed && safeUrl(v.renewal_link) ? `Продлить: ${safeUrl(v.renewal_link)}` : '',
    '\n—\nSky — твоя экосистема.', `Открыть Sky: ${ctx.appUrl || ''}`, 'Это служебное уведомление о вашей подписке.',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { html, text, brand: 'Sky Prime', subject: subst(ctx.subject || title, v, 'prime', 'text') };
};

/* ─── 3. SkyMoney: пополнение ─── */
export const renderMoney = (content = {}, vars = {}, ctx = {}) => {
  const v = Object.fromEntries(VARIABLES.money.map((k) => [k, clean(vars[k] ?? '', 300)]));
  const title = clean(content.title, 200) || 'Баланс пополнен';
  const preheader = clean(subst(ctx.preheader || `Зачислено ${v.amount} ${v.currency}`, v, 'money', 'text'), 200);
  const row = (k, val, strong) => `<tr><td style="padding:11px 0;border-top:1px solid ${BRAND.line};font:400 14px/20px ${FONT};color:${BRAND.muted};">${esc(k)}</td><td align="right" style="padding:11px 0;border-top:1px solid ${BRAND.line};font:${strong ? 800 : 600} 14px/20px ${FONT};color:${BRAND.ink};">${esc(val)}</td></tr>`;
  const hero = `<tr><td class="pad" align="left" bgcolor="${BRAND.indigo}" style="${GRAD}padding:30px 36px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="font:700 13px/18px ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,0.82);">SkyMoney</td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>
<td width="40" height="40" align="center" valign="middle" bgcolor="${BRAND.green}" style="width:40px;height:40px;border-radius:20px;background:${BRAND.green};font:800 22px/40px ${FONT};color:#ffffff;">✓</td>
<td style="padding-left:12px;font:700 16px/22px ${FONT};color:#ffffff;">${subst(title, v, 'money', 'html')}</td></tr></table>
<div class="big" style="padding-top:18px;font:800 46px/52px ${FONT};letter-spacing:-1.2px;color:#ffffff;">+ ${esc(v.amount)} <span style="font-size:26px;font-weight:700;opacity:0.85;">${esc(v.currency)}</span></div>
</td></tr>`;
  const hello = v.username ? `<p style="margin:0 0 14px;font:600 15px/24px ${FONT};color:${BRAND.ink};">Здравствуйте, ${esc(v.username)}!</p>` : '';
  const details = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 22px;">
${row('Дата и время', v.transaction_date)}${row('Номер операции', v.transaction_id)}${row('Способ пополнения', v.payment_method)}${row('Сумма', `${v.amount} ${v.currency}`)}${row('Комиссия', v.commission)}${row('Итого', v.total_amount, true)}
<tr><td colspan="2" style="border-top:1px solid ${BRAND.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
  const op = button('Посмотреть операцию', ctx.operationUrl || ctx.appUrl, { kind: 'primary', full: true });
  const receipt = safeUrl(ctx.receiptUrl) ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;"><tr><td class="stack" width="50%" style="padding:0 6px 8px 0;">${button('Открыть квитанцию', ctx.receiptUrl, { kind: 'soft', full: true })}</td><td class="stack" width="50%" style="padding:0 0 8px 6px;">${button('Сохранить в PDF', `${safeUrl(ctx.receiptUrl)}${safeUrl(ctx.receiptUrl).includes('?') ? '&' : '?'}print=1`, { kind: 'soft', full: true })}</td></tr></table>
<p style="margin:6px 0 0;font:400 12px/18px ${FONT};color:${BRAND.muted};">Это подтверждение операции (квитанция Sky), а не кассовый чек: фискальный документ не формируется. Данные взяты из платёжной системы Sky на момент зачисления.</p>` : '';
  const html = shell({
    brand: 'SkyMoney', logoUrl: logoOf(ctx), title, preheader, hero,
    body: bodyWrap(`${hello}${paragraphs(content.body, v, 'money')}${details}${op}${receipt}`),
    footerHtml: footer({ links: linksOf(ctx), marketing: false, messageId: ctx.messageId || '—' }),
  });
  const text = [
    subst(title, v, 'money', 'text'), `+ ${v.amount} ${v.currency}`, '',
    v.username ? `Здравствуйте, ${v.username}!` : '',
    String(content.body ?? '').split('\n').map((l) => subst(l, v, 'money', 'text')).join('\n'), '',
    `Дата и время: ${v.transaction_date}`, `Номер операции: ${v.transaction_id}`, `Способ пополнения: ${v.payment_method}`,
    `Сумма: ${v.amount} ${v.currency}`, `Комиссия: ${v.commission}`, `Итого: ${v.total_amount}`, '',
    `Посмотреть операцию: ${safeUrl(ctx.operationUrl || ctx.appUrl)}`,
    safeUrl(ctx.receiptUrl) ? `Квитанция: ${safeUrl(ctx.receiptUrl)}\n(Это подтверждение операции Sky, а не кассовый чек.)` : '',
    '\n—\nSky — твоя экосистема.', 'Это служебное финансовое уведомление.',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { html, text, brand: 'SkyMoney', subject: subst(ctx.subject || title, v, 'money', 'text') };
};

/** Печатная квитанция (страница по защищённой ссылке; «Сохранить в PDF» — печать браузера). Только данные платёжной системы, без выдумок. */
export const renderReceiptPage = (r) => {
  const row = (k, v) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};text-align:right;font-weight:600;">${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Квитанция ${esc(r.number)}</title>
<style>body{margin:0;background:${BRAND.page};font-family:${FONT};color:${BRAND.ink}}.card{max-width:560px;margin:28px auto;background:#fff;border-radius:24px;padding:30px;box-shadow:0 6px 28px rgba(60,60,140,.10)}table{width:100%;border-collapse:collapse;font-size:14px}.btn{display:inline-block;margin-top:20px;padding:12px 22px;border-radius:14px;background:${BRAND.indigo};color:#fff;font-weight:700;border:0;font-size:15px;cursor:pointer}.note{margin-top:18px;font-size:12px;line-height:18px;color:${BRAND.muted}}@media print{body{background:#fff}.card{box-shadow:none;margin:0}.btn{display:none}}</style></head>
<body><div class="card"><div style="font-weight:800;font-size:20px">Sky <span style="color:${BRAND.muted};font-weight:600;font-size:14px">· SkyMoney</span></div>
<h1 style="font-size:22px;margin:18px 0 4px">Квитанция о пополнении</h1><div style="color:${BRAND.muted};font-size:13px;margin-bottom:14px">№ ${esc(r.number)}</div>
<div style="font-size:34px;font-weight:800;margin:6px 0 14px">+ ${esc(r.amount)} ${esc(r.currency)}</div>
<table>${row('Статус', r.status)}${row('Дата и время зачисления', r.date)}${row('Способ пополнения', r.method)}${row('Сумма', `${r.amount} ${r.currency}`)}${row('Комиссия', r.commission)}${row('Итого', r.total)}</table>
<button class="btn" onclick="window.print()">Сохранить в PDF / Печать</button>
<div class="note">Это подтверждение операции (квитанция Sky), а не кассовый чек: фискальный документ не формируется. Данные взяты из платёжной системы Sky. Ссылка защищена и действует только для этой операции.</div></div>
${r.autoPrint ? '<script>setTimeout(function(){window.print()},400)</script>' : ''}</body></html>`;
};

/** Страница отписки от рекламных рассылок. */
export const renderUnsubPage = ({ token, done, error }) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Рассылки Sky</title>
<style>body{margin:0;background:${BRAND.page};font-family:${FONT};color:${BRAND.ink}}.card{max-width:460px;margin:60px auto;background:#fff;border-radius:24px;padding:30px;box-shadow:0 6px 28px rgba(60,60,140,.10);text-align:center}.btn{padding:13px 24px;border-radius:14px;background:${BRAND.indigo};color:#fff;font-weight:700;border:0;font-size:15px;cursor:pointer}p{line-height:22px;color:${BRAND.muted};font-size:14px}</style></head>
<body><div class="card"><div style="font-weight:800;font-size:22px">Sky</div>
${error ? '<h1 style="font-size:20px">Ссылка недействительна</h1><p>Откройте письмо ещё раз или управляйте рассылками в настройках Sky.</p>'
  : done ? '<h1 style="font-size:20px">Вы отписаны</h1><p>Рекламные рассылки Sky вам больше не придут. Служебные письма — о входе, подписках и пополнениях — продолжат приходить: они нужны для безопасности аккаунта.</p>'
  : `<h1 style="font-size:20px">Отписаться от рассылок Sky?</h1><p>Вы перестанете получать новости и предложения. Служебные и финансовые письма останутся.</p><form method="post" action="/api/email/unsubscribe"><input type="hidden" name="t" value="${esc(token)}"><button class="btn" type="submit">Отписаться</button></form>`}
</div></body></html>`;

/* ─── Шаблоны по умолчанию ─── */
export const DEFAULT_TEMPLATES = [
  { key: 'newsletter_default', kind: 'newsletter', name: 'Информационная рассылка', subject: 'Новости Sky', preheader: 'Что нового в экосистеме Sky',
    content: { label: 'Новости Sky', title: 'Что нового в Sky', subtitle: 'Коротко о главном за этот период', body: 'Мы продолжаем развивать экосистему: делаем сервисы быстрее, понятнее и безопаснее.\n\n• Новые возможности в приложении\n• Улучшения в уже знакомых разделах\n• Больше внимания к безопасности аккаунта',
      cards: [{ title: 'Новое', text: 'Расскажите здесь о новой функции или разделе.' }, { title: 'Улучшено', text: 'Опишите, что стало удобнее.' }], cta: { label: 'Открыть Sky', url: '' } }, auto: false },
  { key: 'prime_7d', kind: 'prime', name: 'Prime: за 7 дней до окончания', subject: 'Ваша подписка {subscription_name} закончится через {days_remaining}', preheader: 'Продлите заранее — доступ к сервисам не прервётся',
    content: { title: 'Подписка скоро закончится', subtitle: 'Продлите заранее, чтобы не потерять доступ', body: 'Подписка {subscription_name} действует до {expiration_date}. После этого закроются музыка, кино, подкасты, книги и режим «Код» в Sky AI.\n\nПродлить можно в любой момент — оставшиеся дни не сгорят, а прибавятся к новому сроку.', cta: { label: 'Продлить подписку', url: '' } }, auto: true },
  { key: 'prime_3d', kind: 'prime', name: 'Prime: за 3 дня', subject: '{subscription_name}: осталось {days_remaining}', preheader: 'Подписка закончится {expiration_date}',
    content: { title: 'Осталось всего несколько дней', subtitle: 'Не прерывайте доступ к Sky Prime', body: 'Подписка {subscription_name} закончится {expiration_date}. Продление занимает меньше минуты.', cta: { label: 'Продлить подписку', url: '' } }, auto: true },
  { key: 'prime_1d', kind: 'prime', name: 'Prime: за 1 день', subject: '{subscription_name} заканчивается завтра', preheader: 'Продлите, чтобы доступ не прервался',
    content: { title: 'Подписка заканчивается завтра', subtitle: 'Последний день перед окончанием', body: 'Завтра, {expiration_date}, закончится подписка {subscription_name}. Продлите её сейчас — и всё продолжит работать без пауз.', cta: { label: 'Продлить подписку', url: '' } }, auto: true },
  { key: 'prime_0d', kind: 'prime', name: 'Prime: в день окончания', subject: '{subscription_name} заканчивается сегодня', preheader: 'Продлите сегодня, чтобы сохранить доступ',
    content: { title: 'Подписка заканчивается сегодня', subtitle: 'Сегодня последний день', body: 'Подписка {subscription_name} действует до {expiration_date}. Продлите её, чтобы сохранить доступ к сервисам Sky Prime.', cta: { label: 'Продлить подписку', url: '' } }, auto: true },
  { key: 'prime_renewed', kind: 'prime', name: 'Prime: продление подтверждено', subject: 'Подписка {subscription_name} продлена', preheader: 'Теперь она действует до {expiration_date}',
    content: { title: 'Подписка продлена', subtitle: 'Спасибо, что вы с нами', body: 'Подписка {subscription_name} успешно продлена и теперь действует до {expiration_date}. Мы сообщим заранее, когда будет пора продлевать снова.', cta: { label: '', url: '' } }, auto: true },
  { key: 'money_topup', kind: 'money', name: 'SkyMoney: пополнение', subject: 'Баланс пополнен на {amount} {currency}', preheader: 'Зачислено {amount} {currency}',
    content: { title: 'Баланс пополнен', body: 'Средства зачислены на ваш баланс SkyMoney. Подробности операции — ниже.' }, auto: true },
];

/* ─── Налоговые документы (Sky Tax): письмо покупателю и печатная страница ─── */
const DOC_TITLE = { fiscal_receipt: 'Кассовый чек', npd_receipt: 'Чек самозанятого', confirmation: 'Подтверждение операции', internal_receipt: 'Квитанция Sky' };
const PROV_NOTE = { provider: 'Документ сформирован через подключённую продавцом интеграцию и подтверждён ею.', manual: 'Номер документа внёс продавец вручную; Sky его не проверял.', internal: 'Внутренний документ Sky; фискальным чеком не является.' };
const money = (n) => `${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
export const taxDocTitle = (kind, op) => `${op === 'refund' ? 'Чек возврата' : DOC_TITLE[kind] ?? 'Документ'}`;

/** d: { kind, opKind, number, issuedAt, sellerName, sellerInn, amount, items:[{name,qty,price,amount}], provenance, url, fiscalSign, kindLabel } */
export const renderTaxDocMail = (d, ctx = {}) => {
  const title = `${taxDocTitle(d.kind, d.opKind)} № ${d.number}`;
  const rows = (d.items ?? []).map((i) => `<tr><td style="padding:9px 0;border-top:1px solid ${BRAND.line};font:400 14px/20px ${FONT};color:${BRAND.ink};">${esc(i.name)}${Number(i.qty) !== 1 ? ` × ${esc(i.qty)}` : ''}</td><td align="right" style="padding:9px 0;border-top:1px solid ${BRAND.line};font:600 14px/20px ${FONT};color:${BRAND.ink};">${esc(money(i.amount))}</td></tr>`).join('');
  const link = safeUrl(ctx.pageUrl) ? button('Открыть документ', ctx.pageUrl, { kind: 'primary', full: true }) : '';
  const official = safeUrl(d.url) ? `<p style="margin:12px 0 0;font:400 13px/19px ${FONT};color:${BRAND.muted};">Документ в системе оператора: <a href="${esc(safeUrl(d.url))}" style="color:${BRAND.indigo};">${esc(safeUrl(d.url))}</a></p>` : '';
  const html = shell({
    brand: 'Sky Tax', logoUrl: logoOf(ctx), title, preheader: `${money(d.amount)} · ${d.sellerName}`,
    hero: heroBlock({ title, subtitle: d.sellerName, accent: d.kindLabel ?? 'Чек', vars: {}, kind: 'money' }),
    body: bodyWrap(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px;"><tr><td style="font:400 14px/20px ${FONT};color:${BRAND.muted};">Дата</td><td align="right" style="font:600 14px/20px ${FONT};color:${BRAND.ink};">${esc(d.issuedAt)}</td></tr>
<tr><td style="padding-top:6px;font:400 14px/20px ${FONT};color:${BRAND.muted};">Продавец</td><td align="right" style="padding-top:6px;font:600 14px/20px ${FONT};color:${BRAND.ink};">${esc(d.sellerName)}${d.sellerInn ? `<br><span style="font-weight:400;color:${BRAND.muted};">ИНН ${esc(d.sellerInn)}</span>` : ''}</td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}<tr><td style="padding:12px 0 4px;border-top:2px solid ${BRAND.ink};font:800 16px/22px ${FONT};color:${BRAND.ink};">${d.opKind === 'refund' ? 'Возвращено' : 'Итого'}</td><td align="right" style="padding:12px 0 4px;border-top:2px solid ${BRAND.ink};font:800 16px/22px ${FONT};color:${BRAND.ink};">${esc(money(d.amount))}</td></tr></table>
<p style="margin:14px 0 14px;font:400 12px/18px ${FONT};color:${BRAND.muted};">${esc(PROV_NOTE[d.provenance] ?? '')}${d.fiscalSign ? ` Фискальный признак: ${esc(d.fiscalSign)}.` : ''}</p>${link}${official}`),
    footerHtml: footer({ links: linksOf(ctx), marketing: false, messageId: ctx.messageId || '—' }),
  });
  const text = [title, d.sellerName + (d.sellerInn ? `, ИНН ${d.sellerInn}` : ''), `Дата: ${d.issuedAt}`, '', ...(d.items ?? []).map((i) => `${i.name}${Number(i.qty) !== 1 ? ` × ${i.qty}` : ''}: ${money(i.amount)}`), `${d.opKind === 'refund' ? 'Возвращено' : 'Итого'}: ${money(d.amount)}`, '', PROV_NOTE[d.provenance] ?? '', safeUrl(ctx.pageUrl) ? `Документ: ${ctx.pageUrl}` : '', safeUrl(d.url) ? `У оператора: ${d.url}` : '', '', '—', 'Sky — твоя экосистема.'].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { html, text, brand: 'Sky Tax', subject: title };
};

export const renderTaxDocPage = (d) => {
  const row = (k, v) => `<tr><td style="padding:9px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.muted};">${esc(k)}</td><td style="padding:9px 0;border-bottom:1px solid ${BRAND.line};text-align:right;font-weight:600;">${v}</td></tr>`;
  const items = (d.items ?? []).map((i) => row(`${i.name}${Number(i.qty) !== 1 ? ` × ${i.qty}` : ''}`, esc(money(i.amount)))).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(taxDocTitle(d.kind, d.opKind))} ${esc(d.number)}</title>
<style>body{margin:0;background:${BRAND.page};font-family:${FONT};color:${BRAND.ink}}.card{max-width:560px;margin:28px auto;background:#fff;border-radius:24px;padding:30px;box-shadow:0 6px 28px rgba(60,60,140,.10)}table{width:100%;border-collapse:collapse;font-size:14px}.btn{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:14px;background:${BRAND.indigo};color:#fff;font-weight:700;border:0;font-size:15px;cursor:pointer}.note{margin-top:16px;font-size:12px;line-height:18px;color:${BRAND.muted}}@media print{body{background:#fff}.card{box-shadow:none;margin:0}.btn{display:none}}</style></head>
<body><div class="card"><div style="font-weight:800;font-size:20px">Sky <span style="color:${BRAND.muted};font-weight:600;font-size:14px">· Sky Tax</span></div>
<h1 style="font-size:22px;margin:16px 0 2px">${esc(taxDocTitle(d.kind, d.opKind))}</h1><div style="color:${BRAND.muted};font-size:13px;margin-bottom:12px">№ ${esc(d.number)} · ${esc(d.kindLabel ?? '')}</div>
<table>${row('Дата', esc(d.issuedAt))}${row('Продавец', esc(d.sellerName) + (d.sellerInn ? `<br><span style="font-weight:400;color:${BRAND.muted}">ИНН ${esc(d.sellerInn)}</span>` : ''))}${items}${row(d.opKind === 'refund' ? 'Возвращено' : 'Итого', `<b style="font-size:17px">${esc(money(d.amount))}</b>`)}${d.fiscalSign ? row('Фискальный признак', esc(d.fiscalSign)) : ''}</table>
${safeUrl(d.url) ? `<p class="note">Документ в системе оператора: <a href="${esc(safeUrl(d.url))}" rel="noopener noreferrer">${esc(safeUrl(d.url))}</a></p>` : ''}
<button class="btn" onclick="window.print()">Сохранить в PDF / Печать</button>
<div class="note">${esc(PROV_NOTE[d.provenance] ?? '')} Ссылка защищена и открывает только этот документ.</div></div></body></html>`;
};

/**
 * Вкладка «Email-коммуникации»: рассылки, письма Sky Prime и SkyMoney, шаблоны, адресная отправка, журнал, статистика, настройки.
 * Сервер — server/emailcomms.mjs (/api/admin/email*); отправка идёт через общую почтовую инфраструктуру Sky (notify.sendEmail).
 * Данные в письмах Prime/SkyMoney берёт только сервер из базы; предпросмотр этих писем — на примерных данных и так подписан.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Send, Eye, Smartphone, Monitor } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { ScrollTabs } from './ScrollTabs';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)' };
const A = '/api/admin/email';
const fld = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const inp = 'w-full rounded-xl px-3 py-2 text-sm';
const card = { background: C.l1, border: `1px solid ${C.brd}` };
const ERR: Record<string, string> = {
  not_allowed: 'Нет прав.', owner_only: 'Только владелец.', finance_required: 'Для писем Prime и SkyMoney нужно ещё право «Начисления».', bad_url: 'Ссылки — только https.', incomplete: 'Заполните тему и заголовок.', locked: 'Рассылку уже нельзя менять.',
  no_verified_email: 'У адресата нет подтверждённой почты.', hourly_limit: 'Достигнут предел адресных писем в час.', money_single_recipient: 'Письмо о пополнении — одному получателю.', too_many_requests: 'Слишком часто, подождите.',
  no_active_subscription: 'Нет действующей подписки.', lifetime: 'Подписка бессрочная.', expired: 'Подписка уже закончилась.', payment_not_credited: 'Платёж не найден или не зачислен.', not_found: 'Не найдено.', no_recipients: 'Выберите получателей.', bad_timezone: 'Неверный часовой пояс.', bad_rate: 'Неверное значение.',
};
const errText = (e?: string) => ERR[e ?? ''] ?? `Не получилось${e ? ` (${e})` : ''}`;

interface Content { label?: string; brand?: string; title?: string; subtitle?: string; body?: string; imageUrl?: string; cards?: { title: string; text: string }[]; cta?: { label: string; url: string }; hero?: string; emoji?: string; align?: 'left' | 'center'; customHtml?: string }
interface Tpl { key: string; kind: 'newsletter' | 'prime' | 'money'; name: string; subject: string; preheader: string; content: Content; enabled: boolean; auto: boolean }
interface Settings { timezone: string; primeAuto: boolean; moneyAuto: boolean; perMinute: number; supportUrl: string; privacyUrl: string; ofdTaxRatePct: number; ofdIncludeTopups: boolean }
interface Overview { settings: Settings; sender: { mode: string; from: string; configured: boolean }; templates: Tpl[]; stats: Stats; canFinance: boolean; isOwner: boolean }
interface Stats { rows: { kind: string; status: string; n: number }[]; byDay: { day: string; sent: number; failed: number }[]; unsubscribed: number }
interface Camp { id: string; name: string; subject: string; preheader: string; content: Content; audience: { mode: string; ids: string[] }; status: string; scheduled_at: string | null; total: number; sent: number; failed: number; skipped: number; pending: number; is_template: boolean; created_at: string }
interface UserHit { id: string; name: string; username: string; skyId: string; email: string; verified: boolean; prime: boolean }

const KIND_RU: Record<string, string> = { newsletter: 'Рассылка', prime: 'Sky Prime', money: 'SkyMoney' };
const STATUS_RU: Record<string, string> = { pending: 'Ожидает отправки', sending: 'Отправляется', sent: 'Отправлено', failed: 'Ошибка', skipped: 'Пропущено', draft: 'Черновик', scheduled: 'Запланирована', cancelled: 'Отменена' };
const REASON_RU: Record<string, string> = { unsubscribed: 'отписан от рассылок', no_verified_email: 'нет подтверждённой почты', no_active_subscription: 'подписка не активна', lifetime: 'подписка бессрочная', expired: 'подписка закончилась', subscription_changed: 'подписка изменилась', stale: 'письмо устарело', payment_not_credited: 'платёж не зачислен', template_disabled: 'шаблон выключен', cancelled: 'рассылка отменена', email_not_configured: 'почта не настроена', email_delivery_failed: 'почтовый сервер не принял письмо', profile_deleted: 'профиль удалён' };

const Btn = ({ children, onClick, disabled, kind = 'ghost' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; kind?: 'ghost' | 'main' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50" style={kind === 'main' ? { background: C.acc, color: '#fff' } : { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>{children}</button>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="mb-1 block text-xs" style={{ color: C.t3 }}>{label}</span>{children}</label>;

/* ─── предпросмотр ─── */
const Preview = ({ tplKey, content, subject, preheader }: { tplKey: string; content: Content; subject: string; preheader: string }) => {
  const [html, setHtml] = useState(''); const [example, setExample] = useState(false); const [device, setDevice] = useState<'m' | 'd'>('m'); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await apiCall<{ html: string; example: boolean }>(`${A}/preview`, { method: 'POST', body: JSON.stringify({ templateKey: tplKey, content, subject, preheader }) });
    setBusy(false);
    if (r.ok && r.data) { setHtml(r.data.html); setExample(r.data.example); } else flash(errText(r.error));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={run} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Предпросмотр</Btn>
        <Btn onClick={() => setDevice('m')} kind={device === 'm' ? 'main' : 'ghost'}><Smartphone size={13} /> Телефон</Btn>
        <Btn onClick={() => setDevice('d')} kind={device === 'd' ? 'main' : 'ghost'}><Monitor size={13} /> Компьютер</Btn>
      </div>
      {example && <p className="text-xs" style={{ color: C.t3 }}>Предпросмотр на примерных данных. В настоящем письме подставляются данные подписки или платежа из базы.</p>}
      {html && <div className="overflow-auto rounded-2xl" style={{ background: '#eef0f6', border: `1px solid ${C.brd}` }}><iframe title="Предпросмотр письма" sandbox="" srcDoc={html} className="mx-auto block bg-white" style={{ width: device === 'm' ? 375 : 680, maxWidth: '100%', height: 680, border: 0 }} /></div>}
    </div>
  );
};

/* ─── оформление шапки и своё оформление ─── */
const HEROES: { id: string; name: string; bg: string }[] = [
  { id: 'gradient', name: 'Sky', bg: 'linear-gradient(135deg,#4f6ef7,#8b5cf6)' }, { id: 'aurora', name: 'Северное сияние', bg: 'linear-gradient(135deg,#06b6d4,#3b82f6,#8b5cf6)' },
  { id: 'sunset', name: 'Закат', bg: 'linear-gradient(135deg,#f97316,#f43f5e,#d946ef)' }, { id: 'night', name: 'Ночь', bg: 'linear-gradient(135deg,#0f0c29,#302b63,#4a2fa8)' },
  { id: 'mint', name: 'Мята', bg: 'linear-gradient(135deg,#059669,#10b981,#2dd4bf)' }, { id: 'rose', name: 'Розовый', bg: 'linear-gradient(135deg,#ec4899,#a855f7)' },
  { id: 'gold', name: 'Золото', bg: 'linear-gradient(135deg,#f59e0b,#fde68a)' }, { id: 'light', name: 'Светлая', bg: '#eef0ff' }, { id: 'ink', name: 'Графит', bg: '#14142b' },
];
const SAMPLE_DESIGN = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f5fb;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr><td align="center" bgcolor="#4f46e5" style="background:#4f46e5;padding:32px 24px;color:#ffffff;">
{{logo}}
<div style="font-size:42px;">{{emoji}}</div>
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;">{{label}}</div>
<h1 style="margin:8px 0 0;font-size:28px;">{{title}}</h1>
<p style="margin:8px 0 0;font-size:16px;">{{subtitle}}</p>
</td></tr>
<tr><td style="padding:28px 32px;color:#14142b;font-size:15px;line-height:24px;">
<p>Здравствуйте, {{username}}!</p>
{{body}}
{{cards}}
{{cta}}
</td></tr>
</table>
{{footer}}
</td></tr></table></body></html>`;

const DesignEditor = ({ c, set }: { c: Content; set: (c: Content) => void }) => {
  const [err, setErr] = useState('');
  const upload = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (f.size > 200_000) { setErr('Файл больше 200 КБ'); return; }
    const t = await f.text();
    if (!/<[a-z!][\s\S]*>/i.test(t)) { setErr('В файле нет HTML-разметки'); return; }
    set({ ...c, customHtml: t });
  };
  const download = () => { const u = URL.createObjectURL(new Blob([SAMPLE_DESIGN], { type: 'text/html' })); const a = document.createElement('a'); a.href = u; a.download = 'sky-email-design.html'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
  return (
    <div className="space-y-3 rounded-2xl p-3" style={card}>
      <Field label="Название сервиса в логотипе и в имени отправителя (по теме письма)">
        <input className={inp} style={fld} list="email-brands" maxLength={24} value={c.brand ?? ''} onChange={(e) => set({ ...c, brand: e.target.value })} placeholder="Sky" />
        <datalist id="email-brands">{['Sky', 'Sky Prime', 'SkyMoney', 'Sky Music', 'Sky Film', 'Sky Video', 'Sky Market', 'Sky GO', 'Sky Games', 'Sky Business', 'Sky AI', 'Sky Gifts'].map((b) => <option key={b} value={b} />)}</datalist>
      </Field>
      <div>
        <span className="mb-1.5 block text-xs font-semibold" style={{ color: C.t2 }}>Оформление шапки</span>
        <div className="flex flex-wrap gap-2">
          {HEROES.map((h) => (
            <button key={h.id} type="button" onClick={() => set({ ...c, hero: h.id })} aria-pressed={(c.hero ?? 'gradient') === h.id} title={h.name}
              className="rounded-xl px-2 py-1.5 text-[11px] font-semibold"
              style={{ background: h.bg, color: ['light', 'gold'].includes(h.id) ? '#14142b' : '#fff', border: (c.hero ?? 'gradient') === h.id ? `2px solid ${C.acc}` : `1px solid ${C.brd}`, minWidth: 64 }}>{h.name}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Эмодзи над заголовком (необязательно)"><input className={inp} style={fld} maxLength={8} value={c.emoji ?? ''} onChange={(e) => set({ ...c, emoji: e.target.value })} placeholder="🎉" /></Field>
        <Field label="Выравнивание шапки">
          <div className="flex gap-2">
            <Btn onClick={() => set({ ...c, align: 'left' })} kind={(c.align ?? 'left') === 'left' ? 'main' : 'ghost'}>Слева</Btn>
            <Btn onClick={() => set({ ...c, align: 'center' })} kind={c.align === 'center' ? 'main' : 'ghost'}>По центру</Btn>
          </div>
        </Field>
      </div>
      <div className="space-y-1.5 border-t pt-3" style={{ borderColor: C.brd }}>
        <span className="block text-xs font-semibold" style={{ color: C.t2 }}>Своё оформление письма (HTML-файл)</span>
        <p className="text-xs" style={{ color: C.t3 }}>{`Загрузите готовую вёрстку письма. Подставляются места: {{title}} {{subtitle}} {{label}} {{emoji}} {{logo}} {{username}} {{body}} {{cards}} {{cta}} {{cta_url}} {{cta_label}} {{image_url}} {{app_url}} {{unsubscribe_url}} {{footer}}. Скрипты, формы, фреймы, обработчики событий, http-ссылки и внешние стили удаляются автоматически. Если в файле нет {{footer}}, ссылка «Отписаться» добавится внизу сама: в рекламном письме она обязательна. Размер до 200 КБ; письмо должно быть сверстано таблицами и со стилями внутри тегов — так оно одинаково выглядит в почтовых клиентах.`}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.acc, color: '#fff' }}>
            <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />Загрузить HTML
          </label>
          <Btn onClick={download}>Скачать пример</Btn>
          {c.customHtml && <Btn onClick={() => set({ ...c, customHtml: '' })}>Вернуть стандартное оформление</Btn>}
        </div>
        {c.customHtml && <p className="text-xs" style={{ color: C.t2 }}>{`Загружено своё оформление (${Math.round(c.customHtml.length / 1024)} КБ). Оформление шапки выше в этом случае не используется.`}</p>}
        {err && <p className="text-xs" style={{ color: '#ef4444' }}>{err}</p>}
      </div>
    </div>
  );
};

/* ─── редактор содержимого ─── */
const ContentEditor = ({ c, set, vars }: { c: Content; set: (c: Content) => void; vars?: string[] }) => {
  const cards = [c.cards?.[0] ?? { title: '', text: '' }, c.cards?.[1] ?? { title: '', text: '' }];
  const setCard = (i: number, v: { title: string; text: string }) => { const n = [...cards]; n[i] = v; set({ ...c, cards: n }); };
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Метка над заголовком"><input className={inp} style={fld} value={c.label ?? ''} onChange={(e) => set({ ...c, label: e.target.value })} /></Field>
        <Field label="Заголовок"><input className={inp} style={fld} value={c.title ?? ''} onChange={(e) => set({ ...c, title: e.target.value })} /></Field>
      </div>
      <Field label="Подзаголовок"><input className={inp} style={fld} value={c.subtitle ?? ''} onChange={(e) => set({ ...c, subtitle: e.target.value })} /></Field>
      {!vars && <DesignEditor c={c} set={set} />}
      <Field label="Текст (пустая строка — новый абзац; строки с «•» — список)"><textarea className={inp} style={fld} rows={6} value={c.body ?? ''} onChange={(e) => set({ ...c, body: e.target.value })} /></Field>
      {vars && <p className="text-xs" style={{ color: C.t3 }}>Переменные: {vars.map((v) => `{${v}}`).join(' ')}</p>}
      <Field label="Картинка-баннер (https, необязательно)"><input className={inp} style={fld} value={c.imageUrl ?? ''} onChange={(e) => set({ ...c, imageUrl: e.target.value })} placeholder="https://" /></Field>
      <div className="grid gap-2 sm:grid-cols-2">{cards.map((cd, i) => (
        <div key={i} className="space-y-1 rounded-xl p-2" style={card}>
          <input className={inp} style={fld} placeholder={`Карточка ${i + 1}: заголовок`} value={cd.title} onChange={(e) => setCard(i, { ...cd, title: e.target.value })} />
          <input className={inp} style={fld} placeholder="Текст" value={cd.text} onChange={(e) => setCard(i, { ...cd, text: e.target.value })} />
        </div>))}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Кнопка: текст (пусто — без кнопки)"><input className={inp} style={fld} value={c.cta?.label ?? ''} onChange={(e) => set({ ...c, cta: { label: e.target.value, url: c.cta?.url ?? '' } })} /></Field>
        {vars ? <p className="self-end text-xs" style={{ color: C.t3 }}>Ссылку кнопки подставляет сервер.</p> : <Field label="Кнопка: ссылка (https; пусто — открыть Sky)"><input className={inp} style={fld} value={c.cta?.url ?? ''} onChange={(e) => set({ ...c, cta: { label: c.cta?.label ?? '', url: e.target.value } })} /></Field>}
      </div>
    </div>
  );
};

/* ─── шаблон: правка, тест, вкл/выкл ─── */
const TemplateCard = ({ t, reload, vars }: { t: Tpl; reload: () => void; vars: string[] }) => {
  const [open, setOpen] = useState(false); const [c, setC] = useState<Content>(t.content); const [subject, setSubject] = useState(t.subject); const [pre, setPre] = useState(t.preheader); const [busy, setBusy] = useState(false);
  useEffect(() => { setC(t.content); setSubject(t.subject); setPre(t.preheader); }, [t]);
  const save = async (patch: Record<string, unknown>, msg = 'Сохранено') => { setBusy(true); const r = await apiCall(`${A}/templates/${t.key}`, { method: 'PUT', body: JSON.stringify(patch) }); setBusy(false); if (r.ok) { flash(msg); reload(); } else flash(errText(r.error)); };
  const test = async () => { setBusy(true); const r = await apiCall<{ to: string }>(`${A}/test`, { method: 'POST', body: JSON.stringify({ templateKey: t.key, content: c, subject, preheader: pre }) }); setBusy(false); flash(r.ok ? `Тестовое письмо отправлено на ${r.data?.to ?? 'вашу почту'}` : errText(r.error)); };
  return (
    <div className="rounded-2xl p-3" style={card}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}><div className="truncate text-sm font-semibold" style={{ color: C.t1 }}>{t.name}</div><div className="truncate text-xs" style={{ color: C.t3 }}>{t.key} · {t.enabled ? 'включён' : 'выключен'}{t.kind !== 'newsletter' ? ` · автоотправка ${t.auto ? 'вкл' : 'выкл'}` : ''}</div></button>
        <Btn onClick={() => save({ enabled: !t.enabled }, t.enabled ? 'Шаблон выключен' : 'Шаблон включён')} disabled={busy}>{t.enabled ? 'Выключить' : 'Включить'}</Btn>
        {t.kind !== 'newsletter' && <Btn onClick={() => save({ auto: !t.auto })} disabled={busy}>{t.auto ? 'Отключить автоотправку' : 'Включить автоотправку'}</Btn>}
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2"><Field label="Тема письма"><input className={inp} style={fld} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field><Field label="Прехедер (виден в списке писем)"><input className={inp} style={fld} value={pre} onChange={(e) => setPre(e.target.value)} /></Field></div>
          <ContentEditor c={c} set={setC} vars={t.kind === 'newsletter' ? undefined : vars} />
          <div className="flex flex-wrap gap-2"><Btn kind="main" onClick={() => save({ subject, preheader: pre, content: c })} disabled={busy}>Сохранить шаблон</Btn><Btn onClick={test} disabled={busy}><Send size={13} /> Тест на мою почту</Btn></div>
          <Preview tplKey={t.key} content={c} subject={subject} preheader={pre} />
        </div>
      )}
    </div>
  );
};

/* ─── адресная отправка ─── */
const SendPanel = ({ ov, kinds, reload }: { ov: Overview; kinds: ('newsletter' | 'prime' | 'money')[]; reload: () => void }) => {
  const [kind, setKind] = useState(kinds[0]); const [q, setQ] = useState(''); const [hits, setHits] = useState<UserHit[]>([]); const [sel, setSel] = useState<UserHit[]>([]);
  const tpls = ov.templates.filter((t) => t.kind === kind); const [tk, setTk] = useState(''); const [c, setC] = useState<Content>({ title: '', body: '' }); const [subject, setSubject] = useState('');
  const [info, setInfo] = useState<{ prime?: { active: boolean; lifetime?: boolean; daysLeft?: number }; payments?: { id: string; number: string; amount: number; currency: string; credited_at: string }[] } | null>(null); const [pay, setPay] = useState('');
  const [res, setRes] = useState<{ profileId: string; status: string; reason?: string }[] | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setTk(tpls.find((x) => x.key.includes('3d'))?.key ?? tpls[0]?.key ?? ''); }, [kind, ov.templates]); // eslint-disable-line react-hooks/exhaustive-deps
  const search = async () => { const r = await apiCall<{ users: UserHit[] }>(`${A}/users?q=${encodeURIComponent(q)}`); if (r.ok && r.data) setHits(r.data.users); else flash(errText(r.error)); };
  const pick = async (u: UserHit) => {
    if (kind === 'money') setSel([u]); else if (!sel.some((x) => x.id === u.id)) setSel([...sel, u]);
    if (kind !== 'newsletter') { const r = await apiCall<typeof info>(`${A}/user-info?id=${encodeURIComponent(u.id)}`); if (r.ok) setInfo(r.data ?? null); }
  };
  const send = async () => {
    setBusy(true); setRes(null);
    const r = await apiCall<{ results: { profileId: string; status: string; reason?: string }[] }>(`${A}/send`, { method: 'POST', body: JSON.stringify({ kind, templateKey: kind === 'newsletter' ? 'newsletter_default' : tk, profileIds: sel.map((x) => x.id), paymentId: kind === 'money' ? pay : undefined, content: kind === 'newsletter' ? c : undefined, subject: kind === 'newsletter' ? subject : undefined }) });
    setBusy(false);
    if (r.ok && r.data) { setRes(r.data.results); reload(); } else flash(errText(r.error));
  };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-3 text-xs leading-relaxed" style={{ ...card, color: C.t3 }}>
        Письмо уходит через общую почтовую очередь Sky. Для Sky Prime сервер сам проверяет актуальную подписку, для SkyMoney — только реальный зачисленный платёж из базы; вручную вписать сумму или «подтверждение» нельзя. Рекламные письма не отправляются тем, кто отписался.
      </div>
      <div className="flex flex-wrap gap-2">{kinds.map((k) => <Btn key={k} kind={kind === k ? 'main' : 'ghost'} onClick={() => { setKind(k); setSel([]); setInfo(null); setRes(null); }}>{KIND_RU[k]}</Btn>)}</div>
      <div className="flex gap-2"><input className={inp} style={fld} placeholder="Sky ID, имя, логин или почта" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /><Btn onClick={search}>Найти</Btn></div>
      {hits.length > 0 && <div className="space-y-1">{hits.map((u) => (
        <button key={u.id} type="button" onClick={() => pick(u)} className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs" style={card}>
          <span className="min-w-0 truncate" style={{ color: C.t1 }}><b>{u.name}</b> @{u.username} · {u.skyId}</span><span style={{ color: u.verified ? C.t3 : '#e5484d' }}>{u.email || 'нет почты'}{u.verified ? '' : ' (не подтверждена)'}{u.prime ? ' · Prime' : ''}</span>
        </button>))}</div>}
      {sel.length > 0 && <div className="flex flex-wrap gap-2">{sel.map((u) => <span key={u.id} className="rounded-full px-3 py-1 text-xs" style={card}>@{u.username} <button type="button" onClick={() => setSel(sel.filter((x) => x.id !== u.id))}>×</button></span>)}</div>}
      {kind === 'prime' && info?.prime && <p className="text-xs" style={{ color: C.t2 }}>{info.prime.active ? (info.prime.lifetime ? 'Подписка бессрочная — письмо о сроке не нужно.' : `Подписка активна, осталось дней: ${info.prime.daysLeft}.`) : 'Нет действующей подписки.'}</p>}
      {kind !== 'newsletter' && <Field label="Шаблон"><select className={inp} style={fld} value={tk} onChange={(e) => setTk(e.target.value)}>{tpls.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>}
      {kind === 'money' && <Field label="Зачисленное пополнение (из базы)"><select className={inp} style={fld} value={pay} onChange={(e) => setPay(e.target.value)}><option value="">— выберите —</option>{(info?.payments ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.amount} {p.currency} · {new Date(p.credited_at).toLocaleString('ru-RU')}</option>)}</select></Field>}
      {kind === 'newsletter' && <><Field label="Тема"><input className={inp} style={fld} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field><ContentEditor c={c} set={setC} /><Preview tplKey="newsletter_default" content={c} subject={subject} preheader="" /></>}
      <Btn kind="main" onClick={send} disabled={busy || !sel.length || (kind === 'money' && !pay)}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Отправить ({sel.length})</Btn>
      {res && <div className="space-y-1">{res.map((r, i) => <div key={i} className="rounded-xl px-3 py-1.5 text-xs" style={{ ...card, color: r.status === 'queued' ? C.t1 : '#e5484d' }}>{sel.find((x) => x.id === r.profileId)?.username ? `@${sel.find((x) => x.id === r.profileId)?.username}` : r.profileId}: {r.status === 'queued' ? 'поставлено в очередь' : r.status === 'duplicate' ? 'уже отправлялось только что' : errText(r.reason)}</div>)}</div>}
    </div>
  );
};

/* ─── рассылки ─── */
const Newsletters = ({ ov, reload }: { ov: Overview; reload: () => void }) => {
  const [list, setList] = useState<Camp[]>([]); const [cur, setCur] = useState<Camp | null>(null); const [count, setCount] = useState<number | null>(null); const [when, setWhen] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<{ campaigns: Camp[] }>(`${A}/campaigns`); if (r.ok && r.data) setList(r.data.campaigns); }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15_000); return () => clearInterval(t); }, [load]);
  const blank = (): Camp => ({ id: '', name: 'Новая рассылка', subject: '', preheader: '', content: { label: 'Новости Sky', title: '', body: '' }, audience: { mode: 'all', ids: [] }, status: 'draft', scheduled_at: null, total: 0, sent: 0, failed: 0, skipped: 0, pending: 0, is_template: false, created_at: '' });
  const save = async () => { if (!cur) return null; setBusy(true); const r = await apiCall<{ id: string }>(cur.id ? `${A}/campaigns/${cur.id}` : `${A}/campaigns`, { method: cur.id ? 'PUT' : 'POST', body: JSON.stringify({ name: cur.name, subject: cur.subject, preheader: cur.preheader, content: cur.content, audience: cur.audience, isTemplate: cur.is_template }) }); setBusy(false); if (!r.ok) { flash(errText(r.error)); return null; } flash('Сохранено'); const id = r.data?.id ?? cur.id; setCur({ ...cur, id }); await load(); return id; };
  const counted = async () => { if (!cur) return; const r = await apiCall<{ count: number }>(`${A}/audience`, { method: 'POST', body: JSON.stringify({ audience: cur.audience }) }); if (r.ok && r.data) setCount(r.data.count); };
  const sched = async () => { const id = await save(); if (!id) return; if (!window.confirm(`Отправить рассылку ${when ? 'в указанное время' : 'сейчас'}?`)) return; const r = await apiCall(`${A}/campaigns/${id}/schedule`, { method: 'POST', body: JSON.stringify({ at: when ? new Date(when).toISOString() : undefined }) }); if (r.ok) { flash('Рассылка запланирована'); setCur(null); await load(); } else flash(errText(r.error)); };
  const test = async () => { if (!cur) return; const r = await apiCall<{ to: string }>(`${A}/test`, { method: 'POST', body: JSON.stringify({ templateKey: 'newsletter_default', content: cur.content, subject: cur.subject, preheader: cur.preheader }) }); flash(r.ok ? `Тест отправлен на ${r.data?.to}` : errText(r.error)); };
  if (cur) {
    const editable = ['draft', 'scheduled'].includes(cur.status);
    return (
      <div className="space-y-3">
        <Btn onClick={() => { setCur(null); setCount(null); }}>← К списку</Btn>
        <div className="grid gap-2 sm:grid-cols-2"><Field label="Название (внутреннее)"><input className={inp} style={fld} value={cur.name} disabled={!editable} onChange={(e) => setCur({ ...cur, name: e.target.value })} /></Field><Field label="Тема письма"><input className={inp} style={fld} value={cur.subject} disabled={!editable} onChange={(e) => setCur({ ...cur, subject: e.target.value })} /></Field></div>
        <Field label="Прехедер"><input className={inp} style={fld} value={cur.preheader} disabled={!editable} onChange={(e) => setCur({ ...cur, preheader: e.target.value })} /></Field>
        <ContentEditor c={cur.content} set={(content) => setCur({ ...cur, content })} />
        <div className="grid items-end gap-2 sm:grid-cols-3">
          <Field label="Кому"><select className={inp} style={fld} value={cur.audience.mode} onChange={(e) => { setCur({ ...cur, audience: { ...cur.audience, mode: e.target.value } }); setCount(null); }}><option value="all">Всем с подтверждённой почтой</option><option value="prime">Только с Sky Prime</option><option value="nonprime">Без Sky Prime</option><option value="list">По списку профилей</option></select></Field>
          <Btn onClick={counted}>Посчитать получателей{count != null ? `: ${count}` : ''}</Btn>
          <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={cur.is_template} onChange={(e) => setCur({ ...cur, is_template: e.target.checked })} /> Сохранить как шаблон рассылки</label>
        </div>
        {cur.audience.mode === 'list' && <Field label="ID профилей через запятую"><input className={inp} style={fld} value={cur.audience.ids.join(',')} onChange={(e) => setCur({ ...cur, audience: { ...cur.audience, ids: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} /></Field>}
        <p className="text-xs" style={{ color: C.t3 }}>Получат только люди с подтверждённой почтой, не отписавшиеся от рекламных рассылок. В каждом письме есть ссылка «Отписаться».</p>
        <Preview tplKey="newsletter_default" content={cur.content} subject={cur.subject} preheader={cur.preheader} />
        {editable ? (
          <div className="flex flex-wrap items-end gap-2"><Btn onClick={save} disabled={busy}>Сохранить черновик</Btn><Btn onClick={test}><Send size={13} /> Тест на мою почту</Btn><Field label="Когда (пусто — сразу)"><input type="datetime-local" className={inp} style={fld} value={when} onChange={(e) => setWhen(e.target.value)} /></Field><Btn kind="main" onClick={sched} disabled={busy}>Отправить рассылку</Btn></div>
        ) : <p className="text-xs" style={{ color: C.t3 }}>Статус: {STATUS_RU[cur.status]} · получателей {cur.total}, отправлено {cur.sent}, ошибок {cur.failed}, пропущено {cur.skipped}, в очереди {cur.pending}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Btn kind="main" onClick={() => setCur(blank())}>+ Новая рассылка</Btn>
      {!list.length && <p className="text-sm" style={{ color: C.t3 }}>Рассылок пока нет.</p>}
      {list.map((c) => (
        <div key={c.id} className="rounded-2xl p-3" style={card}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCur(c)}><div className="truncate text-sm font-semibold" style={{ color: C.t1 }}>{c.name}{c.is_template ? ' · шаблон' : ''}</div><div className="text-xs" style={{ color: C.t3 }}>{STATUS_RU[c.status]}{c.scheduled_at ? ` · ${new Date(c.scheduled_at).toLocaleString('ru-RU')}` : ''} · получателей {c.total} · отправлено {c.sent} · ошибок {c.failed} · пропущено {c.skipped}{c.pending ? ` · в очереди ${c.pending}` : ''}</div></button>
            {['scheduled', 'sending'].includes(c.status) && <Btn onClick={async () => { if (!window.confirm('Отменить рассылку? Неотправленные письма будут пропущены.')) return; const r = await apiCall(`${A}/campaigns/${c.id}/cancel`, { method: 'POST', body: '{}' }); flash(r.ok ? 'Отменено' : errText(r.error)); await load(); }}>Отменить</Btn>}
            {['draft', 'cancelled'].includes(c.status) && <Btn onClick={async () => { const r = await apiCall(`${A}/campaigns/${c.id}`, { method: 'DELETE' }); flash(r.ok ? 'Удалено' : errText(r.error)); await load(); }}>Удалить</Btn>}
            <Btn onClick={() => setCur({ ...c, id: '', status: 'draft', name: `${c.name} (копия)`, total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 })}>Дублировать</Btn>
          </div>
        </div>))}
      <p className="text-xs" style={{ color: C.t3 }}>Всего отписалось от рекламных рассылок: {ov.stats.unsubscribed}.</p>
    </div>
  );
};

/* ─── журнал ─── */
interface J { id: string; message_id: string; kind: string; template_key: string; profile_id: string; sky_id: string; email_mask: string; subject: string; status: string; attempts: number; last_error: string; manual: boolean; is_test: boolean; created_at: string; sent_at: string | null; username: string | null; admin_username: string | null }
const Journal = () => {
  const [items, setItems] = useState<J[]>([]); const [kind, setKind] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ items: J[] }>(`${A}/journal?kind=${kind}&status=${status}&q=${encodeURIComponent(q)}&limit=150`); if (r.ok && r.data) setItems(r.data.items); }, [kind, status, q]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select className="rounded-xl px-3 py-2 text-xs" style={fld} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Все типы</option>{Object.entries(KIND_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="rounded-xl px-3 py-2 text-xs" style={fld} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{['pending', 'sending', 'sent', 'failed', 'skipped'].map((s) => <option key={s} value={s}>{STATUS_RU[s]}</option>)}</select>
        <input className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs" style={fld} placeholder="Sky ID, логин, номер письма" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn onClick={load}>Обновить</Btn>
      </div>
      <div className="overflow-x-auto rounded-2xl" style={card}>
        <table className="w-full min-w-[820px] text-left text-xs" style={{ color: C.t1 }}>
          <thead style={{ color: C.t3 }}><tr>{['Дата', 'Получатель', 'Sky ID', 'Почта', 'Тип', 'Кто отправил', 'Статус'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{items.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: C.brd }}>
              <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString('ru-RU')}</td>
              <td className="px-3 py-2">{r.username ? `@${r.username}` : '—'}</td><td className="px-3 py-2">{r.sky_id}</td><td className="px-3 py-2">{r.email_mask}</td>
              <td className="px-3 py-2">{KIND_RU[r.kind]}{r.is_test ? ' (тест)' : ''}<div style={{ color: C.t3 }}>{r.template_key}</div></td>
              <td className="px-3 py-2">{r.manual ? (r.admin_username ? `@${r.admin_username}` : 'администратор') : 'автоматически'}</td>
              <td className="px-3 py-2"><b style={{ color: r.status === 'failed' ? '#e5484d' : C.t1 }}>{STATUS_RU[r.status]}</b>{r.last_error ? <div style={{ color: C.t3 }}>{REASON_RU[r.last_error] ?? r.last_error}</div> : null}{r.attempts > 0 && r.status !== 'sent' ? <div style={{ color: C.t3 }}>попыток: {r.attempts}</div> : null}</td>
            </tr>))}</tbody>
        </table>
        {!items.length && <p className="p-4 text-sm" style={{ color: C.t3 }}>Записей нет.</p>}
      </div>
    </div>
  );
};

/* ─── статистика ─── */
const StatsView = ({ s }: { s: Stats }) => {
  const sum = (k: string, st: string) => s.rows.find((r) => r.kind === k && r.status === st)?.n ?? 0;
  const max = Math.max(1, ...s.byDay.map((d) => d.sent + d.failed));
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: C.t3 }}>За 30 дней, без тестовых писем. «Открытия» и «клики» Sky не считает: для этого нужны трекинг-пиксели и переписанные ссылки, а это вопрос приватности — решение за владельцем.</p>
      <div className="grid gap-2 sm:grid-cols-3">{(['newsletter', 'prime', 'money'] as const).map((k) => (
        <div key={k} className="rounded-2xl p-3" style={card}><div className="text-sm font-semibold" style={{ color: C.t1 }}>{KIND_RU[k]}</div><div className="mt-1 text-xs leading-6" style={{ color: C.t2 }}>Отправлено: <b>{sum(k, 'sent')}</b><br />Ошибок: <b style={{ color: sum(k, 'failed') ? '#e5484d' : undefined }}>{sum(k, 'failed')}</b><br />Пропущено: {sum(k, 'skipped')}<br />В очереди: {sum(k, 'pending') + sum(k, 'sending')}</div></div>))}</div>
      <div className="rounded-2xl p-3" style={card}><div className="mb-2 text-sm font-semibold" style={{ color: C.t1 }}>Отправки по дням (14 дней)</div>
        <div className="flex h-24 items-end gap-1">{s.byDay.map((d) => <div key={d.day} title={`${d.day}: отправлено ${d.sent}, ошибок ${d.failed}`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, ((d.sent + d.failed) / max) * 100)}%`, background: d.failed ? '#e5484d' : C.acc }} />)}{!s.byDay.length && <span className="text-xs" style={{ color: C.t3 }}>Данных пока нет.</span>}</div></div>
      <p className="text-xs" style={{ color: C.t3 }}>Отписались от рекламных рассылок: {s.unsubscribed}.</p>
    </div>
  );
};

/* ─── настройки ─── */
const SettingsView = ({ ov, reload }: { ov: Overview; reload: () => void }) => {
  const [s, setS] = useState(ov.settings); const [busy, setBusy] = useState(false);
  useEffect(() => setS(ov.settings), [ov.settings]);
  const save = async (patch: Partial<Settings>) => { setBusy(true); const r = await apiCall(`${A}/settings`, { method: 'PUT', body: JSON.stringify(patch) }); setBusy(false); if (r.ok) { flash('Сохранено'); reload(); } else flash(errText(r.error)); };
  const own = ov.isOwner;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-3 text-xs leading-relaxed" style={card}>
        <div className="mb-1 text-sm font-semibold" style={{ color: C.t1 }}>Отправитель</div>
        <div style={{ color: C.t2 }}>Режим: <b>{ov.sender.mode}</b> · Адрес «От»: <b>{ov.sender.from || 'не задан'}</b> · {ov.sender.configured ? 'почта настроена' : 'почта НЕ настроена — письма не уходят (проверьте scripts/set-email.sh)'}</div>
        <div className="mt-1" style={{ color: C.t3 }}>Адрес, домен и подписи SPF/DKIM/DMARC задаются у почтового провайдера и в .env — отдельного почтового механизма у email-коммуникаций нет, они работают через ту же отправку, что и коды входа.</div>
      </div>
      <div className="rounded-2xl p-3 space-y-2" style={card}>
        <div className="text-sm font-semibold" style={{ color: C.t1 }}>Автоматические письма (только владелец)</div>
        <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" disabled={!own || busy} checked={s.primeAuto} onChange={(e) => save({ primeAuto: e.target.checked })} /> Напоминания о Sky Prime (за 7, 3, 1 день и в день окончания) и подтверждение продления</label>
        <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" disabled={!own || busy} checked={s.moneyAuto} onChange={(e) => save({ moneyAuto: e.target.checked })} /> Уведомления о пополнении SkyMoney (только пополнения, зачисленные ПОСЛЕ включения)</label>
        <p className="text-xs" style={{ color: C.t3 }}>Перед каждой отправкой сервер заново проверяет подписку или платёж; устаревшее и повторное письмо не уходит. При первом включении напоминания о Prime получат все, у кого срок попадает в окно 7 дней.</p>
      </div>
      <div className="rounded-2xl p-3 grid gap-2 sm:grid-cols-2" style={card}>
        <Field label="Часовой пояс для дат и «дней до окончания»"><input className={inp} style={fld} value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} /></Field>
        <Field label="Писем в минуту (предел очереди)"><input type="number" className={inp} style={fld} value={s.perMinute} onChange={(e) => setS({ ...s, perMinute: Number(e.target.value) })} /></Field>
        <Field label="Ссылка «Поддержка» в письмах (https, пусто — внутри Sky)"><input className={inp} style={fld} value={s.supportUrl} onChange={(e) => setS({ ...s, supportUrl: e.target.value })} /></Field>
        <Field label="Ссылка «Политика конфиденциальности» (https, пусто — внутри Sky)"><input className={inp} style={fld} value={s.privacyUrl} onChange={(e) => setS({ ...s, privacyUrl: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Btn kind="main" disabled={busy} onClick={() => save({ timezone: s.timezone, perMinute: s.perMinute, supportUrl: s.supportUrl, privacyUrl: s.privacyUrl })}>Сохранить</Btn></div>
      </div>
    </div>
  );
};

/* ─── вкладка ─── */
type Sec = 'news' | 'prime' | 'money' | 'tpl' | 'send' | 'journal' | 'stats' | 'settings';
export const EmailTab = () => {
  const [ov, setOv] = useState<Overview | null>(null); const [sec, setSec] = useState<Sec>('news'); const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await apiCall<Overview>(`${A}/overview`); if (r.ok && r.data) { setOv(r.data); setErr(''); } else setErr(errText(r.error)); }, []);
  useEffect(() => { void load(); }, [load]);
  const secs = useMemo(() => [['news', 'Информационные рассылки'], ['prime', 'Sky Prime'], ['money', 'SkyMoney'], ['tpl', 'Шаблоны писем'], ['send', 'Адресная отправка'], ['journal', 'История отправок'], ['stats', 'Статистика'], ['settings', 'Настройки отправителя']] as [Sec, string][], []);
  if (!ov) return <div className="grid place-items-center py-10">{err ? <p style={{ color: C.t3 }}>{err}</p> : <Loader2 className="animate-spin" size={20} />}</div>;
  const kinds = (ov.canFinance ? ['newsletter', 'prime', 'money'] : ['newsletter']) as ('newsletter' | 'prime' | 'money')[];
  const byKind = (k: string) => ov.templates.filter((t) => t.kind === k);
  const vars: Record<string, string[]> = { prime: ['username', 'subscription_name', 'expiration_date', 'days_remaining', 'renewal_amount', 'renewal_link'], money: ['username', 'amount', 'currency', 'transaction_id', 'payment_method', 'commission', 'total_amount', 'transaction_date'] };
  return (
    <div className="space-y-3">
      <ScrollTabs>{secs.map(([k, l]) => <button key={k} type="button" onClick={() => setSec(k)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold" style={sec === k ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{l}</button>)}</ScrollTabs>
      {sec === 'news' && <Newsletters ov={ov} reload={load} />}
      {(sec === 'prime' || sec === 'money') && <div className="space-y-2">
        <p className="rounded-2xl p-3 text-xs leading-relaxed" style={{ ...card, color: C.t3 }}>{sec === 'prime' ? 'Служебные письма о подписке: приходят независимо от настроек рассылок. Автоотправка: ' : 'Служебные финансовые письма: уходят только после зачисления платежа. Квитанция — подтверждение операции Sky, не кассовый чек. Автоотправка: '}<b>{(sec === 'prime' ? ov.settings.primeAuto : ov.settings.moneyAuto) ? 'включена' : 'выключена'}</b> (включает владелец в «Настройках отправителя»).</p>
        {byKind(sec).map((t) => <TemplateCard key={t.key} t={t} reload={load} vars={vars[sec]} />)}</div>}
      {sec === 'tpl' && <div className="space-y-2">{ov.templates.map((t) => <TemplateCard key={t.key} t={t} reload={load} vars={vars[t.kind] ?? []} />)}</div>}
      {sec === 'send' && <SendPanel ov={ov} kinds={kinds} reload={load} />}
      {sec === 'journal' && <Journal />}
      {sec === 'stats' && <StatsView s={ov.stats} />}
      {sec === 'settings' && <SettingsView ov={ov} reload={load} />}
    </div>
  );
};

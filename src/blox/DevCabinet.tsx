/**
 * Кабинет разработчика Sky Blox: проекты, соединение с сервером,
 * плейсы, магазин, публикация, статистика и финансы.
 *
 * Разработчик видит и меняет только свои проекты; публиковать игру он
 * может лишь после одобрения модератором, а выплаты — это заявки, а не
 * автоматические переводы.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Eye, ImagePlus, Loader2, Plus, RefreshCw, Send, Trash2, Wrench } from 'lucide-react';
import { Alert, BloxImage, C, Field, StatusBadge, Spinner, errText, fmtDt, fmtN, glass, inputStyle } from './ui';
import {
  apiAddVersion, apiArchive, apiBecomeDeveloper, apiCheckConn, apiCreateGame, apiCreatePlace, apiCreateProduct, apiDeleteImage, apiDeveloper, apiDevReports,
  apiDevStats, apiDisconnect, apiFinance, apiHistoryOf, apiInfo, apiMyGame, apiMyGames, apiMyProducts, apiPayoutCancel, apiPayoutEvents,
  apiPayoutInfo, apiPayoutNow, apiPublish, apiRotateSecret, apiSubmit, apiUpdateGame, apiUpdatePlace, apiUpdateProduct, apiUploadImage, apiVersions, apiMyAppeals, apiAppeal,
  CATEGORY_LABEL, type Developer, type Finance, type Game, type Info, type Place, type Product, type Requisites,
} from './bloxApi';

/* ── Вход разработчика ───────────────────────────────────────────── */

const Onboarding = ({ info, onDone }: { info: Info | null; onDone: () => void }) => {
  const [name, setName] = useState('');
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    const r = await apiBecomeDeveloper(name.trim());
    setBusy(false);
    if (!r.ok) { setErr(errText(r)); return; }
    onDone();
  };
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <div className="rounded-3xl p-5" style={glass}>
        <p className="text-lg font-black" style={{ color: C.t1 }}>Разместите свою игру в Sky Blox</p>
        <p className="mt-1 text-[12px]" style={{ color: C.t2 }}>Игра работает на вашей инфраструктуре и открывается у игроков в изолированном окне. Sky не запускает ваш код на своих серверах и не пускает ваш сервер к данным пользователей.</p>
      </div>
      {info && (
        <div className="space-y-2 rounded-2xl p-4" style={glass}>
          <p className="text-[12px] font-bold" style={{ color: C.green }}>Что поддерживается</p>
          {info.supportedFormats.map((f) => <p key={f} className="text-[12px]" style={{ color: C.t2 }}>✓ {f}</p>)}
          <p className="pt-1 text-[12px] font-bold" style={{ color: C.red }}>Что не поддерживается</p>
          {info.unsupportedFormats.map((f) => <p key={f} className="text-[12px]" style={{ color: C.t2 }}>✕ {f}</p>)}
          <p className="pt-1 text-[11px]" style={{ color: C.t3 }}>Комиссия платформы с продаж: {info.commissionPercent}%. Вознаграждение удерживается {info.holdDays} дн., затем доступно для заявки на выплату (минимум {info.minPayoutPoints.toLocaleString('ru-RU')} баллов). Выплаты исполняются вручную после проверки; курса «баллы → рубли» платформа не задаёт.</p>
        </div>
      )}
      <Field label="Имя разработчика или студии"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full rounded-xl px-3 py-2 text-[13px]" style={inputStyle} /></Field>
      <label className="flex items-start gap-2 text-[12px]" style={{ color: C.t2 }}>
        <input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        Я принимаю условия разработчика Sky Blox: игры проходят модерацию, содержимое не нарушает законов и прав третьих лиц, секреты проекта я храню в тайне, а покупки и вознаграждения подчиняются правилам платформы.
      </label>
      {err && <Alert text={err} />}
      <button type="button" disabled={busy || !ok || name.trim().length < 2} onClick={() => void go()} className="w-full rounded-2xl py-3 text-[14px] font-black text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}>Стать разработчиком</button>
    </div>
  );
};

/* ── Картинки ────────────────────────────────────────────────────── */

const ImageManager = ({ type, id, coverId, shotIds, onChanged }: { type: 'game' | 'place'; id: string; coverId: string | null; shotIds: string[]; onChanged: () => void }) => {
  const cover = useRef<HTMLInputElement>(null); const shot = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const up = async (kind: 'cover' | 'shot', f?: File) => {
    if (!f) return;
    setBusy(true); setErr('');
    const r = await apiUploadImage(type, id, kind, f);
    setBusy(false);
    if (!r.ok) setErr(errText(r)); else onChanged();
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <BloxImage id={coverId} className="h-16 w-28 rounded-lg object-cover" />
        <button type="button" disabled={busy} onClick={() => cover.current?.click()} className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background: C.accBg, color: C.acc }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} {coverId ? 'Заменить обложку' : 'Загрузить обложку'}</button>
        <input ref={cover} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { void up('cover', e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {shotIds.map((s) => (
          <div key={s} className="relative"><BloxImage id={s} className="h-14 w-24 rounded-lg object-cover" />
            <button type="button" aria-label="Удалить" onClick={async () => { await apiDeleteImage(s); onChanged(); }} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-white" style={{ background: C.red }}><Trash2 size={10} /></button></div>
        ))}
        <button type="button" disabled={busy} onClick={() => shot.current?.click()} className="grid h-14 w-24 place-items-center rounded-lg text-[11px] font-semibold" style={{ ...glass, color: C.t3 }}><Plus size={14} /> скриншот</button>
        <input ref={shot} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { void up('shot', e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      <p className="text-[10px]" style={{ color: C.t3 }}>JPEG, PNG или WebP. Тип проверяется по содержимому файла.</p>
    </div>
  );
};

const SecretBox = ({ secret, keyId, onClose }: { secret: string; keyId: string; onClose: () => void }) => (
  <div className="space-y-2 rounded-2xl p-4" style={{ ...glass, border: `1px solid ${C.amber}` }}>
    <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Секретный ключ проекта</p>
    <p className="text-[11px]" style={{ color: C.amber }}>Он показан только сейчас. Храните его на сервере игры и никогда не кладите в код браузера: им подписываются запросы к Sky. Потеряли — выпустите новый (старый перестанет работать).</p>
    <p className="break-all rounded-lg p-2 font-mono text-[11px]" style={{ background: C.l1, color: C.t1, userSelect: 'all' }} translate="no">ID ключа: {keyId}{'\n'}Секрет: {secret}</p>
    <div className="flex gap-2">
      <button type="button" onClick={() => void navigator.clipboard?.writeText(secret)} className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}><Copy size={12} /> Копировать секрет</button>
      <button type="button" onClick={onClose} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: C.acc }}>Я сохранил(а)</button>
    </div>
  </div>
);

/* ── Редактор проекта ────────────────────────────────────────────── */

type Sec = 'main' | 'conn' | 'places' | 'shop' | 'publish';

const PlaceEditor = ({ gameId, place, onDone }: { gameId: string; place: Place | null; onDone: () => void }) => {
  const [title, setTitle] = useState(place?.title ?? '');
  const [description, setDescription] = useState(place?.description ?? '');
  const [entryPath, setEntryPath] = useState(place?.entryPath ?? '/');
  const [maxPlayers, setMaxPlayers] = useState(String(place?.maxPlayers ?? 1));
  const [minAge, setMinAge] = useState(String(place?.minAge ?? 0));
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [cur, setCur] = useState<Place | null>(place);

  const save = async () => {
    setErr(''); setMsg('');
    const body = { title, description, entryPath, maxPlayers: Number(maxPlayers) || 1, minAge: Number(minAge) || 0 };
    const r = cur ? await apiUpdatePlace(cur.id, body) : await apiCreatePlace(gameId, body);
    if (!r.ok) { setErr(errText(r)); return; }
    setCur(r.data.place);
    setMsg('recheck' in r.data && r.data.recheck ? 'Сохранено. Изменение затрагивает запуск — плейс отправлен на повторную проверку.' : 'Сохранено.');
  };
  const reload = async () => { if (!cur) return; const g = await apiMyGame(gameId); if (g.ok) setCur(g.data.game.places?.find((p) => p.id === cur.id) ?? cur); };
  const act = async (fn: () => Promise<{ ok: boolean; error?: string; reason?: string; data?: any }>) => { setErr(''); const r = await fn(); if (!r.ok) setErr(r.data?.blockers ? r.data.blockers.join(' ') : errText(r)); else { setMsg('Готово.'); await reload(); } };

  return (
    <div className="space-y-3 rounded-2xl p-4" style={glass}>
      <div className="flex items-center gap-2"><button type="button" onClick={onDone} aria-label="Назад" style={{ color: C.acc }}><ArrowLeft size={16} /></button><p className="text-[13px] font-bold" style={{ color: C.t1 }}>{cur ? 'Плейс' : 'Новый плейс'}</p><StatusBadge status={cur?.moderationStatus} /></div>
      <Field label="Название"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Описание"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={3000} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Путь запуска на сервере игры" hint="Только путь на вашем домене, например /arena?level=1. Другой адрес указать нельзя."><input value={entryPath} onChange={(e) => setEntryPath(e.target.value)} className="w-full rounded-xl px-3 py-2 font-mono text-[12px]" style={inputStyle} translate="no" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Максимум игроков"><input value={maxPlayers} inputMode="numeric" onChange={(e) => setMaxPlayers(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
        <Field label="Возраст от"><input value={minAge} inputMode="numeric" onChange={(e) => setMinAge(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      </div>
      {err && <Alert text={err} />}{msg && <Alert kind="info" text={msg} />}
      <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white" style={{ background: C.acc }}>Сохранить</button>
      {cur && (
        <>
          <ImageManager type="place" id={cur.id} coverId={cur.coverId} shotIds={cur.shotIds} onChanged={() => void reload()} />
          {cur.moderationReason && <p className="text-[12px]" style={{ color: C.t2 }} translate="no">Причина решения: {cur.moderationReason}</p>}
          <div className="flex flex-wrap gap-2">
            {['draft', 'needs_changes', 'hidden', 'archived'].includes(cur.moderationStatus ?? '') && <button type="button" onClick={() => void act(() => apiSubmit('place', cur.id))} className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background: C.accBg, color: C.acc }}><Send size={12} /> На проверку</button>}
            {cur.moderationStatus === 'approved' && <button type="button" onClick={() => void act(() => apiPublish('place', cur.id, true))} className="rounded-xl px-3 py-2 text-[12px] font-bold text-white" style={{ background: C.green }}>Опубликовать</button>}
            {cur.moderationStatus === 'published' && <button type="button" onClick={() => void act(() => apiPublish('place', cur.id, false))} className="rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Снять с публикации</button>}
            {cur.moderationStatus !== 'archived' && <button type="button" onClick={() => { if (window.confirm('Архивировать плейс? История решений сохранится.')) void act(() => apiArchive('place', cur.id)); }} className="rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.red }}>В архив</button>}
          </div>
          {cur.autoFindings && cur.autoFindings.length > 0 && <p className="text-[11px]" style={{ color: C.amber }}>Автоматическая проверка отметила: {cur.autoFindings.map((f) => f.message).join('; ')}. Модератор проверит вручную.</p>}
        </>
      )}
    </div>
  );
};

const ShopSection = ({ gameId }: { gameId: string }) => {
  const [items, setItems] = useState<Product[] | null>(null);
  const [f, setF] = useState({ sku: '', title: '', description: '', price: '', kind: 'consumable' });
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await apiMyProducts(gameId); setItems(r.ok ? r.data.items : []); }, [gameId]);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    setErr('');
    const r = await apiCreateProduct(gameId, { sku: f.sku.trim(), title: f.title.trim(), description: f.description.trim(), price: Number(f.price), kind: f.kind });
    if (!r.ok) { setErr(errText(r)); return; }
    setF({ sku: '', title: '', description: '', price: '', kind: 'consumable' }); void load();
  };
  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: C.t3 }}>Цены — в Prime Points (единая валюта Sky). Цену и выдачу определяет сервер Sky; игровой сервер не меняет баланс игрока — он создаёт запрос на покупку, игрок подтверждает оплату в Sky.</p>
      {items === null ? <Spinner /> : items.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Товаров пока нет.</p> : items.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-2xl p-3" style={glass}>
          <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{p.title}</p><p className="font-mono text-[10px]" style={{ color: C.t3 }} translate="no">{p.sku} · {p.kind === 'durable' ? 'постоянный' : 'расходуемый'}</p></div>
          <input defaultValue={p.price} inputMode="numeric" aria-label="Цена" className="w-24 rounded-lg px-2 py-1 text-right text-[12px]" style={inputStyle}
            onBlur={async (e) => { const n = Number(e.target.value); if (n === p.price) return; const r = await apiUpdateProduct(p.id, { price: n }); if (!r.ok) setErr(errText(r)); void load(); }} />
          <label className="flex items-center gap-1 text-[11px]" style={{ color: C.t2 }}><input type="checkbox" checked={p.active} onChange={async (e) => { await apiUpdateProduct(p.id, { active: e.target.checked }); void load(); }} /> активен</label>
        </div>
      ))}
      <div className="space-y-2 rounded-2xl p-3" style={glass}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Новый товар</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="SKU (латиница)"><input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toLowerCase() })} className="w-full rounded-xl px-3 py-2 font-mono text-[12px]" style={inputStyle} translate="no" /></Field>
          <Field label="Цена, баллы"><input value={f.price} inputMode="numeric" onChange={(e) => setF({ ...f, price: e.target.value.replace(/\D/g, '') })} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
        </div>
        <Field label="Название"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
        <Field label="Описание"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}><option value="consumable">Расходуемый (можно купить много раз)</option><option value="durable">Постоянный (покупается один раз)</option></select>
        {err && <Alert text={err} />}
        <button type="button" disabled={!f.sku || !f.title || !f.price} onClick={() => void add()} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Добавить товар</button>
      </div>
    </div>
  );
};

const ProjectEditor = ({ gameId, info, onBack, onOpenGame }: { gameId: string; info: Info | null; onBack: () => void; onOpenGame: (id: string) => void }) => {
  const [game, setGame] = useState<Game | null>(null);
  const [sec, setSec] = useState<Sec>('main');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [editPlace, setEditPlace] = useState<Place | 'new' | null>(null);
  const [secret, setSecret] = useState<{ secret: string; keyId: string } | null>(null);
  const [versions, setVersions] = useState<{ label: string; notes: string; at: string }[]>([]);
  const [verForm, setVerForm] = useState({ label: '', notes: '' });
  const [hist, setHist] = useState<{ action: string; reason: string; by: string; at: string; to: string | null }[]>([]);
  const [checking, setChecking] = useState(false);
  const [appeal, setAppeal] = useState('');
  const [f, setF] = useState({ title: '', description: '', category: 'other', hostingType: 'webhost', clientUrl: '', serverUrl: '' });

  const load = useCallback(async () => {
    const r = await apiMyGame(gameId);
    if (!r.ok) { setErr(errText(r)); return; }
    const g = r.data.game;
    setGame(g);
    setF({ title: g.title, description: g.description, category: g.category, hostingType: g.hostingType ?? 'webhost', clientUrl: g.clientUrl ?? '', serverUrl: g.serverUrl ?? '' });
    const [v, h] = await Promise.all([apiVersions(gameId), apiHistoryOf('game', gameId)]);
    if (v.ok) setVersions(v.data.items);
    if (h.ok) setHist(h.data.items);
  }, [gameId]);
  useEffect(() => { void load(); }, [load]);

  if (!game) return <Spinner />;
  const st = game.moderationStatus;

  const save = async () => {
    setErr(''); setMsg('');
    const r = await apiUpdateGame(gameId, f);
    if (!r.ok) { setErr(errText(r)); return; }
    setMsg(r.data.recheck ? 'Сохранено. Изменение затрагивает содержимое или безопасность — игра отправлена на повторную проверку и пока скрыта.' : 'Сохранено.');
    void load();
  };
  const check = async () => {
    setChecking(true); setErr('');
    const r = await apiCheckConn(gameId);
    setChecking(false);
    if (!r.ok) { setErr(errText(r)); return; }
    void load();
  };
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; reason?: string; data?: any }>, done: string) => {
    setErr(''); setMsg('');
    const r = await fn();
    if (!r.ok) { setErr(r.data?.blockers ? `Не готово: ${r.data.blockers.join(' ')}` : errText(r)); return; }
    setMsg(done); void load();
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2"><button type="button" onClick={onBack} aria-label="К проектам" style={{ color: C.acc }}><ArrowLeft size={18} /></button>
        <p className="flex-1 truncate text-[15px] font-black" style={{ color: C.t1 }} translate="no">{game.title}</p><StatusBadge status={st} />
        <button type="button" onClick={() => onOpenGame(gameId)} aria-label="Предпросмотр" className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2, color: C.t2 }}><Eye size={14} /></button></div>

      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['main', 'Основное'], ['conn', 'Сервер и соединение'], ['places', 'Плейсы'], ['shop', 'Магазин'], ['publish', 'Публикация']] as [Sec, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSec(k)} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: sec === k ? C.accBg : C.l2, color: sec === k ? C.acc : C.t3 }}>{l}</button>
        ))}
      </div>
      {err && <Alert text={err} />}{msg && <Alert kind="info" text={msg} />}
      {secret && <SecretBox secret={secret.secret} keyId={secret.keyId} onClose={() => setSecret(null)} />}

      {sec === 'main' && (
        <div className="space-y-3 rounded-2xl p-4" style={glass}>
          <Field label="Название"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} className="w-full rounded-xl px-3 py-2 text-[13px]" style={inputStyle} /></Field>
          <Field label="Описание" hint="Не короче 30 символов. Без ссылок-сокращателей и обещаний «бесплатных баллов».">
            <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={5} maxLength={4000} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
          <Field label="Категория"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white" style={{ background: C.acc }}>Сохранить</button>
          <ImageManager type="game" id={gameId} coverId={game.coverId} shotIds={game.shotIds} onChanged={() => void load()} />
          <div className="space-y-2 border-t pt-3" style={{ borderColor: C.brd }}>
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Версии · сейчас <span translate="no">{game.version}</span></p>
            <div className="flex gap-2"><input value={verForm.label} onChange={(e) => setVerForm({ ...verForm, label: e.target.value })} placeholder="1.1.0" className="w-28 rounded-xl px-3 py-2 font-mono text-[12px]" style={inputStyle} translate="no" /><input value={verForm.notes} onChange={(e) => setVerForm({ ...verForm, notes: e.target.value })} placeholder="Что изменилось" className="flex-1 rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
              <button type="button" disabled={!verForm.label} onClick={async () => { const r = await apiAddVersion(gameId, verForm.label, verForm.notes); if (!r.ok) setErr(errText(r)); else { setVerForm({ label: '', notes: '' }); void load(); } }} className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Выпустить</button></div>
            {versions.map((v, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}><span className="font-mono" translate="no">{v.label}</span> · {fmtDt(v.at)}{v.notes ? ` — ${v.notes}` : ''}</p>)}
            <p className="text-[10px]" style={{ color: C.t3 }}>Версия — запись для игроков и истории. Изменение адреса, описания или параметров запуска у опубликованной игры отправляет её на повторную проверку.</p>
          </div>
        </div>
      )}

      {sec === 'conn' && (
        <div className="space-y-3">
          <div className="space-y-3 rounded-2xl p-4" style={glass}>
            <Field label="Способ размещения"><select value={f.hostingType} onChange={(e) => setF({ ...f, hostingType: e.target.value })} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>{Object.entries(info?.hostingTypes ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Адрес игры (HTTPS)" hint="Страница, которая открывается у игрока в окне Sky. Без редиректов; X-Frame-Options не должен запрещать встраивание."><input value={f.clientUrl} onChange={(e) => setF({ ...f, clientUrl: e.target.value })} placeholder="https://game.example.com/" className="w-full rounded-xl px-3 py-2 font-mono text-[12px]" style={inputStyle} translate="no" /></Field>
            <Field label="Адрес игрового сервера (необязательно)" hint="HTTPS-сервис с ручкой GET /sky/health. Нужен для покупок и подписанных запросов к Sky."><input value={f.serverUrl} onChange={(e) => setF({ ...f, serverUrl: e.target.value })} placeholder="https://api.game.example.com/" className="w-full rounded-xl px-3 py-2 font-mono text-[12px]" style={inputStyle} translate="no" /></Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Сохранить настройки</button>
              <button type="button" disabled={checking} onClick={() => void check()} className="flex items-center gap-1 rounded-xl px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>{checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Проверить соединение</button>
              {game.serverUrl && <button type="button" onClick={() => { if (window.confirm('Отключить сервер? Игра будет снята с публикации до новой проверки.')) void run(() => apiDisconnect(gameId), 'Сервер отключён.'); }} className="rounded-xl px-4 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.red }}>Отключить сервер</button>}
            </div>
          </div>

          <div className="space-y-2 rounded-2xl p-4" style={glass}>
            <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Состояние: <span style={{ color: game.connStatus === 'ok' ? C.green : game.connStatus === 'failed' ? C.red : C.t3 }}>{{ ok: 'подключено', failed: 'ошибка', unconfigured: 'не проверялось', checking: 'проверяется' }[game.connStatus ?? 'unconfigured']}</span></p>
            {game.connCheckedAt && <p className="text-[11px]" style={{ color: C.t3 }}>Последняя проверка: {fmtDt(game.connCheckedAt)}</p>}
            {(game.connChecks ?? []).map((c, i) => (
              <div key={i} className="rounded-xl p-2 text-[12px]" style={{ background: C.l1 }}>
                <p style={{ color: c.ok ? C.green : C.red }}>{c.ok ? '✓' : '✕'} {c.message}</p>
                {c.fix && <p className="mt-0.5" style={{ color: C.t2 }}>Что сделать: {c.fix}</p>}
              </div>
            ))}
            {(game.advice ?? []).map((a) => <p key={a} className="text-[11px]" style={{ color: C.amber }}>• {a}</p>)}
            <p className="text-[10px]" style={{ color: C.t3 }}>Sky проверяет доступность и подпись сервера; код игры не запускается на серверах Sky, а адреса во внутренние сети отклоняются.</p>
          </div>

          <div className="space-y-2 rounded-2xl p-4" style={glass}>
            <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Ключ проекта</p>
            <p className="font-mono text-[11px]" style={{ color: C.t2 }} translate="no">ID: {game.keyId}</p>
            <button type="button" onClick={() => { if (window.confirm('Выпустить новый секрет? Старый перестанет работать.')) void apiRotateSecret(gameId).then((r) => { if (r.ok) setSecret({ secret: r.data.secret, keyId: r.data.keyId }); else setErr(errText(r)); }); }} className="rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Выпустить новый секрет</button>
          </div>
        </div>
      )}

      {sec === 'places' && (editPlace ? <PlaceEditor gameId={gameId} place={editPlace === 'new' ? null : editPlace} onDone={() => { setEditPlace(null); void load(); }} /> : (
        <div className="space-y-2">
          <button type="button" onClick={() => setEditPlace('new')} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold text-white" style={{ background: C.acc }}><Plus size={14} /> Новый плейс</button>
          {(game.places ?? []).length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Плейсов пока нет. Плейс — отдельная карта, режим или локация, которую игрок запускает.</p>}
          {(game.places ?? []).map((p) => (
            <button key={p.id} type="button" onClick={() => setEditPlace(p)} className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left" style={glass}>
              <BloxImage id={p.coverId} className="h-12 w-20 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{p.title}{p.isMain ? ' · главный' : ''}</p><p className="text-[10px]" style={{ color: C.t3 }}>запусков {fmtN(p.launches)}</p></div>
              <StatusBadge status={p.moderationStatus} />
            </button>
          ))}
        </div>
      ))}

      {sec === 'shop' && <ShopSection gameId={gameId} />}

      {sec === 'publish' && (
        <div className="space-y-3 rounded-2xl p-4" style={glass}>
          <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Статус: <StatusBadge status={st} /></p>
          {game.moderationReason && <p className="rounded-lg p-2 text-[12px]" style={{ background: C.l1, color: C.t1 }} translate="no">Причина решения: {game.moderationReason}</p>}
          <div className="space-y-1 text-[12px]" style={{ color: C.t2 }}>
            <p>{game.connStatus === 'ok' ? '✓' : '✕'} Соединение проверено</p><p>{game.coverId ? '✓' : '✕'} Обложка загружена</p><p>{game.description.trim().length >= 30 ? '✓' : '✕'} Описание заполнено</p>
            <p>{(game.places ?? []).some((p) => p.moderationStatus === 'published') ? '✓' : '✕'} Есть опубликованный плейс</p>
          </div>
          {(game.autoFindings ?? []).length > 0 && <p className="text-[11px]" style={{ color: C.amber }}>Автоматическая проверка отметила: {game.autoFindings!.map((x) => x.message).join('; ')}. Это подсказка модератору — решение принимает человек.</p>}
          <div className="flex flex-wrap gap-2">
            {['draft', 'needs_changes', 'hidden', 'archived'].includes(st ?? '') && <button type="button" onClick={() => void run(() => apiSubmit('game', gameId), 'Игра отправлена на проверку.')} className="flex items-center gap-1 rounded-xl px-4 py-2 text-[12px] font-bold text-white" style={{ background: C.acc }}><Send size={13} /> Отправить на проверку</button>}
            {st === 'approved' && <button type="button" onClick={() => void run(() => apiPublish('game', gameId, true), 'Игра опубликована.')} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white" style={{ background: C.green }}>Опубликовать</button>}
            {st === 'published' && <button type="button" onClick={() => void run(() => apiPublish('game', gameId, false), 'Игра снята с публикации.')} className="rounded-xl px-4 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Снять с публикации</button>}
            {st !== 'archived' && st !== 'blocked' && <button type="button" onClick={() => { if (window.confirm('Архивировать игру? Журнал решений сохранится.')) void run(() => apiArchive('game', gameId), 'Игра в архиве.'); }} className="rounded-xl px-4 py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.red }}>В архив</button>}
          </div>
          {['blocked', 'hidden', 'needs_changes'].includes(st ?? '') && (
            <div className="space-y-2"><p className="text-[12px] font-bold" style={{ color: C.t1 }}>Апелляция</p>
              <textarea value={appeal} onChange={(e) => setAppeal(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
              <button type="button" disabled={appeal.trim().length < 10} onClick={async () => { const r = await apiAppeal({ subjectType: 'game', subjectId: gameId, text: appeal }); setMsg(r.ok ? 'Апелляция отправлена: её рассмотрит другой модератор.' : errText(r)); }} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Подать апелляцию</button></div>
          )}
          <div className="space-y-1 border-t pt-3" style={{ borderColor: C.brd }}>
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История решений</p>
            {hist.map((h, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(h.at)} · {h.by === 'staff' ? 'модератор' : h.by === 'system' ? 'система' : 'вы'} · {h.action}{h.reason && <span style={{ color: C.t3 }} translate="no"> · {h.reason}</span>}</p>)}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Статистика и финансы ────────────────────────────────────────── */

const StatsTab = () => {
  const [d, setD] = useState<Awaited<ReturnType<typeof apiDevStats>> | null>(null);
  const [rep, setRep] = useState<Awaited<ReturnType<typeof apiDevReports>> | null>(null);
  const [ap, setAp] = useState<Awaited<ReturnType<typeof apiMyAppeals>> | null>(null);
  useEffect(() => { void apiDevStats().then(setD); void apiDevReports().then(setRep); void apiMyAppeals().then(setAp); }, []);
  if (!d) return <Spinner />;
  return (
    <div className="space-y-3 p-4">
      {d.ok && d.data.items.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Статистика появится после создания проекта.</p>}
      {d.ok && d.data.items.map((s) => (
        <div key={s.id} className="rounded-2xl p-3" style={glass}>
          <p className="text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{s.title}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {([['Запусков', s.launches], ['За 7 дней', s.launches7], ['Игроков', s.visitors], ['В избранном', s.favorites], ['Покупок', s.purchases], ['Баллов', s.points], ['Оценка', s.rating ?? '—'], ['Жалоб', s.reports], ['Подтверждено', s.reportsUpheld]] as [string, number | string][]).map(([l, v]) => (
              <div key={l}><p className="text-[15px] font-black" style={{ color: C.t1 }}>{typeof v === 'number' ? fmtN(v) : v}</p><p className="text-[10px]" style={{ color: C.t3 }}>{l}</p></div>
            ))}
          </div>
        </div>
      ))}
      {rep?.ok && rep.data.items.length > 0 && (
        <div className="space-y-1"><p className="text-[12px] font-bold" style={{ color: C.t1 }}>Жалобы на ваши проекты</p>
          {rep.data.items.map((r) => <p key={r.id} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(r.at)} · {r.reason} · {({ open: 'ждёт рассмотрения', in_review: 'на рассмотрении', upheld: 'подтверждена', dismissed: 'отклонена' } as Record<string, string>)[r.status] ?? r.status}{r.resolution && <span translate="no"> · {r.resolution}</span>}</p>)}</div>
      )}
      {ap?.ok && ap.data.items.length > 0 && (
        <div className="space-y-1"><p className="text-[12px] font-bold" style={{ color: C.t1 }}>Ваши апелляции</p>
          {ap.data.items.map((a) => <p key={a.id} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(a.at)} · {({ open: 'на рассмотрении', accepted: 'принята', rejected: 'отклонена' } as Record<string, string>)[a.status] ?? a.status}{a.decision && <span translate="no"> · {a.decision}</span>}</p>)}</div>
      )}
    </div>
  );
};

const PAYOUT_LABEL: Record<string, string> = { draft: 'Черновик', review: 'На рассмотрении', needs_info: 'Требуются уточнения', approved: 'Одобрена', processing: 'В обработке', paid: 'Выплачена', rejected: 'Отклонена', cancelled: 'Отменена' };

const FinanceTab = ({ info }: { info: Info | null }) => {
  const [fin, setFin] = useState<Finance | null>(null);
  const [amount, setAmount] = useState('');
  const [req, setReq] = useState<Requisites>({ method: '', holder: '', account: '', bank: '', note: '' });
  const [terms, setTerms] = useState(false);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [events, setEvents] = useState<{ action: string; to: string | null; comment: string; at: string }[]>([]);
  const load = useCallback(async () => { const r = await apiFinance(); if (r.ok) setFin(r.data); else setErr(errText(r)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!fin) return err ? <div className="p-4"><Alert text={err} /></div> : <Spinner />;
  const b = fin.balances;

  const submit = async () => {
    setErr(''); setMsg('');
    const key = `po-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const r = await apiPayoutNow({ amount: Number(amount), idempotencyKey: key, acceptTerms: terms });
    if (!r.ok) { setErr(errText(r)); void load(); return; }
    setMsg(`Выплачено: на ваш кошелёк зачислено ${r.data.payout.net.toLocaleString('ru-RU')} баллов, удержано ${r.data.payout.fee.toLocaleString('ru-RU')}.`); setAmount(''); setTerms(false); void load();
  };
  const feePct = fin.rules.payoutFeePercent;
  const amt = Number(amount) || 0; const feePreview = Math.round((amt * feePct) / 100);
  const Stat = ({ l, v, hint }: { l: string; v: number; hint?: string }) => <div className="rounded-2xl p-3" style={glass}><p className="text-lg font-black" style={{ color: C.t1 }}>{v.toLocaleString('ru-RU')}</p><p className="text-[11px]" style={{ color: C.t2 }}>{l}</p>{hint && <p className="text-[10px]" style={{ color: C.t3 }}>{hint}</p>}</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat l="Начислено" v={b.accrued} hint="за вычетом возвратов" />
        <Stat l="Комиссия платформы" v={b.commission} hint={`${fin.rules.commissionPercent}% от покупок`} />
        <Stat l="Удерживается" v={b.held} hint={`${fin.rules.holdDays} дн. после покупки`} />
        <Stat l="Доступно к выплате" v={b.available} />
        <Stat l="В заявках (резерв)" v={b.reserved} />
        <Stat l="Выплачено" v={b.paid} />
      </div>
      <p className="text-[11px]" style={{ color: C.t3 }}>Суммы в Prime Points. Выплата — это перевод доступного вознаграждения баллами на ваш кошелёк в Sky с удержанием {feePct}%. Деньги платформа не переводит и курс «баллы → рубли» не задаёт.</p>

      <div className="space-y-2 rounded-2xl p-4" style={glass}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Выплата баллами</p>
        {!fin.rules.payoutsEnabled && <Alert text="Выплаты сейчас выключены администрацией." />}
        <Field label={`Сумма, баллы (доступно ${b.available.toLocaleString('ru-RU')}, минимум ${fin.rules.minPayoutPoints.toLocaleString('ru-RU')})`}><input value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl px-3 py-2 text-[13px]" style={inputStyle} /></Field>
        {amt > 0 && <p className="text-[12px]" style={{ color: C.t2 }}>{`Удержание ${feePct}%: ${feePreview.toLocaleString('ru-RU')} · вы получите ${(amt - feePreview).toLocaleString('ru-RU')} баллов`}</p>}
        <label className="flex items-start gap-2 text-[12px]" style={{ color: C.t2 }}><input type="checkbox" className="mt-0.5" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> Я согласен(на) с удержанием при выплате и условиями разработчика. Выплата выполняется сразу и не отменяется.</label>
        {err && <Alert text={err} />}{msg && <Alert kind="info" text={msg} />}
        <button type="button" disabled={!terms || !amount || !fin.rules.payoutsEnabled} onClick={() => void submit()} className="rounded-xl px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Выплатить</button>
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>История выплат</p>
        {fin.payouts.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Выплат пока нет.</p>}
        {fin.payouts.map((p) => (
          <div key={p.id} className="space-y-2 rounded-2xl p-3" style={glass}>
            <div className="flex items-center gap-2"><div className="flex-1"><p className="text-[13px] font-semibold" style={{ color: C.t1 }}>{p.instant ? `${p.amount.toLocaleString('ru-RU')} баллов → ${p.net.toLocaleString('ru-RU')} на кошелёк (удержано ${p.fee.toLocaleString('ru-RU')}, ${p.feePercent}%)` : `${p.amount.toLocaleString('ru-RU')} баллов · …${p.requisitesTail}`}</p><p className="text-[11px]" style={{ color: C.t3 }}>{fmtDt(p.submittedAt ?? p.createdAt)}</p></div>
              <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: C.l2, color: p.status === 'paid' ? C.green : p.status === 'rejected' ? C.red : C.acc }}>{PAYOUT_LABEL[p.status] ?? p.status}</span></div>
            {p.adminComment && <p className="text-[12px]" style={{ color: C.t2 }} translate="no">Комментарий: {p.adminComment}</p>}
            {p.status === 'paid' && <p className="text-[11px]" style={{ color: C.green }}>Выплата зафиксирована {fmtDt(p.paidAt)} · <span translate="no">{p.paidRef}</span></p>}
            {p.status === 'needs_info' && <InfoForm id={p.id} onDone={() => void load()} />}
            <div className="flex gap-3">
              {['draft', 'review', 'needs_info'].includes(p.status) && <button type="button" onClick={async () => { const r = await apiPayoutCancel(p.id); if (!r.ok) setErr(errText(r)); void load(); }} className="text-[11px] font-semibold" style={{ color: C.red }}>Отменить</button>}
              <button type="button" onClick={async () => { if (open === p.id) { setOpen(null); return; } const r = await apiPayoutEvents(p.id); if (r.ok) setEvents(r.data.items); setOpen(p.id); }} className="text-[11px] font-semibold" style={{ color: C.acc }}>{open === p.id ? 'Скрыть историю' : 'История'}</button>
            </div>
            {open === p.id && events.map((e, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(e.at)} · {e.action}{e.comment && <span translate="no"> · {e.comment}</span>}</p>)}
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Начисления</p>
        {fin.earnings.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Начислений пока нет: они появляются после подтверждённых покупок игроков.</p>}
        {fin.earnings.map((e) => (
          <div key={e.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: C.l2 }}>
            <span className="flex-1 truncate" style={{ color: C.t2 }} translate="no">{e.gameTitle ?? '—'} · {e.note}</span>
            <span className="font-bold" style={{ color: e.amount < 0 ? C.red : C.t1 }}>{e.amount > 0 ? '+' : ''}{e.amount}</span>
            <span className="text-[10px]" style={{ color: e.held ? C.amber : C.green }}>{e.held ? `удержание до ${fmtDt(e.availableAt)}` : 'доступно'}</span>
          </div>
        ))}
      </div>
      {info && <p className="text-[10px]" style={{ color: C.t3 }}>Редакция условий: {info.termsVersion}.</p>}
    </div>
  );
};

const InfoForm = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const [r, setR] = useState<Requisites>({ method: '', holder: '', account: '' });
  const [err, setErr] = useState('');
  return (
    <div className="space-y-2 rounded-xl p-2" style={{ background: C.l1 }}>
      <p className="text-[11px] font-bold" style={{ color: C.amber }}>Сотрудник запросил уточнения. Введите реквизиты заново (сумма не меняется).</p>
      <input value={r.method} onChange={(e) => setR({ ...r, method: e.target.value })} placeholder="Способ" className="w-full rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} />
      <input value={r.holder} onChange={(e) => setR({ ...r, holder: e.target.value })} placeholder="Получатель" className="w-full rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} />
      <input value={r.account} onChange={(e) => setR({ ...r, account: e.target.value })} placeholder="Счёт / телефон" className="w-full rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} />
      {err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      <button type="button" onClick={async () => { const x = await apiPayoutInfo(id, r); if (!x.ok) setErr(errText(x)); else onDone(); }} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: C.acc }}>Отправить уточнения</button>
    </div>
  );
};

/* ── Документация для игр ────────────────────────────────────────── */

const DocsTab = ({ info }: { info: Info | null }) => (
  <div className="space-y-3 p-4 text-[12px]" style={{ color: C.t2 }}>
    <p className="text-[14px] font-black" style={{ color: C.t1 }}>Как подключить игру</p>
    <p><b>1. Страница игры.</b> HTTPS-страница на вашем хостинге. Она не должна запрещать встраивание (X-Frame-Options), а Content-Security-Policy: frame-ancestors должен разрешать {info?.publicOrigin || 'домен Sky'}.</p>
    <p><b>2. Рукопожатие в браузере.</b> Игра шлёт <code>window.parent.postMessage({'{'}source:'sky-blox', type:'hello'{'}'}, '*')</code> и получает <code>{'{'}source:'sky-host', type:'session', token, user, gameId, placeId{'}'}</code>. Токен живёт 2 минуты и одноразовый.</p>
    <p><b>3. Проверка токена на вашем сервере.</b> POST <code>/api/blox/server/session/verify</code> с телом <code>{'{'}"token":"…"{'}'}</code>. Ответ — псевдоним игрока <code>playerId</code> (профиль Sky не раскрывается).</p>
    <p><b>4. Подпись запросов.</b> Заголовки <code>X-Blox-Key</code> (ID ключа), <code>X-Blox-Ts</code> (мс), <code>X-Blox-Nonce</code> (случайная строка, одноразовая), <code>X-Blox-Sig</code> = hex(HMAC-SHA256(секрет, МЕТОД\nПУТЬ?ЗАПРОС\nTS\nNONCE\nsha256hex(тело))). Время ±120 с.</p>
    <p><b>5. Покупки.</b> <code>POST /api/blox/server/purchases</code> {'{'}playerId, sku, idempotencyKey{'}'} → запрос на покупку. Игрок подтверждает оплату в Sky. Результат: <code>GET /api/blox/server/purchases/:id</code>; выдали — <code>POST …/fulfill</code>; не смогли выдать — <code>POST …/fail</code> (баллы вернутся). Права: <code>POST /api/blox/server/entitlements/check</code> и <code>/consume</code>.</p>
    <p><b>6. Проверка здоровья.</b> <code>GET /sky/health</code> на вашем сервере с заголовком <code>X-Sky-Challenge</code> должен вернуть <code>{'{'}"ok":true,"protocol":1,"signature":hex(HMAC-SHA256(секрет, challenge)){'}'}</code>.</p>
    <p style={{ color: C.t3 }}>Секрет проекта показывается один раз при создании. Не кладите его в код браузера. Игровой сервер не может менять баланс игроков и не видит данные Sky.</p>
  </div>
);

/* ── Корень кабинета ─────────────────────────────────────────────── */

export const DevCabinet = ({ onOpenGame }: { onOpenGame: (id: string) => void }) => {
  const [dev, setDev] = useState<Developer | null | undefined>(undefined);
  const [info, setInfo] = useState<Info | null>(null);
  const [games, setGames] = useState<Game[] | null>(null);
  const [tab, setTab] = useState<'projects' | 'stats' | 'finance' | 'docs'>('projects');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ secret: string; keyId: string } | null>(null);
  const [f, setF] = useState({ title: '', description: '', category: 'other', hostingType: 'webhost', clientUrl: '' });
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [d, i] = await Promise.all([apiDeveloper(), apiInfo()]);
    if (i.ok) setInfo(i.data);
    setDev(d.ok ? d.data.developer : null);
    if (d.ok && d.data.developer) { const g = await apiMyGames(); setGames(g.ok ? g.data.items : []); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (dev === undefined) return <Spinner />;
  if (dev === null) return <Onboarding info={info} onDone={() => void load()} />;
  if (dev.status === 'suspended') return <div className="p-4"><Alert text={`Аккаунт разработчика приостановлен. ${dev.suspendReason ? `Причина: ${dev.suspendReason}` : ''}`} /></div>;
  if (open) return <ProjectEditor gameId={open} info={info} onBack={() => { setOpen(null); void load(); }} onOpenGame={onOpenGame} />;

  const create = async () => {
    setErr('');
    const r = await apiCreateGame({ title: f.title.trim(), description: f.description.trim(), category: f.category, hostingType: f.hostingType, clientUrl: f.clientUrl.trim() || undefined });
    if (!r.ok) { setErr(errText(r)); return; }
    setSecret({ secret: r.data.secret, keyId: r.data.game.keyId! });
    setCreating(false); setF({ title: '', description: '', category: 'other', hostingType: 'webhost', clientUrl: '' }); void load();
  };

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto px-4 pt-3" style={{ scrollbarWidth: 'none' }}>
        {([['projects', 'Проекты'], ['stats', 'Статистика'], ['finance', 'Финансы'], ['docs', 'Документация']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: tab === k ? C.accBg : C.l2, color: tab === k ? C.acc : C.t3 }}>{l}</button>
        ))}
      </div>
      {tab === 'stats' && <StatsTab />}
      {tab === 'finance' && <FinanceTab info={info} />}
      {tab === 'docs' && <DocsTab info={info} />}
      {tab === 'projects' && (
        <div className="space-y-3 p-4">
          {secret && <SecretBox secret={secret.secret} keyId={secret.keyId} onClose={() => setSecret(null)} />}
          {!creating ? (
            <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}><Plus size={15} /> Новый игровой проект</button>
          ) : (
            <div className="space-y-3 rounded-2xl p-4" style={glass}>
              <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Новый проект</p>
              <Field label="Название"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} className="w-full rounded-xl px-3 py-2 text-[13px]" style={inputStyle} /></Field>
              <Field label="Описание"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} maxLength={4000} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Категория"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Размещение"><select value={f.hostingType} onChange={(e) => setF({ ...f, hostingType: e.target.value })} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>{Object.entries(info?.hostingTypes ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              </div>
              <Field label="Адрес игры (HTTPS, можно позже)"><input value={f.clientUrl} onChange={(e) => setF({ ...f, clientUrl: e.target.value })} className="w-full rounded-xl px-3 py-2 font-mono text-[12px]" style={inputStyle} translate="no" /></Field>
              {err && <Alert text={err} />}
              <div className="flex gap-2"><button type="button" onClick={() => setCreating(false)} className="flex-1 rounded-xl py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button><button type="button" disabled={f.title.trim().length < 2} onClick={() => void create()} className="flex-1 rounded-xl py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Создать</button></div>
            </div>
          )}
          {games === null ? <Spinner /> : games.length === 0 && !creating ? <p className="py-6 text-center text-[12px]" style={{ color: C.t3 }}>Проектов пока нет. Создайте первый — после проверки он появится в каталоге.</p> : games.map((g) => (
            <button key={g.id} type="button" onClick={() => setOpen(g.id)} className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left" style={glass}>
              <BloxImage id={g.coverId} className="h-14 w-24 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{g.title}</p><p className="text-[10px]" style={{ color: C.t3 }}>{CATEGORY_LABEL[g.category]} · версия <span translate="no">{g.version}</span> · {g.connStatus === 'ok' ? 'сервер подключён' : 'соединение не проверено'}</p></div>
              <div className="flex flex-col items-end gap-1"><StatusBadge status={g.moderationStatus} /><Wrench size={12} style={{ color: C.t3 }} /></div>
            </button>
          ))}
          {info && <p className="text-[10px]" style={{ color: C.t3 }}><Check size={10} className="inline" /> Размещение: {Object.values(info.hostingTypes).join(' · ')}</p>}
        </div>
      )}
    </div>
  );
};

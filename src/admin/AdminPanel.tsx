/**
 * Панель администратора Sky.
 *
 * Через неё управляется вся экосистема, и относиться к ней как к
 * обычной странице нельзя. Поэтому здесь важно, чего экран НЕ делает:
 *
 *   — не решает, что человеку можно. Список прав приходит с сервера, и
 *     нарисованная кнопка ничего не разрешает: нажатие всё равно уйдёт
 *     на сервер, а тот спросит базу;
 *   — не выполняет опасное сам. Выдача прав, смена роли и начисления
 *     оформляются заявкой, которую подтверждает владелец;
 *   — не хранит подтверждений. Код живёт минуты и тратится один раз.
 *
 * Скрытая кнопка защитой не является, поэтому спрятанное здесь спрятано
 * ради порядка на экране, а не ради безопасности.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Loader2, Check, X, KeyRound,
  Wallet, Crown, ScrollText, AlertTriangle, RefreshCw, Users, Ban, Trophy,
  Eye, Bike,
} from 'lucide-react';
import {
  adminCall, errorText, ROLE_LABEL, PERMISSION_LABEL,
  type MyRights, type AdminRow, type PendingAction, type LogEntry, type SecurityEvent,
  type AdminPermission, type Person,
} from './adminWire';

const C = {
  bg: 'var(--bg-l1)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)', purple: 'var(--purple)',
};

const inputStyle = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

/* ─── Sky Gifts: каталог обычных подарков и медиа карточки Prime ─────── */

const emptyGiftForm = () => ({ name: '', description: '', emoji: '🎁', pricePoints: '', gradient: '#1a1a1f,#252528', rarity: 'common', seasonal: false });

const GiftCatalogForm = ({ initial, onCancel, onSaved }: {
  initial?: import('@/gifts/giftsApi').GiftCatalogItem;
  onCancel: () => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState(() => initial ? {
    name: initial.name, description: initial.description, emoji: initial.emoji,
    pricePoints: String(initial.pricePoints), gradient: initial.gradient, rarity: initial.rarity, seasonal: initial.seasonal,
  } : emptyGiftForm());
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setFailed('');
    const { apiAdminCreateGift, apiAdminUpdateGift } = await import('@/gifts/giftsApi');
    const input = {
      name: form.name.trim(), description: form.description.trim(), emoji: form.emoji.trim() || '🎁',
      pricePoints: Math.trunc(Number(form.pricePoints)), gradient: form.gradient.trim(), rarity: form.rarity, seasonal: form.seasonal,
    };
    const res = initial ? await apiAdminUpdateGift(initial.id, input) : await apiAdminCreateGift(input);
    setBusy(false);
    if (!res.ok) { setFailed(res.reason); return; }
    onSaved();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex gap-2">
        <input value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
          placeholder="🎁" className="w-16 rounded-xl px-3 py-2 text-center text-lg outline-none" style={inputStyle} />
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Название" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      </div>
      <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="Описание" rows={2} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="flex gap-2">
        <input value={form.pricePoints} onChange={(e) => setForm((f) => ({ ...f, pricePoints: e.target.value }))}
          placeholder="Цена в баллах Прайма" type="number" min={1}
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <select value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))}
          className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
          {['common', 'rare', 'epic', 'legendary', 'unique'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <input value={form.gradient} onChange={(e) => setForm((f) => ({ ...f, gradient: e.target.value }))}
        placeholder="Цвета фона: #111111,#222222" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
        <input type="checkbox" checked={form.seasonal} onChange={(e) => setForm((f) => ({ ...f, seasonal: e.target.checked }))} />
        Сезонный подарок
      </label>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !form.name.trim() || !form.pricePoints} onClick={() => void save()}
          className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          {initial ? 'Сохранить' : 'Создать'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
          Отмена
        </button>
      </div>
    </div>
  );
};

/** Загрузка одной версии медиа: новая версия не трогает уже отправленные подарки. */
const GiftMediaUpload = ({ label, onUpload }: { label: string; onUpload: (file: File) => Promise<{ ok: boolean; reason?: string }> }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputId = useState(() => `gm-${Math.random().toString(36).slice(2)}`)[0];
  return (
    <label htmlFor={inputId} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold cursor-pointer"
      style={{ background: C.l2, color: busy ? C.t3 : C.t2, border: `1px solid ${C.brd}` }}>
      {busy ? '…' : label}
      {err && <span style={{ color: C.red }} title={err}> !</span>}
      <input id={inputId} type="file" accept="image/*,video/*" className="hidden" disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file) return;
          setBusy(true); setErr('');
          const r = await onUpload(file);
          setBusy(false);
          if (!r.ok) setErr(r.reason ?? 'Ошибка');
        }} />
    </label>
  );
};

const GiftsCatalogList = () => {
  const [items, setItems] = useState<import('@/gifts/giftsApi').GiftCatalogItem[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const load = useCallback(async () => {
    const { apiAdminGiftCatalog } = await import('@/gifts/giftsApi');
    setItems(await apiAdminGiftCatalog());
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (items === null) return <p className="text-xs" style={{ color: C.t3 }}>Загрузка…</p>;

  return (
    <div className="space-y-2">
      {editing === 'new'
        ? <GiftCatalogForm onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
        : (
          <button type="button" onClick={() => setEditing('new')}
            className="w-full rounded-2xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
            + Новый подарок
          </button>
        )}
      {items.map((it) => (
        editing === it.id ? (
          <GiftCatalogForm key={it.id} initial={it} onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); void load(); }} />
        ) : (
          <div key={it.id} className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{it.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate" style={{ color: C.t1 }}>{it.name}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>⭐ {it.pricePoints.toLocaleString('ru')} · {it.rarity}{it.seasonal ? ' · сезонный' : ''}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: it.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: it.active ? C.green : C.red }}>
                {it.active ? 'включён' : 'выключен'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setEditing(it.id)}
                className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
                Изменить
              </button>
              <button type="button" onClick={async () => {
                const { apiAdminSetGiftActive } = await import('@/gifts/giftsApi');
                await apiAdminSetGiftActive(it.id, !it.active);
                void load();
              }} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
                {it.active ? 'Выключить' : 'Включить'}
              </button>
              <GiftMediaUpload label="Фото/видео" onUpload={async (file) => {
                const { apiAdminUploadGiftMedia } = await import('@/gifts/giftsApi');
                const r = await apiAdminUploadGiftMedia(it.id, 'main', file);
                if (r.ok) void load();
                return r;
              }} />
              <GiftMediaUpload label="Превью" onUpload={async (file) => {
                const { apiAdminUploadGiftMedia } = await import('@/gifts/giftsApi');
                const r = await apiAdminUploadGiftMedia(it.id, 'thumbnail', file);
                if (r.ok) void load();
                return r;
              }} />
            </div>
          </div>
        )
      ))}
      {items.length === 0 && <p className="text-xs text-center py-6" style={{ color: C.t3 }}>Каталог пуст</p>}
    </div>
  );
};

/** Медиа карточки Prime — по темам оформления, отдельно от каталога обычных подарков. */
const PrimeCardMediaPanel = () => {
  const [themes, setThemes] = useState<import('@/gifts/GiftPrime').PrimeGiftTheme[] | null>(null);
  useEffect(() => { void import('@/gifts/GiftPrime').then((m) => setThemes(m.PRIME_GIFT_THEMES)); }, []);
  if (!themes) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Необязательно: если для темы не загружено медиа, карточка Prime в мессенджере рисуется тем же градиентом, что и сейчас.
      </p>
      {themes.map((t) => (
        <div key={t.id} className="rounded-2xl p-3 flex items-center gap-2" style={{ background: t.bg, border: `1px solid ${C.brd}` }}>
          <span className="text-xl">{t.emoji}</span>
          <p className="flex-1 text-xs font-bold text-white">{t.label}</p>
          <GiftMediaUpload label="Фото/видео" onUpload={async (file) => {
            const { apiAdminUploadPrimeCardMedia } = await import('@/gifts/giftsApi');
            return apiAdminUploadPrimeCardMedia(t.id, 'main', file);
          }} />
          <GiftMediaUpload label="Превью" onUpload={async (file) => {
            const { apiAdminUploadPrimeCardMedia } = await import('@/gifts/giftsApi');
            return apiAdminUploadPrimeCardMedia(t.id, 'thumbnail', file);
          }} />
        </div>
      ))}
    </div>
  );
};

const GiftsAdminSection = () => {
  const [sub, setSub] = useState<'catalog' | 'prime-card'>('catalog');
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {([['catalog', 'Каталог подарков'], ['prime-card', 'Карточка Prime']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSub(key)}
            className="flex-1 rounded-xl py-2 text-xs font-bold"
            style={{ background: sub === key ? C.acc : C.l2, color: sub === key ? '#fff' : C.t3 }}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'catalog' ? <GiftsCatalogList /> : <PrimeCardMediaPanel />}
    </div>
  );
};

const fmtTs = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('ru', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/* ─── Подтверждение личности ───────────────────────────────────────── */

/**
 * Перед опасным сервер просит подтвердить, что за клавиатурой тот же
 * человек. Код приходит из приложения двухэтапной защиты или письмом —
 * решает сервер, а не этот экран: дать выбор способа значило бы дать
 * выбрать самый слабый.
 */
const StepUp = ({ purpose, onCode, onCancel }: {
  purpose: string;
  onCode: (code: string) => void;
  onCancel: () => void;
}) => {
  const [method, setMethod] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    void adminCall({ action: 'step-up', purpose }).then((r) => {
      if (!alive) return;
      setBusy(false);
      if (r.type === 'admin-step-up') setMethod(r.payload.method ?? null);
      else setFailed(errorText(r.payload?.error));
    });
    return () => { alive = false; };
  }, [purpose]);

  return (
    <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.acc}` }}>
      <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
        <KeyRound size={13} style={{ color: C.acc }} /> Подтвердите личность
      </p>

      {busy && <Loader2 size={14} className="mt-2 animate-spin" style={{ color: C.t3 }} />}
      {failed && <p className="mt-1.5 text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {method && (
        <>
          <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>
            {method === 'app'
              ? 'Введите код из приложения двухэтапной защиты.'
              : 'Код отправлен на вашу почту. Он действует пять минут.'}
          </p>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" placeholder="000000"
              className="flex-1 rounded-xl px-3 py-2 text-sm tracking-widest outline-none" style={inputStyle} />
            <button type="button" disabled={code.length < 6} onClick={() => onCode(code)}
              className="rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: C.acc, color: '#fff' }}>
              Подтвердить
            </button>
          </div>
        </>
      )}

      <button type="button" onClick={onCancel}
        className="mt-2 text-[11px]" style={{ color: C.t3 }}>Отмена</button>
    </div>
  );
};

/* ─── Начисления ───────────────────────────────────────────────────── */

type GrantWhat = 'money' | 'points' | 'prime';

const GRANT_LABEL: Record<GrantWhat, string> = {
  money: 'Деньги, ₽', points: 'Баллы', prime: 'Prime, дней',
};

/**
 * Начислить на счёт: деньги, баллы или Prime.
 *
 * Само начисление здесь не происходит. Экран оформляет заявку, и деньги
 * появляются на счету только после того, как владелец повернёт второй
 * ключ. Деньги из ничего — это ровно то, ради чего административный
 * аккаунт и крадут.
 */
const GrantForm = ({ onSent }: { onSent: () => void }) => {
  const [what, setWhat] = useState<GrantWhat>('money');
  const [userId, setUserId] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(false);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');

  const send = async (code: string) => {
    setStep(false); setFailed(''); setSent('');
    const n = Number(value);
    const r = await adminCall({
      action: 'grant', what, userId: userId.trim(), code, reason: reason.trim(),
      ...(what === 'prime' ? { days: n } : { amount: n }),
    });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка отправлена владельцу на подтверждение. '
      + 'Деньги появятся на счету только после того, как он её подтвердит.');
    setValue(''); setReason('');
    onSent();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
        <Wallet size={13} style={{ color: C.acc }} /> Начислить на счёт
      </p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Начисление проходит в два ключа: вы оформляете заявку, подтверждает владелец.
        В одиночку деньги не появятся ни у кого, включая вас.
      </p>

      <div className="flex gap-1">
        {(Object.keys(GRANT_LABEL) as GrantWhat[]).map((k) => (
          <button key={k} type="button" onClick={() => setWhat(k)}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: what === k ? C.acc : C.l2, color: what === k ? '#fff' : C.t3 }}>
            {GRANT_LABEL[k]}
          </button>
        ))}
      </div>

      <input value={userId} onChange={(e) => setUserId(e.target.value)}
        placeholder="Идентификатор профиля получателя (acc-…)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        inputMode="numeric" placeholder={GRANT_LABEL[what]}
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Основание — его увидит владелец"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {step ? (
        <StepUp purpose={`pending:grant_${what}`} onCode={(c) => void send(c)}
          onCancel={() => setStep(false)} />
      ) : (
        <button type="button"
          disabled={!userId.trim() || !value || Number(value) <= 0}
          onClick={() => { setFailed(''); setSent(''); setStep(true); }}
          className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          Оформить заявку
        </button>
      )}
    </div>
  );
};

/* ─── Sky Video: монетизация и корректировка дохода ───────────────── */

/**
 * Очередь заявок на монетизацию роликов. Решение здесь прямое, без
 * второго ключа: это модерация содержимого (право content), а не
 * деньги — деньги начинают идти только после отдельной корректировки,
 * и та уже оформляется заявкой с подтверждением владельца.
 */
const SkyVideoMonetizationQueue = () => {
  const [queue, setQueue] = useState<import('@/video/skyVideoApi').MonetizationQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { apiSkyVideoMonetizationQueue } = await import('@/video/skyVideoApi');
    const list = await apiSkyVideoMonetizationQueue();
    setLoading(false);
    if (list === null) { setFailed('Не удалось загрузить очередь'); return; }
    setQueue(list);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (requestId: string, approve: boolean) => {
    const { apiDecideSkyVideoMonetization } = await import('@/video/skyVideoApi');
    const ok = await apiDecideSkyVideoMonetization(requestId, approve);
    if (!ok) { setFailed('Не получилось решить заявку'); return; }
    setQueue((q) => q.filter((r) => r.requestId !== requestId));
  };

  if (loading) return <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;

  return (
    <div className="space-y-2">
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {queue.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заявок на монетизацию нет.</p>
      ) : queue.map((r) => (
        <div key={r.requestId} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>{r.title}</p>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {r.ownerName ?? r.ownerUsername ?? r.ownerId} · {r.views} просмотров · {fmtTs(r.requestedAt)}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void decide(r.requestId, true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
              style={{ background: C.green, color: '#fff' }}>
              <Check size={12} /> Одобрить
            </button>
            <button type="button" onClick={() => void decide(r.requestId, false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
              style={{ background: C.l2, color: C.red }}>
              <X size={12} /> Отклонить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Корректировка дохода по конкретному ролику. Начисление и списание —
 * тот же приём, что деньги на счёт: экран оформляет заявку, а
 * поворачивает второй ключ владелец. Сама эта форма ничего не
 * начисляет — только просит.
 */
const RevenueAdjustForm = ({ onSent }: { onSent: () => void }) => {
  const [ownerId, setOwnerId] = useState('');
  const [videoId, setVideoId] = useState('');
  const [rubles, setRubles] = useState('');
  const [sign, setSign] = useState<'plus' | 'minus'>('plus');
  const [note, setNote] = useState('');
  const [step, setStep] = useState(false);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');

  const send = async (code: string) => {
    setStep(false); setFailed(''); setSent('');
    const kopecks = Math.round(Number(rubles) * 100) * (sign === 'minus' ? -1 : 1);
    const r = await adminCall({
      action: 'skyvideo-revenue-adjust', userId: ownerId.trim(), videoId: videoId.trim(),
      amountKopecks: kopecks, note: note.trim(), code,
    });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка отправлена владельцу на подтверждение.');
    setRubles(''); setNote('');
    onSent();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
        <Wallet size={13} style={{ color: C.acc }} /> Скорректировать доход по ролику
      </p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Тоже в два ключа. Ролик должен принадлежать указанному человеку —
        иначе владелец не сможет подтвердить заявку.
      </p>

      <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
        placeholder="Идентификатор профиля автора (acc-…)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={videoId} onChange={(e) => setVideoId(e.target.value)}
        placeholder="Идентификатор ролика (svid-…)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

      <div className="flex gap-1">
        {([['plus', 'Начислить'], ['minus', 'Списать']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSign(k)}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: sign === k ? C.acc : C.l2, color: sign === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>
      <input value={rubles} onChange={(e) => setRubles(e.target.value.replace(/[^\d.]/g, ''))}
        inputMode="decimal" placeholder="Сумма, ₽"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="Основание — его увидит владелец"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {step ? (
        <StepUp purpose="pending:skyvideo_revenue_adjust" onCode={(c) => void send(c)}
          onCancel={() => setStep(false)} />
      ) : (
        <button type="button"
          disabled={!ownerId.trim() || !videoId.trim() || !rubles || Number(rubles) <= 0}
          onClick={() => { setFailed(''); setSent(''); setStep(true); }}
          className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          Оформить заявку
        </button>
      )}
    </div>
  );
};

/* ─── Prime Pulse: предложения ────────────────────────────────────── */

const PULSE_CATEGORIES = ['game', 'service', 'promo', 'fun'] as const;
const PULSE_CAT_LABEL: Record<string, string> = { game: 'Игры', service: 'Сервисы', promo: 'Sky', fun: 'Партнёры' };

const emptyPulseForm = () => ({
  category: 'promo' as typeof PULSE_CATEGORIES[number],
  title: '', description: '', brand: 'Sky', valueLabel: '',
  color1: '#f59e0b', color2: '#d97706', expiresAt: '', maxPerUser: '1',
});

const PulseOfferForm = ({ initial, onCancel, onSaved }: {
  initial?: import('@/prime/primePulseApi').PulseOffer;
  onCancel: () => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState(() => initial ? {
    category: initial.category, title: initial.title, description: initial.description,
    brand: initial.brand, valueLabel: initial.valueLabel,
    color1: initial.color[0], color2: initial.color[1],
    expiresAt: initial.expiresAt ? initial.expiresAt.slice(0, 10) : '',
    maxPerUser: String(initial.maxPerUser),
  } : emptyPulseForm());
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setFailed('');
    const { apiPulseCreateOffer, apiPulseUpdateOffer } = await import('@/prime/primePulseApi');
    const input = {
      category: form.category, title: form.title.trim(), description: form.description.trim(),
      brand: form.brand.trim() || 'Sky', valueLabel: form.valueLabel.trim(),
      color1: form.color1, color2: form.color2,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      maxPerUser: Number(form.maxPerUser) || 1,
    };
    const res = initial ? await apiPulseUpdateOffer(initial.id, input) : await apiPulseCreateOffer(input);
    setBusy(false);
    if (!res.ok) { setFailed(res.reason); return; }
    onSaved();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex gap-1">
        {PULSE_CATEGORIES.map((k) => (
          <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, category: k }))}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: form.category === k ? C.acc : C.l2, color: form.category === k ? '#fff' : C.t3 }}>
            {PULSE_CAT_LABEL[k]}
          </button>
        ))}
      </div>
      <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="Название" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="Описание" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="flex gap-2">
        <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
          placeholder="Бренд (Sky Music, Sky Market…)" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <input value={form.valueLabel} onChange={(e) => setForm((f) => ({ ...f, valueLabel: e.target.value }))}
          placeholder="Значение (×2, −30%…)" className="w-28 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      </div>
      <div className="flex gap-2 items-center">
        <input type="color" value={form.color1} onChange={(e) => setForm((f) => ({ ...f, color1: e.target.value }))}
          className="h-9 w-12 rounded-lg" style={{ background: C.l2, border: `1px solid ${C.brd}` }} />
        <input type="color" value={form.color2} onChange={(e) => setForm((f) => ({ ...f, color2: e.target.value }))}
          className="h-9 w-12 rounded-lg" style={{ background: C.l2, border: `1px solid ${C.brd}` }} />
        <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <input value={form.maxPerUser} onChange={(e) => setForm((f) => ({ ...f, maxPerUser: e.target.value.replace(/\D/g, '') }))}
          inputMode="numeric" placeholder="Раз/чел" className="w-16 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !form.title.trim() || !form.valueLabel.trim()} onClick={() => void save()}
          className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          {initial ? 'Сохранить' : 'Создать'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
          Отмена
        </button>
      </div>
    </div>
  );
};

const PrimePulseAdminSection = () => {
  const [offers, setOffers] = useState<import('@/prime/primePulseApi').PulseOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState<string | null | 'new'>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { apiPulseAdminOffers } = await import('@/prime/primePulseApi');
    const list = await apiPulseAdminOffers();
    setLoading(false);
    if (list === null) { setFailed('Не удалось загрузить предложения'); return; }
    setOffers(list);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (id: string, on: boolean) => {
    const { apiPulseSetActive } = await import('@/prime/primePulseApi');
    if (await apiPulseSetActive(id, on)) void load();
  };

  const remove = async (id: string) => {
    const { apiPulseDeleteOffer } = await import('@/prime/primePulseApi');
    const res = await apiPulseDeleteOffer(id);
    if (!res.ok) { setFailed(res.reason); return; }
    void load();
  };

  if (editing === 'new') {
    return <PulseOfferForm onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  }
  const editingOffer = offers.find((o) => o.id === editing);
  if (editingOffer) {
    return <PulseOfferForm initial={editingOffer} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setEditing('new')}
        className="w-full rounded-xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
        + Новое предложение
      </button>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {loading ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : offers.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Предложений пока нет.</p>
      ) : offers.map((o) => (
        <div key={o.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold" style={{ color: C.t1 }}>{o.title}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
                {o.brand} · {PULSE_CAT_LABEL[o.category]} · {o.valueLabel} · погашений: {o.redeemedCount ?? 0}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-bold" style={{ color: o.active ? C.green : C.t3 }}>
              {o.active ? 'Активно' : 'Снято'}
            </span>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setEditing(o.id)}
              className="flex-1 rounded-xl py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>
              Изменить
            </button>
            <button type="button" onClick={() => void toggle(o.id, !o.active)}
              className="flex-1 rounded-xl py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: o.active ? C.amber : C.green }}>
              {o.active ? 'Снять' : 'Вернуть'}
            </button>
            {(o.redeemedCount ?? 0) === 0 && (
              <button type="button" onClick={() => void remove(o.id)}
                className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.red }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── Мероприятия: кампании, шкала наград, участники, заявки ─────────── */

const emptyCampaignForm = () => ({ title: '', description: '', conditions: '', startsAt: '', endsAt: '' });

const CampaignForm = ({ initial, onCancel, onSaved }: {
  initial?: import('@/campaigns/campaignsApi').Campaign;
  onCancel: () => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState(() => initial ? {
    title: initial.title, description: initial.description, conditions: initial.conditions,
    startsAt: initial.startsAt ? initial.startsAt.slice(0, 10) : '',
    endsAt: initial.endsAt ? initial.endsAt.slice(0, 10) : '',
  } : emptyCampaignForm());
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setFailed('');
    const { apiAdminCreateCampaign, apiAdminUpdateCampaign } = await import('@/campaigns/campaignsApi');
    const input = {
      title: form.title.trim(), description: form.description.trim(), conditions: form.conditions.trim(),
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    };
    const res = initial ? await apiAdminUpdateCampaign(initial.id, input) : await apiAdminCreateCampaign(input);
    setBusy(false);
    if (!res.ok) { setFailed(res.reason); return; }
    onSaved();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="Название" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="Описание" rows={3} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <textarea value={form.conditions} onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
        placeholder="Условия участия" rows={3} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="mb-1 text-[10px]" style={{ color: C.t3 }}>Начало</p>
          <input type="date" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        </div>
        <div className="flex-1">
          <p className="mb-1 text-[10px]" style={{ color: C.t3 }}>Окончание</p>
          <input type="date" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        </div>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !form.title.trim()} onClick={() => void save()}
          className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          {initial ? 'Сохранить' : 'Создать'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
          Отмена
        </button>
      </div>
    </div>
  );
};

const emptyLevelForm = () => ({ viewsThreshold: '', rewardDays: '' });

/** Шкала наград — числа приходят с сервера и правятся только здесь, никогда во фронтенде. */
const CampaignLevelsPanel = ({ campaignId, onBack }: { campaignId: string; onBack: () => void }) => {
  const [levels, setLevels] = useState<import('@/campaigns/campaignsApi').CampaignLevel[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(emptyLevelForm());
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    const { apiAdminLevels } = await import('@/campaigns/campaignsApi');
    const list = await apiAdminLevels(campaignId);
    setLevels(list ?? []);
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (lv?: import('@/campaigns/campaignsApi').CampaignLevel) => {
    setFailed('');
    setForm(lv ? { viewsThreshold: String(lv.viewsThreshold), rewardDays: String(lv.rewardDays) } : emptyLevelForm());
    setEditing(lv ? lv.id : 'new');
  };

  const save = async () => {
    setFailed('');
    const { apiAdminCreateLevel, apiAdminUpdateLevel } = await import('@/campaigns/campaignsApi');
    const input = { viewsThreshold: Number(form.viewsThreshold), rewardDays: Number(form.rewardDays) };
    const res = editing === 'new' ? await apiAdminCreateLevel(campaignId, input)
      : await apiAdminUpdateLevel(campaignId, String(editing), input);
    if (!res.ok) { setFailed(res.reason); return; }
    setEditing(null); void load();
  };

  const toggle = async (id: string, on: boolean) => {
    const { apiAdminSetLevelActive } = await import('@/campaigns/campaignsApi');
    if (await apiAdminSetLevelActive(campaignId, id, on)) void load();
  };

  const remove = async (id: string) => {
    const { apiAdminDeleteLevel } = await import('@/campaigns/campaignsApi');
    const res = await apiAdminDeleteLevel(campaignId, id);
    if (!res.ok) { setFailed(res.reason); return; }
    void load();
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.t3 }}>← Назад к мероприятиям</button>
      <p className="text-xs font-bold" style={{ color: C.t1 }}>Шкала наград</p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Не суммируется: пользователь получает награду только высшего достигнутого уровня.
      </p>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {editing ? (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex gap-2">
            <input value={form.viewsThreshold} onChange={(e) => setForm((f) => ({ ...f, viewsThreshold: e.target.value.replace(/\D/g, '') }))}
              inputMode="numeric" placeholder="Порог просмотров" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
            <input value={form.rewardDays} onChange={(e) => setForm((f) => ({ ...f, rewardDays: e.target.value.replace(/\D/g, '') }))}
              inputMode="numeric" placeholder="Дней Prime" className="w-28 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!form.viewsThreshold || !form.rewardDays} onClick={() => void save()}
              className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => startEdit()}
          className="w-full rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.acc }}>
          + Новый уровень
        </button>
      )}

      {levels === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : levels.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Уровней пока нет.</p>
      ) : levels.slice().sort((a, b) => a.viewsThreshold - b.viewsThreshold).map((lv) => (
        <div key={lv.id} className="flex items-center justify-between rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{lv.viewsThreshold.toLocaleString('ru-RU')} просмотров → {lv.rewardDays} дн. Prime</p>
            <p className="mt-0.5 text-[10px]" style={{ color: lv.active ? C.green : C.t3 }}>{lv.active ? 'Активен' : 'Отключён'}</p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => startEdit(lv)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
              Изменить
            </button>
            <button type="button" onClick={() => void toggle(lv.id, !lv.active)}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: lv.active ? C.amber : C.green }}>
              {lv.active ? 'Отключить' : 'Включить'}
            </button>
            <button type="button" onClick={() => void remove(lv.id)} className="rounded-lg px-2 py-1.5" style={{ background: C.l2, color: C.red }}>
              <X size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const CampaignParticipantsPanel = ({ campaignId, onBack }: { campaignId: string; onBack: () => void }) => {
  const [rows, setRows] = useState<import('@/campaigns/campaignsApi').AdminParticipant[] | null>(null);

  useEffect(() => {
    void (async () => {
      const { apiAdminParticipants } = await import('@/campaigns/campaignsApi');
      setRows(await apiAdminParticipants(campaignId) ?? []);
    })();
  }, [campaignId]);

  return (
    <div className="space-y-2">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.t3 }}>← Назад к мероприятиям</button>
      <p className="text-xs font-bold" style={{ color: C.t1 }}>Участники</p>
      {rows === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Участников пока нет.</p>
      ) : rows.map((p) => (
        <div key={p.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>@{p.username}</p>
            <span className="shrink-0 text-[10px] font-bold"
              style={{ color: p.status === 'suspicious' ? C.amber : p.status === 'blocked' ? C.red : C.green }}>
              {p.status === 'suspicious' ? 'Проверка' : p.status === 'blocked' ? 'Заблокировано' : 'Активно'}
            </span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            Sky ID {p.skyId} · {p.views.toLocaleString('ru-RU')} просмотров · {fmtTs(p.createdAt)}
          </p>
          {p.videoUrl && <p className="mt-1 truncate text-[10px]" style={{ color: C.t3 }}>{p.videoUrl}</p>}
          {p.suspiciousReason && <p className="mt-1 text-[10px]" style={{ color: C.amber }}>{p.suspiciousReason}</p>}
        </div>
      ))}
    </div>
  );
};

const CampaignCoverUpload = ({ campaignId }: { campaignId: string }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState(false);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setFailed(''); setDone(false);
    const { apiAdminUploadCover } = await import('@/campaigns/campaignsApi');
    const res = await apiAdminUploadCover(campaignId, file);
    setBusy(false);
    if (!res.ok) { setFailed(res.reason); return; }
    setDone(true);
  };

  return (
    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold"
      style={{ background: C.l2, color: C.t2 }}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : done ? <Check size={11} style={{ color: C.green }} /> : null}
      Обложка
      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e)} />
      {failed && <span style={{ color: C.red }}>{failed}</span>}
    </label>
  );
};

const CampaignsAdminList = () => {
  const [campaigns, setCampaigns] = useState<import('@/campaigns/campaignsApi').Campaign[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [levelsFor, setLevelsFor] = useState<string | null>(null);
  const [participantsFor, setParticipantsFor] = useState<string | null>(null);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    const { apiAdminCampaigns } = await import('@/campaigns/campaignsApi');
    const list = await apiAdminCampaigns();
    if (list === null) { setFailed('Не удалось загрузить мероприятия'); return; }
    setCampaigns(list);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleActive = async (id: string, on: boolean) => {
    const { apiAdminSetCampaignActive } = await import('@/campaigns/campaignsApi');
    if (await apiAdminSetCampaignActive(id, on)) void load();
  };

  const archive = async (id: string) => {
    const { apiAdminArchiveCampaign } = await import('@/campaigns/campaignsApi');
    if (await apiAdminArchiveCampaign(id)) void load();
  };

  if (levelsFor) return <CampaignLevelsPanel campaignId={levelsFor} onBack={() => setLevelsFor(null)} />;
  if (participantsFor) return <CampaignParticipantsPanel campaignId={participantsFor} onBack={() => setParticipantsFor(null)} />;

  if (editing === 'new') {
    return <CampaignForm onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  }
  const editingCampaign = campaigns?.find((c) => c.id === editing);
  if (editingCampaign) {
    return <CampaignForm initial={editingCampaign} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setEditing('new')}
        className="w-full rounded-xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
        + Новое мероприятие
      </button>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {campaigns === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : campaigns.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Мероприятий пока нет.</p>
      ) : campaigns.map((c) => (
        <div key={c.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{c.title}</p>
            <span className="shrink-0 text-[10px] font-bold"
              style={{ color: c.archived ? C.t3 : c.active ? C.green : C.amber }}>
              {c.archived ? 'В архиве' : c.active ? 'Активно' : 'Черновик'}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[10px]" style={{ color: C.t3 }}>{c.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setEditing(c.id)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
              Изменить
            </button>
            <button type="button" onClick={() => setLevelsFor(c.id)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.purple }}>
              Шкала наград
            </button>
            <button type="button" onClick={() => setParticipantsFor(c.id)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
              Участники
            </button>
            <CampaignCoverUpload campaignId={c.id} />
            {!c.archived && (
              <button type="button" onClick={() => void toggleActive(c.id, !c.active)}
                className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: c.active ? C.amber : C.green }}>
                {c.active ? 'Снять' : 'Включить'}
              </button>
            )}
            {!c.archived && (
              <button type="button" onClick={() => void archive(c.id)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>
                В архив
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Заявки на награду: одобрение всегда в два ключа, отклонение — сразу.
 * Получателя не спрашиваем: сервер сам берёт его из самой заявки, поэтому
 * форма предложения — это кнопка и подтверждение личности, без единого
 * поля ввода. Так чужую награду нельзя перенаправить опечаткой в id.
 */
const CampaignGrantsPanel = ({ onPendingChanged }: { onPendingChanged: () => void }) => {
  const [grants, setGrants] = useState<import('@/campaigns/campaignsApi').AdminGrant[] | null>(null);
  const [status, setStatus] = useState<'pending' | 'granted' | 'rejected' | ''>('pending');
  const [failed, setFailed] = useState('');
  const [proposing, setProposing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const { apiAdminGrants } = await import('@/campaigns/campaignsApi');
    const list = await apiAdminGrants(status ? { status } : {});
    if (list === null) { setFailed('Не удалось загрузить заявки'); return; }
    setGrants(list);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const propose = async (grantId: string, code: string) => {
    setProposing(null); setFailed('');
    const r = await adminCall({ action: 'propose-campaign-reward', grantId, code });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    onPendingChanged();
    void load();
  };

  const reject = async (grantId: string) => {
    const { apiAdminRejectGrant } = await import('@/campaigns/campaignsApi');
    const res = await apiAdminRejectGrant(grantId, reason.trim());
    setRejecting(null); setReason('');
    if (!res.ok) { setFailed(res.reason); return; }
    void load();
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {([['pending', 'Ждут'], ['granted', 'Начислены'], ['rejected', 'Отклонены'], ['', 'Все']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {grants === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : grants.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заявок нет.</p>
      ) : grants.map((g) => (
        <div key={g.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold" style={{ color: C.t1 }}>@{g.username}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
                {g.campaignTitle} · {g.viewsAtRequest.toLocaleString('ru-RU')} просмотров · {g.rewardDays} дн. Prime
              </p>
              <p className="text-[10px]" style={{ color: C.t3 }}>Sky ID {g.skyId} · {fmtTs(g.createdAt)}</p>
            </div>
            <span className="shrink-0 text-[10px] font-bold" style={{
              color: g.status === 'granted' ? C.green : g.status === 'rejected' ? C.red
                : g.status === 'pending' ? C.amber : C.t3,
            }}>
              {g.status === 'pending' ? 'Ждёт' : g.status === 'granted' ? 'Начислена' : g.status === 'rejected' ? 'Отклонена' : g.status}
            </span>
          </div>

          {g.status === 'pending' && (
            <div className="mt-2 space-y-2">
              {proposing === g.id ? (
                <StepUp purpose="pending:campaign_reward" onCode={(c) => void propose(g.id, c)} onCancel={() => setProposing(null)} />
              ) : rejecting === g.id ? (
                <div className="space-y-1.5">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина отказа (увидит участник)"
                    className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void reject(g.id)}
                      className="flex-1 rounded-xl py-1.5 text-[11px] font-bold" style={{ background: C.red, color: '#fff' }}>
                      Отклонить
                    </button>
                    <button type="button" onClick={() => { setRejecting(null); setReason(''); }}
                      className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t3 }}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setProposing(g.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold" style={{ background: C.green, color: '#04150c' }}>
                    <Trophy size={12} /> Предложить выдачу
                  </button>
                  <button type="button" onClick={() => setRejecting(g.id)}
                    className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.red }}>
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const CampaignsAdminSection = ({ onPendingChanged }: { onPendingChanged: () => void }) => {
  const [sub, setSub] = useState<'campaigns' | 'grants'>('campaigns');
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button type="button" onClick={() => setSub('campaigns')}
          className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
          style={{ background: sub === 'campaigns' ? C.acc : C.l2, color: sub === 'campaigns' ? '#fff' : C.t3 }}>
          Мероприятия
        </button>
        <button type="button" onClick={() => setSub('grants')}
          className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
          style={{ background: sub === 'grants' ? C.acc : C.l2, color: sub === 'grants' ? '#fff' : C.t3 }}>
          Заявки на подарок
        </button>
      </div>
      {sub === 'campaigns' ? <CampaignsAdminList /> : <CampaignGrantsPanel onPendingChanged={onPendingChanged} />}
    </div>
  );
};

const SkyVideoAdminSection = ({ rights, onPendingChanged }: { rights: MyRights; onPendingChanged: () => void }) => (
  <div className="space-y-4">
    {rights.permissions.includes('content') && (
      <div>
        <p className="mb-2 text-xs font-bold" style={{ color: C.t1 }}>Заявки на монетизацию</p>
        <SkyVideoMonetizationQueue />
      </div>
    )}
    {rights.permissions.includes('finance') && (
      <RevenueAdjustForm onSent={onPendingChanged} />
    )}
  </div>
);

/* ─── Очередь заявок ───────────────────────────────────────────────── */

const STATUS_LABEL: Record<PendingAction['status'], string> = {
  pending: 'Ждёт владельца', approved: 'Подтверждена', rejected: 'Отклонена',
  executed: 'Выполнена', failed: 'Не выполнена', expired: 'Просрочена',
};

const PendingList = ({ rights, actions, onChanged }: {
  rights: MyRights; actions: PendingAction[]; onChanged: () => void;
}) => {
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState('');

  const decide = async (code: string) => {
    if (!deciding) return;
    const { id, approve } = deciding;
    setDeciding(null); setFailed('');
    const r = await adminCall({ action: 'decide', id, approve, code, note: note.trim() });
    if (r.type !== 'admin-done') setFailed(errorText(r.payload?.error));
    setNote('');
    onChanged();
  };

  if (actions.length === 0) {
    return <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заявок нет.</p>;
  }

  return (
    <div className="space-y-2">
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {actions.map((a) => (
        <div key={a.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{a.title}</p>
            <span className="shrink-0 text-[10px] font-bold" style={{
              color: a.status === 'executed' ? C.green
                : a.status === 'pending' ? C.amber : C.t3,
            }}>{STATUS_LABEL[a.status]}</span>
          </div>

          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {a.actorName ? `от ${a.actorName}` : ''}
            {a.targetName ? ` · кому: ${a.targetName}` : ''} · {fmtTs(a.createdAt)}
          </p>

          {Object.keys(a.payload).length > 0 && (
            <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
              {Object.entries(a.payload).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </p>
          )}
          {a.reason && <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>Основание: {a.reason}</p>}
          {a.outcome && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Итог: {a.outcome}</p>}

          {rights.owner && a.status === 'pending' && (
            deciding?.id === a.id ? (
              <div className="mt-2 space-y-2">
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Примечание к решению"
                  className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
                <StepUp purpose="pending:decide" onCode={(c) => void decide(c)}
                  onCancel={() => setDeciding(null)} />
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => { setDeciding({ id: a.id, approve: true }); setNote(''); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                  style={{ background: C.green, color: '#fff' }}>
                  <Check size={12} /> Подтвердить
                </button>
                <button type="button" onClick={() => { setDeciding({ id: a.id, approve: false }); setNote(''); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                  style={{ background: C.l2, color: C.red }}>
                  <X size={12} /> Отклонить
                </button>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
};

/* ─── Администраторы и роли ────────────────────────────────────────── */

const AdminsList = ({ admins, roles, onChanged }: {
  admins: AdminRow[]; roles: string[]; onChanged: () => void;
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [role, setRole] = useState('read_only_admin');
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');

  /* Выдача прав новому человеку. Роль выбирается здесь же и уходит
     вместе с заявкой: администратор без роли считался бы полноправным,
     и владелец подтверждал бы, не видя чего. */
  const [newId, setNewId] = useState('');
  const [newRole, setNewRole] = useState('read_only_admin');
  const [granting, setGranting] = useState(false);

  const send = async (code: string) => {
    const id = editing;
    setEditing(null); setFailed(''); setSent('');
    const r = await adminCall({ action: 'set-role', userId: id, role, code });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка на смену роли отправлена владельцу.');
    onChanged();
  };

  const grant = async (code: string) => {
    setGranting(false); setFailed(''); setSent('');
    const r = await adminCall({
      action: 'set-admin', userId: newId.trim(), value: true, role: newRole, code });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка на выдачу прав отправлена владельцу.');
    setNewId('');
    onChanged();
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Роль определяет, что человеку доступно. Сменить её в одиночку нельзя:
        заявку подтверждает владелец.
      </p>

      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-xs font-bold" style={{ color: C.t1 }}>Выдать права</p>
        <input value={newId} onChange={(e) => setNewId(e.target.value)}
          placeholder="Идентификатор профиля (acc-…)"
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
        </select>
        <p className="text-[10px]" style={{ color: C.t3 }}>
          Выдавайте наименьшее, чего хватит для работы. Расширить роль всегда можно
          отдельной заявкой, а вернуть выданное лишнее — уже нельзя.
        </p>
        {granting ? (
          <StepUp purpose="pending:admin_grant" onCode={(c) => void grant(c)}
            onCancel={() => setGranting(false)} />
        ) : (
          <button type="button" disabled={!newId.trim()} onClick={() => setGranting(true)}
            className="w-full rounded-xl py-2 text-xs font-bold disabled:opacity-40"
            style={{ background: C.acc, color: '#fff' }}>
            Оформить заявку
          </button>
        )}
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {admins.map((a) => (
        <div key={a.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>
                {a.owner && <Crown size={11} style={{ color: C.amber, display: 'inline', marginRight: 4 }} />}
                {a.name} <span className="font-normal" style={{ color: C.t3 }}>@{a.username}</span>
              </p>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                {ROLE_LABEL[a.role] ?? a.role}
                {a.banned && <span style={{ color: C.red }}> · ограничен</span>}
              </p>
            </div>
            {!a.owner && (
              <button type="button" onClick={() => { setEditing(a.id); setRole(a.role === 'super_admin' ? 'read_only_admin' : a.role); }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
                style={{ background: C.l2, color: C.t2 }}>
                Роль
              </button>
            )}
          </div>

          {a.legacy && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[10px]" style={{ color: C.amber }}>
              <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              Роль не назначена — права шире, чем нужно для работы. Назначьте подходящую.
            </p>
          )}

          {editing === a.id && (
            <div className="mt-2 space-y-2">
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
              </select>
              <StepUp purpose="pending:role_set" onCode={(c) => void send(c)}
                onCancel={() => setEditing(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/* ─── Люди: бан профиля и блокировка учётной записи ───────────────── */

/**
 * Два запрета рядом, и это разные вещи.
 *
 *   бан профиля  — закрыта одна витрина. Второй профиль того же
 *                  человека продолжает работать, и это не оплошность:
 *                  так наказывают за то, что сделано этим профилем;
 *
 *   блокировка   — закрыт человек. Все его профили и те, что он заведёт
 *   учётной        после, плюс вход. Так убирают с платформы.
 *   записи
 *
 * Экран говорит об этом прямо: администратор, забанивший один профиль в
 * уверенности, что убрал человека, ошибётся дважды — и в наказании, и в
 * том, что будет думать дальше.
 */
const HOURS: { label: string; minutes: number }[] = [
  { label: 'час', minutes: 60 },
  { label: 'сутки', minutes: 60 * 24 },
  { label: 'неделя', minutes: 60 * 24 * 7 },
  { label: 'месяц', minutes: 60 * 24 * 30 },
  { label: 'год', minutes: 60 * 24 * 365 },
];

const PeopleTab = ({ canModerate }: { canModerate: boolean }) => {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Person | null>(null);
  const [minutes, setMinutes] = useState(60 * 24);
  const [reason, setReason] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState('');

  const search = async () => {
    setFailed(''); setDone(''); setPicked(null);
    const r = await adminCall({ action: 'find', q: q.trim() });
    if (r.type !== 'admin-people') { setFailed(errorText(r.payload?.error)); setPeople([]); return; }
    setPeople(r.payload.people ?? []);
  };

  const refresh = async (id: string) => {
    const r = await adminCall({ action: 'find', q: id });
    const fresh = (r.type === 'admin-people' ? r.payload.people ?? [] : []).find((p) => p.id === id);
    if (fresh) { setPicked(fresh); setPeople((was) => (was ?? []).map((p) => (p.id === id ? fresh : p))); }
  };

  /** Бан профиля: немедленный, это повседневная работа модерации. */
  const banProfile = async (on: boolean) => {
    if (!picked) return;
    setFailed(''); setDone('');
    const r = await adminCall({
      action: 'restrict', userId: picked.id, kind: 'ban', minutes: on ? minutes : 0 });
    if (r.type !== 'admin-done') { setFailed(errorText(r.payload?.error)); return; }
    setDone(on ? 'Профиль забанен.' : 'Бан профиля снят.');
    await refresh(picked.id);
  };

  /** Блокировка учётной записи: тяжелее, поэтому с подтверждением личности. */
  const blockAccount = async (code: string, on: boolean) => {
    if (!picked) return;
    setBlocking(false); setFailed(''); setDone('');
    const r = await adminCall({
      action: 'block-account', userId: picked.id,
      minutes: on ? minutes : 0, reason: reason.trim(), code });
    if (r.type !== 'admin-done') { setFailed(errorText(r.payload?.error)); return; }
    setDone(on
      ? 'Учётная запись заблокирована. Закрыты все профили этого человека и вход.'
      : 'Блокировка снята.');
    await refresh(picked.id);
  };

  if (!canModerate) {
    return <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>
      Запреты налагает модерация.
    </p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
          placeholder="Ник или идентификатор профиля"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void search()}
          className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
          Найти
        </button>
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {done && <p className="text-[11px]" style={{ color: C.green }}>{done}</p>}

      {people?.length === 0 && (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Никого не нашлось.</p>
      )}

      {(people ?? []).map((p) => (
        <button key={p.id} type="button" onClick={() => { setPicked(p); setReason(''); }}
          className="w-full rounded-2xl p-3 text-left"
          style={{
            background: C.l1,
            border: `1px solid ${picked?.id === p.id ? C.acc : C.brd}`,
          }}>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>
              {p.owner && <Crown size={11} style={{ color: C.amber, display: 'inline', marginRight: 4 }} />}
              {p.name} <span className="font-normal" style={{ color: C.t3 }}>@{p.username}</span>
            </p>
            {p.blocked && <span className="shrink-0 text-[10px] font-bold" style={{ color: C.red }}>заблокирован</span>}
            {!p.blocked && p.banned && <span className="shrink-0 text-[10px] font-bold" style={{ color: C.amber }}>забанен</span>}
          </div>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            {p.admin ? 'администратор · ' : ''}
            профилей в учётной записи: {p.profiles}
          </p>
        </button>
      ))}

      {picked && !picked.owner && (
        <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>
            {picked.name} <span className="font-normal" style={{ color: C.t3 }}>@{picked.username}</span>
          </p>

          <div>
            <p className="mb-1 text-[10px] font-bold" style={{ color: C.t3 }}>НА СКОЛЬКО</p>
            <div className="flex flex-wrap gap-1">
              {HOURS.map((h) => (
                <button key={h.minutes} type="button" onClick={() => setMinutes(h.minutes)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
                  style={{
                    background: minutes === h.minutes ? C.acc : C.l2,
                    color: minutes === h.minutes ? '#fff' : C.t3,
                  }}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          {/* Бан профиля */}
          <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: C.t1 }}>
              <Ban size={12} style={{ color: C.amber }} /> Забанить профиль
            </p>
            <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
              Закрывает эту витрину. Остальные профили этого человека
              {picked.profiles > 1 ? ` (их ещё ${picked.profiles - 1})` : ''} продолжат работать.
            </p>
            {picked.banned ? (
              <button type="button" onClick={() => void banProfile(false)}
                className="mt-2 w-full rounded-lg py-2 text-[11px] font-bold"
                style={{ background: C.l1, color: C.green }}>
                Снять бан профиля
              </button>
            ) : (
              <button type="button" onClick={() => void banProfile(true)}
                className="mt-2 w-full rounded-lg py-2 text-[11px] font-bold"
                style={{ background: C.amber, color: '#111' }}>
                Забанить профиль
              </button>
            )}
          </div>

          {/* Блокировка учётной записи */}
          <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: C.t1 }}>
              <ShieldAlert size={12} style={{ color: C.red }} /> Заблокировать Sky ID
            </p>
            <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
              Закрывает человека целиком: все его профили, те, что он заведёт после,
              и вход. Это не бан посильнее — это другое решение.
            </p>

            {picked.blocked ? (
              <>
                {picked.blockedReason && (
                  <p className="mt-1.5 text-[10px]" style={{ color: C.t2 }}>
                    Основание: {picked.blockedReason}
                  </p>
                )}
                <button type="button" onClick={() => void blockAccount('', false)}
                  className="mt-2 w-full rounded-lg py-2 text-[11px] font-bold"
                  style={{ background: C.l1, color: C.green }}>
                  Снять блокировку
                </button>
              </>
            ) : (
              <>
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Основание — попадёт в журнал"
                  className="mt-2 w-full rounded-lg px-3 py-2 text-[11px] outline-none" style={inputStyle} />
                {blocking ? (
                  <div className="mt-2">
                    <StepUp purpose="block:account" onCode={(c) => void blockAccount(c, true)}
                      onCancel={() => setBlocking(false)} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setBlocking(true)}
                    className="mt-2 w-full rounded-lg py-2 text-[11px] font-bold"
                    style={{ background: C.red, color: '#fff' }}>
                    Заблокировать Sky ID
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {picked?.owner && (
        <p className="rounded-2xl p-3 text-[11px]" style={{ background: C.l1, color: C.t2, border: `1px solid ${C.brd}` }}>
          Это владелец сервиса. К нему запреты неприменимы — ни бан профиля, ни
          блокировка учётной записи: иначе назначенный администратор отобрал бы
          сервис у хозяина.
        </p>
      )}
    </div>
  );
};

/* ─── Курьеры: заявки на допуск и проверка паспорта ──────────────────
   Не отдельная админка — те же REST-ручки логистики (server/logistics.mjs,
   server/courierverify.mjs), что и остальной Sky Market. Скан документа
   никогда не превращается в публичную ссылку: каждый показ идёт через
   защищённый запрос с тем же токеном (fetchVerificationDocBlob), и
   каждый такой просмотр остаётся в logi_log на сервере. */

const CourierApplicationsQueue = () => {
  const [items, setItems] = useState<import('@/marketplace/logistics/types').AdminCourierListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { apiAdminListCouriers } = await import('@/marketplace/logistics/logisticsApi');
    const r = await apiAdminListCouriers(onlyPending ? { status: 'pending' } : {});
    setLoading(false);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить заявки'); return; }
    setItems(r.data.items);
  }, [onlyPending]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (courierId: string, approve: boolean) => {
    const reason = approve ? '' : (window.prompt('Причина отказа') ?? '');
    const { apiAdminDecideCourier } = await import('@/marketplace/logistics/logisticsApi');
    const r = await apiAdminDecideCourier(courierId, approve, reason);
    if (!r.ok) { setFailed(r.error === 'passport_unverified' ? 'Паспорт ещё не подтверждён' : r.error === 'underage' ? 'Курьеру нет 16 лет' : 'Не получилось решить заявку'); return; }
    void load();
  };

  const setStatus = async (courierId: string, status: 'suspended' | 'approved') => {
    const reason = window.prompt(status === 'suspended' ? 'Причина приостановки' : 'Комментарий (необязательно)') ?? '';
    const { apiAdminSetCourierStatus } = await import('@/marketplace/logistics/logisticsApi');
    const r = await apiAdminSetCourierStatus(courierId, status, reason);
    if (!r.ok) { setFailed('Не получилось изменить статус'); return; }
    void load();
  };

  if (loading) return <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOnlyPending((v) => !v)}
        className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>
        {onlyPending ? 'Показать все' : 'Только на рассмотрении'}
      </button>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заявок нет.</p>
      ) : items.map((c) => (
        <div key={c.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center gap-2">
            <Bike size={14} style={{ color: C.t3 }} />
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{c.name}</p>
            <span className="text-[10px]" style={{ color: C.t3 }}>{c.status}</span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {c.cityId} · {c.district} · возраст {c.age ?? '—'} · {fmtTs(c.createdAt)}
          </p>
          <div className="mt-2 flex gap-2">
            {c.status === 'pending' && (
              <>
                <button type="button" onClick={() => void decide(c.id, true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                  style={{ background: C.green, color: '#fff' }}>
                  <Check size={12} /> Одобрить
                </button>
                <button type="button" onClick={() => void decide(c.id, false)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                  style={{ background: C.l2, color: C.red }}>
                  <X size={12} /> Отклонить
                </button>
              </>
            )}
            {c.status === 'approved' && (
              <button type="button" onClick={() => void setStatus(c.id, 'suspended')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                style={{ background: C.l2, color: C.red }}>
                <Ban size={12} /> Приостановить
              </button>
            )}
            {c.status === 'suspended' && (
              <button type="button" onClick={() => void setStatus(c.id, 'approved')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                style={{ background: C.green, color: '#fff' }}>
                <Check size={12} /> Восстановить
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const CourierPassportQueue = () => {
  const [items, setItems] = useState<import('@/marketplace/logistics/types').VerificationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [docUrl, setDocUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { apiAdminVerificationQueue } = await import('@/marketplace/logistics/logisticsApi');
    const r = await apiAdminVerificationQueue();
    setLoading(false);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить очередь'); return; }
    setItems(r.data.items);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (docUrl) URL.revokeObjectURL(docUrl); }, [docUrl]);

  const viewDoc = async (verificationId: string) => {
    const { fetchVerificationDocBlob } = await import('@/marketplace/logistics/logisticsApi');
    const r = await fetchVerificationDocBlob(verificationId);
    if (!r.ok || !r.blob) { setFailed('Не удалось открыть документ'); return; }
    if (docUrl) URL.revokeObjectURL(docUrl);
    setDocUrl(URL.createObjectURL(r.blob));
  };

  const decide = async (verificationId: string, approve: boolean) => {
    const reason = approve ? '' : (window.prompt('Причина отказа') ?? '');
    const { apiAdminDecideVerification } = await import('@/marketplace/logistics/logisticsApi');
    const r = await apiAdminDecideVerification(verificationId, approve, reason);
    if (!r.ok) { setFailed(r.error === 'underage' ? 'Курьеру нет 16 лет' : r.error === 'no_document' ? 'Нет приложенного документа' : 'Не получилось решить заявку'); return; }
    void load();
  };

  if (loading) return <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;

  return (
    <div className="space-y-2">
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {docUrl && (
        <div className="rounded-2xl p-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>Документ</p>
            <button type="button" onClick={() => { URL.revokeObjectURL(docUrl); setDocUrl(null); }} className="text-[10px] font-bold" style={{ color: C.t3 }}>Закрыть</button>
          </div>
          {/* Ссылка живёт только в этой вкладке (object URL), никуда не публикуется. */}
          <img src={docUrl} alt="Скан документа" className="max-h-64 w-full rounded-xl object-contain" style={{ background: C.l2 }} />
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заявок на проверку паспорта нет.</p>
      ) : items.map((v) => (
        <div key={v.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>{v.fullName || v.profileName}</p>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            @{v.username} · возраст {v.age ?? '—'} · {fmtTs(v.createdAt)}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void viewDoc(v.id)} disabled={!v.hasDoc}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: C.l2, color: C.t2 }}>
              <Eye size={12} /> {v.hasDoc ? 'Документ' : 'Нет скана'}
            </button>
            <button type="button" onClick={() => void decide(v.id, true)} disabled={!v.hasDoc}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: C.green, color: '#fff' }}>
              <Check size={12} /> Подтвердить
            </button>
            <button type="button" onClick={() => void decide(v.id, false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
              style={{ background: C.l2, color: C.red }}>
              <X size={12} /> Отклонить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const CourierAdminSection = () => {
  const [sub, setSub] = useState<'applications' | 'passports'>('passports');
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {([['passports', 'Проверка паспортов'], ['applications', 'Заявки курьеров']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSub(key)}
            className="flex-1 rounded-xl py-2 text-xs font-bold"
            style={{ background: sub === key ? C.acc : C.l2, color: sub === key ? '#fff' : C.t3 }}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'passports' ? <CourierPassportQueue /> : <CourierApplicationsQueue />}
    </div>
  );
};

/* ─── Sky Family: семьи, участники, приглашения, журнал ───────────────
   Те же ручки, что и у клиента (server/family.mjs), просто через
   /api/family/admin/*: список, деталь, приостановка/восстановление.
   Ни ролью, ни владельцем, ни лимитом здесь не управляют напрямую —
   это делает семья сама; администратору доступен только просмотр и
   статус семьи целиком (например, при разборе жалобы). */

const FAMILY_ROLE_LABEL: Record<string, string> = {
  owner: 'Владелец', adult: 'Взрослый', teen: 'Подросток', child: 'Ребёнок', guest: 'Гость',
};
const FAMILY_STATUS_LABEL: Record<string, string> = {
  active: 'Активна', suspended: 'Приостановлена', closed: 'Закрыта',
};

const FamilyAdminDetail = ({ familyId, onBack, onChanged }: { familyId: string; onBack: () => void; onChanged: () => void }) => {
  const [detail, setDetail] = useState<import('@/family/familyApi').AdminFamilyDetail | null>(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminFamilyDetail } = await import('@/family/familyApi');
    const r = await apiAdminFamilyDetail(familyId);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить семью'); return; }
    setDetail(r.data);
  }, [familyId]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (status: 'active' | 'suspended') => {
    setBusy(true); setFailed('');
    const { apiAdminSetFamilyStatus } = await import('@/family/familyApi');
    const r = await apiAdminSetFamilyStatus(familyId, status);
    setBusy(false);
    if (!r.ok) { setFailed('Не получилось изменить статус'); return; }
    void load();
    onChanged();
  };

  if (!detail) {
    return failed
      ? <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>
      : <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
  }

  const { family, members, invitations, log } = detail;
  const activeMembers = members.filter((m) => m.status === 'active');

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-bold" style={{ color: C.t3 }}>← К списку семей</button>

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{family.name}</p>
          <span className="shrink-0 text-[10px] font-bold" style={{
            color: family.status === 'active' ? C.green : family.status === 'suspended' ? C.red : C.t3,
          }}>{FAMILY_STATUS_LABEL[family.status] ?? family.status}</span>
        </div>
        <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
          {activeMembers.length}/{family.memberLimit} участников · до {family.adultLimit} взрослых
          {family.primeUntil && <> · Prime до {fmtTs(family.primeUntil)}</>}
        </p>
        {failed && <p className="mt-1.5 text-[11px]" style={{ color: C.red }}>{failed}</p>}
        <div className="mt-2 flex gap-2">
          {family.status !== 'closed' && (
            family.status === 'suspended' ? (
              <button type="button" disabled={busy} onClick={() => void setStatus('active')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: C.green, color: '#fff' }}>
                <Check size={12} /> Восстановить
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void setStatus('suspended')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: C.l2, color: C.red }}>
                <Ban size={12} /> Приостановить
              </button>
            )
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>УЧАСТНИКИ</p>
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>
                  {m.role === 'owner' && <Crown size={11} style={{ color: C.amber, display: 'inline', marginRight: 4 }} />}
                  {m.name} {m.username && <span className="font-normal" style={{ color: C.t3 }}>@{m.username}</span>}
                </p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{FAMILY_ROLE_LABEL[m.role] ?? m.role}</p>
              </div>
              <span className="shrink-0 text-[10px]" style={{ color: m.status === 'active' ? C.t3 : C.red }}>
                {m.status === 'active' ? '' : m.status === 'left' ? 'вышел' : 'исключён'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {invitations.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>ПРИГЛАШЕНИЯ</p>
          <div className="space-y-1.5">
            {invitations.map((inv) => (
              <div key={inv.id} className="rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <p className="text-[11px]" style={{ color: C.t2 }}>{FAMILY_ROLE_LABEL[inv.role] ?? inv.role} · {inv.status}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(inv.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>ЖУРНАЛ</p>
          <div className="space-y-1.5">
            {log.map((e) => (
              <div key={e.id} className="rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <p className="text-[11px]" style={{ color: C.t2 }}>{e.action}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FamilyAdminSection = () => {
  const [families, setFamilies] = useState<import('@/family/familyApi').AdminFamilyRow[] | null>(null);
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminListFamilies } = await import('@/family/familyApi');
    const r = await apiAdminListFamilies(q.trim() ? { q: q.trim() } : {});
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить семьи'); return; }
    setFamilies(r.data.items);
  }, [q]);

  useEffect(() => { void load(); }, [load]);

  if (openId) return <FamilyAdminDetail familyId={openId} onBack={() => setOpenId(null)} onChanged={() => void load()} />;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название семьи или @владелец"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {families === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : families.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Семей не найдено.</p>
      ) : families.map((f) => (
        <button key={f.id} type="button" onClick={() => setOpenId(f.id)}
          className="w-full rounded-2xl p-3 text-left" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{f.name}</p>
            <span className="shrink-0 text-[10px] font-bold" style={{
              color: f.status === 'active' ? C.green : f.status === 'suspended' ? C.red : C.t3,
            }}>{FAMILY_STATUS_LABEL[f.status] ?? f.status}</span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {f.ownerName} @{f.ownerUsername} · {f.memberCount}/{f.memberLimit} участников
            {f.primeUntil && <> · Prime до {fmtTs(f.primeUntil)}</>}
          </p>
        </button>
      ))}
    </div>
  );
};

/* ─── Sky Garant: сделки, споры, force-действия ────────────────────────
   Те же ручки, что и у клиента (server/garant.mjs), через
   /api/garant/admin/*. Решение спора и force-подтверждение двигают уже
   удержанные в сделке деньги — не создают новые, поэтому здесь обычная
   проверка права 'garant', без двух ключей (тот же подход, что и у
   собственных споров Sky Market). */

const GARANT_STATUS_LABEL: Record<string, string> = {
  pending_seller: 'Ждём товар', pending_buyer: 'Ждём оплату', in_escrow: 'У гаранта',
  completed: 'Завершена', cancelled: 'Отменена', disputed: 'Спор',
};

const GarantDealAdminDetail = ({ dealId, onBack, onChanged }: { dealId: string; onBack: () => void; onChanged: () => void }) => {
  const [detail, setDetail] = useState<import('@/garant/garantApi').GarantDeal | null>(null);
  const [log, setLog] = useState<import('@/garant/garantApi').GarantLogEntry[]>([]);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [winner, setWinner] = useState<'seller_wins' | 'buyer_wins' | 'cancelled'>('seller_wins');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminDealDetail } = await import('@/garant/garantApi');
    const r = await apiAdminDealDetail(dealId);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить сделку'); return; }
    setDetail(r.data.deal); setLog(r.data.log);
  }, [dealId]);

  useEffect(() => { void load(); }, [load]);

  const forceConfirm = async (side: 'buyer' | 'seller') => {
    setBusy(true); setFailed('');
    const { apiAdminForceConfirm } = await import('@/garant/garantApi');
    const r = await apiAdminForceConfirm(dealId, side);
    setBusy(false);
    if (!r.ok) { setFailed('Не получилось подтвердить'); return; }
    void load(); onChanged();
  };

  const forceCancel = async () => {
    setBusy(true); setFailed('');
    const { apiAdminForceCancel } = await import('@/garant/garantApi');
    const r = await apiAdminForceCancel(dealId);
    setBusy(false);
    if (!r.ok) { setFailed('Не получилось отменить'); return; }
    void load(); onChanged();
  };

  const resolve = async () => {
    if (!note.trim()) { setFailed('Укажите обоснование'); return; }
    setBusy(true); setFailed('');
    const { apiAdminResolveDispute } = await import('@/garant/garantApi');
    const r = await apiAdminResolveDispute(dealId, winner, note.trim());
    setBusy(false);
    if (!r.ok) { setFailed('Не получилось вынести решение'); return; }
    setResolving(false); setNote('');
    void load(); onChanged();
  };

  if (!detail) {
    return failed
      ? <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>
      : <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-bold" style={{ color: C.t3 }}>← К списку сделок</button>

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{detail.title}</p>
          <span className="shrink-0 text-[10px] font-bold" style={{
            color: detail.status === 'completed' ? C.green : detail.status === 'disputed' ? C.red
              : detail.status === 'cancelled' ? C.t3 : C.amber,
          }}>{GARANT_STATUS_LABEL[detail.status] ?? detail.status}</span>
        </div>
        <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
          {detail.itemName} · {detail.payType === 'rubles' ? `${detail.price.toLocaleString('ru')} ₽` : `${detail.price.toLocaleString('ru')} баллов`}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.t3 }}>Продавец</p>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{detail.sellerName} <span style={{ color: C.t3 }}>@{detail.sellerUsername}</span></p>
            <p className="text-[9px]" style={{ color: detail.sellerDeposited ? C.green : C.t3 }}>{detail.sellerDeposited ? 'Товар внесён' : 'Товар не внесён'}</p>
            <p className="text-[9px]" style={{ color: detail.sellerConfirmed ? C.green : C.t3 }}>{detail.sellerConfirmed ? 'Подтвердил' : 'Не подтвердил'}</p>
          </div>
          <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.t3 }}>Покупатель</p>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{detail.buyerName} <span style={{ color: C.t3 }}>@{detail.buyerUsername}</span></p>
            <p className="text-[9px]" style={{ color: detail.buyerDeposited ? C.green : C.t3 }}>{detail.buyerDeposited ? 'Оплата внесена' : 'Оплата не внесена'}</p>
            <p className="text-[9px]" style={{ color: detail.buyerConfirmed ? C.green : C.t3 }}>{detail.buyerConfirmed ? 'Подтвердил' : 'Не подтвердил'}</p>
          </div>
        </div>

        {detail.status === 'disputed' && detail.disputeReason && (
          <div className="mt-2 rounded-xl p-2.5" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.red }}>Причина спора</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>«{detail.disputeReason}»</p>
          </div>
        )}
        {detail.disputeResult && (
          <div className="mt-2 rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.t3 }}>Решение спора</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>{detail.disputeResult} — {detail.disputeNote}</p>
          </div>
        )}

        {failed && <p className="mt-2 text-[11px]" style={{ color: C.red }}>{failed}</p>}

        {detail.status === 'disputed' && !detail.disputeResult && (
          resolving ? (
            <div className="mt-3 space-y-2">
              {([
                ['seller_wins', 'Победа продавца'], ['buyer_wins', 'Победа покупателя'], ['cancelled', 'Отмена сделки'],
              ] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setWinner(k)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
                  style={{ background: winner === k ? C.acc : C.l2, color: winner === k ? '#fff' : C.t2 }}>
                  {winner === k && <Check size={12} />}{l}
                </button>
              ))}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Обоснование решения"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void resolve()}
                  className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.acc, color: '#fff' }}>
                  Вынести решение
                </button>
                <button type="button" onClick={() => setResolving(false)} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>Отмена</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setResolving(true)}
              className="mt-3 w-full rounded-xl py-2.5 text-xs font-bold" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f6ef7)', color: '#fff' }}>
              Вынести решение по спору
            </button>
          )
        )}

        {detail.status === 'in_escrow' && (
          <div className="mt-3 flex flex-wrap gap-2">
            {!detail.sellerConfirmed && (
              <button type="button" disabled={busy} onClick={() => void forceConfirm('seller')}
                className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.acc }}>
                Force-подтвердить продавца
              </button>
            )}
            {!detail.buyerConfirmed && (
              <button type="button" disabled={busy} onClick={() => void forceConfirm('buyer')}
                className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.acc }}>
                Force-подтвердить покупателя
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void forceCancel()}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.red }}>
              Принудительно отменить
            </button>
          </div>
        )}
      </div>

      {log.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>ЖУРНАЛ</p>
          <div className="space-y-1.5">
            {log.map((e) => (
              <div key={e.id} className="rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <p className="text-[11px]" style={{ color: C.t2 }}>{e.action}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const GarantAdminSection = () => {
  const [deals, setDeals] = useState<import('@/garant/garantApi').GarantDeal[] | null>(null);
  const [status, setStatus] = useState<'' | 'disputed' | 'in_escrow' | 'completed' | 'cancelled'>('disputed');
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminListDeals } = await import('@/garant/garantApi');
    const r = await apiAdminListDeals({ status: status || undefined, q: q.trim() || undefined });
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить сделки'); return; }
    setDeals(r.data.items);
  }, [status, q]);

  useEffect(() => { void load(); }, [load]);

  if (openId) return <GarantDealAdminDetail dealId={openId} onBack={() => setOpenId(null)} onChanged={() => void load()} />;

  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['disputed', 'Споры'], ['in_escrow', 'У гаранта'], ['completed', 'Завершены'], ['cancelled', 'Отменены'], ['', 'Все']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название сделки или @участник"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {deals === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : deals.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Сделок не найдено.</p>
      ) : deals.map((d) => (
        <button key={d.id} type="button" onClick={() => setOpenId(d.id)}
          className="w-full rounded-2xl p-3 text-left" style={{ background: C.l1, border: `1px solid ${d.status === 'disputed' ? 'rgba(248,113,113,0.3)' : C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{d.title}</p>
            <span className="shrink-0 text-[10px] font-bold" style={{
              color: d.status === 'completed' ? C.green : d.status === 'disputed' ? C.red
                : d.status === 'cancelled' ? C.t3 : C.amber,
            }}>{GARANT_STATUS_LABEL[d.status] ?? d.status}</span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {d.sellerName} → {d.buyerName} · {d.payType === 'rubles' ? `${d.price.toLocaleString('ru')} ₽` : `${d.price.toLocaleString('ru')} баллов`}
          </p>
        </button>
      ))}
    </div>
  );
};

/* ─── Панель ───────────────────────────────────────────────────────── */

type Tab = 'overview' | 'people' | 'pending' | 'admins' | 'grant' | 'video' | 'pulse' | 'campaigns' | 'gifts' | 'couriers' | 'family' | 'garant' | 'log' | 'events';

export const AdminPanel = () => {
  const [rights, setRights] = useState<MyRights | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [integrity, setIntegrity] = useState<{ intact: boolean; checked: number } | null>(null);
  const [lockStep, setLockStep] = useState(false);
  const [failed, setFailed] = useState('');

  const loadRights = useCallback(async () => {
    const r = await adminCall({ action: 'whoami' });
    /* Панель рисует то, что ответил сервер, и ничего сверх: поля,
       которых он не прислал, означают «нет», а не «наверное, есть». */
    setRights(r.type === 'admin-me' ? {
      admin: r.payload.admin === true,
      owner: r.payload.owner === true,
      role: r.payload.role ?? null,
      roleLabel: r.payload.roleLabel ?? '',
      permissions: r.payload.permissions ?? [],
      legacy: r.payload.legacy === true,
      twoFactor: r.payload.twoFactor === true,
      twoFactorDue: r.payload.twoFactorDue ?? null,
      twoFactorRequired: r.payload.twoFactorRequired === true,
      lockdown: r.payload.lockdown ?? { active: false, reason: '', since: null },
    } : {
      admin: false, owner: false, role: null, roleLabel: '',
      permissions: [], legacy: false,
      twoFactor: false, twoFactorDue: null, twoFactorRequired: false,
      lockdown: { active: false, reason: '', since: null },
    });
  }, []);

  useEffect(() => { void loadRights(); }, [loadRights]);

  const has = (p: AdminPermission) => rights?.permissions?.includes(p) ?? false;

  const loadPending = useCallback(async () => {
    const r = await adminCall({ action: 'pending', limit: 50 });
    if (r.type === 'admin-pending-list') setActions(r.payload.actions ?? []);
  }, []);

  const loadAdmins = useCallback(async () => {
    const r = await adminCall({ action: 'admins' });
    if (r.type === 'admin-list') {
      setAdmins(r.payload.admins ?? []);
      setRoles(r.payload.roles ?? []);
    }
  }, []);

  const loadLog = useCallback(async () => {
    const r = await adminCall({ action: 'log', limit: 100 });
    if (r.type === 'admin-log') setLog(r.payload.entries ?? []);
  }, []);

  const loadEvents = useCallback(async () => {
    const r = await adminCall({ action: 'security-events', limit: 100 });
    if (r.type === 'admin-security-events') setEvents(r.payload.events ?? []);
  }, []);

  useEffect(() => {
    if (tab === 'pending') void loadPending();
    if (tab === 'admins') void loadAdmins();
    if (tab === 'log') void loadLog();
    if (tab === 'events') void loadEvents();
  }, [tab, loadPending, loadAdmins, loadLog, loadEvents]);

  const setLockdown = async (code: string, on: boolean) => {
    setLockStep(false); setFailed('');
    const r = await adminCall({ action: 'set-lockdown', on, code, reason: 'Из панели' });
    if (r.type !== 'admin-lockdown') { setFailed(errorText(r.payload?.error)); return; }
    void loadRights();
  };

  if (!rights) {
    return <div className="grid place-items-center py-12"><Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} /></div>;
  }

  if (!rights.admin) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <Shield size={22} style={{ color: C.t3 }} />
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Панель закрыта</p>
        <p className="max-w-[260px] text-xs" style={{ color: C.t3 }}>
          Доступ выдаёт владелец сервиса.
        </p>
      </div>
    );
  }

  if (rights.twoFactorRequired) {
    /* Прав здесь уже нет — сервер вернул пустой набор permissions.
       Это единственный экран, который объясняет, почему: без него
       выглядело бы так, будто права сняли, а не так, будто их не
       выдадут без второго фактора. */
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <ShieldAlert size={22} style={{ color: C.red }} />
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Нужен второй фактор</p>
        <p className="max-w-[280px] text-xs" style={{ color: C.t3 }}>
          Срок на включение прошёл. Один код на почту больше не открывает
          панель — учётную запись с этими правами не защитить одним
          фактором. Включите двухэтапную защиту в настройках Sky ID,
          и права вернутся сразу, без нового входа.
        </p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Обзор', show: true },
    { key: 'people', label: 'Люди', show: has('moderation') },
    { key: 'pending', label: 'Заявки', show: true },
    { key: 'grant', label: 'Начисления', show: has('finance') },
    { key: 'video', label: 'Sky Video', show: has('content') || has('finance') },
    { key: 'pulse', label: 'Prime Pulse', show: has('content') },
    { key: 'campaigns', label: 'Мероприятия', show: has('campaigns') },
    { key: 'gifts', label: 'Подарки', show: has('gifts') },
    { key: 'couriers', label: 'Курьеры', show: has('logistics') },
    { key: 'family', label: 'Sky Family', show: has('moderation') },
    { key: 'garant', label: 'Sky Garant', show: has('garant') },
    { key: 'admins', label: 'Администраторы', show: has('security') },
    { key: 'log', label: 'Журнал', show: has('security') },
    { key: 'events', label: 'События', show: has('security') },
  ];

  return (
    <div className="space-y-3 p-4">
      {!rights.owner && !rights.twoFactor && rights.twoFactorDue && (
        /* Предупреждение, а не отказ: срок ещё не наступил, права
           работают. Молчать до последнего дня значило бы, что человек
           узнаёт о запрете, только когда панель уже закрылась. */
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]"
          style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: C.t2 }}>
          <ShieldAlert size={13} style={{ color: C.red, flexShrink: 0 }} />
          <span>
            Второй фактор не включён. С {fmtTs(rights.twoFactorDue)} без него панель
            перестанет отвечать — включите в настройках Sky ID.
          </span>
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TABS.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: tab === t.key ? C.acc : C.l2, color: tab === t.key ? '#fff' : C.t3 }}>
            {t.label}
          </button>
        ))}
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {rights.lockdown.active && (
        <div className="flex items-start gap-2 rounded-2xl p-3"
          style={{ background: 'rgba(255,80,80,0.08)', border: `1px solid ${C.red}` }}>
          <ShieldAlert size={14} style={{ color: C.red, flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-xs font-bold" style={{ color: C.red }}>Аварийный режим</p>
            <p className="text-[11px]" style={{ color: C.t2 }}>
              Административные действия закрыты с {fmtTs(rights.lockdown.since)}.
              Обычная работа сервиса продолжается.
            </p>
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
              {rights.owner ? <Crown size={13} style={{ color: C.amber }} />
                : <ShieldCheck size={13} style={{ color: C.acc }} />}
              {rights.roleLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {rights.permissions.map((p) => (
                <span key={p} className="rounded-lg px-2 py-0.5 text-[10px]"
                  style={{ background: C.l2, color: C.t2 }}>
                  {PERMISSION_LABEL[p] ?? p}
                </span>
              ))}
              {rights.permissions.length === 0 && (
                <span className="text-[10px]" style={{ color: C.t3 }}>Только чтение</span>
              )}
            </div>
            {rights.legacy && (
              <p className="mt-2 flex items-start gap-1.5 text-[10px]" style={{ color: C.amber }}>
                <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                Роль не назначена, поэтому права полные — так было до появления ролей.
                Попросите владельца назначить подходящую.
              </p>
            )}
          </div>

          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>КАК УСТРОЕНА ПАНЕЛЬ</p>
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: C.t2 }}>
              Опасное делается в два ключа: администратор оформляет заявку, подтверждает
              владелец. Перед оформлением сервер спрашивает подтверждение личности —
              украденная сессия не должна сразу открывать критические действия.
              Каждое действие попадает в журнал, скреплённый цепочкой отпечатков.
            </p>
          </div>

          {rights.owner && (
            <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[10px] font-bold" style={{ color: C.t3 }}>АВАРИЙНЫЙ РЕЖИМ</p>
              <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
                Закрывает панель целиком и отключает открытые административные подключения.
                Обычная жизнь сервиса при этом продолжается.
              </p>
              {lockStep ? (
                <div className="mt-2">
                  <StepUp purpose="lockdown"
                    onCode={(c) => void setLockdown(c, !rights.lockdown.active)}
                    onCancel={() => setLockStep(false)} />
                </div>
              ) : (
                <button type="button" onClick={() => setLockStep(true)}
                  className="mt-2 w-full rounded-xl py-2.5 text-xs font-bold"
                  style={{
                    background: rights.lockdown.active ? C.l2 : C.red,
                    color: rights.lockdown.active ? C.green : '#fff',
                  }}>
                  {rights.lockdown.active ? 'Снять аварийный режим' : 'Включить аварийный режим'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'pending' && (
        <>
          <button type="button" onClick={() => void loadPending()}
            className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
            <RefreshCw size={11} /> Обновить
          </button>
          <PendingList rights={rights} actions={actions} onChanged={() => void loadPending()} />
        </>
      )}

      {tab === 'people' && <PeopleTab canModerate={has('moderation')} />}

      {tab === 'grant' && <GrantForm onSent={() => void loadPending()} />}
      {tab === 'video' && <SkyVideoAdminSection rights={rights} onPendingChanged={() => void loadPending()} />}
      {tab === 'pulse' && <PrimePulseAdminSection />}
      {tab === 'campaigns' && <CampaignsAdminSection onPendingChanged={() => void loadPending()} />}
      {tab === 'gifts' && <GiftsAdminSection />}
      {tab === 'couriers' && <CourierAdminSection />}
      {tab === 'family' && <FamilyAdminSection />}
      {tab === 'garant' && <GarantAdminSection />}

      {tab === 'admins' && (
        <>
          <p className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>
            <Users size={11} /> АДМИНИСТРАТОРЫ
          </p>
          <AdminsList admins={admins} roles={roles} onChanged={() => void loadAdmins()} />
        </>
      )}

      {tab === 'log' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void loadLog()}
              className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
              <RefreshCw size={11} /> Обновить
            </button>
            <button type="button"
              onClick={() => void adminCall({ action: 'verify-log' }).then((r) => {
                if (r.type === 'admin-log-verified') {
                  setIntegrity({
                    intact: r.payload.intact === true,
                    checked: r.payload.checked ?? 0,
                  });
                }
              })}
              className="flex items-center gap-1.5 text-[11px]" style={{ color: C.acc }}>
              <ScrollText size={11} /> Проверить целостность
            </button>
          </div>

          {integrity && (
            <p className="text-[11px]" style={{ color: integrity.intact ? C.green : C.red }}>
              {integrity.intact
                ? `Цепочка цела, проверено записей: ${integrity.checked}`
                : 'Цепочка расходится — журнал правили. Это само по себе событие безопасности.'}
            </p>
          )}

          {log.map((e) => (
            <div key={e.id} className="rounded-xl px-3 py-2"
              style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold" style={{
                  color: e.result === 'ok' ? C.t1 : C.red,
                }}>{e.type}</p>
                <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}</span>
              </div>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                {e.actorRole ? `${ROLE_LABEL[e.actorRole] ?? e.actorRole} · ` : ''}
                {e.result !== 'ok' ? `${e.result} · ` : ''}{e.detail}
              </p>
            </div>
          ))}
          {log.length === 0 && (
            <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Журнал пуст.</p>
          )}
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-2">
          <button type="button" onClick={() => void loadEvents()}
            className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
            <RefreshCw size={11} /> Обновить
          </button>
          {events.map((e) => (
            <div key={e.id} className="rounded-xl px-3 py-2"
              style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold" style={{ color: C.t1 }}>{e.kind}</p>
                <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}</span>
              </div>
              {e.detail && <p className="text-[10px]" style={{ color: C.t3 }}>{e.detail}</p>}
            </div>
          ))}
          {events.length === 0 && (
            <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Событий нет.</p>
          )}
        </div>
      )}
    </div>
  );
};

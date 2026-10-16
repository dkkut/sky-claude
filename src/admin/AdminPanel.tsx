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
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Loader2, Check, X, KeyRound,
  Wallet, Crown, ScrollText, AlertTriangle, RefreshCw, Users, Ban, Trophy,
  Eye, Bike, Trash2, MessageCircle, Copy,
} from 'lucide-react';
import {
  adminCall, errorText, ROLE_LABEL, PERMISSION_LABEL,
  type MyRights, type AdminRow, type PendingAction, type LogEntry, type SecurityEvent,
  type AdminPermission, type Person,
} from './adminWire';
import { COUNTRIES } from '@/region/types';
import { AD_PLACEMENTS, AD_STATUS_LABEL, AD_STATUS_COLOR, AD_FORMAT_LABEL, fmtBudget, campaignMediaUrl } from '@/ads/store';
import type { PetRarity, PetAvailability, SkinItemType, SkinAvailability } from '@/messenger/petsApi';
/* Остальное из violationsApi.ts грузится по требованию (dynamic import,
   см. ниже) — файл большой, а открывает его не каждый администратор.
   evidenceFileUrl — чистая функция (собирает адрес, байтов не носит),
   её держим статической: она нужна прямо в JSX, а не в обработчике. */
import { evidenceFileUrl } from '@/marketplace/violationsApi';

import { CodesAdminSection } from '@/codes/CodesAdmin';
import { MarketVerifyAdmin } from '@/marketplace/MarketVerifyAdmin';
import { BloxAdminSection } from '@/blox/BloxAdmin';
import { MonitoringTab } from './MonitoringTab';

import { ContentModTab } from './ContentModTab';
import { ScrollTabs } from './ScrollTabs';
import { RegistrationTab } from './RegistrationTab';
import { SiteTab } from './SiteTab';
import { ModulesTab } from './ModulesTab';
import { SkyKassaTab } from './SkyKassaTab';
import { StorageTab } from './StorageTab';
import { GoAdminTab } from './GoAdmin';
import { AdminGateScreen } from './AdminGate';
const C = {
  bg: 'var(--bg-l1)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)', purple: 'var(--purple)',
};

const inputStyle = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

/* ─── Регионы: общий список кодов (src/region/types.ts) ──────────────
   Тот же справочник стран, что и в уже существующем RegionPicker —
   ничего здесь заново не заводится, только выбор из того же списка. */

const RegionMultiSelect = ({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) => {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = needle
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(needle) || c.nameEn.toLowerCase().includes(needle) || c.code.toLowerCase() === needle)
    : COUNTRIES;
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);

  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск региона"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-xl p-2" style={{ background: C.l2 }}>
        {list.map((c) => (
          <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]" style={{ color: C.t2 }}>
            <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)} />
            <span>{c.flag} {c.name}</span>
          </label>
        ))}
        {list.length === 0 && <p className="px-2 py-3 text-center text-[11px]" style={{ color: C.t3 }}>Не найдено</p>}
      </div>
      <p className="text-[10px]" style={{ color: C.t3 }}>
        {value.length === 0
          ? 'Доступен во всех регионах.'
          : `Заблокирован в: ${value.map((code) => COUNTRIES.find((c) => c.code === code)?.name ?? code).join(', ')}`}
      </p>
    </div>
  );
};

/* ─── Bloom: региональная доступность постов ─────────────────────────── */

const BloomAdminSection = () => {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<import('@/bloom/bloomApi').AdminBloomPost[] | null>(null);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [regions, setRegions] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setFailed('');
    const { apiBloomAdminSearchPosts } = await import('@/bloom/bloomApi');
    setItems(await apiBloomAdminSearchPosts(q.trim() || undefined));
  }, [q]);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (post: import('@/bloom/bloomApi').AdminBloomPost) => {
    setEditing(post.id); setRegions(post.blockedRegions); setReason('');
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setFailed('');
    const { apiBloomSetPostRegions } = await import('@/bloom/bloomApi');
    const r = await apiBloomSetPostRegions(editing, regions, reason.trim() || undefined);
    setSaving(false);
    if (!r.ok) { setFailed('Не удалось сохранить региональные ограничения'); return; }
    setEditing(null);
    void load();
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        По умолчанию пост доступен во всех регионах. Заблокированные регионы проверяются на
        сервере при любой попытке получить пост — из ленты, профиля автора, поиска, «популярного»
        или напрямую по ссылке; изменить id в запросе для обхода нельзя.
      </p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ник автора или id поста"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Постов не найдено.</p>
      ) : items.map((p) => (
        <div key={p.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>
                {p.authorName} <span className="font-normal" style={{ color: C.t3 }}>@{p.authorUsername}</span>
              </p>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: C.t2 }}>{p.text || '(без текста)'}</p>
            </div>
            <button type="button" onClick={() => startEdit(p)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
              style={{ background: p.blockedRegions.length ? 'rgba(248,113,113,0.15)' : C.l2, color: p.blockedRegions.length ? C.red : C.t2 }}>
              {p.blockedRegions.length ? `Заблокирован (${p.blockedRegions.length})` : 'Региональная доступность'}
            </button>
          </div>
          {editing === p.id && (
            <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: C.brd }}>
              <RegionMultiSelect value={regions} onChange={setRegions} />
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (необязательно, для журнала)"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void save()}
                  className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
                  Сохранить
                </button>
                <button type="button" onClick={() => setEditing(null)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

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

/** Реальное состояние владения NFT-подарками и покупок (server/giftshealth.mjs). Только чтение. */
const GiftsHealthPanel = () => {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const { apiCall } = await import('@/core/auth/api');
    const r = await apiCall<any>('/api/gifts/admin/health');
    if (r.ok && r.data) setD(r.data); else setErr('Не удалось загрузить диагностику');
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p className="text-xs" style={{ color: C.red }}>{err}</p>;
  if (!d) return <p className="text-xs" style={{ color: C.t3 }}>Загрузка…</p>;
  const row = (label: string, value: React.ReactNode, bad = false) => (
    <div className="flex justify-between gap-2 text-xs"><span style={{ color: C.t2 }}>{label}</span><b style={{ color: bad ? C.red : C.t1 }}>{value}</b></div>
  );
  const list = (title: string, items: any[], fmt: (x: any) => string) => items.length > 0 && (
    <details className="text-[11px]" style={{ color: C.t2 }}><summary style={{ color: C.red }}>{title}: {items.length}</summary>
      {items.map((x, i) => <p key={i} translate="no">{fmt(x)}</p>)}</details>
  );
  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-sm font-bold" style={{ color: C.t1 }}>Владение и покупки подарков</p>
      <div className="space-y-1">
        {row('Подарков NFT в каталоге, у которых уже есть запись владельца', d.nft.materialized)}
        {row('Принадлежат Sky Mint (платформе, продаются по цене каталога)', d.nft.mint)}
        {row('Принадлежат настоящим профилям', d.nft.realOwners)}
        {row('Покупок за 7 дней', `${d.nft.purchases7d.count} · ${d.nft.purchases7d.rub.toLocaleString('ru-RU')} ₽`)}
        {row('Остатки прежних демонстрационных владельцев', d.nft.demoOwners.length, d.nft.demoOwners.length > 0)}
        {row('Владельцы, которых нет среди профилей', d.nft.unknownOwners.length, d.nft.unknownOwners.length > 0)}
        {row('Лоты, у которых продавец уже не владелец', d.nft.staleListings.length, d.nft.staleListings.length > 0)}
        {row('Списано за NFT, но подарок не выдан', d.nft.paidNotDelivered.length, d.nft.paidNotDelivered.length > 0)}
        {row('Обычные подарки: заказы по статусам', Object.entries(d.orders.byStatus).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'нет')}
        {row('Заказы, застрявшие без оплаты более 10 минут', d.orders.stuck.length, d.orders.stuck.length > 0)}
        {row('Каталог обычных подарков: активных / всего', `${d.catalog.active ?? '—'} / ${d.catalog.total ?? '—'}`)}
      </div>
      {list('Демонстрационные владельцы', d.nft.demoOwners, (x) => `${x.nftId} → ${x.ownerName} (${x.ownerId})`)}
      {list('Неизвестные владельцы', d.nft.unknownOwners, (x) => `${x.nftId} → ${x.ownerName} (${x.ownerId})`)}
      {list('Протухшие лоты', d.nft.staleListings, (x) => `${x.id} · ${x.nftId} · продавец ${x.sellerId}`)}
      {list('Оплачено, не выдано (возврат — через «Начисления → Баланс и операции человека»)', d.nft.paidNotDelivered, (x) => `${x.txId} · ${x.userId} · ${x.amount} ₽ · ${x.at}`)}
      {list('Застрявшие заказы', d.orders.stuck, (x) => `${x.id} · ${x.buyerId} · ${x.price} · ${x.at}`)}
      <p className="text-[10px]" style={{ color: C.t3 }}>Раздел только показывает данные. Владельцев и историю он не меняет и не удаляет.</p>
    </div>
  );
};

const GiftsAdminSection = () => {
  const [sub, setSub] = useState<'catalog' | 'prime-card' | 'health'>('catalog');
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {([['catalog', 'Каталог подарков'], ['prime-card', 'Карточка Prime'], ['health', 'Диагностика']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSub(key)}
            className="flex-1 rounded-xl py-2 text-xs font-bold"
            style={{ background: sub === key ? C.acc : C.l2, color: sub === key ? '#fff' : C.t3 }}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'catalog' ? <GiftsCatalogList /> : sub === 'prime-card' ? <PrimeCardMediaPanel /> : <GiftsHealthPanel />}
    </div>
  );
};

/* ─── Sky Pets + Sky Skin Market ──────────────────────────────────────
   Та же гейтовка правом content, что сервер проверяет сам
   (server/routes/pets.mjs: can(me,'content')) — у фичи нет отдельного
   права, своего админ-роутера тоже нет, см. комментарий там же.
   Выдача Pet Coins — ВСЕГДА заявка в очередь владельца
   (adminsec.createPendingAction), поэтому форма ниже не утверждает
   «начислено», а прямо говорит «отправлено на подтверждение». */

const PET_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'] as const;
const SKIN_ITEM_TYPES = ['skin', 'outfit', 'headwear', 'accessory', 'aura', 'effect', 'animation', 'background', 'trail', 'emote'] as const;
const SKIN_AVAILABILITIES = ['unlimited', 'limited', 'event', 'exclusive'] as const;

const PetTypesAdminSection = () => {
  const [types, setTypes] = useState<import('@/messenger/petsApi').PetType[] | null>(null);
  const [failed, setFailed] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', species: '', description: '', color: '#8b5cf6', rarity: 'common', availableFrom: 'shop', pricePetCoins: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setFailed('');
    const { apiPetTypes } = await import('@/messenger/petsApi');
    const r = await apiPetTypes();
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить каталог типов'); return; }
    setTypes(r.data.types);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setSaving(true); setFailed('');
    const { apiAdminCreatePetType } = await import('@/messenger/petsApi');
    const r = await apiAdminCreatePetType({
      name: form.name.trim(), species: form.species.trim(), description: form.description.trim(),
      color: form.color, rarity: form.rarity as PetRarity, availableFrom: form.availableFrom as PetAvailability,
      pricePetCoins: form.availableFrom === 'shop' ? Math.max(0, Math.trunc(Number(form.pricePetCoins) || 0)) : undefined,
    });
    setSaving(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось создать тип — проверь поля'); return; }
    setCreating(false);
    setForm({ name: '', species: '', description: '', color: '#8b5cf6', rarity: 'common', availableFrom: 'shop', pricePetCoins: '' });
    void load();
  };

  const retire = async (id: string) => {
    const { apiAdminRetirePetType } = await import('@/messenger/petsApi');
    await apiAdminRetirePetType(id);
    void load();
  };

  return (
    <div className="space-y-2">
      {creating ? (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex gap-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Имя"
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
            <input value={form.species} onChange={(e) => setForm((f) => ({ ...f, species: e.target.value }))} placeholder="Вид (напр. Кот)"
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          </div>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Описание" rows={2}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          <div className="flex gap-2">
            <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              className="h-9 w-12 rounded-xl" style={{ background: C.l2, border: `1px solid ${C.brd}` }} />
            <select value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))}
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
              {PET_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={form.availableFrom} onChange={(e) => setForm((f) => ({ ...f, availableFrom: e.target.value }))}
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
              {(['shop', 'starter', 'event', 'achievement'] as const).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {form.availableFrom === 'shop' && (
            <input value={form.pricePetCoins} onChange={(e) => setForm((f) => ({ ...f, pricePetCoins: e.target.value }))}
              type="number" min={0} placeholder="Цена, Pet Coins"
              className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          )}
          {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={saving || !form.name.trim() || !form.species.trim()} onClick={() => void create()}
              className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
              Создать тип
            </button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="w-full rounded-2xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
          + Новый тип питомца
        </button>
      )}

      {failed && !creating && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {types === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : types.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Каталог пуст.</p>
      ) : types.map((t) => (
        <div key={t.id} className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="h-8 w-8 shrink-0 rounded-full" style={{ background: t.color }} />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{t.name} <span className="font-normal" style={{ color: C.t3 }}>· {t.species}</span></p>
            <p className="text-[10px]" style={{ color: C.t3 }}>{t.rarity} · {t.availableFrom}{t.pricePetCoins != null ? ` · ${t.pricePetCoins} 🪙` : ''}</p>
          </div>
          {t.status !== 'retired' && (
            <button type="button" onClick={() => void retire(t.id)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>
              Снять с продажи
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

const PetEconomyAdminSection = () => {
  const [stats, setStats] = useState<import('@/messenger/petsApi').PetEconomyStats | null>(null);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminEconomyStats } = await import('@/messenger/petsApi');
    const r = await apiAdminEconomyStats();
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить статистику'); return; }
    setStats(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => void load()} className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
        <RefreshCw size={11} /> Обновить
      </button>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {stats === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {([
            ['Выпущено', stats.generated, C.green],
            ['Потрачено', stats.spent, C.t2],
            ['Сожжено', stats.burned, C.red],
            ['В обороте', stats.circulating, C.amber],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[10px] font-bold" style={{ color: C.t3 }}>{label.toUpperCase()}</p>
              <p className="mt-1 text-lg font-black" style={{ color }}>{value.toLocaleString('ru')} 🪙</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Pet Coins — отдельная от Sky Money валюта: не выводится, не обменивается на рубли, не переводится между пользователями напрямую.
      </p>
    </div>
  );
};

const PetCoinsGrantForm = () => {
  const [profileId, setProfileId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState(false);

  const send = async () => {
    setBusy(true); setFailed(''); setSent(false);
    const { apiAdminGrantPetCoins } = await import('@/messenger/petsApi');
    const r = await apiAdminGrantPetCoins(profileId.trim(), Math.max(0, Math.trunc(Number(amount) || 0)), reason.trim());
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не получилось оформить заявку'); return; }
    setSent(true); setProfileId(''); setAmount(''); setReason('');
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Это НЕ прямое начисление: заявка уходит в очередь владельца (второй ключ) — Pet Coins появятся
        на счету только после его подтверждения, как и обычные деньги/баллы/Prime.
      </p>
      <input value={profileId} onChange={(e) => setProfileId(e.target.value)} placeholder="Sky ID получателя"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={1} placeholder="Сумма, Pet Coins"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (для журнала и владельца)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>Заявка отправлена в очередь владельца.</p>}
      <button type="button" disabled={busy || !profileId.trim() || !amount} onClick={() => void send()}
        className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
        Оформить заявку на начисление
      </button>
    </div>
  );
};

const emptySkinItemForm = () => ({
  name: '', description: '', itemType: 'skin', rarity: 'common', availability: 'unlimited',
  supply: '', petTypeId: '', pricePetCoins: '', priceSkyMoneyKopecks: '',
  modelMediaId: '', modelMime: '',
});

const SkinItemForm = ({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) => {
  const [form, setForm] = useState(emptySkinItemForm);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const save = async () => {
    setBusy(true); setFailed('');
    const { apiAdminCreateSkinItem } = await import('@/messenger/petsApi');
    const r = await apiAdminCreateSkinItem({
      name: form.name.trim(), description: form.description.trim() || undefined,
      itemType: form.itemType as SkinItemType, rarity: form.rarity as PetRarity, availability: form.availability as SkinAvailability,
      supply: form.availability === 'limited' ? Math.max(1, Math.trunc(Number(form.supply) || 0)) : undefined,
      petTypeId: form.petTypeId.trim() || undefined,
      pricePetCoins: form.pricePetCoins ? Math.max(0, Math.trunc(Number(form.pricePetCoins))) : undefined,
      priceSkyMoneyKopecks: form.priceSkyMoneyKopecks ? Math.max(0, Math.trunc(Number(form.priceSkyMoneyKopecks))) : undefined,
      modelMediaId: form.modelMediaId.trim() || undefined, modelMime: form.modelMime.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось создать — проверь поля (нужна хотя бы одна цена)'); return; }
    onSaved();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex gap-2">
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Название"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <select value={form.itemType} onChange={(e) => setForm((f) => ({ ...f, itemType: e.target.value }))}
          className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
          {SKIN_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Описание" rows={2}
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="flex gap-2">
        <select value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))}
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
          {PET_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={form.availability} onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))}
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
          {SKIN_AVAILABILITIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {form.availability === 'limited' && (
        <input value={form.supply} onChange={(e) => setForm((f) => ({ ...f, supply: e.target.value }))} type="number" min={1}
          placeholder="Лимит экземпляров" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      )}
      <input value={form.petTypeId} onChange={(e) => setForm((f) => ({ ...f, petTypeId: e.target.value }))}
        placeholder="Привязать к типу питомца (id, необязательно)" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="flex gap-2">
        <input value={form.pricePetCoins} onChange={(e) => setForm((f) => ({ ...f, pricePetCoins: e.target.value }))} type="number" min={0}
          placeholder="Цена, Pet Coins" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <input value={form.priceSkyMoneyKopecks} onChange={(e) => setForm((f) => ({ ...f, priceSkyMoneyKopecks: e.target.value }))} type="number" min={0}
          placeholder="или цена, копейки Sky Money" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      </div>
      <p className="text-[10px]" style={{ color: C.t3 }}>
        Превью-картинку можно загрузить после создания предмета — кнопкой «Превью» в списке.
      </p>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !form.name.trim()} onClick={() => void save()}
          className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          Создать предмет
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
          Отмена
        </button>
      </div>
    </div>
  );
};

const SkinPreviewUpload = ({ itemId }: { itemId: string }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setFailed(false); setDone(false);
    const { apiAdminUploadSkinPreview } = await import('@/messenger/petsApi');
    const r = await apiAdminUploadSkinPreview(itemId, file);
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed(true); return; }
    setDone(true);
  };

  return (
    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold"
      style={{ background: C.l2, color: failed ? C.red : C.t2 }}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : done ? <Check size={11} style={{ color: C.green }} /> : null}
      Превью
      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e)} />
    </label>
  );
};

const SkinItemSalesView = ({ itemId, onBack }: { itemId: string; onBack: () => void }) => {
  const [owners, setOwners] = useState<import('@/messenger/petsApi').SkinSaleOwner[] | null>(null);
  useEffect(() => {
    void (async () => {
      const { apiAdminSkinItemSales } = await import('@/messenger/petsApi');
      const r = await apiAdminSkinItemSales(itemId);
      if (r.ok && r.data) setOwners(r.data.owners);
    })();
  }, [itemId]);
  return (
    <div className="space-y-2">
      <button type="button" onClick={onBack} className="text-[11px]" style={{ color: C.t3 }}>← Назад</button>
      {owners === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : owners.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Пока никто не купил.</p>
      ) : owners.map((o, i) => (
        <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs" style={{ color: C.t1 }}>{o.name} <span style={{ color: C.t3 }}>@{o.username}</span></p>
          <p className="text-[10px]" style={{ color: C.t3 }}>{o.instanceNumber != null ? `#${o.instanceNumber} · ` : ''}{o.acquiredVia} · {fmtTs(o.acquiredAt)}</p>
        </div>
      ))}
    </div>
  );
};

const SkinMarketAdminSection = () => {
  const [items, setItems] = useState<import('@/messenger/petsApi').SkinItem[] | null>(null);
  const [failed, setFailed] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', pricePetCoins: '', priceSkyMoneyKopecks: '', supply: '' });
  const [salesOf, setSalesOf] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminListSkinItems } = await import('@/messenger/petsApi');
    const r = await apiAdminListSkinItems();
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить предметы'); return; }
    setItems(r.data.items);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const startEdit = (it: import('@/messenger/petsApi').SkinItem) => {
    setEditing(it.id);
    setEditForm({ name: it.name, description: it.description, pricePetCoins: String(it.pricePetCoins ?? ''), priceSkyMoneyKopecks: String(it.priceSkyMoneyKopecks ?? ''), supply: String(it.supply ?? '') });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { apiAdminUpdateSkinItem } = await import('@/messenger/petsApi');
    const r = await apiAdminUpdateSkinItem(editing, {
      name: editForm.name.trim(), description: editForm.description.trim(),
      pricePetCoins: editForm.pricePetCoins ? Math.max(0, Math.trunc(Number(editForm.pricePetCoins))) : null,
      priceSkyMoneyKopecks: editForm.priceSkyMoneyKopecks ? Math.max(0, Math.trunc(Number(editForm.priceSkyMoneyKopecks))) : null,
      supply: editForm.supply ? Math.max(1, Math.trunc(Number(editForm.supply))) : undefined,
    });
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось сохранить'); return; }
    setEditing(null);
    void load();
  };

  const retire = async (id: string) => {
    const { apiAdminRetireSkinItem } = await import('@/messenger/petsApi');
    await apiAdminRetireSkinItem(id);
    void load();
  };

  if (salesOf) return <SkinItemSalesView itemId={salesOf} onBack={() => setSalesOf(null)} />;

  return (
    <div className="space-y-2">
      {creating ? (
        <SkinItemForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="w-full rounded-2xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
          + Новый предмет
        </button>
      )}
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Предметов пока нет.</p>
      ) : items.map((it) => (
        <div key={it.id} className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{it.name}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                {it.itemType} · {it.rarity} · {it.availability}
                {it.supply != null ? ` · ${it.remaining ?? 0}/${it.supply}` : ''}
                {it.pricePetCoins != null ? ` · ${it.pricePetCoins} 🪙` : ''}
                {it.priceSkyMoneyKopecks != null ? ` · ${(it.priceSkyMoneyKopecks / 100).toLocaleString('ru')} ₽` : ''}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: it.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: it.status === 'active' ? C.green : C.red }}>
              {it.status === 'active' ? 'активен' : 'снят'}
            </span>
          </div>

          {editing === it.id ? (
            <div className="space-y-2 border-t pt-2" style={{ borderColor: C.brd }}>
              <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              {it.remaining === null || it.remaining === it.supply ? null : (
                <p className="text-[10px]" style={{ color: C.amber }}>Уже были продажи — цену/лимит менять нельзя (сервер заблокирует).</p>
              )}
              <div className="flex gap-2">
                <input value={editForm.pricePetCoins} onChange={(e) => setEditForm((f) => ({ ...f, pricePetCoins: e.target.value }))}
                  type="number" placeholder="Pet Coins" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
                <input value={editForm.priceSkyMoneyKopecks} onChange={(e) => setEditForm((f) => ({ ...f, priceSkyMoneyKopecks: e.target.value }))}
                  type="number" placeholder="копейки ₽" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveEdit()} className="flex-1 rounded-xl py-1.5 text-[11px] font-bold" style={{ background: C.acc, color: '#fff' }}>Сохранить</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t3 }}>Отмена</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => startEdit(it)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>Изменить</button>
              <SkinPreviewUpload itemId={it.id} />
              <button type="button" onClick={() => setSalesOf(it.id)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>Продажи</button>
              {it.status === 'active' && (
                <button type="button" onClick={() => void retire(it.id)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>Снять с продажи</button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const CUSTOMIZATION_CATEGORY_LABEL: Record<string, string> = {
  frame: 'Рамки', banner: 'Баннеры чата', profileTheme: 'Темы профиля', chatListStyle: 'Список чатов',
};

const CustomizationAdminSection = () => {
  const [items, setItems] = useState<import('@/customization/customizationApi').AdminCatalogItem[] | null>(null);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [grantProfile, setGrantProfile] = useState('');
  const [grantItem, setGrantItem] = useState('');
  const [grantMsg, setGrantMsg] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminCustomizationCatalog } = await import('@/customization/customizationApi');
    const list = await apiAdminCustomizationCatalog();
    if (!list.length) { setFailed('Не удалось загрузить каталог'); return; }
    setItems(list);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const savePrice = async (id: string) => {
    const { apiAdminSetCustomizationPrice } = await import('@/customization/customizationApi');
    const price = Math.max(1, Math.trunc(Number(priceDraft)));
    const r = await apiAdminSetCustomizationPrice(id, price);
    if (!r.ok) { setFailed(errorText(r.error)); return; }
    setEditing(null);
    void load();
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { apiAdminSetCustomizationActive } = await import('@/customization/customizationApi');
    const r = await apiAdminSetCustomizationActive(id, active);
    if (!r.ok) { setFailed(errorText(r.error)); return; }
    void load();
  };

  const doGrant = async () => {
    setGrantMsg('');
    const { apiAdminGrantCustomization } = await import('@/customization/customizationApi');
    const r = await apiAdminGrantCustomization(grantProfile.trim(), grantItem.trim());
    setGrantMsg(r.ok ? 'Выдано' : errorText(r.error));
    if (r.ok) { setGrantProfile(''); setGrantItem(''); }
  };

  const grouped = useMemo(() => {
    const byCat = new Map<string, import('@/customization/customizationApi').AdminCatalogItem[]>();
    for (const it of items ?? []) {
      const arr = byCat.get(it.category) ?? [];
      arr.push(it);
      byCat.set(it.category, arr);
    }
    return byCat;
  }, [items]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ВЫДАТЬ ПРЕДМЕТ БЕЗ ОПЛАТЫ</p>
        <div className="flex gap-2">
          <input value={grantProfile} onChange={(e) => setGrantProfile(e.target.value)} placeholder="id профиля (acc-…)"
            className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          <input value={grantItem} onChange={(e) => setGrantItem(e.target.value)} placeholder="id предмета"
            className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        </div>
        <button type="button" onClick={() => void doGrant()} disabled={!grantProfile.trim() || !grantItem.trim()}
          className="w-full rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          Выдать
        </button>
        {grantMsg && <p className="text-[11px]" style={{ color: grantMsg === 'Выдано' ? C.green : C.red }}>{grantMsg}</p>}
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : [...grouped.entries()].map(([cat, list]) => (
        <div key={cat}>
          <p className="mb-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>
            {CUSTOMIZATION_CATEGORY_LABEL[cat] ?? cat}
          </p>
          <div className="space-y-1.5">
            {list.map((it) => (
              <div key={it.id} className="rounded-2xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{it.id}</p>
                    <p className="text-[10px]" style={{ color: C.t3 }}>
                      {it.owners} куплено{it.locked ? ' · цена зафиксирована' : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => void toggleActive(it.id, !it.active)}
                    className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: it.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: it.active ? C.green : C.red }}>
                    {it.active ? 'в продаже' : 'снят'}
                  </button>
                </div>
                {editing === it.id ? (
                  <div className="mt-2 flex gap-2">
                    <input value={priceDraft} onChange={(e) => setPriceDraft(e.target.value)} type="number"
                      className="flex-1 rounded-xl px-3 py-1.5 text-xs outline-none" style={inputStyle} />
                    <button type="button" onClick={() => void savePrice(it.id)}
                      className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.acc, color: '#fff' }}>OK</button>
                    <button type="button" onClick={() => setEditing(null)}
                      className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t3 }}>×</button>
                  </div>
                ) : (
                  <button type="button" disabled={it.locked}
                    onClick={() => { setEditing(it.id); setPriceDraft(String(it.pricePoints)); }}
                    className="mt-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ color: C.acc }}>
                    {it.pricePoints.toLocaleString('ru')} баллов{!it.locked ? ' · изменить' : ''}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const PetsAdminSection = () => {
  const [sub, setSub] = useState<'types' | 'economy' | 'grant' | 'market'>('types');
  return (
    <div className="space-y-3">
      <ScrollTabs>
        {([['types', 'Типы питомцев'], ['economy', 'Экономика'], ['grant', 'Начислить'], ['market', 'Skin Market']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: sub === k ? C.acc : C.l2, color: sub === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </ScrollTabs>
      {sub === 'types' && <PetTypesAdminSection />}
      {sub === 'economy' && <PetEconomyAdminSection />}
      {sub === 'grant' && <PetCoinsGrantForm />}
      {sub === 'market' && <SkinMarketAdminSection />}
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


/* ─── Деньги человека: баланс, откат операций, Prime, подарки ─────────── */

interface MoneyTx { id: string; type: string; amount: number; desc: string; createdAt: string; points: boolean; reversible: boolean }
interface MoneyGift { id: string; kind: 'gift' | 'prime'; title: string; status: string; price: number; currency: string; recipientId: string; createdAt: string; revocable: boolean }
interface UserMoney {
  profile: { id: string; name: string; username: string };
  balance: number; points: number;
  transactions: MoneyTx[]; gifts: MoneyGift[];
  prime: { active: boolean; plan?: string; expiresAt?: string | null; refundPreview?: number };
}

type MoneyOp =
  | { op: 'adjust'; label: string; extra: Record<string, unknown> }
  | { op: 'reverse'; label: string; extra: Record<string, unknown> }
  | { op: 'revoke_prime'; label: string; extra: Record<string, unknown> }
  | { op: 'revoke_gift'; label: string; extra: Record<string, unknown> }
  | { op: 'cancel_subscription'; label: string; extra: Record<string, unknown> };

const OP_PURPOSE: Record<MoneyOp['op'], string> = {
  adjust: 'pending:adjust_balance', reverse: 'pending:reverse_tx', revoke_prime: 'pending:revoke_prime',
  revoke_gift: 'pending:revoke_gift', cancel_subscription: 'pending:cancel_subscription',
};

/**
 * Правки денег и услуг конкретного человека. Как и начисление, ничего не
 * происходит сразу: каждая кнопка оформляет заявку, а владелец подтверждает
 * её своим кодом в разделе «Заявки». Откат операции кошелька не трогает сам
 * заказ или подписку — для них есть свои кнопки ниже.
 */
const UserMoneyOps = ({ onSent }: { onSent: () => void }) => {
  const [q, setQ] = useState('');
  const [data, setData] = useState<UserMoney | null>(null);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState<MoneyOp | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [sign, setSign] = useState<1 | -1>(1);
  const [currency, setCurrency] = useState<'money' | 'points'>('money');

  const find = async (query = q) => {
    setFailed(''); setSent(''); setBusy(true);
    const r = await adminCall({ action: 'user-money', query: query.trim() });
    setBusy(false);
    if (r.type !== 'admin-user-money') { setData(null); setFailed(errorText(r.payload?.error)); return; }
    setData(r.payload as UserMoney);
  };

  const send = async (code: string) => {
    if (!op || !data) return;
    const cur = op; setOp(null); setFailed(''); setSent('');
    const r = await adminCall({ action: 'money-op', op: cur.op, userId: data.profile.id, code, reason: reason.trim(), ...cur.extra });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка отправлена владельцу. Изменение произойдёт только после его подтверждения в разделе «Заявки».');
    setReason(''); setAmount('');
    onSent();
  };

  const start = (o: MoneyOp) => { setFailed(''); setSent(''); setReason(''); setOp(o); };
  const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
  const reasonOk = reason.trim().length >= 5;

  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
        <Wallet size={13} style={{ color: C.acc }} /> Баланс и операции человека
      </p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Изменить баланс, отменить операцию кошелька, снять Prime, отозвать подарок или отменить подписку.
        Каждое действие — заявка с основанием: оформляете вы, подтверждает владелец.
      </p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void find(); }}
          placeholder="@имя пользователя или acc-…" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" disabled={!q.trim() || busy} onClick={() => void find()}
          className="rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Найти</button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {data && (
        <div className="space-y-3">
          <div className="rounded-xl p-3" style={{ background: C.l2 }}>
            <p className="text-xs font-bold" style={{ color: C.t1 }} translate="no">{data.profile.name} · @{data.profile.username}</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>Баланс: <b>{rub(data.balance)}</b> · Баллы: <b>{data.points.toLocaleString('ru-RU')}</b></p>
            <button type="button" onClick={() => void find(data.profile.id)} className="mt-1 text-[10px]" style={{ color: C.acc }}>Обновить</button>
          </div>

          {/* Правка баланса */}
          <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2 }}>
            <p className="text-[11px] font-bold" style={{ color: C.t1 }}>Изменить баланс</p>
            <div className="flex gap-1">
              {([['money', 'Рубли'], ['points', 'Баллы']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setCurrency(k)} className="flex-1 rounded-lg py-1.5 text-[11px] font-semibold"
                  style={{ background: currency === k ? C.acc : C.l1, color: currency === k ? '#fff' : C.t3 }}>{l}</button>
              ))}
              {([[1, 'Начислить'], [-1, 'Списать']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setSign(k)} className="flex-1 rounded-lg py-1.5 text-[11px] font-semibold"
                  style={{ background: sign === k ? (k === 1 ? C.green : C.red) : C.l1, color: sign === k ? '#fff' : C.t3 }}>{l}</button>
              ))}
            </div>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="Сумма" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
            <button type="button" disabled={!amount || Number(amount) <= 0}
              onClick={() => start({ op: 'adjust', label: `${sign === 1 ? 'Начислить' : 'Списать'} ${Number(amount).toLocaleString('ru-RU')} ${currency === 'points' ? 'баллов' : '₽'}`, extra: { amount: sign * Number(amount), currency } })}
              className="w-full rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Оформить заявку</button>
          </div>

          {/* Prime и подписки */}
          <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2 }}>
            <p className="text-[11px] font-bold" style={{ color: C.t1 }}>Prime и подписки</p>
            {data.prime.active ? (
              <>
                <p className="text-[11px]" style={{ color: C.t2 }}>
                  Prime действует{data.prime.expiresAt ? ` до ${fmtTs(data.prime.expiresAt)}` : ' бессрочно'}
                  {data.prime.plan ? ` · тариф ${data.prime.plan}` : ''}.
                  {(data.prime.refundPreview ?? 0) > 0 ? ` Возврат за неиспользованные дни: ${rub(data.prime.refundPreview!)}.` : ' Возвращать нечего (не оплачено с кошелька).'}
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => start({ op: 'revoke_prime', label: 'Снять Prime и вернуть деньги за остаток', extra: { refund: true } })}
                    className="flex-1 rounded-lg py-2 text-[11px] font-bold" style={{ background: C.l1, color: C.red }}>Снять с возвратом</button>
                  <button type="button" onClick={() => start({ op: 'cancel_subscription', label: 'Отменить подписку Prime без возврата', extra: { what: 'prime' } })}
                    className="flex-1 rounded-lg py-2 text-[11px] font-bold" style={{ background: C.l1, color: C.t2 }}>Отменить без возврата</button>
                </div>
              </>
            ) : <p className="text-[11px]" style={{ color: C.t3 }}>Действующего Prime нет.</p>}
            <button type="button" onClick={() => start({ op: 'cancel_subscription', label: 'Отменить семейную подписку без возврата', extra: { what: 'family' } })}
              className="w-full rounded-lg py-2 text-[11px] font-bold" style={{ background: C.l1, color: C.t2 }}>Отменить семейный Prime (без возврата)</button>
          </div>

          {/* Подарки */}
          <div className="space-y-1.5 rounded-xl p-3" style={{ background: C.l2 }}>
            <p className="text-[11px] font-bold" style={{ color: C.t1 }}>Отправленные подарки</p>
            {data.gifts.length === 0 && <p className="text-[11px]" style={{ color: C.t3 }}>Подарков нет.</p>}
            {data.gifts.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: C.l1 }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold" style={{ color: C.t1 }} translate="no">{g.title}</p>
                  <p className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(g.createdAt)} · {g.price} {g.currency === 'points' ? 'баллов' : '₽'} · {g.status}</p>
                </div>
                {g.revocable && (
                  <button type="button" onClick={() => start({ op: 'revoke_gift', label: `Отозвать подарок «${g.title}» и вернуть оплату отправителю`, extra: { instanceId: g.id } })}
                    className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>Отозвать</button>
                )}
              </div>
            ))}
          </div>

          {/* Операции кошелька */}
          <div className="space-y-1.5 rounded-xl p-3" style={{ background: C.l2 }}>
            <p className="text-[11px] font-bold" style={{ color: C.t1 }}>Последние операции кошелька</p>
            <p className="text-[10px]" style={{ color: C.t3 }}>Откат меняет только запись кошелька: приход снимается, расход возвращается. Заказ или подписку он не затрагивает.</p>
            {data.transactions.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: C.l1 }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px]" style={{ color: C.t1 }} translate="no">{t.desc || t.type}</p>
                  <p className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(t.createdAt)} · {t.type}</p>
                </div>
                <span className="shrink-0 text-[11px] font-bold" style={{ color: t.amount > 0 ? C.green : C.red }}>
                  {t.amount > 0 ? '+' : ''}{t.amount.toLocaleString('ru-RU')} {t.points ? 'б.' : '₽'}
                </span>
                {t.reversible && (
                  <button type="button" onClick={() => start({ op: 'reverse', label: `Отменить операцию: ${t.desc || t.type} (${t.amount > 0 ? '+' : ''}${t.amount})`, extra: { txId: t.id } })}
                    className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>Отменить</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {op && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{op.label}</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Основание (от 5 знаков) — его увидит владелец и пользователь в истории"
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          {reasonOk ? (
            <StepUp purpose={OP_PURPOSE[op.op]} onCode={(c) => void send(c)} onCancel={() => setOp(null)} />
          ) : (
            <button type="button" onClick={() => setOp(null)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
          )}
        </div>
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

/* ─── Sky Video: региональная доступность роликов ────────────────────── */

const SkyVideoRegionsAdmin = () => {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<import('@/video/skyVideoApi').AdminSkyVideo[] | null>(null);
  const [failed, setFailed] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [regions, setRegions] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Удаление ролика и модерация комментариев — те же серверные функции
  // (deleteVideo/removeComment в server/skyvideo.mjs), которыми автор
  // уже убирает своё; здесь просто добавлена админская дверь к ним —
  // раньше в панели была только региональная доступность.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<import('@/video/skyVideoApi').VideoComment[] | null>(null);
  const [commentsFailed, setCommentsFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiSkyVideoAdminSearch } = await import('@/video/skyVideoApi');
    setItems(await apiSkyVideoAdminSearch(q.trim() || undefined));
  }, [q]);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (v: import('@/video/skyVideoApi').AdminSkyVideo) => {
    setEditing(v.id); setRegions(v.blockedRegions); setReason('');
    setDeleting(null); setOpenComments(null);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setFailed('');
    const { apiSkyVideoSetRegions } = await import('@/video/skyVideoApi');
    const r = await apiSkyVideoSetRegions(editing, regions, reason.trim() || undefined);
    setSaving(false);
    if (!r.ok) { setFailed('Не удалось сохранить региональные ограничения'); return; }
    setEditing(null);
    void load();
  };

  const startDelete = (id: string) => {
    setDeleting(id); setDeleteReason('');
    setEditing(null); setOpenComments(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true); setFailed('');
    const { apiDeleteSkyVideo } = await import('@/video/skyVideoApi');
    const ok = await apiDeleteSkyVideo(deleting, deleteReason.trim() || undefined);
    setSaving(false);
    if (!ok) { setFailed('Не удалось удалить ролик'); return; }
    setDeleting(null);
    void load();
  };

  const toggleComments = async (id: string) => {
    setEditing(null); setDeleting(null);
    if (openComments === id) { setOpenComments(null); return; }
    setOpenComments(id); setComments(null); setCommentsFailed('');
    const { apiSkyVideoComments } = await import('@/video/skyVideoApi');
    const list = await apiSkyVideoComments(id);
    if (list === null) { setCommentsFailed('Не удалось загрузить комментарии'); return; }
    setComments(list);
  };

  const removeComment = async (commentId: string) => {
    const { apiDeleteSkyVideoComment } = await import('@/video/skyVideoApi');
    const ok = await apiDeleteSkyVideoComment(commentId);
    if (ok) setComments((cs) => (cs ? cs.filter((c) => c.id !== commentId) : cs));
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        По умолчанию ролик доступен во всех регионах. Ограничение проверяется на сервере при
        просмотре, получении информации, воспроизведении файла, в ленте, поиске и подборках —
        для заблокированного региона сам медиафайл не отдаётся даже по прямой ссылке.
      </p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ник автора, название или id ролика"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Роликов не найдено.</p>
      ) : items.map((v) => (
        <div key={v.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{v.title}</p>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: C.t3 }}>
                {v.authorName ?? '—'} {v.authorUsername ? `@${v.authorUsername}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" onClick={() => startEdit(v)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
                style={{ background: v.blockedRegions.length ? 'rgba(248,113,113,0.15)' : C.l2, color: v.blockedRegions.length ? C.red : C.t2 }}>
                {v.blockedRegions.length ? `Заблокирован (${v.blockedRegions.length})` : 'Региональная доступность'}
              </button>
              <button type="button" onClick={() => void toggleComments(v.id)}
                className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: C.l2, color: C.t2 }}>
                <MessageCircle size={13} />
              </button>
              <button type="button" onClick={() => startDelete(v.id)}
                className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'rgba(248,113,113,0.15)', color: C.red }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {editing === v.id && (
            <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: C.brd }}>
              <RegionMultiSelect value={regions} onChange={setRegions} />
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (необязательно, для журнала)"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void save()}
                  className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
                  Сохранить
                </button>
                <button type="button" onClick={() => setEditing(null)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
                  Отмена
                </button>
              </div>
            </div>
          )}
          {deleting === v.id && (
            <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: C.brd }}>
              <p className="text-[11px]" style={{ color: C.red }}>
                Ролик снимается с показа (не по DELETE — статус «removed»): файл и данные,
                включая уже посчитанные начисления, остаются, видит их только автор и модерация.
              </p>
              <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Причина удаления (для автора и журнала)"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void confirmDelete()}
                  className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.red, color: '#fff' }}>
                  Подтвердить удаление
                </button>
                <button type="button" onClick={() => setDeleting(null)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
                  Отмена
                </button>
              </div>
            </div>
          )}
          {openComments === v.id && (
            <div className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: C.brd }}>
              {commentsFailed ? (
                <p className="text-[11px]" style={{ color: C.red }}>{commentsFailed}</p>
              ) : comments === null ? (
                <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
              ) : comments.length === 0 ? (
                <p className="text-[11px]" style={{ color: C.t3 }}>Комментариев нет.</p>
              ) : comments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 rounded-xl px-2.5 py-2" style={{ background: C.l2 }}>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold" style={{ color: C.t1 }}>
                      {c.authorName ?? '—'} {c.authorUsername ? `@${c.authorUsername}` : ''}
                    </p>
                    <p className="mt-0.5 text-[11px] break-words" style={{ color: C.t2 }}>{c.body}</p>
                  </div>
                  <button type="button" onClick={() => void removeComment(c.id)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg" style={{ background: 'rgba(248,113,113,0.15)', color: C.red }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
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
    {rights.permissions.includes('content') && (
      <div>
        <p className="mb-2 text-xs font-bold" style={{ color: C.t1 }}>Ролики и комментарии</p>
        <SkyVideoRegionsAdmin />
      </div>
    )}
    {rights.permissions.includes('finance') && (
      <RevenueAdjustForm onSent={onPendingChanged} />
    )}
  </div>
);

/* ─── Очередь заявок ───────────────────────────────────────────────── */

const PAYLOAD_LABEL: Record<string, string> = {
  amount: 'сумма', currency: 'валюта', txId: 'операция', refund: 'вернуть деньги', instanceId: 'подарок',
  what: 'подписка', reason: 'основание', days: 'дней', plan: 'тариф',
};

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
              {Object.entries(a.payload).map(([k, v]) => `${PAYLOAD_LABEL[k] ?? k}: ${typeof v === 'boolean' ? (v ? 'да' : 'нет') : v}`).join(' · ')}
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

/**
 * Sky ID строкой — чтобы его можно было скопировать и вставить в другую
 * форму (начисление, рассылка и т.п.), где получателя всё ещё вводят
 * руками по идентификатору профиля (acc-…). Раньше findPerson уже
 * отдавал id, но нигде в этом экране он не показывался — искать
 * приходилось по нику, а действовать где-то ещё — снова по памяти.
 */
const CopyId = ({ id }: { id: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={(e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(id).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }}
      className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 font-mono"
      style={{ color: C.t3, background: 'transparent' }}>
      {copied ? <Check size={10} style={{ color: C.green }} /> : <Copy size={10} />}
      {id}
    </button>
  );
};

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

  // Список при открытии вкладки — пустой запрос отдаёт последних
  // зарегистрированных (см. findPerson в adminsec.mjs), а не ничего:
  // «все пользователи» значит видно сразу, а поиск — чтобы сузить, а не
  // чтобы увидеть хоть кого-то. Запускаем ровно один раз на открытие
  // вкладки — именно поэтому search (меняется от q на каждый ввод) в
  // зависимостях не нужен, иначе набор в поле заново вызывал бы этот эффект.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canModerate) void search(); }, [canModerate]);

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
          placeholder="Ник или идентификатор — пусто показывает всех по очереди регистрации"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void search()}
          className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
          Найти
        </button>
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {done && <p className="text-[11px]" style={{ color: C.green }}>{done}</p>}

      {people === null && (
        <div className="py-6 text-center"><Loader2 size={16} className="mx-auto animate-spin" style={{ color: C.t3 }} /></div>
      )}

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
          <div className="mt-1 text-[10px]"><CopyId id={p.id} /></div>
        </button>
      ))}

      {picked && !picked.owner && (
        <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>
            {picked.name} <span className="font-normal" style={{ color: C.t3 }}>@{picked.username}</span>
          </p>
          <div className="text-[10px]"><CopyId id={picked.id} /></div>

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

export const ChannelsAdminSection = () => {
  const [items, setItems] = useState<import('./channelsApi').AdminChannel[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'channel' | 'group' | 'all'>('channel');
  const [failed, setFailed] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminChannels } = await import('./channelsApi');
    const r = await apiAdminChannels({ q: q.trim() || undefined, type: kind, limit: 200 });
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить список'); return; }
    setItems(r.data.items);
    setTotal(r.data.total);
  }, [q, kind]);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setNote(`${what} скопирован`); }
    catch { setNote('Не удалось скопировать'); }
    window.setTimeout(() => setNote(''), 1800);
  };

  const remove = async (c: import('./channelsApi').AdminChannel) => {
    if (!window.confirm(`Удалить «${c.name}» вместе со всеми сообщениями и участниками? Это нельзя отменить.`)) return;
    setBusy(c.id);
    const { apiAdminDeleteChannel } = await import('./channelsApi');
    const r = await apiAdminDeleteChannel(c.id);
    setBusy(null);
    if (r.ok) { setItems((prev) => prev?.filter((x) => x.id !== c.id) ?? prev); setTotal((n) => Math.max(0, n - 1)); setNote('Удалено'); window.setTimeout(() => setNote(''), 1800); }
    else setFailed('Не удалось удалить');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {([['channel', 'Каналы'], ['group', 'Группы'], ['all', 'Все']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className="rounded-full px-3 py-1.5 text-[11px] font-bold"
            style={{ background: kind === k ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : C.l2, color: kind === k ? C.acc : C.t2 }}>{l}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, @ник, ID или владелец"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      <p className="text-[10px]" style={{ color: C.t3 }}>Всего: {total}{note && <span style={{ color: C.green }}> · {note}</span>}</p>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Ничего не найдено.</p>
      ) : items.map((c) => (
        <div key={c.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-bold" style={{ color: C.t1 }}>{c.name}</p>
            <span className="shrink-0 text-[10px] font-bold" style={{ color: c.type === 'channel' ? C.acc : C.t3 }}>
              {c.type === 'channel' ? 'Канал' : 'Группа'}
            </span>
          </div>
          <p className="mt-0.5 break-all font-mono text-[10px]" style={{ color: C.t3 }}>{c.id}</p>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {c.username ? `@${c.username} · ` : ''}{c.memberCount} уч. · {c.messageCount} сообщ.
            {' · '}создан {fmtTs(c.createdAt)}{c.lastMessageAt && <> · последнее {fmtTs(c.lastMessageAt)}</>}
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            Владелец: {c.ownerName ? `${c.ownerName} @${c.ownerUsername}` : 'нет'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void copy(c.id, 'ID')}
              className="rounded-lg px-2.5 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>Копировать ID</button>
            {c.username && (
              <button type="button" onClick={() => void copy(`@${c.username}`, 'Ник')}
                className="rounded-lg px-2.5 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>Копировать @ник</button>
            )}
            {c.ownerId && (
              <button type="button" onClick={() => void copy(c.ownerId as string, 'ID владельца')}
                className="rounded-lg px-2.5 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>ID владельца</button>
            )}
            <button type="button" disabled={busy === c.id} onClick={() => void remove(c)}
              className="rounded-lg px-2.5 py-1 text-[10px] font-bold" style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: C.red }}>
              {busy === c.id ? '...' : 'Удалить'}
            </button>
          </div>
        </div>
      ))}
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

/**
 * KutRent Market — просмотр пользователей и заказов сайта-партнёра
 * (market.kutrent.online). Право 'kutrent_market' — только читать;
 * единственное действие, создающее деньги без реального платежа
 * (подтвердить оплату вручную, пока не подключена касса), требует
 * права 'finance' и второго ключа владельца — форма ниже, тот же
 * приём, что у RevenueAdjustForm.
 */
const KutrentMarkPaidForm = ({ orderId, onSent }: { orderId: string; onSent: () => void }) => {
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(false);
  const [failed, setFailed] = useState('');

  const send = async (code: string) => {
    setStep(false); setFailed('');
    const r = await adminCall({ action: 'kutrent-mark-paid', orderId, reason: reason.trim(), code });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    onSent();
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl p-2" style={{ background: C.l2 }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Основание — его увидит владелец (например, номер операции в банке)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {step ? (
        <StepUp purpose="pending:kutrent_mark_paid" onCode={(c) => void send(c)} onCancel={() => setStep(false)} />
      ) : (
        <button type="button" disabled={!reason.trim()}
          onClick={() => { setFailed(''); setStep(true); }}
          className="w-full rounded-xl py-2 text-xs font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          Оформить заявку на подтверждение оплаты
        </button>
      )}
    </div>
  );
};

const KUTRENT_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидание подтверждения', paid: 'Оплачен', rejected: 'Отклонён', cancelled: 'Отменён',
};

const KutrentUserDetail = ({ userId, onBack }: { userId: string; onBack: () => void }) => {
  const [detail, setDetail] = useState<import('@/kutrent/kutrentMarketApi').KutrentMarketUserDetail | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    void (async () => {
      setFailed(''); setDetail(null);
      const { apiAdminKutrentUserDetail } = await import('@/kutrent/kutrentMarketApi');
      const r = await apiAdminKutrentUserDetail(userId);
      if (!r.ok || !r.data) { setFailed('Не удалось загрузить карточку'); return; }
      setDetail(r.data.user);
    })();
  }, [userId]);

  return (
    <div className="space-y-2">
      <button type="button" onClick={onBack} className="text-[11px] font-bold" style={{ color: C.t3 }}>← К списку пользователей</button>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {!detail ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : (
        <>
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>@{detail.username} · {detail.name}</p>
            <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
              {detail.authenticator} · вход {detail.lastLoginAt ? new Date(detail.lastLoginAt).toLocaleString('ru') : '—'}
              {' · регистрация '}{new Date(detail.createdAt).toLocaleString('ru')}
            </p>
            <p className="mt-0.5 text-[10px] font-mono" style={{ color: C.t3 }}>Sky ID: {detail.skyId}</p>
            <span className="mt-1 inline-block text-[10px] font-bold" style={{ color: detail.status === 'active' ? C.green : C.red }}>
              {detail.status === 'active' ? 'Активен' : 'Приостановлен'}
            </span>
          </div>
          <p className="text-[11px] font-bold" style={{ color: C.t2 }}>Заказы ({detail.orders.length})</p>
          {detail.orders.length === 0 ? (
            <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заказов пока нет.</p>
          ) : detail.orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[10px]" style={{ color: C.t3 }}>{o.id} · {new Date(o.createdAt).toLocaleString('ru')}</p>
              <div className="text-right">
                <p className="text-xs font-bold" style={{ color: C.t1 }}>{o.amount.toLocaleString('ru')} ₽</p>
                <span className="text-[10px] font-bold" style={{
                  color: o.status === 'paid' ? C.green : o.status === 'rejected' ? C.red
                    : o.status === 'cancelled' ? C.t3 : C.amber,
                }}>{KUTRENT_ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

const KUTRENT_REQUISITES_FIELDS: [string, string][] = [
  ['accountNumber', 'Счёт получателя в банке получателя'],
  ['bankName', 'Наименование Банка получателя'],
  ['bik', 'БИК Банка получателя'],
  ['bankInn', 'ИНН Банка получателя'],
  ['bankKpp', 'КПП Банка получателя'],
  ['corrAccount', 'К/С Банка получателя'],
  ['recipientName', 'Получатель'],
];

/**
 * Реквизиты расчётного счёта — показываются каждому покупателю сразу
 * после создания заказа (см. market-site/app.js). Смотреть может любой
 * с правом 'kutrent_market', менять — только владелец со вторым
 * подтверждением личности: сюда идут настоящие переводы, ошибка или
 * подмена значит потерянные или уведённые деньги у всех будущих
 * покупателей разом.
 */
const KutrentRequisitesSection = ({ rights, onBack }: { rights: MyRights | null; onBack: () => void }) => {
  const [req, setReq] = useState<Record<string, string> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminGetKutrentRequisites } = await import('@/kutrent/kutrentMarketApi');
    const r = await apiAdminGetKutrentRequisites();
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить реквизиты'); return; }
    const { updatedAt: ua, ...fields } = r.data.requisites ?? {};
    setReq(fields as Record<string, string>);
    setUpdatedAt(ua ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = () => {
    if (!req) return;
    setDraft({ ...req });
    setEditing(true);
  };

  const save = async (code: string) => {
    setStep(false); setFailed('');
    const { apiAdminSetKutrentRequisites } = await import('@/kutrent/kutrentMarketApi');
    const r = await apiAdminSetKutrentRequisites({
      accountNumber: draft.accountNumber ?? '', bankName: draft.bankName ?? '', bik: draft.bik ?? '',
      bankInn: draft.bankInn ?? '', bankKpp: draft.bankKpp ?? '', corrAccount: draft.corrAccount ?? '',
      recipientName: draft.recipientName ?? '',
    }, code);
    if (!r.ok || !r.data) { setFailed(errorText(r.error)); return; }
    const { updatedAt: ua, ...fields } = r.data.requisites;
    setReq(fields as Record<string, string>);
    setUpdatedAt(ua ?? null);
    setEditing(false);
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={onBack} className="text-[11px] font-bold" style={{ color: C.t3 }}>← К заказам</button>
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[10px] font-bold" style={{ color: C.t3 }}>РЕКВИЗИТЫ РАСЧЁТНОГО СЧЁТА</p>
        <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
          Показываются каждому покупателю сразу после создания заказа — это не секрет.
          Менять может только владелец: ошибка или подмена здесь значит потерянные или
          уведённые деньги у всех будущих покупателей разом.
        </p>
        {failed && <p className="mt-1.5 text-[11px]" style={{ color: C.red }}>{failed}</p>}
        {!req ? (
          <Loader2 size={14} className="mt-2 animate-spin" style={{ color: C.t3 }} />
        ) : !editing ? (
          <>
            <div className="mt-2 space-y-1">
              {KUTRENT_REQUISITES_FIELDS.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-2 text-[11px]">
                  <span style={{ color: C.t3 }}>{label}</span>
                  <span className="text-right font-semibold" style={{ color: C.t1, wordBreak: 'break-all' }}>{req[k] || '—'}</span>
                </div>
              ))}
            </div>
            {updatedAt && <p className="mt-1.5 text-[10px]" style={{ color: C.t3 }}>Изменено {fmtTs(updatedAt)}</p>}
            {rights?.owner && (
              <button type="button" onClick={startEdit}
                className="mt-2 w-full rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.acc }}>
                Изменить
              </button>
            )}
          </>
        ) : (
          <div className="mt-2 space-y-2">
            {KUTRENT_REQUISITES_FIELDS.map(([k, label]) => (
              <input key={k} value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                placeholder={label} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
            ))}
            {step ? (
              <StepUp purpose="kutrent_requisites" onCode={(c) => void save(c)} onCancel={() => setStep(false)} />
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(true)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
                  Сохранить
                </button>
                <button type="button" onClick={() => setEditing(false)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
                  Отмена
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const KutrentMarketAdminSection = ({ rights }: { rights: MyRights | null }) => {
  const canFinance = rights?.permissions?.includes('finance') ?? false;
  const [sub, setSub] = useState<'orders' | 'users' | 'requisites'>('orders');
  const [status, setStatus] = useState<'' | 'pending' | 'paid' | 'rejected' | 'cancelled'>('pending');
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<import('@/kutrent/kutrentMarketApi').KutrentMarketOrder[] | null>(null);
  const [users, setUsers] = useState<import('@/kutrent/kutrentMarketApi').KutrentMarketUser[] | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [failed, setFailed] = useState('');

  const loadOrders = useCallback(async () => {
    setFailed('');
    const { apiAdminListKutrentOrders } = await import('@/kutrent/kutrentMarketApi');
    const r = await apiAdminListKutrentOrders({ status: status || undefined, q: q.trim() || undefined });
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить заказы'); return; }
    setOrders(r.data.orders);
  }, [status, q]);

  const loadUsers = useCallback(async () => {
    setFailed('');
    const { apiAdminListKutrentUsers } = await import('@/kutrent/kutrentMarketApi');
    const r = await apiAdminListKutrentUsers(q.trim() || undefined);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить пользователей'); return; }
    setUsers(r.data.users);
  }, [q]);

  useEffect(() => { if (sub === 'orders') void loadOrders(); else void loadUsers(); }, [sub, loadOrders, loadUsers]);

  const ORDER_STATUS_LABEL = KUTRENT_ORDER_STATUS_LABEL;

  if (openUserId) return <KutrentUserDetail userId={openUserId} onBack={() => setOpenUserId(null)} />;
  if (sub === 'requisites') return <KutrentRequisitesSection rights={rights} onBack={() => setSub('orders')} />;

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {([['orders', 'Заказы'], ['users', 'Пользователи'], ['requisites', 'Реквизиты']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: sub === k ? C.acc : C.l2, color: sub === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>

      {sub === 'orders' && (
        <ScrollTabs>
          {([['pending', 'Ожидают'], ['paid', 'Оплачены'], ['rejected', 'Отклонены'], ['cancelled', 'Отменены'], ['', 'Все']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
              {l}
            </button>
          ))}
        </ScrollTabs>
      )}

      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={sub === 'orders' ? 'Номер заказа, @ник или Authenticator' : '@ник или Authenticator'}
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => (sub === 'orders' ? void loadOrders() : void loadUsers())}
          className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {sub === 'orders' && (
        orders === null ? <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
          : orders.length === 0 ? <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заказов не найдено.</p>
          : orders.map((o) => (
            <div key={o.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold" style={{ color: C.t1 }}>{o.username ? `@${o.username}` : o.id}</p>
                  <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
                    {o.id} · {o.authenticator ?? '—'} · {new Date(o.createdAt).toLocaleString('ru')}
                  </p>
                  {/* Sky ID — для срочных действий в основной админке (бан/блокировка
                      Sky ID), где Authenticator Маркета ничего не значит. */}
                  {o.skyId && (
                    <p className="mt-0.5 text-[10px] font-mono" style={{ color: C.t3 }}>Sky ID: {o.skyId}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold" style={{ color: C.t1 }}>{o.amount.toLocaleString('ru')} ₽</p>
                  <span className="text-[10px] font-bold" style={{
                    color: o.status === 'paid' ? C.green : o.status === 'rejected' ? C.red
                      : o.status === 'cancelled' ? C.t3 : C.amber,
                  }}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
                </div>
              </div>
              {/* Телефон, с которого должен прийти перевод — покупатель
                  указывает его сам после создания заказа; без него искать
                  операцию в банке не по чему, и заявку на подтверждение
                  сервер всё равно отклонит (no_payment_proof). */}
              {o.status === 'pending' && (
                <p className="mt-1.5 text-[11px]" style={{ color: o.senderPhone ? C.t2 : C.t3 }}>
                  Телефон перевода: {o.senderPhone ? <span style={{ color: C.t1, fontWeight: 700 }}>{o.senderPhone}</span> : 'ещё не указан'}
                </p>
              )}
              {o.status === 'pending' && canFinance && o.senderPhone && (
                openOrderId === o.id
                  ? <KutrentMarkPaidForm orderId={o.id} onSent={() => { setOpenOrderId(null); void loadOrders(); }} />
                  : (
                    <button type="button" onClick={() => setOpenOrderId(o.id)}
                      className="mt-2 w-full rounded-xl py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.acc }}>
                      Подтвердить оплату
                    </button>
                  )
              )}
            </div>
          ))
      )}

      {sub === 'users' && (
        users === null ? <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
          : users.length === 0 ? <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Пользователей не найдено.</p>
          : users.map((u) => (
            <div key={u.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold" style={{ color: C.t1 }}>@{u.username} · {u.name}</p>
                  <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
                    {u.authenticator} · вход {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ru') : '—'}
                  </p>
                  {/* Sky ID — чтобы администрация могла сразу перейти к действиям
                      в основной панели (бан/блокировка), не разыскивая его отдельно
                      по нику: Authenticator — внутренний код только Маркета. */}
                  <p className="mt-0.5 text-[10px] font-mono" style={{ color: C.t3 }}>Sky ID: {u.skyId}</p>
                </div>
                <span className="text-[10px] font-bold" style={{ color: u.status === 'active' ? C.green : C.red }}>
                  {u.status === 'active' ? 'Активен' : 'Приостановлен'}
                </span>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button type="button" onClick={() => setOpenUserId(u.id)}
                  className="flex-1 rounded-xl py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>
                  Подробнее
                </button>
                {canFinance && (
                  <button type="button"
                    onClick={async () => {
                      const { apiAdminSetKutrentUserStatus } = await import('@/kutrent/kutrentMarketApi');
                      const next = u.status === 'active' ? 'suspended' : 'active';
                      const r = await apiAdminSetKutrentUserStatus(u.id, next);
                      if (r.ok) void loadUsers();
                    }}
                    className="flex-1 rounded-xl py-1.5 text-[11px] font-bold"
                    style={{ background: C.l2, color: u.status === 'active' ? C.red : C.green }}>
                    {u.status === 'active' ? 'Приостановить' : 'Восстановить'}
                  </button>
                )}
              </div>
            </div>
          ))
      )}
    </div>
  );
};

/* ─── Sky Market: споры и игровой каталог ─────────────────────────────
   Право 'market' (роль market_admin) до сих пор не имело раздела в
   этой панели: resolveDispute/createGame/updateGame/apiUploadGameCover
   на сервере и в клиентском marketApi.ts существовали, но ни одна из
   них никогда не вызывалась — администратор с этим правом физически
   не мог разрешить спор по заказу. KutRent Market (отдельная вкладка
   выше) — другой магазин-партнёр, сюда не относится. */

const MarketDisputeDetail = ({ order, onBack, onChanged }: {
  order: import('@/marketplace/types').Order;
  onBack: () => void;
  onChanged: () => void;
}) => {
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    void (async () => {
      const { apiOrderHistory } = await import('@/marketplace/marketApi');
      const r = await apiOrderHistory(order.id);
      if (!r.ok || !r.data) return;
      const opened = r.data.events.find((e) => e.to === 'disputed');
      const why = opened?.detail?.reason;
      setReason(typeof why === 'string' ? why : '');
    })();
  }, [order.id]);

  const resolve = async (outcome: 'completed' | 'cancelled') => {
    if (!note.trim()) { setFailed('Укажите обоснование'); return; }
    setBusy(true); setFailed('');
    const { apiResolveDispute } = await import('@/marketplace/marketApi');
    const r = await apiResolveDispute(order.id, outcome, note.trim());
    setBusy(false);
    if (!r.ok) { setFailed(errorText(r.error)); return; }
    onChanged();
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-bold" style={{ color: C.t3 }}>← К списку споров</button>
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>{order.title}</p>
        <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>
          {order.total.toLocaleString('ru')} ₽ · заказ <CopyId id={order.id} />
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.t3 }}>Продавец</p>
            <CopyId id={order.sellerId} />
          </div>
          <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.t3 }}>Покупатель</p>
            <CopyId id={order.buyerId} />
          </div>
        </div>
        {reason && (
          <div className="mt-2 rounded-xl p-2.5" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.red }}>Причина спора</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>«{reason}»</p>
          </div>
        )}
        {failed && <p className="mt-2 text-[11px]" style={{ color: C.red }}>{failed}</p>}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Обоснование решения"
          className="mt-3 w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void resolve('completed')}
            className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.green, color: '#fff' }}>
            Завершить (продавцу)
          </button>
          <button type="button" disabled={busy} onClick={() => void resolve('cancelled')}
            className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.red, color: '#fff' }}>
            Отменить (покупателю)
          </button>
        </div>
      </div>
    </div>
  );
};

const MarketDisputesTab = () => {
  const [orders, setOrders] = useState<import('@/marketplace/types').Order[] | null>(null);
  const [failed, setFailed] = useState('');
  const [openOrder, setOpenOrder] = useState<import('@/marketplace/types').Order | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    const { apiDisputedOrders } = await import('@/marketplace/marketApi');
    const r = await apiDisputedOrders(100);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить споры'); return; }
    setOrders(r.data.orders);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (openOrder) {
    return (
      <MarketDisputeDetail order={openOrder} onBack={() => setOpenOrder(null)}
        onChanged={() => { setOpenOrder(null); void load(); }} />
    );
  }

  return (
    <div className="space-y-2">
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {orders === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : orders.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Открытых споров нет.</p>
      ) : orders.map((o) => (
        <button key={o.id} type="button" onClick={() => setOpenOrder(o)}
          className="w-full rounded-2xl p-3 text-left" style={{ background: C.l1, border: '1px solid rgba(248,113,113,0.3)' }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>{o.title}</p>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>{o.total.toLocaleString('ru')} ₽ · заказ {o.id}</p>
        </button>
      ))}
    </div>
  );
};

const GameCoverUpload = ({ gameId }: { gameId: string }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setFailed(false); setDone(false);
    const { apiUploadGameCover } = await import('@/marketplace/marketApi');
    const r = await apiUploadGameCover(gameId, file);
    setBusy(false);
    if (!r.ok) { setFailed(true); return; }
    setDone(true);
  };

  return (
    <label className="flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold"
      style={{ background: C.l2, color: failed ? C.red : C.t3 }}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : done ? <Check size={11} style={{ color: C.green }} /> : null}
      Обложка
      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e)} />
    </label>
  );
};

const MarketGamesTab = () => {
  const [games, setGames] = useState<import('@/marketplace/types').Game[] | null>(null);
  const [failed, setFailed] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed('');
    const { apiGames } = await import('@/marketplace/marketApi');
    const r = await apiGames();
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить игры'); return; }
    setGames(r.data.games);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!title.trim() || !slug.trim()) { setFailed('Укажите название и slug'); return; }
    setBusy(true); setFailed('');
    const { apiCreateGame } = await import('@/marketplace/marketApi');
    const r = await apiCreateGame({ title: title.trim(), slug: slug.trim() });
    setBusy(false);
    if (!r.ok) { setFailed(errorText(r.error)); return; }
    setTitle(''); setSlug('');
    void load();
  };

  const toggleHidden = async (g: import('@/marketplace/types').Game) => {
    setFailed('');
    const { apiUpdateGame } = await import('@/marketplace/marketApi');
    const r = await apiUpdateGame(g.id, { hidden: !g.hidden });
    if (!r.ok) { setFailed(errorText(r.error)); return; }
    void load();
  };

  return (
    <div className="space-y-2">
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[11px] font-bold" style={{ color: C.t2 }}>Новая игра</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название"
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (латиница, например cs2)"
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" disabled={busy} onClick={() => void create()}
          className="w-full rounded-xl py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.acc, color: '#fff' }}>
          Добавить игру
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {games === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : games.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Игр пока нет.</p>
      ) : games.map((g) => (
        <div key={g.id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{g.title}</p>
            <p className="text-[10px]" style={{ color: C.t3 }}>/{g.slug}{g.hidden ? ' · скрыта' : ''}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <GameCoverUpload gameId={g.id} />
            <button type="button" onClick={() => void toggleHidden(g)}
              className="rounded-xl px-3 py-1.5 text-[11px] font-bold"
              style={{ background: C.l2, color: g.hidden ? C.green : C.t3 }}>
              {g.hidden ? 'Показать' : 'Скрыть'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── Нарушения и штрафы (право 'violations') ─────────────────────────
 *
 * Аннулирование нарушения/штрафа и одобрение апелляции целиком или
 * частично прощают уже назначенное наказание — это заявки во вкладку
 * «Заявки» (PendingList выше), не прямые действия: решает владелец
 * вторым ключом. Здесь — только то, что администратор может сам:
 * подтвердить/отклонить новое нарушение, отклонить апелляцию (решение
 * остаётся в силе, ничего не прощается), вести регламент и реквизиты.
 */

const VIOLATION_STATUS_LABEL: Record<string, string> = {
  DETECTED: 'Выявлено', UNDER_REVIEW: 'На рассмотрении', CONFIRMED: 'Подтверждено',
  REJECTED: 'Отклонено', APPEALED: 'Обжалуется', CANCELLED: 'Аннулировано', CLOSED: 'Закрыто',
};
const APPEAL_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Подана', UNDER_REVIEW: 'На рассмотрении', APPROVED: 'Одобрена',
  REJECTED: 'Отклонена', PARTIALLY_APPROVED: 'Частично одобрена',
};
const SANCTION_LABEL: Record<string, string> = {
  none: 'без санкции', warning: 'предупреждение', remove_listing: 'снятие объявления',
  restrict_publishing: 'ограничение публикации', restrict_feature: 'ограничение функций',
  suspend: 'приостановка', restrict_staff: 'ограничение сотрудника',
  temp_block: 'временная блокировка', perm_block: 'постоянная блокировка',
};
const VIOLATION_MODULES = ['market', 'warehouse', 'pvz'] as const;
const SEVERITIES = ['warning', 'minor', 'moderate', 'severe', 'critical'] as const;

const EVIDENCE_KIND_LABEL: Record<string, string> = {
  photo: 'Фото', video: 'Видео', document: 'Документ', screenshot: 'Скриншот',
  order_data: 'Данные заказа', tracking: 'Трек', qr_operation: 'QR-операция',
  system_event: 'Событие системы', message: 'Сообщение',
};

/**
 * Список уже приложенных доказательств плюс форма добавить своё.
 *
 * Байты тянутся не обычным apiCall (см. violationsApi.ts::evidenceFileUrl)
 * — нужен пропуск, и прежде чем показывать ссылки, его надо получить
 * хотя бы раз за это открытие панели.
 */
const EvidenceSection = ({ evidence, onUpload }: {
  evidence: import('@/marketplace/violationsApi').ViolationEvidence[];
  onUpload: (kind: import('@/marketplace/violationsApi').EvidenceKind, file: Blob) => Promise<boolean>;
}) => {
  const [kind, setKind] = useState<import('@/marketplace/violationsApi').EvidenceKind>('photo');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    void (async () => {
      const { apiViolationsTicket } = await import('@/marketplace/violationsApi');
      await apiViolationsTicket();
    })();
  }, []);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setFailed('');
    const ok = await onUpload(kind, file);
    setBusy(false);
    if (!ok) setFailed('Не удалось загрузить доказательство');
  };

  return (
    <div className="space-y-1.5 rounded-xl p-2" style={{ background: C.l2 }}>
      <p className="text-[10px] font-bold" style={{ color: C.t3 }}>Доказательства</p>
      {evidence.length === 0 && <p className="text-[10px]" style={{ color: C.t3 }}>Пока ничего не приложено.</p>}
      {evidence.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-2 text-[10px]" style={{ color: C.t2 }}>
          <a href={evidenceFileUrl(e.id)} target="_blank" rel="noreferrer" className="truncate underline">
            {EVIDENCE_KIND_LABEL[e.kind] ?? e.kind}{e.description ? ` — ${e.description}` : ''}
          </a>
          <span className="shrink-0" style={{ color: C.t3 }}>{(e.bytes / 1024).toFixed(0)} КБ</span>
        </div>
      ))}
      <div className="flex gap-1.5">
        <select value={kind} onChange={(ev) => setKind(ev.target.value as import('@/marketplace/violationsApi').EvidenceKind)}
          className="rounded-lg px-2 py-1.5 text-[10px]" style={inputStyle}>
          {Object.entries(EVIDENCE_KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="flex-1 cursor-pointer rounded-lg py-1.5 text-center text-[10px] font-bold"
          style={{ background: busy ? C.l1 : C.acc, color: busy ? C.t3 : '#fff' }}>
          {busy ? 'Загружаем…' : 'Приложить файл'}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => void pick(e)} />
        </label>
      </div>
      {failed && <p className="text-[10px]" style={{ color: C.red }}>{failed}</p>}
    </div>
  );
};

const ViolationDecideForm = ({ violationId, onDone }: { violationId: string; onDone: () => void }) => {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const decide = async (decision: 'CONFIRMED' | 'REJECTED') => {
    setBusy(true); setFailed('');
    const { apiDecideViolation } = await import('@/marketplace/violationsApi');
    const r = await apiDecideViolation(violationId, decision, { comment: comment.trim() });
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось сохранить решение'); return; }
    onDone();
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl p-2" style={{ background: C.l2 }}>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
        placeholder="Комментарий к решению (необязательно)"
        className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={inputStyle} />
      {failed && <p className="text-[10px]" style={{ color: C.red }}>{failed}</p>}
      <div className="flex gap-1.5">
        <button type="button" disabled={busy} onClick={() => void decide('CONFIRMED')}
          className="flex-1 rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.red, color: '#fff' }}>
          Подтвердить нарушение
        </button>
        <button type="button" disabled={busy} onClick={() => void decide('REJECTED')}
          className="flex-1 rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.l1, color: C.t2 }}>
          Отклонить
        </button>
      </div>
    </div>
  );
};

const ViolationAdminCard = ({ v, onChanged }: {
  v: import('@/marketplace/violationsApi').ViolationItem; onChanged: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<import('@/marketplace/violationsApi').ViolationDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState('');

  const loadDetail = useCallback(async () => {
    const { apiViolationDetail } = await import('@/marketplace/violationsApi');
    const r = await apiViolationDetail(v.id);
    if (r.ok && r.data && 'violation' in r.data) setDetail(r.data.violation);
  }, [v.id]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!detail) void loadDetail();
  };

  const requestCancel = async (code: string) => {
    setStepping(false);
    const { apiRequestCancelViolation } = await import('@/marketplace/violationsApi');
    const r = await apiRequestCancelViolation(v.id, reason.trim(), code);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось оформить заявку'); return; }
    setCancelling(false); setReason(''); onChanged();
  };

  return (
    <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <button type="button" onClick={toggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{v.ruleSnapshot.title}</p>
            <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
              {v.module} · {v.violatorName ?? v.violatorId} · {fmtTs(v.createdAt)}
            </p>
          </div>
          <span className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
            {VIOLATION_STATUS_LABEL[v.status] ?? v.status}
          </span>
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: C.brd }}>
          {!detail ? (
            <p className="text-[11px]" style={{ color: C.t3 }}>Загружаем…</p>
          ) : (
            <>
              {detail.description && <p className="text-[11px]" style={{ color: C.t2 }}>{detail.description}</p>}
              <p className="text-[10px]" style={{ color: C.t3 }}>
                Повторность: {detail.repeatCount} · Санкция: {detail.sanctionApplied ? SANCTION_LABEL[detail.sanctionApplied] ?? detail.sanctionApplied : '—'}
              </p>
              {detail.penalties.map((p) => (
                <p key={p.id} className="text-[10px]" style={{ color: C.t3 }}>
                  Штраф {p.amountKop != null ? `${(p.amountKop / 100).toLocaleString('ru')} ₽` : '—'} · {p.status}
                </p>
              ))}
              <EvidenceSection evidence={detail.evidence} onUpload={async (kind, file) => {
                const { apiUploadViolationEvidence } = await import('@/marketplace/violationsApi');
                const r = await apiUploadViolationEvidence(v.id, kind, file);
                if (r.ok) void loadDetail();
                return r.ok;
              }} />
            </>
          )}
          {failed && <p className="text-[10px]" style={{ color: C.red }}>{failed}</p>}

          {['DETECTED', 'UNDER_REVIEW'].includes(v.status) && (
            <ViolationDecideForm violationId={v.id} onDone={onChanged} />
          )}

          {v.status === 'CONFIRMED' && (
            cancelling ? (
              stepping ? (
                <StepUp purpose="pending:cancel_violation" onCode={(c) => void requestCancel(c)}
                  onCancel={() => setStepping(false)} />
              ) : (
                <div className="space-y-1.5">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина аннулирования"
                    className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={inputStyle} />
                  <div className="flex gap-1.5">
                    <button type="button" disabled={!reason.trim()} onClick={() => setStepping(true)}
                      className="flex-1 rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
                      Оформить заявку владельцу
                    </button>
                    <button type="button" onClick={() => setCancelling(false)}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t3 }}>
                      Отмена
                    </button>
                  </div>
                </div>
              )
            ) : (
              <button type="button" onClick={() => setCancelling(true)}
                className="w-full rounded-lg py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.red }}>
                Запросить аннулирование
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};

const ViolationsListTab = () => {
  const [items, setItems] = useState<import('@/marketplace/violationsApi').ViolationItem[] | null>(null);
  const [module, setModule] = useState<'' | typeof VIOLATION_MODULES[number]>('');
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminViolations } = await import('@/marketplace/violationsApi');
    const r = await apiAdminViolations({
      module: module || undefined,
      status: (status || undefined) as import('@/marketplace/violationsApi').ViolationStatus | undefined,
    });
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить список'); return; }
    setItems(r.data.violations);
  }, [module, status]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <select value={module} onChange={(e) => setModule(e.target.value as typeof module)}
          className="rounded-xl px-2 py-1.5 text-[11px]" style={inputStyle}>
          <option value="">Все модули</option>
          {VIOLATION_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl px-2 py-1.5 text-[11px]" style={inputStyle}>
          <option value="">Все статусы</option>
          {Object.entries(VIOLATION_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" onClick={() => void load()}
          className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Нарушений не найдено.</p>
      ) : items.map((v) => <ViolationAdminCard key={v.id} v={v} onChanged={() => void load()} />)}
    </div>
  );
};

const AppealAdminCard = ({ a, onChanged }: {
  a: import('@/marketplace/violationsApi').ViolationAppealAdminRow; onChanged: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<import('@/marketplace/violationsApi').ViolationAppealDetail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [failed, setFailed] = useState('');
  const open_ = ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status);

  const loadDetail = useCallback(async () => {
    const { apiAppealDetail } = await import('@/marketplace/violationsApi');
    const r = await apiAppealDetail(a.id);
    if (r.ok && r.data && 'appeal' in r.data) setDetail(r.data.appeal);
  }, [a.id]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!detail) void loadDetail();
  };

  const decide = async (decision: 'APPROVED' | 'REJECTED', code?: string) => {
    setBusy(true); setFailed(''); setStepping(false);
    const { apiDecideAppeal } = await import('@/marketplace/violationsApi');
    const r = await apiDecideAppeal(a.id, decision, { reason: reason.trim(), code });
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось отправить решение'); return; }
    setReason(''); onChanged();
  };

  const startApprove = () => {
    if (!reason.trim()) { setFailed('Укажите основание решения'); return; }
    setFailed(''); setStepping(true);
  };

  return (
    <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <button type="button" onClick={toggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{a.violationTitle}</p>
            <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
              {a.module} · {a.violatorName ?? a.violatorId} · {fmtTs(a.createdAt)}
            </p>
          </div>
          <span className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>
            {APPEAL_STATUS_LABEL[a.status] ?? a.status}
          </span>
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: C.brd }}>
          <p className="text-[11px]" style={{ color: C.t2 }}>{a.reason}</p>
          {a.comment && <p className="text-[10px]" style={{ color: C.t3 }}>{a.comment}</p>}
          {a.decisionReason && <p className="text-[10px]" style={{ color: C.t3 }}>Решение: {a.decisionReason}</p>}
          {detail && (
            <EvidenceSection evidence={detail.evidence} onUpload={async (kind, file) => {
              const { apiUploadAppealEvidence } = await import('@/marketplace/violationsApi');
              const r = await apiUploadAppealEvidence(a.id, kind, file);
              if (r.ok) void loadDetail();
              return r.ok;
            }} />
          )}
          {failed && <p className="text-[10px]" style={{ color: C.red }}>{failed}</p>}
          {open_ && (
            stepping ? (
              <StepUp purpose="pending:resolve_appeal" onCode={(c) => void decide('APPROVED', c)}
                onCancel={() => setStepping(false)} />
            ) : (
            <div className="space-y-1.5">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="Основание решения (увидит нарушитель)"
                className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={inputStyle} />
              <div className="flex gap-1.5">
                <button type="button" disabled={busy || !reason.trim()} onClick={() => void decide('REJECTED')}
                  className="flex-1 rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t2 }}>
                  Отклонить апелляцию
                </button>
                <button type="button" disabled={busy} onClick={startApprove}
                  className="flex-1 rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
                  Одобрить (заявка владельцу)
                </button>
              </div>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                Частичное одобрение (снять только санкцию или только штраф) — через API, отдельной формы здесь пока нет.
              </p>
            </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

const AppealsAdminTab = () => {
  const [items, setItems] = useState<import('@/marketplace/violationsApi').ViolationAppealAdminRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminAppeals } = await import('@/marketplace/violationsApi');
    const r = await apiAdminAppeals((status || undefined) as import('@/marketplace/violationsApi').AppealStatus | undefined);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить апелляции'); return; }
    setItems(r.data.appeals);
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl px-2 py-1.5 text-[11px]" style={inputStyle}>
          <option value="">Все статусы</option>
          {Object.entries(APPEAL_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" onClick={() => void load()}
          className="rounded-xl px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Апелляций не найдено.</p>
      ) : items.map((a) => <AppealAdminCard key={a.id} a={a} onChanged={() => void load()} />)}
    </div>
  );
};

const emptyRuleForm = () => ({
  module: 'market' as typeof VIOLATION_MODULES[number], code: '', title: '', description: '',
  severity: 'minor' as typeof SEVERITIES[number], defaultSanction: 'warning', defaultPenaltyKop: '', repeatMultiplier: '1',
});

const RuleCreateForm = ({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) => {
  const [form, setForm] = useState(emptyRuleForm);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const create = async () => {
    if (!form.code.trim() || !form.title.trim()) { setFailed('Код и название обязательны'); return; }
    setBusy(true); setFailed('');
    const { apiCreateRule } = await import('@/marketplace/violationsApi');
    const r = await apiCreateRule({
      module: form.module, code: form.code.trim(), title: form.title.trim(), description: form.description.trim(),
      severity: form.severity, defaultSanction: form.defaultSanction,
      defaultPenaltyKop: form.defaultPenaltyKop ? Math.round(Number(form.defaultPenaltyKop) * 100) : null,
      repeatMultiplier: Number(form.repeatMultiplier) || 1,
    });
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось создать правило — проверьте код (должен быть уникален в модуле)'); return; }
    onCreated();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex gap-2">
        <select value={form.module} onChange={(e) => setForm((f) => ({ ...f, module: e.target.value as typeof form.module }))}
          className="rounded-xl px-2 py-2 text-xs" style={inputStyle}>
          {VIOLATION_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="Код пункта (M-12)"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      </div>
      <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Название правила"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
        placeholder="Описание" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <div className="flex gap-2">
        <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as typeof form.severity }))}
          className="flex-1 rounded-xl px-2 py-2 text-xs" style={inputStyle}>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={form.defaultSanction} onChange={(e) => setForm((f) => ({ ...f, defaultSanction: e.target.value }))}
          className="flex-1 rounded-xl px-2 py-2 text-xs" style={inputStyle}>
          {Object.keys(SANCTION_LABEL).map((s) => <option key={s} value={s}>{SANCTION_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <input value={form.defaultPenaltyKop} onChange={(e) => setForm((f) => ({ ...f, defaultPenaltyKop: e.target.value }))}
          type="number" min={0} placeholder="Штраф по умолчанию, ₽ (необязательно)"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <input value={form.repeatMultiplier} onChange={(e) => setForm((f) => ({ ...f, repeatMultiplier: e.target.value }))}
          type="number" min={1} max={10} step={0.1} placeholder="Множитель повтора"
          className="w-36 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void create()}
          className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          Создать правило
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>
          Отмена
        </button>
      </div>
    </div>
  );
};

const RulesAdminTab = () => {
  const [rules, setRules] = useState<import('@/marketplace/violationsApi').ViolationRule[] | null>(null);
  const [module, setModule] = useState<typeof VIOLATION_MODULES[number]>('market');
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiListRules } = await import('@/marketplace/violationsApi');
    const r = await apiListRules(module);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить правила'); return; }
    setRules(r.data.rules);
  }, [module]);
  useEffect(() => { void load(); }, [load]);

  const toggleActive = async (rule: import('@/marketplace/violationsApi').ViolationRule) => {
    const { apiUpdateRule } = await import('@/marketplace/violationsApi');
    const r = await apiUpdateRule(rule.id, { active: !rule.active });
    if (r.ok) void load();
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {VIOLATION_MODULES.map((m) => (
          <button key={m} type="button" onClick={() => setModule(m)}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: module === m ? C.acc : C.l2, color: module === m ? '#fff' : C.t3 }}>
            {m}
          </button>
        ))}
      </div>
      {creating ? (
        <RuleCreateForm onCreated={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="w-full rounded-2xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
          + Новое правило
        </button>
      )}
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {rules === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : rules.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Правил пока нет.</p>
      ) : rules.map((rule) => (
        <div key={rule.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold" style={{ color: C.t1 }}>{rule.code} · {rule.title}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
                {rule.severity} · {SANCTION_LABEL[rule.defaultSanction] ?? rule.defaultSanction}
                {rule.defaultPenaltyKop != null ? ` · ${(rule.defaultPenaltyKop / 100).toLocaleString('ru')} ₽` : ''}
                {' · ×'}{rule.repeatMultiplier} за повтор · v{rule.version}
              </p>
            </div>
            <button type="button" onClick={() => void toggleActive(rule)}
              className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold"
              style={{ background: C.l2, color: rule.active ? C.green : C.t3 }}>
              {rule.active ? 'активно' : 'выключено'}
            </button>
          </div>
          {rule.description && <p className="mt-1.5 text-[11px]" style={{ color: C.t2 }}>{rule.description}</p>}
        </div>
      ))}
    </div>
  );
};

const PaymentSettingsTab = ({ rights }: { rights: MyRights }) => {
  const [settings, setSettings] = useState<{ id: string; requisites: Record<string, string>; setAt: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fields, setFields] = useState([{ k: 'recipient', v: '' }, { k: 'inn', v: '' }, { k: 'bank_name', v: '' }, { k: 'account_number', v: '' }]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    void (async () => {
      const { apiPaymentSettings } = await import('@/marketplace/violationsApi');
      const r = await apiPaymentSettings();
      if (r.ok && r.data?.settings) {
        setSettings(r.data.settings);
        setFields(Object.entries(r.data.settings.requisites).map(([k, v]) => ({ k, v })));
      }
      setLoaded(true);
    })();
  }, []);

  if (!rights.owner) {
    return (
      <div className="space-y-2">
        <p className="text-[11px]" style={{ color: C.t3 }}>
          Реквизиты для оплаты штрафов задаёт только владелец. Текущие (если заданы):
        </p>
        {!loaded ? <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} /> : settings ? (
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            {Object.entries(settings.requisites).map(([k, v]) => (
              <p key={k} className="text-[11px]" style={{ color: C.t1 }}>{k}: {v}</p>
            ))}
          </div>
        ) : <p className="text-[11px]" style={{ color: C.t3 }}>Не заданы.</p>}
      </div>
    );
  }

  const save = async () => {
    setBusy(true); setFailed(''); setOk(false);
    const requisites: Record<string, string> = {};
    for (const { k, v } of fields) if (k.trim() && v.trim()) requisites[k.trim()] = v.trim();
    const { apiSetPaymentSettings } = await import('@/marketplace/violationsApi');
    const r = await apiSetPaymentSettings(requisites);
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось сохранить реквизиты'); return; }
    setSettings(r.data.settings); setOk(true);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Куда переводят штраф нарушители. Смена реквизитов не меняет уже выставленные штрафы —
        у них место оплаты заморожено на момент начисления.
      </p>
      {fields.map((f, i) => (
        <div key={i} className="flex gap-2">
          <input value={f.k} onChange={(e) => setFields((arr) => arr.map((x, j) => j === i ? { ...x, k: e.target.value } : x))}
            placeholder="поле" className="w-36 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          <input value={f.v} onChange={(e) => setFields((arr) => arr.map((x, j) => j === i ? { ...x, v: e.target.value } : x))}
            placeholder="значение" className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        </div>
      ))}
      <button type="button" onClick={() => setFields((arr) => [...arr, { k: '', v: '' }])}
        className="text-[11px] font-bold" style={{ color: C.acc }}>
        + поле
      </button>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {ok && <p className="text-[11px]" style={{ color: C.green }}>Сохранено.</p>}
      <button type="button" disabled={busy} onClick={() => void save()}
        className="w-full rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
        Сохранить реквизиты
      </button>
    </div>
  );
};

const ViolationsStatsTab = () => {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('@/marketplace/violationsApi').apiViolationStats>>['data'] | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    void (async () => {
      const { apiViolationStats } = await import('@/marketplace/violationsApi');
      const r = await apiViolationStats();
      if (!r.ok || !r.data) { setFailed('Не удалось загрузить статистику'); return; }
      setStats(r.data);
    })();
  }, []);

  if (failed) return <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>;
  if (!stats) return <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ПО МОДУЛЮ / СТАТУСУ / ТЯЖЕСТИ</p>
        {stats.byModule.map((row, i) => (
          <p key={i} className="mt-1 text-[11px]" style={{ color: C.t2 }}>
            {row.module} · {VIOLATION_STATUS_LABEL[row.status] ?? row.status} · {row.severity}: {row.n}
          </p>
        ))}
      </div>
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ШТРАФЫ</p>
        {stats.penaltySums.map((row, i) => (
          <p key={i} className="mt-1 text-[11px]" style={{ color: C.t2 }}>
            {row.status}: {row.n} шт., {(Number(row.sum_kop) / 100).toLocaleString('ru')} ₽
          </p>
        ))}
      </div>
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[10px] font-bold" style={{ color: C.t3 }}>АПЕЛЛЯЦИИ</p>
        {stats.appeals.map((row, i) => (
          <p key={i} className="mt-1 text-[11px]" style={{ color: C.t2 }}>
            {APPEAL_STATUS_LABEL[row.status] ?? row.status}: {row.n}
          </p>
        ))}
      </div>
    </div>
  );
};

const ViolationsAdminSection = ({ rights }: { rights: MyRights }) => {
  const [sub, setSub] = useState<'violations' | 'appeals' | 'rules' | 'payment' | 'stats' | 'manual'>('violations');
  const [mf, setMf] = useState({ entityId: '', ruleId: '' });
  const [mb, setMb] = useState(false);
  const submit = async () => {
    if (!mf.entityId || !mf.ruleId) return;
    setMb(true);
    const { apiCall } = await import('@/core/auth/api');
    await apiCall('/api/violations', { method: 'POST', body: JSON.stringify({ targetId: mf.entityId, ruleId: mf.ruleId }) });
    setMb(false);
    setMf({ entityId: '', ruleId: '' });
  };
  return (
    <div className="space-y-2">
      <ScrollTabs>
        {([
          ['violations', 'Нарушения'], ['appeals', 'Апелляции'], ['rules', 'Регламент'],
          ['payment', 'Реквизиты'], ['stats', 'Статистика'], ['manual', 'Штраф'],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: sub === k ? C.acc : C.l2, color: sub === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </ScrollTabs>
      {sub === 'violations' && <ViolationsListTab />}
      {sub === 'appeals' && <AppealsAdminTab />}
      {sub === 'rules' && <RulesAdminTab />}
      {sub === 'payment' && <PaymentSettingsTab rights={rights} />}
      {sub === 'stats' && <ViolationsStatsTab />}
      {sub === 'manual' && (
        <div className="space-y-2" style={{ background: C.l2, padding: 16, borderRadius: 12 }}>
          <input placeholder="ID магазина/ПВЗ" value={mf.entityId} onChange={(e) => setMf({...mf, entityId: e.target.value})}
            className="w-full px-3 py-2 text-xs rounded-xl outline-none" style={{ background: C.bg, color: C.t1 }} />
          <input placeholder="ID правила" value={mf.ruleId} onChange={(e) => setMf({...mf, ruleId: e.target.value})}
            className="w-full px-3 py-2 text-xs rounded-xl outline-none" style={{ background: C.bg, color: C.t1 }} />
          <button type="button" onClick={submit} disabled={mb} className="w-full py-2 text-xs font-bold rounded-xl text-white"
            style={{ background: C.acc, opacity: mb ? 0.6 : 1 }}>{mb ? '...' : 'Создать'}</button>
        </div>
      )}
    </div>
  );
};

const MarketAdminSection = () => {
  const [tab, setTab] = useState<'disputes' | 'games'>('disputes');
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {([['disputes', 'Споры'], ['games', 'Игровой каталог']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className="rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: tab === k ? C.acc : C.l2, color: tab === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'disputes' ? <MarketDisputesTab /> : <MarketGamesTab />}
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
      <ScrollTabs>
        {([['disputed', 'Споры'], ['in_escrow', 'У гаранта'], ['completed', 'Завершены'], ['cancelled', 'Отменены'], ['', 'Все']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </ScrollTabs>
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

/* ─── Sky Ads: модерация и управление кампаниями ──────────────────────
   Список площадок/цен, статусов и денежного расчёта — те же, что уже
   есть на клиенте (src/ads/store.ts) и на сервере (server/ads.mjs):
   здесь только просмотр и решения, всё считает и хранит сервер. */

const AdsAdminDetail = ({ campaignId, onBack, onChanged }: { campaignId: string; onBack: () => void; onChanged: () => void }) => {
  const [detail, setDetail] = useState<import('@/ads/adsApi').CampaignDetail | null>(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiCampaignDetail } = await import('@/ads/adsApi');
    const r = await apiCampaignDetail(campaignId);
    if (!r) { setFailed('Не удалось загрузить кампанию'); return; }
    setDetail(r);
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: import('@/ads/adsApi').AdminAction, withReason = false) => {
    if (withReason && !reason.trim()) { setFailed('Укажите причину'); return; }
    setBusy(true); setFailed('');
    const { apiAdminAction } = await import('@/ads/adsApi');
    const ok = await apiAdminAction(campaignId, action, withReason ? reason.trim() : undefined);
    setBusy(false);
    if (!ok) { setFailed('Не получилось выполнить действие'); return; }
    setRejecting(false); setReason('');
    void load(); onChanged();
  };

  if (!detail) {
    return failed
      ? <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>
      : <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
  }

  const { campaign: c, statsByRegion, events } = detail;
  const mediaUrl = campaignMediaUrl(c);
  const placementLabel = AD_PLACEMENTS.find((p) => p.placement === c.placement)?.label ?? c.placement;

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-bold" style={{ color: C.t3 }}>← К списку кампаний</button>

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        {mediaUrl && (
          c.format === 'video'
            ? <video src={mediaUrl} controls className="mb-2 w-full max-h-48 rounded-xl object-cover" />
            : <img src={mediaUrl} alt="" className="mb-2 w-full max-h-48 rounded-xl object-cover" />
        )}
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{c.title}</p>
          <span className="shrink-0 text-[10px] font-bold" style={{ color: AD_STATUS_COLOR[c.status] }}>
            {AD_STATUS_LABEL[c.status]}
          </span>
        </div>
        <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>id: {c.id} · рекламодатель: {c.userId}</p>
        {c.description && <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>{c.description}</p>}
        {c.linkUrl && <p className="mt-1 truncate text-[11px]" style={{ color: C.acc }}>{c.linkUrl}</p>}

        <div className="mt-2 grid grid-cols-4 gap-2">
          <div className="rounded-xl p-2 text-center" style={{ background: C.l2 }}>
            <p className="text-[9px] uppercase" style={{ color: C.t3 }}>Показы</p>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{c.impressions.toLocaleString('ru')}</p>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: C.l2 }}>
            <p className="text-[9px] uppercase" style={{ color: C.t3 }}>Клики</p>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{c.clicks.toLocaleString('ru')}</p>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: C.l2 }}>
            <p className="text-[9px] uppercase" style={{ color: C.t3 }}>CTR</p>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{c.ctr}%</p>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: C.l2 }}>
            <p className="text-[9px] uppercase" style={{ color: C.t3 }}>Потрачено</p>
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{fmtBudget(c.spent)}</p>
          </div>
        </div>

        <div className="mt-2 space-y-1 rounded-xl p-2.5" style={{ background: C.l2 }}>
          {[
            ['Площадка', placementLabel],
            ['Формат', AD_FORMAT_LABEL[c.format]],
            ['Бюджет', `${fmtBudget(c.budget)} (${fmtBudget(c.dailyLimit)}/день × ${c.durationDays} дн.)`],
            ['Регионы', c.targetRegions.length ? c.targetRegions.join(', ') : 'Все регионы'],
            ['Старт', c.startDate ? fmtTs(c.startDate) : '—'],
            ['Конец', c.endDate ? fmtTs(c.endDate) : '—'],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between text-[11px]">
              <span style={{ color: C.t3 }}>{l}</span>
              <span style={{ color: C.t2 }}>{v}</span>
            </div>
          ))}
        </div>

        {c.rejectReason && (
          <div className="mt-2 rounded-xl p-2.5" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: C.red }}>Причина отказа</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>{c.rejectReason}</p>
          </div>
        )}

        {failed && <p className="mt-2 text-[11px]" style={{ color: C.red }}>{failed}</p>}

        {c.status === 'moderation' && (
          rejecting ? (
            <div className="mt-3 space-y-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина отказа"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void act('reject', true)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.red, color: '#fff' }}>
                  Отклонить
                </button>
                <button type="button" onClick={() => setRejecting(false)} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}>Отмена</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void act('approve')}
                className="flex-1 rounded-xl py-2.5 text-xs font-bold disabled:opacity-50" style={{ background: C.green, color: '#fff' }}>
                Одобрить
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)}
                className="flex-1 rounded-xl py-2.5 text-xs font-bold disabled:opacity-50" style={{ background: C.l2, color: C.red }}>
                Отклонить
              </button>
            </div>
          )
        )}

        {c.status === 'active' && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void act('pause')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.t2 }}>Пауза</button>
            <button type="button" disabled={busy} onClick={() => void act('complete')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.t2 }}>Завершить</button>
            <button type="button" disabled={busy} onClick={() => void act('cancel')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.red }}>Отменить</button>
          </div>
        )}

        {c.status === 'paused' && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void act('resume')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.green }}>Возобновить</button>
            <button type="button" disabled={busy} onClick={() => void act('complete')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.t2 }}>Завершить</button>
            <button type="button" disabled={busy} onClick={() => void act('cancel')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.red }}>Отменить</button>
          </div>
        )}

        {c.status === 'scheduled' && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void act('cancel')}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: C.l2, color: C.red }}>Отменить</button>
          </div>
        )}

        {statsByRegion.length > 0 && (
          <div className="mt-3">
            <p className="text-[9px] font-bold uppercase" style={{ color: C.t3 }}>По регионам</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {statsByRegion.slice(0, 8).map((r) => (
                <span key={r.region} className="rounded-lg px-2 py-0.5 text-[10px]" style={{ background: C.l2, color: C.t2 }}>
                  {r.region}: {r.impressions}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>ЖУРНАЛ</p>
          <div className="space-y-1.5">
            {events.map((e) => (
              <div key={e.id} className="rounded-xl px-3 py-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <p className="text-[11px]" style={{ color: C.t2 }}>{e.kind}{e.detail ? ` — ${e.detail}` : ''}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AdsAdminSection = () => {
  const [items, setItems] = useState<import('@/ads/adsApi').AdminAdCampaign[] | null>(null);
  const [status, setStatus] = useState<'' | 'moderation' | 'active' | 'paused' | 'scheduled' | 'rejected' | 'completed' | 'cancelled'>('moderation');
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminCampaigns } = await import('@/ads/adsApi');
    setItems(await apiAdminCampaigns({ status: status || undefined, q: q.trim() || undefined }));
  }, [status, q]);

  useEffect(() => { void load(); }, [load]);

  if (openId) return <AdsAdminDetail campaignId={openId} onBack={() => setOpenId(null)} onChanged={() => void load()} />;

  return (
    <div className="space-y-2">
      <ScrollTabs>
        {([
          ['moderation', 'На проверке'], ['active', 'Активные'], ['paused', 'На паузе'],
          ['scheduled', 'Запланированы'], ['rejected', 'Отклонены'], ['completed', 'Завершены'],
          ['cancelled', 'Отменены'], ['', 'Все'],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </ScrollTabs>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, id или ник рекламодателя"
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          <RefreshCw size={12} />
        </button>
      </div>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Кампаний не найдено.</p>
      ) : items.map((c) => (
        <button key={c.id} type="button" onClick={() => setOpenId(c.id)}
          className="w-full rounded-2xl p-3 text-left"
          style={{ background: C.l1, border: `1px solid ${c.status === 'moderation' ? 'rgba(245,158,11,0.35)' : C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>{c.title}</p>
              <p className="mt-0.5 truncate text-[10px]" style={{ color: C.t3 }}>
                {c.advertiserName} @{c.advertiserUsername} · {AD_PLACEMENTS.find((p) => p.placement === c.placement)?.label ?? c.placement}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-bold" style={{ color: AD_STATUS_COLOR[c.status] }}>
              {AD_STATUS_LABEL[c.status]}
            </span>
          </div>
          <div className="mt-2 flex gap-3 text-[10px]" style={{ color: C.t3 }}>
            <span>{fmtBudget(c.budget)}</span>
            <span>{c.impressions.toLocaleString('ru')} показов</span>
            <span>{c.clicks.toLocaleString('ru')} кликов</span>
          </div>
        </button>
      ))}
    </div>
  );
};

/* ─── Рассылки ─────────────────────────────────────────────────────────
   Показ уведомления не меняется — тот же useNotifStore/NotifBridge, что
   и у лайков/комментариев Bloom. Здесь только создание, планирование,
   аудитория и история: реальную отправку делает серверный worker
   (server/notifyBroadcast.mjs), не браузер. */

const BROADCAST_STATUS_LABEL: Record<import('@/notifications/broadcastApi').BroadcastStatus, string> = {
  draft: 'Черновик', scheduled: 'Запланирована', processing: 'Отправляется',
  sent: 'Отправлена', cancelled: 'Отменена', failed: 'Ошибка',
};

const BROADCAST_ERROR: Record<string, string> = {
  empty: 'Заполните заголовок и текст',
  bad_link: 'Ссылка должна вести на собственный раздел приложения (начинаться с /)',
  bad_audience: 'Выберите аудиторию',
  empty_audience: 'Укажите хотя бы одного пользователя',
  too_many_users: 'Слишком много пользователей в списке',
  bad_region: 'Выберите регион',
  bad_schedule: 'Неверная дата и время',
  not_allowed: 'Недостаточно прав',
  not_found: 'Не найдено',
  not_cancellable: 'Рассылку уже нельзя отменить — отправка началась или она уже решена',
};

const errBroadcast = (code?: string, unknown?: string[]) => {
  if (code === 'unknown_usernames' && unknown?.length) return `Не найдены: ${unknown.join(', ')}`;
  return BROADCAST_ERROR[String(code ?? '')] ?? 'Не получилось';
};

const fmtDT = (iso?: string) => iso ? new Date(iso).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const NotifyComposeForm = ({ onSent }: { onSent: () => void }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [audienceType, setAudienceType] = useState<import('@/notifications/broadcastApi').AudienceType>('all');
  const [usernames, setUsernames] = useState('');
  const [region, setRegion] = useState('RU');
  const [scheduleKind, setScheduleKind] = useState<import('@/notifications/broadcastApi').ScheduleKind>('once');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = title.trim() && body.trim()
    && (audienceType !== 'users' || usernames.trim())
    && (when !== 'later' || (date && time));

  const send = async () => {
    setBusy(true); setFailed(''); setSent('');
    const { apiAdminCreateBroadcast } = await import('@/notifications/broadcastApi');

    let scheduledAt: string | undefined;
    if (when === 'later') {
      const local = new Date(`${date}T${time}`);
      if (Number.isNaN(local.getTime())) { setBusy(false); setFailed('Неверная дата и время'); setConfirming(false); return; }
      scheduledAt = local.toISOString();
    }

    const r = await apiAdminCreateBroadcast({
      title: title.trim(), body: body.trim(), link: link.trim() || undefined,
      audienceType,
      usernames: audienceType === 'users'
        ? usernames.split(/[\n,]/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean) : undefined,
      region: audienceType === 'region' ? region : undefined,
      scheduleKind, sendNow: when === 'now', scheduledAt,
      timezoneLabel: when === 'later' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
      reason: reason.trim() || undefined,
    });
    setBusy(false); setConfirming(false);
    if (!r.ok || !r.data) { setFailed(errBroadcast(r.error, (r as { unknown?: string[] }).unknown)); return; }
    setSent(when === 'now' ? 'Рассылка отправляется.' : 'Рассылка запланирована.');
    setTitle(''); setBody(''); setLink(''); setUsernames(''); setReason(''); setDate(''); setTime('');
    onSent();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-xs font-bold" style={{ color: C.t1 }}>Новая рассылка</p>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" maxLength={200}
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Текст уведомления" maxLength={1000} rows={3}
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Ссылка в приложении, необязательно (например /bloom)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

      <p className="mt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Кому</p>
      <div className="flex gap-1">
        {([['all', 'Всем'], ['users', 'Пользователям'], ['region', 'По региону']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAudienceType(k)}
            className="flex-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold"
            style={{ background: audienceType === k ? C.acc : C.l2, color: audienceType === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>
      {audienceType === 'users' && (
        <textarea value={usernames} onChange={(e) => setUsernames(e.target.value)} rows={2}
          placeholder="Ники через запятую или с новой строки: username1, username2"
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      )}
      {audienceType === 'region' && (
        <select value={region} onChange={(e) => setRegion(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
        </select>
      )}

      <p className="mt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Когда</p>
      <div className="flex gap-1">
        <button type="button" onClick={() => setWhen('now')}
          className="flex-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold"
          style={{ background: when === 'now' ? C.acc : C.l2, color: when === 'now' ? '#fff' : C.t3 }}>
          Сейчас
        </button>
        <button type="button" onClick={() => setWhen('later')}
          className="flex-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold"
          style={{ background: when === 'later' ? C.acc : C.l2, color: when === 'later' ? '#fff' : C.t3 }}>
          Запланировать
        </button>
      </div>
      {when === 'later' && (
        <>
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          </div>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Часовой пояс браузера: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Повтор</p>
          <div className="flex gap-1">
            {([['once', 'Один раз'], ['daily', 'Ежедневно'], ['weekly', 'Еженедельно']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setScheduleKind(k)}
                className="flex-1 rounded-xl px-2 py-1.5 text-[11px] font-semibold"
                style={{ background: scheduleKind === k ? C.acc : C.l2, color: scheduleKind === k ? '#fff' : C.t3 }}>
                {l}
              </button>
            ))}
          </div>
        </>
      )}

      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина/заметка (необязательно, для журнала)"
        className="mt-2 w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {confirming ? (
        <div className="space-y-2 rounded-xl p-2.5" style={{ background: 'rgba(248,113,113,0.08)', border: `1px solid ${C.red}` }}>
          <p className="text-[11px]" style={{ color: C.t2 }}>
            {audienceType === 'all' ? 'Уйдёт всем пользователям сервиса. ' : ''}
            Подтвердите отправку — массовая рассылка необратима, отменить можно только то, что ещё не ушло.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void send()}
              className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.red, color: '#fff' }}>
              Подтвердить и {when === 'now' ? 'отправить' : 'запланировать'}
            </button>
            <button type="button" onClick={() => setConfirming(false)}
              className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={!valid} onClick={() => setConfirming(true)}
          className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          {when === 'now' ? 'Отправить сейчас' : 'Запланировать'}
        </button>
      )}
    </div>
  );
};

const NotifyBroadcastDetail = ({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) => {
  const [data, setData] = useState<{ broadcast: import('@/notifications/broadcastApi').Broadcast; runs: import('@/notifications/broadcastApi').BroadcastRun[] } | null>(null);
  const [failed, setFailed] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    const { apiAdminGetBroadcast } = await import('@/notifications/broadcastApi');
    const r = await apiAdminGetBroadcast(id);
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить'); return; }
    setData(r.data);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const cancel = async () => {
    const { apiAdminCancelBroadcast } = await import('@/notifications/broadcastApi');
    const r = await apiAdminCancelBroadcast(id, cancelReason.trim() || undefined);
    setCancelling(false);
    if (!r.ok) { setFailed('Не удалось отменить'); return; }
    void load(); onChanged();
  };

  if (!data) {
    return failed
      ? <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>
      : <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
  }
  const b = data.broadcast;
  const cancellable = b.status === 'draft' || b.status === 'scheduled';

  return (
    <div className="space-y-2">
      <button type="button" onClick={onBack} className="text-[11px]" style={{ color: C.t3 }}>← Назад к истории</button>
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-bold" style={{ color: C.t1 }}>{b.title}</p>
          <span className="shrink-0 text-[10px] font-bold" style={{
            color: b.status === 'sent' ? C.green : b.status === 'failed' ? C.red
              : b.status === 'cancelled' ? C.t3 : C.amber,
          }}>{BROADCAST_STATUS_LABEL[b.status]}</span>
        </div>
        <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>{b.body}</p>
        {b.link && <p className="mt-1 text-[11px]" style={{ color: C.acc }}>{b.link}</p>}
        <div className="mt-2 space-y-0.5 text-[10px]" style={{ color: C.t3 }}>
          <p>Создал: {b.creatorName ?? '—'} {b.creatorUsername ? `@${b.creatorUsername}` : ''} · {fmtDT(b.createdAt)}</p>
          <p>Аудитория: {b.audienceType === 'all' ? 'все пользователи' : b.audienceType === 'region' ? `регион ${b.audienceRegion}` : `${b.audienceUserIds.length} чел.`}</p>
          <p>Расписание: {b.scheduleKind === 'once' ? 'один раз' : b.scheduleKind === 'daily' ? 'ежедневно' : 'еженедельно'}
            {b.scheduledAt ? ` · план: ${fmtDT(b.scheduledAt)}${b.timezoneLabel ? ` (${b.timezoneLabel})` : ''}` : ''}</p>
          {b.lastSentAt && <p>Последняя отправка: {fmtDT(b.lastSentAt)}</p>}
          {b.reason && <p>Причина: {b.reason}</p>}
          {b.lastError && <p style={{ color: C.red }}>Ошибка: {b.lastError}</p>}
          {b.cancelledAt && <p>Отменена: {fmtDT(b.cancelledAt)}{b.reason ? ` · ${b.reason}` : ''}</p>}
        </div>

        {cancellable && (
          cancelling ? (
            <div className="mt-2 space-y-2">
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Причина отмены (необязательно)"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              <div className="flex gap-2">
                <button type="button" onClick={() => void cancel()} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.red, color: '#fff' }}>Подтвердить отмену</button>
                <button type="button" onClick={() => setCancelling(false)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>Назад</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setCancelling(true)}
              className="mt-2 w-full rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.red }}>
              Отменить рассылку
            </button>
          )
        )}
      </div>

      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Запуски</p>
      {data.runs.length === 0 ? (
        <p className="py-4 text-center text-[11px]" style={{ color: C.t3 }}>Ещё не запускалась.</p>
      ) : data.runs.map((run) => (
        <div key={run.id} className="rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold" style={{ color: C.t1 }}>{fmtDT(run.scheduledFor)}</span>
            <span className="text-[10px] font-bold" style={{ color: run.status === 'sent' ? C.green : run.status === 'failed' ? C.red : C.amber }}>
              {run.status === 'sent' ? 'Отправлено' : run.status === 'failed' ? 'Ошибка' : 'В процессе'}
            </span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            Получателей: {run.recipientsTotal} · доставлено: {run.recipientsSent}
            {run.recipientsFailed > 0 ? ` · ошибок: ${run.recipientsFailed}` : ''}
          </p>
          {run.error && <p className="mt-0.5 text-[10px]" style={{ color: C.red }}>{run.error}</p>}
        </div>
      ))}
    </div>
  );
};

const NotifyHistoryList = ({ openId, setOpenId }: { openId: string | null; setOpenId: (id: string | null) => void }) => {
  const [status, setStatus] = useState<'' | import('@/notifications/broadcastApi').BroadcastStatus>('');
  const [items, setItems] = useState<import('@/notifications/broadcastApi').Broadcast[] | null>(null);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setFailed('');
    const { apiAdminListBroadcasts } = await import('@/notifications/broadcastApi');
    const r = await apiAdminListBroadcasts({ status: status || undefined, limit: 50 });
    if (!r.ok || !r.data) { setFailed('Не удалось загрузить историю'); return; }
    setItems(r.data.items);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  if (openId) return <NotifyBroadcastDetail id={openId} onBack={() => setOpenId(null)} onChanged={() => void load()} />;

  return (
    <div className="space-y-2">
      <ScrollTabs>
        {([['', 'Все'], ['scheduled', 'Запланированы'], ['sent', 'Отправлены'], ['cancelled', 'Отменены'], ['failed', 'Ошибки']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </ScrollTabs>
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {items === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Рассылок нет.</p>
      ) : items.map((b) => (
        <button key={b.id} type="button" onClick={() => setOpenId(b.id)}
          className="w-full rounded-2xl p-3 text-left" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{b.title}</p>
            <span className="shrink-0 text-[10px] font-bold" style={{
              color: b.status === 'sent' ? C.green : b.status === 'failed' ? C.red
                : b.status === 'cancelled' ? C.t3 : C.amber,
            }}>{BROADCAST_STATUS_LABEL[b.status]}</span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {b.audienceType === 'all' ? 'Всем' : b.audienceType === 'region' ? `Регион: ${b.audienceRegion}` : `${b.audienceUserIds.length} чел.`}
            {' · '}{fmtDT(b.scheduledAt ?? b.createdAt)}
          </p>
        </button>
      ))}
    </div>
  );
};

const NotifyAdminSection = () => {
  const [sub, setSub] = useState<'compose' | 'history'>('compose');
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {([['compose', 'Создать'], ['history', 'История']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setSub(k); setOpenId(null); }}
            className="flex-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: sub === k ? C.acc : C.l2, color: sub === k ? '#fff' : C.t3 }}>
            {l}
          </button>
        ))}
      </div>
      {sub === 'compose'
        ? <NotifyComposeForm onSent={() => setSub('history')} />
        : <NotifyHistoryList openId={openId} setOpenId={setOpenId} />}
    </div>
  );
};

/* ─── Панель ───────────────────────────────────────────────────────── */

type Tab = 'monitor' | 'overview' | 'people' | 'pending' | 'admins' | 'grant' | 'video' | 'bloom' | 'pulse' | 'campaigns' | 'gifts' | 'couriers' | 'family' | 'garant' | 'market' | 'kutrent' | 'pets' | 'customization' | 'ads' | 'codes' | 'sellers' | 'blox' | 'notify' | 'log' | 'events' | 'violations' | 'content' | 'go' | 'registration' | 'site' | 'modules' | 'skykassa' | 'storage';

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

  const [platformStatus, setPlatformStatus] = useState<import('@/core/platform').PlatformStatus | null>(null);
  const [shutdownStep, setShutdownStep] = useState(false);
  const [maintenanceStep, setMaintenanceStep] = useState(false);
  const [shutdownReason, setShutdownReason] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [platformFailed, setPlatformFailed] = useState('');

  const loadPlatformStatus = useCallback(async () => {
    const { apiPlatformStatus } = await import('@/core/platform');
    const s = await apiPlatformStatus();
    if (s) setPlatformStatus(s);
  }, []);

  const doSetShutdown = async (code: string) => {
    setShutdownStep(false); setPlatformFailed('');
    const { apiSetPlatformShutdown } = await import('@/core/platform');
    const r = await apiSetPlatformShutdown(!(platformStatus?.shutdown.active), shutdownReason.trim(), code);
    if (!r.ok) { setPlatformFailed(errorText(r.error)); return; }
    setPlatformStatus((p) => (p ? { ...p, shutdown: r.state } : p));
    setShutdownReason('');
  };

  const doSetMaintenance = async (code: string) => {
    setMaintenanceStep(false); setPlatformFailed('');
    const { apiSetPlatformMaintenance } = await import('@/core/platform');
    const r = await apiSetPlatformMaintenance(!(platformStatus?.maintenance.active), maintenanceReason.trim(), code);
    if (!r.ok) { setPlatformFailed(errorText(r.error)); return; }
    setPlatformStatus((p) => (p ? { ...p, maintenance: r.state } : p));
    setMaintenanceReason('');
  };

  // Мониторинг — главная вкладка: при первой загрузке прав открываем её тем, у кого она есть.
  const monitorOpened = useRef(false);
  useEffect(() => {
    if (!rights || monitorOpened.current) return;
    monitorOpened.current = true;
    if (rights.permissions.includes('analytics')) setTab('monitor');
  }, [rights]);

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
      gateRequired: r.payload.gateRequired === true,
      lockdown: r.payload.lockdown ?? { active: false, reason: '', since: null },
    } : {
      admin: false, owner: false, role: null, roleLabel: '',
      permissions: [], legacy: false,
      twoFactor: false, twoFactorDue: null, twoFactorRequired: false,
      lockdown: { active: false, reason: '', since: null },
    });
  }, []);

  useEffect(() => { void loadRights(); }, [loadRights]);
  useEffect(() => { if (rights?.owner) void loadPlatformStatus(); }, [rights?.owner, loadPlatformStatus]);

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

  if (rights.gateRequired) {
    return <AdminGateScreen onOpened={() => void loadRights()} />;
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
    { key: 'monitor', label: 'Мониторинг', show: has('analytics') },
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
    { key: 'market', label: 'Sky Market', show: has('market') },
    { key: 'violations', label: 'Нарушения и штрафы', show: has('violations') },
    { key: 'kutrent', label: 'KutRent Market', show: has('kutrent_market') },
    { key: 'content', label: 'Контент', show: has('content') },
    { key: 'go', label: 'Sky GO', show: has('go') },
    { key: 'registration', label: 'Регистрация', show: has('registration') },
    { key: 'site', label: 'Сайт', show: has('site') },
    { key: 'modules', label: 'Модули', show: has('modules') },
    { key: 'storage', label: 'Sky Storage', show: has('storage_view') },
    { key: 'skykassa', label: 'SkyKassa', show: has('skykassa') || has('skykassa_settings') },
    { key: 'pets', label: 'Pets и Skin Market', show: has('content') },
    { key: 'customization', label: 'Кастомизация', show: has('content') },
    { key: 'bloom', label: 'Bloom', show: has('content') },
    { key: 'ads', label: 'Реклама', show: has('content') },
    { key: 'codes', label: 'Sky Codes', show: has('codes') },
    { key: 'blox', label: 'Sky Blox', show: has('blox') || has('blox_moderation') || has('blox_finance') || rights.owner },
    { key: 'sellers', label: 'Продавцы Market', show: has('seller_docs') || has('market_moderation') || has('pvz_manage') || has('market') },
    { key: 'notify', label: 'Рассылки', show: has('notifications') },
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
      <ScrollTabs>
        {TABS.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: tab === t.key ? C.acc : C.l2, color: tab === t.key ? '#fff' : C.t3 }}>
            {t.label}
          </button>
        ))}
      </ScrollTabs>

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

          {rights.owner && (
            <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[10px] font-bold" style={{ color: C.t3 }}>АВАРИЙНЫЕ РАБОТЫ</p>
              <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
                Не путать с аварийным режимом выше: тот закрывает только панель.
                Это — сайт целиком, недоступен вообще никому, кроме вас. Крайняя
                мера для тяжёлого инцидента, не для плановых работ.
              </p>
              {platformFailed && <p className="mt-1.5 text-[11px]" style={{ color: C.red }}>{platformFailed}</p>}
              {platformStatus?.shutdown.active ? (
                <p className="mt-1.5 text-[11px]" style={{ color: C.red }}>
                  Включено {fmtTs(platformStatus.shutdown.set_at)}
                  {platformStatus.shutdown.reason ? `: ${platformStatus.shutdown.reason}` : ''}
                </p>
              ) : (
                <textarea value={shutdownReason} onChange={(e) => setShutdownReason(e.target.value.slice(0, 300))}
                  placeholder="Причина — её увидят все на экране" rows={2}
                  className="mt-2 w-full resize-none rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              )}
              {shutdownStep ? (
                <div className="mt-2">
                  <StepUp purpose="platform_shutdown"
                    onCode={(c) => void doSetShutdown(c)}
                    onCancel={() => setShutdownStep(false)} />
                </div>
              ) : (
                <button type="button" onClick={() => setShutdownStep(true)}
                  className="mt-2 w-full rounded-xl py-2.5 text-xs font-bold"
                  style={{
                    background: platformStatus?.shutdown.active ? C.l2 : C.red,
                    color: platformStatus?.shutdown.active ? C.green : '#fff',
                  }}>
                  {platformStatus?.shutdown.active ? 'Снять аварийные работы' : 'Включить аварийные работы'}
                </button>
              )}
            </div>
          )}

          {rights.owner && (
            <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ТЕХНИЧЕСКИЕ РАБОТЫ</p>
              <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
                Сайт недоступен обычным людям, но администрация продолжает
                работать. Плановое обслуживание, а не авария.
              </p>
              {platformStatus?.maintenance.active ? (
                <p className="mt-1.5 text-[11px]" style={{ color: C.amber }}>
                  Включено {fmtTs(platformStatus.maintenance.set_at)}
                  {platformStatus.maintenance.reason ? `: ${platformStatus.maintenance.reason}` : ''}
                </p>
              ) : (
                <textarea value={maintenanceReason} onChange={(e) => setMaintenanceReason(e.target.value.slice(0, 300))}
                  placeholder="Причина — её увидят все на экране" rows={2}
                  className="mt-2 w-full resize-none rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
              )}
              {maintenanceStep ? (
                <div className="mt-2">
                  <StepUp purpose="platform_maintenance"
                    onCode={(c) => void doSetMaintenance(c)}
                    onCancel={() => setMaintenanceStep(false)} />
                </div>
              ) : (
                <button type="button" onClick={() => setMaintenanceStep(true)}
                  className="mt-2 w-full rounded-xl py-2.5 text-xs font-bold"
                  style={{
                    background: platformStatus?.maintenance.active ? C.l2 : C.amber,
                    color: platformStatus?.maintenance.active ? C.green : '#fff',
                  }}>
                  {platformStatus?.maintenance.active ? 'Снять технические работы' : 'Включить технические работы'}
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

      {tab === 'grant' && (
        <div className="space-y-4">
          <GrantForm onSent={() => void loadPending()} />
          <UserMoneyOps onSent={() => void loadPending()} />
        </div>
      )}
      {tab === 'video' && <SkyVideoAdminSection rights={rights} onPendingChanged={() => void loadPending()} />}
      {tab === 'content' && <ContentModTab />}
      {tab === 'registration' && <RegistrationTab />}
      {tab === 'site' && <SiteTab />}
      {tab === 'modules' && <ModulesTab />}
      {tab === 'storage' && <StorageTab perms={rights?.permissions ?? []} owner={Boolean(rights?.owner)} />}
      {tab === 'skykassa' && <SkyKassaTab owner={Boolean(rights?.owner)} canReview={has('skykassa')} canSettings={has('skykassa_settings')} />}
      {tab === 'go' && <GoAdminTab />}
      {tab === 'pulse' && <PrimePulseAdminSection />}
      {tab === 'campaigns' && <CampaignsAdminSection onPendingChanged={() => void loadPending()} />}
      {tab === 'gifts' && <GiftsAdminSection />}
      {tab === 'couriers' && <CourierAdminSection />}
      {tab === 'family' && <FamilyAdminSection />}
      {tab === 'garant' && <GarantAdminSection />}
      {tab === 'market' && <MarketAdminSection />}
      {tab === 'violations' && <ViolationsAdminSection rights={rights} />}
      {tab === 'kutrent' && <KutrentMarketAdminSection rights={rights} />}
      {tab === 'pets' && <PetsAdminSection />}
      {tab === 'customization' && <CustomizationAdminSection />}
      {tab === 'bloom' && <BloomAdminSection />}
      {tab === 'ads' && <AdsAdminSection />}
      {tab === 'codes' && <CodesAdminSection owner={rights.owner} />}
      {tab === 'monitor' && <MonitoringTab />}
      {tab === 'blox' && <BloxAdminSection can={(p) => has(p as AdminPermission)} owner={rights.owner} />}
      {tab === 'sellers' && <MarketVerifyAdmin can={(p) => has(p as AdminPermission)} />}
      {tab === 'notify' && <NotifyAdminSection />}

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

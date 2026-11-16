/** Sky Music Studio: кабинет владельца карточки музыканта — свои треки, метаданные, замена звука (MP3) с версиями и откатом. */
import { useEffect, useState } from 'react';
import { ChevronLeft, Upload, RotateCcw, Pencil } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { apiTrack, toClientTrack } from './musicApi';
import { TrackEditor } from './TrackEditor';
import type { Track } from './types';
import { RoyaltiesCabinet } from '@/royalties/RoyaltiesCabinet';

const C = { bg: 'var(--bg)', card: 'var(--bg-l2)', border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', accent: 'var(--accent)', red: 'var(--red)' };
const S = '/api/music/studio';
interface Card { id: string; name: string; genres: string[]; published: number; mine: number }
interface Row { id: string; title: string; artist: string; status: string; bytes: number; plays: number; versions: number; explicit: boolean; updatedAt: string }
interface Ver { version: number; bytes: number; note: string; at: string; current: boolean }
const STATUS: Record<string, string> = { published: 'Опубликован', private: 'Личный', pending: 'На проверке', rejected: 'Отклонён' };
const ERR: Record<string, string> = {
  unsupported_type: 'Нужен настоящий MP3-файл (по содержимому, не по расширению).', file_too_large: 'Файл слишком большой — до 30 МБ.', not_found: 'Трек не найден или он не ваш.',
  rate_limited: 'Слишком часто — попробуйте позже.', already_current: 'Эта версия уже действующая.', storage_provider_unavailable: 'Хранилище сейчас недоступно, файл не заменён.',
  replace_failed: 'Не удалось заменить файл. Прежний звук не тронут.', rollback_failed: 'Не удалось откатить. Прежний звук не тронут.',
};
const fail = (r: { error?: string; status?: number }) => flash(ERR[r.error ?? ''] ?? (r.status === 413 ? ERR.file_too_large : `Не получилось (${r.error ?? 'ошибка'})`));
const mb = (n: number) => `${(n / 1048576).toFixed(1)} МБ`;

export const MusicStudio = ({ onClose }: { onClose?: () => void }) => {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { void apiCall<{ cards: Card[] }>(`${S}/cards`).then((r) => { if (r.ok) setCards(r.data!.cards); else { setErr(true); setCards([]); } }); }, []);
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6 pt-4" style={{ background: C.bg }}>
      <div className="mb-3 flex items-center gap-2">
        {(card || onClose) && <button type="button" aria-label="Назад" onClick={() => (card ? setCard(null) : onClose?.())} className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: C.card, color: C.t1 }}><ChevronLeft size={20} /></button>}
        <p className="text-lg font-black" style={{ color: C.t1 }}>{card ? card.name : 'Sky Music Studio'}</p>
      </div>
      {!cards && <p style={{ color: C.t3 }}>Загрузка…</p>}
      {err && <p style={{ color: C.red }}>Не удалось загрузить студию.</p>}
      {cards && !card && (cards.length === 0 && !err ? (
        <p className="text-sm" style={{ color: C.t3 }}>У вас пока нет подтверждённой карточки музыканта. Откройте страницу исполнителя в Sky Music и подайте заявку на владение — её проверяет администрация.</p>
      ) : cards.map((c) => (
        <button key={c.id} type="button" onClick={() => setCard(c)} className="mb-2 w-full rounded-2xl p-4 text-left" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <span translate="no" className="block font-bold" style={{ color: C.t1 }}>{c.name}</span>
          <span className="text-xs" style={{ color: C.t2 }}>Опубликовано треков: {c.published} · ваших: {c.mine}</span>
        </button>)))}
      {!card && <RoyaltiesCabinet />}
      {card && <RoyaltyBlock cardId={card.id} />}
      {card && <Tracks card={card} />}
    </div>
  );
};

const Tracks = ({ card }: { card: Card }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [others, setOthers] = useState(0);
  const [open, setOpen] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Track | null>(null);
  const load = () => apiCall<{ tracks: Row[]; othersPublished: number }>(`${S}/cards/${card.id}/tracks?limit=100`).then((r) => { if (r.ok) { setRows(r.data!.tracks); setOthers(r.data!.othersPublished); } else { setRows([]); fail(r); } });
  useEffect(() => { void load(); }, [card.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (edit) return <TrackEditor track={edit} onClose={() => { setEdit(null); void load(); }} />;
  if (open) return <TrackStudio row={open} onBack={() => { setOpen(null); void load(); }} onEdit={async () => { const t = await apiTrack(open.id); if (t) setEdit(toClientTrack(t)); else flash('Не удалось открыть трек'); }} />;
  if (!rows) return <p style={{ color: C.t3 }}>Загрузка…</p>;
  return (
    <div>
      {rows.length === 0 && <p className="text-sm" style={{ color: C.t3 }}>На этой карточке нет ваших треков.</p>}
      {rows.map((t) => (
        <button key={t.id} type="button" onClick={() => setOpen(t)} className="mb-2 w-full rounded-2xl p-3 text-left" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <span translate="no" className="block font-bold" style={{ color: C.t1 }}>{t.title}</span>
          <span className="text-xs" style={{ color: C.t2 }}>{STATUS[t.status] ?? t.status} · {mb(t.bytes)} · прослушиваний: {t.plays}{t.versions > 1 ? ` · версий звука: ${t.versions}` : ''}</span>
        </button>))}
      {others > 0 && <p className="mt-3 text-xs" style={{ color: C.t3 }}>На карточке есть ещё {others} опубликованных треков других авторов — их можно только слушать, править их вы не можете.</p>}
    </div>
  );
};

const TrackStudio = ({ row, onBack, onEdit }: { row: Row; onBack: () => void; onEdit: () => void }) => {
  const [vers, setVers] = useState<Ver[] | null>(null);
  const [status, setStatus] = useState(row.status);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = () => apiCall<{ versions: Ver[]; status: string }>(`${S}/tracks/${row.id}/versions`).then((r) => { if (r.ok) { setVers(r.data!.versions); setStatus(r.data!.status); } });
  useEffect(() => { void load(); }, [row.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const replace = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 30 * 1048576) return flash(ERR.file_too_large);
    if (status === 'published' && !window.confirm('Трек опубликован. После замены звука он уйдёт на повторную проверку и пропадёт из каталога до решения. Продолжить?')) return;
    setBusy(true);
    const r = await apiCall<{ status: string; backToReview: boolean }>(`${S}/tracks/${row.id}/audio?note=${encodeURIComponent(note)}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } });
    setBusy(false);
    if (!r.ok) return fail(r);
    flash(r.data?.backToReview ? 'Звук заменён, трек отправлен на повторную проверку' : 'Звук заменён'); setNote(''); void load();
  };
  const back = async (v: number) => {
    if (!window.confirm(`Вернуть версию ${v}?`)) return;
    setBusy(true); const r = await apiCall(`${S}/tracks/${row.id}/rollback`, { method: 'POST', body: JSON.stringify({ version: v }) }); setBusy(false);
    if (!r.ok) return fail(r); flash('Версия возвращена'); void load();
  };
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="self-start text-sm" style={{ color: C.accent, minHeight: 44 }}>← К списку треков</button>
      <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p translate="no" className="font-black" style={{ color: C.t1 }}>{row.title}</p>
        <p className="text-xs" style={{ color: C.t2 }}>{STATUS[status] ?? status}</p>
        <button type="button" onClick={onEdit} className="mt-2 inline-flex items-center gap-2 rounded-xl px-4" style={{ minHeight: 44, background: C.bg, color: C.t1, border: `1px solid ${C.border}` }}><Pencil size={16} /> Название, жанр, обложка, текст</button>
      </div>
      <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p className="font-bold" style={{ color: C.t1 }}>Заменить звук</p>
        <p className="mb-2 text-xs" style={{ color: C.t2 }}>Принимается только настоящий MP3 до 30 МБ. Прежний файл сохраняется как версия, вернуть его можно в любой момент. Опубликованный трек после замены проверяется повторно.</p>
        <input aria-label="Что изменилось" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Что изменилось (необязательно)" className="mb-2 w-full rounded-xl px-3" style={{ height: 44, background: C.bg, border: `1px solid ${C.border}`, color: C.t1 }} />
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-4" style={{ minHeight: 44, background: C.accent, color: '#fff', opacity: busy ? 0.6 : 1 }}>
          <Upload size={16} /> {busy ? 'Загрузка…' : 'Выбрать MP3'}
          <input type="file" accept="audio/mpeg,.mp3" hidden disabled={busy} onChange={(e) => { void replace(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <p className="mb-2 font-bold" style={{ color: C.t1 }}>Версии звука</p>
        {!vers ? <p style={{ color: C.t3 }}>Загрузка…</p> : vers.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Замен ещё не было — действует первая загрузка.</p> : vers.map((v) => (
          <div key={v.version} className="flex items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1 text-sm" style={{ color: C.t1 }}>Версия {v.version}{v.current ? ' · действует' : ''}<span className="block text-xs" style={{ color: C.t3 }}>{new Date(v.at).toLocaleString('ru-RU')} · {mb(v.bytes)}{v.note ? ` · ${v.note}` : ''}</span></div>
            {!v.current && <button type="button" disabled={busy} onClick={() => back(v.version)} aria-label={`Вернуть версию ${v.version}`} className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: C.bg, color: C.t1, border: `1px solid ${C.border}` }}><RotateCcw size={16} /></button>}
          </div>))}
      </div>
    </div>
  );
};

const RoyaltyBlock = ({ cardId }: { cardId: string }) => {
  const [d, setD] = useState<{ setting: boolean; effective: boolean; source: string; globalMode: string } | null>(null);
  useEffect(() => { void apiCall<NonNullable<typeof d>>(`${S}/cards/${cardId}/royalty`).then((r) => { if (r.ok) setD(r.data!); }); }, [cardId]);
  if (!d) return null;
  const toggle = async () => { const r = await apiCall<NonNullable<typeof d>>(`${S}/cards/${cardId}/royalty`, { method: 'PUT', body: JSON.stringify({ enabled: !d.setting }) }); if (!r.ok) return fail(r); setD(r.data!); };
  return (
    <div className="mb-3 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1"><p className="font-bold" style={{ color: C.t1 }}>Участие в роялти</p>
          <p className="text-xs" style={{ color: C.t2 }}>{d.source === 'global' ? `Сейчас решает общий режим Sky (${d.globalMode === 'all_on' ? 'включено у всех' : 'выключено у всех'}); ваша настройка сохранена.` : 'Вы решаете сами.'} Sky хранит только переключатель — расчёты и выплаты вне платформы.</p></div>
        <button type="button" role="switch" aria-checked={d.setting} aria-label="Участие в роялти" onClick={toggle} className="relative shrink-0 rounded-full" style={{ width: 52, height: 32, background: d.setting ? C.accent : C.border }}>
          <span className="absolute top-1 rounded-full bg-white" style={{ width: 24, height: 24, left: d.setting ? 24 : 4, transition: 'left .15s' }} /></button>
      </div>
    </div>
  );
};

/* Сериалы Sky Film: карточка, страница сериала (сезоны и серии, «Смотреть / Продолжить»),
   инструменты владельца (сезоны, загрузка серий с заставкой, субтитры, отправка на проверку).
   Данные и права — на сервере (server/filmseries.mjs); здесь только показ. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Play, Plus, Film, Upload, Trash2, Captions, Send, Lock, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { posterUrl, apiUploadMovie, readVideoMeta, fmtDuration, type ServerMovie } from '@/film/filmApi';
import {
  apiSeries, apiMySeries, apiCreateSeries, apiPatchSeries, apiDeleteSeries, apiAddSeason, apiDeleteSeason, apiPatchEpisode,
  apiDeleteEpisode, apiSubmitSeries, apiSubtitles, apiPutSubtitle, apiDeleteSubtitle, SUBTITLE_LANGS,
  type ServerSeries, type SeriesFull, type SubtitleTrack,
} from '@/film/seriesApi';
import { ACCEPT_VIDEO } from '@/shared/fileAccept';

const K = { bg: 'var(--bg)', card: 'var(--bg-l1)', card2: 'var(--bg-l2)', orange: '#FF5500', text: 'var(--t1)', sub: 'var(--t2)', dim: 'var(--t3)', border: 'var(--border)' };
const input = { background: K.card2, color: K.text, border: `1px solid ${K.border}` };

export const SeriesPoster = ({ s, w = 110 }: { s: ServerSeries; w?: number }) => (
  <div className="relative shrink-0 overflow-hidden rounded-xl" style={{ width: w, height: Math.round(w * 1.48), background: 'linear-gradient(160deg,#0b1a45,#162f6a)' }}>
    {s.posterMovieId
      ? <img src={posterUrl(s.posterMovieId)} alt={s.title} className="h-full w-full object-cover" />
      : <div className="flex h-full w-full items-center justify-center"><Film size={w * 0.28} color="rgba(255,255,255,0.2)" /></div>}
    <span className="absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>Сериал</span>
  </div>
);

export const SeriesRow = ({ series, onOpen }: { series: ServerSeries[]; onOpen: (id: string) => void }) => {
  if (!series.length) return null;
  return (
    <section className="mt-4">
      <p className="px-4 pb-2 text-[15px] font-bold" style={{ color: K.text }}>Сериалы</p>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
        {series.map((s) => (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="shrink-0 text-left" style={{ width: 110 }}>
            <SeriesPoster s={s} />
            <p className="mt-1.5 truncate text-[12px] font-semibold" style={{ color: K.text }} translate="no">{s.title}</p>
            <p className="text-[10.5px]" style={{ color: K.dim }}>{`${s.seasons} сез. · ${s.episodes} сер.`}</p>
          </button>
        ))}
      </div>
    </section>
  );
};

const STATUS: Record<string, string> = { private: 'Только вы', pending: 'На проверке', published: 'Опубликован', rejected: 'Отклонён' };

const epLabel = (e: ServerMovie) => `${e.epNo ?? ''}. ${e.title}`;

/** Страница сериала. `onPlay` открывает обычный плеер на выбранной серии. */
export const SeriesPage = ({ id, onClose, onPlay }: { id: string; onClose: () => void; onPlay: (m: ServerMovie) => void }) => {
  const [full, setFull] = useState<SeriesFull | null>(null);
  const [missing, setMissing] = useState(false);
  const [seasonId, setSeasonId] = useState<string>('');
  const load = useCallback(async () => {
    const r = await apiSeries(id);
    if (!r) { setMissing(true); return; }
    setFull(r);
    setSeasonId((cur) => cur && r.seasons.some((s) => s.id === cur) ? cur
      : (r.seasons.find((s) => s.episodes.some((e) => e.id === r.resume?.episodeId)) ?? r.seasons[0])?.id ?? '');
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (missing) return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3" style={{ background: K.bg }}>
      <p className="text-sm" style={{ color: K.sub }}>Сериал не найден или недоступен</p>
      <button type="button" onClick={onClose} className="rounded-full px-6 py-2.5 text-[13px] font-bold text-white" style={{ background: K.orange }}>Назад</button>
    </div>
  );
  if (!full) return <div className="fixed inset-0 z-[90]" style={{ background: K.bg }} />;

  const { series, seasons, resume } = full;
  const season = seasons.find((s) => s.id === seasonId) ?? seasons[0];
  const all = seasons.flatMap((s) => s.episodes);
  const resumeEp = all.find((e) => e.id === resume?.episodeId) ?? all[0];
  const own = series.own === true;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[90] flex flex-col overflow-hidden app-root-h" style={{ background: K.bg }} data-series-page>
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
        <button type="button" onClick={onClose} aria-label="Назад" className="grid h-10 w-10 place-items-center rounded-full" style={{ background: K.card2, color: K.text }}><ChevronLeft size={20} /></button>
        <p className="min-w-0 flex-1 truncate text-lg font-black" style={{ color: K.text }} translate="no">{series.title}</p>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-8" style={{ scrollbarWidth: 'none' }}>
        <div className="flex gap-4">
          <SeriesPoster s={series} w={120} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-[12px]" style={{ color: K.sub }}>{[series.genre, series.year, series.country, series.ageRating].filter(Boolean).join(' · ')}</p>
            <p className="text-[12px]" style={{ color: K.dim }}>{`${series.seasons} сез. · ${series.episodes} сер.`}{series.uploaderName ? ` · ${series.uploaderName}` : ''}</p>
            {own && <p className="text-[11px] font-bold" style={{ color: series.status === 'rejected' ? '#f87171' : K.orange }}>{STATUS[series.status]}</p>}
            {series.rejectReason && <p className="text-[11px]" style={{ color: '#f87171' }} translate="no">{series.rejectReason}</p>}
            {resumeEp && (
              <button type="button" data-series-play onClick={() => onPlay(resumeEp)}
                className="mt-1 flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-white" style={{ background: K.orange }}>
                <Play size={15} fill="white" />
                {resume?.fresh ? 'Смотреть' : resume?.finished ? 'Смотреть сначала' : resume?.next ? `Дальше: серия ${resumeEp.epNo}` : `Продолжить: серия ${resumeEp.epNo}`}
              </button>
            )}
          </div>
        </div>
        {series.description && <p className="mt-3 text-[13px] leading-relaxed" style={{ color: K.sub }} translate="no">{series.description}</p>}

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {seasons.map((s) => (
            <button key={s.id} type="button" onClick={() => setSeasonId(s.id)} className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold"
              style={{ background: s.id === season?.id ? K.orange : K.card2, color: s.id === season?.id ? '#fff' : K.sub }}>
              {s.title ? `${s.number}. ${s.title}` : `Сезон ${s.number}`}
            </button>
          ))}
          {own && <AddSeason seriesId={id} onDone={load} />}
        </div>

        <ul className="mt-3 space-y-2">
          {season?.episodes.map((e) => {
            const dur = e.progressDuration || e.duration || 0; const pos = e.position ?? 0;
            const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
            return (
              <li key={e.id} className="rounded-xl p-3" style={{ background: K.card, border: `1px solid ${K.border}` }}>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => onPlay(e)} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-episode={e.epNo}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: K.card2, color: K.orange }}><Play size={14} fill="currentColor" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold" style={{ color: K.text }} translate="no">{epLabel(e)}</span>
                      <span className="block text-[11px]" style={{ color: K.dim }}>
                        {e.duration ? fmtDuration(e.duration) : ''}{e.subtitles ? ` · субтитры: ${e.subtitles}` : ''}{own && e.status !== 'published' ? ` · ${STATUS[e.status]}` : ''}
                      </span>
                    </span>
                  </button>
                  {own && <EpisodeTools ep={e} onChanged={load} />}
                </div>
                {pct > 0 && <div className="mt-2 h-[3px] overflow-hidden rounded-full" style={{ background: K.card2 }}><div className="h-full" style={{ width: `${pct}%`, background: K.orange }} /></div>}
              </li>
            );
          })}
          {season && !season.episodes.length && <li className="py-6 text-center text-[12.5px]" style={{ color: K.dim }}>В этом сезоне пока нет серий</li>}
        </ul>

        {own && season && <UploadEpisode seriesId={id} season={season} onDone={load} />}
        {own && <OwnerFooter series={series} onChanged={load} onDeleted={onClose} />}
      </div>
    </motion.div>
  );
};

const AddSeason = ({ seriesId, onDone }: { seriesId: string; onDone: () => void }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} aria-label="Добавить сезон" onClick={async () => { setBusy(true); await apiAddSeason(seriesId); setBusy(false); onDone(); }}
      className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: K.card2, color: K.orange }}><Plus size={13} />Сезон</button>
  );
};

const EpisodeTools = ({ ep, onChanged }: { ep: ServerMovie; onChanged: () => void }) => {
  const [open, setOpen] = useState(false);
  const [subs, setSubs] = useState<SubtitleTrack[]>([]);
  const [lang, setLang] = useState('ru');
  const [intro, setIntro] = useState({ a: String(ep.introStart ?? ''), b: String(ep.introEnd ?? '') });
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) void apiSubtitles(ep.id).then(setSubs); }, [open, ep.id]);

  const addSub = async (f: File) => {
    setErr('');
    const text = await f.text();
    const r = await apiPutSubtitle(ep.id, lang, text);
    if (!r.ok) setErr(r.error); else { setSubs(await apiSubtitles(ep.id)); onChanged(); }
  };
  const saveIntro = async () => {
    const a = Number(intro.a); const b = Number(intro.b);
    const clear = intro.a === '' && intro.b === '';
    const r = await apiPatchEpisode(ep.id, clear ? { introStart: null, introEnd: null } : { introStart: a, introEnd: b });
    setErr(r.ok ? '' : r.error); if (r.ok) onChanged();
  };
  return (
    <div className="shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Настройки серии" className="grid h-9 w-9 place-items-center rounded-full" style={{ background: K.card2, color: K.sub }}><Captions size={15} /></button>
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-[95] space-y-3 rounded-2xl p-4 shadow-2xl" style={{ background: K.card, border: `1px solid ${K.border}` }}>
          <p className="text-[13px] font-bold" style={{ color: K.text }} translate="no">{epLabel(ep)}</p>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold" style={{ color: K.sub }}>Заставка (секунды): показывается кнопка «Пропустить заставку»</p>
            <div className="flex gap-2">
              <input inputMode="numeric" placeholder="с" value={intro.a} onChange={(e) => setIntro({ ...intro, a: e.target.value.replace(/\D/g, '') })} className="w-20 rounded-lg px-2 py-1.5 text-sm" style={input} aria-label="Начало заставки" />
              <input inputMode="numeric" placeholder="по" value={intro.b} onChange={(e) => setIntro({ ...intro, b: e.target.value.replace(/\D/g, '') })} className="w-20 rounded-lg px-2 py-1.5 text-sm" style={input} aria-label="Конец заставки" />
              <button type="button" onClick={() => void saveIntro()} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: K.orange }}>Сохранить</button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold" style={{ color: K.sub }}>Субтитры (.srt или .vtt)</p>
            <ul className="space-y-1">
              {subs.map((s) => (
                <li key={s.lang} className="flex items-center justify-between text-[12px]" style={{ color: K.text }}>
                  <span>{s.label}</span>
                  <button type="button" aria-label="Удалить дорожку" onClick={async () => { await apiDeleteSubtitle(ep.id, s.lang); setSubs(await apiSubtitles(ep.id)); onChanged(); }} style={{ color: '#f87171' }}><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={input} aria-label="Язык">
                {SUBTITLE_LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
              <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: K.card2, color: K.text }}><Upload size={13} />Файл</button>
              <input ref={fileRef} type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addSub(f); }} />
            </div>
          </div>
          {err && <p className="text-[12px]" style={{ color: '#f87171' }}>{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={async () => { if (window.confirm('Удалить серию вместе с файлом?')) { await apiDeleteEpisode(ep.id); setOpen(false); onChanged(); } }} className="rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>Удалить серию</button>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: K.card2, color: K.sub }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
};

export const UploadEpisode = ({ seriesId, season, onDone }: { seriesId: string; season: { id: string; number: number; episodes: ServerMovie[] }; onDone: () => void }) => {
  const [title, setTitle] = useState('');
  const [epNo, setEpNo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [intro, setIntro] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false); const [pct, setPct] = useState(0); const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);

  const go = async () => {
    if (!file || !title.trim() || busy) return;
    setBusy(true); setErr(''); setPct(0);
    const info = await readVideoMeta(file);
    const job = apiUploadMovie(file, {
      title: title.trim(), duration: info.duration, width: info.width, height: info.height, category: 'Сериалы',
      seasonId: season.id, epNo: epNo ? Number(epNo) : undefined,
      introStart: intro.a ? Number(intro.a) : 0, introEnd: intro.b ? Number(intro.b) : undefined,
    }, setPct);
    cancel.current = job.cancel;
    const res = await job.promise;
    cancel.current = null; setBusy(false);
    if (!res.ok) { setErr(res.reason ?? 'Не получилось загрузить'); return; }
    setFile(null); setTitle(''); setEpNo(''); setIntro({ a: '', b: '' }); setPct(0); onDone();
  };
  return (
    <section className="mt-5 space-y-2 rounded-2xl p-4" style={{ background: K.card, border: `1px solid ${K.border}` }} data-upload-episode>
      <p className="text-[13px] font-bold" style={{ color: K.text }}>{`Новая серия — сезон ${season.number}`}</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название серии" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={input} aria-label="Название серии" />
      <div className="flex gap-2">
        <input inputMode="numeric" value={epNo} onChange={(e) => setEpNo(e.target.value.replace(/\D/g, ''))} placeholder="№ (авто)" className="w-24 rounded-xl px-3 py-2 text-sm" style={input} aria-label="Номер серии" />
        <input inputMode="numeric" value={intro.a} onChange={(e) => setIntro({ ...intro, a: e.target.value.replace(/\D/g, '') })} placeholder="Заст. с" className="w-24 rounded-xl px-3 py-2 text-sm" style={input} aria-label="Начало заставки" />
        <input inputMode="numeric" value={intro.b} onChange={(e) => setIntro({ ...intro, b: e.target.value.replace(/\D/g, '') })} placeholder="по" className="w-20 rounded-xl px-3 py-2 text-sm" style={input} aria-label="Конец заставки" />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: K.card2, color: K.text }}><Upload size={14} />{file ? file.name.slice(0, 28) : 'Выбрать видео'}</button>
        <input ref={fileRef} type="file" accept={ACCEPT_VIDEO} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f); }} />
        <button type="button" disabled={!file || !title.trim() || busy} onClick={() => void go()} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: K.orange }}>{busy ? `${pct}%` : 'Загрузить'}</button>
        {busy && <button type="button" onClick={() => cancel.current?.()} className="text-xs" style={{ color: K.sub }}>Отмена</button>}
      </div>
      {err && <p className="text-[12px]" style={{ color: '#f87171' }}>{err}</p>}
      <p className="text-[11px]" style={{ color: K.dim }}>Серия остаётся закрытой, пока вы не отправите сериал на проверку. Большие файлы считаются в квоту хранилища.</p>
    </section>
  );
};

const OwnerFooter = ({ series, onChanged, onDeleted }: { series: ServerSeries; onChanged: () => void; onDeleted: () => void }) => {
  const [msg, setMsg] = useState('');
  const submit = async () => {
    const r = await apiSubmitSeries(series.id);
    setMsg(r.ok ? `Отправлено на проверку: серий ${r.data.sent}` : r.error); onChanged();
  };
  return (
    <section className="mt-5 space-y-2">
      <div className="flex flex-wrap gap-2">
        {series.status !== 'pending' && (
          <button type="button" onClick={() => void submit()} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: K.orange }}>
            <Send size={13} />{series.status === 'published' ? 'Отправить новые серии' : 'Отправить на проверку'}
          </button>
        )}
        {series.status === 'published' && (
          <button type="button" onClick={async () => { await apiPatchSeries(series.id, { status: 'private' }); onChanged(); }} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold" style={{ background: K.card2, color: K.text }}><Lock size={13} />Сделать закрытым</button>
        )}
        <button type="button" onClick={async () => { if (window.confirm('Удалить сериал со всеми сезонами, сериями и файлами?')) { const r = await apiDeleteSeries(series.id); if (r.ok) onDeleted(); else setMsg(r.error); } }}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}><Trash2 size={13} />Удалить сериал</button>
      </div>
      {series.status === 'pending' && <p className="flex items-center gap-1 text-[12px]" style={{ color: K.sub }}><Clock size={12} />Сериал на проверке</p>}
      {series.status === 'published' && <p className="flex items-center gap-1 text-[12px]" style={{ color: K.sub }}><CheckCircle2 size={12} />Сериал в общем каталоге</p>}
      {msg && <p className="flex items-center gap-1 text-[12px]" style={{ color: K.sub }}><AlertTriangle size={12} />{msg}</p>}
    </section>
  );
};

/** Полоса «Мои сериалы» над личной коллекцией: список своих и создание нового. */
export const MySeriesBar = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [list, setList] = useState<ServerSeries[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(''); const [err, setErr] = useState('');
  const reload = useCallback(() => { void apiMySeries().then(setList); }, []);
  useEffect(() => { reload(); }, [reload]);
  const create = async () => {
    if (!title.trim()) return;
    const r = await apiCreateSeries({ title: title.trim() });
    if (!r.ok) { setErr(r.error); return; }
    setTitle(''); setAdding(false); setErr(''); reload(); onOpen(r.data.id);
  };
  return (
    <section className="px-3 pb-2 pt-1" data-my-series>
      <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <span className="shrink-0 text-[12px] font-bold" style={{ color: K.sub }}>Мои сериалы</span>
        {(list ?? []).map((s) => (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: K.card2, color: K.text }} translate="no">{s.title}</button>
        ))}
        <button type="button" onClick={() => setAdding((a) => !a)} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] font-bold text-white" style={{ background: K.orange }}><Plus size={12} />Сериал</button>
      </div>
      {adding && (
        <div className="mt-2 flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название сериала" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={input} aria-label="Название сериала" />
          <button type="button" onClick={() => void create()} disabled={!title.trim()} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: K.orange }}>Создать</button>
        </div>
      )}
      {err && <p className="mt-1 text-[12px]" style={{ color: '#f87171' }}>{err}</p>}
    </section>
  );
};


/** Загрузка серии прямо из формы загрузки: выбрать (или создать) сериал и сезон, затем загрузить серию. Серия остаётся закрытой до отправки сериала на проверку. */
export const SeriesUploadInline = ({ onUploaded }: { onUploaded?: () => void }) => {
  const [list, setList] = useState<ServerSeries[] | null>(null);
  const [sid, setSid] = useState('');
  const [full, setFull] = useState<SeriesFull | null>(null);
  const [seasonId, setSeasonId] = useState('');
  const [newTitle, setNewTitle] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const loadList = useCallback(async () => { const l = await apiMySeries(); setList(l); return l; }, []);
  const loadFull = useCallback(async (id: string) => { const f = await apiSeries(id); setFull(f); setSeasonId((cur) => (f?.seasons.some((x) => x.id === cur) ? cur : (f?.seasons[f.seasons.length - 1]?.id ?? ''))); }, []);
  useEffect(() => { void loadList().then((l) => { if (l?.length && !sid) setSid(l[0].id); }); }, [loadList]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sid) void loadFull(sid); else { setFull(null); setSeasonId(''); } }, [sid, loadFull]);

  const create = async () => {
    if (!newTitle.trim() || busy) return;
    setBusy(true); setErr('');
    const r = await apiCreateSeries({ title: newTitle.trim() });
    if (!r.ok) { setBusy(false); setErr(r.error); return; }
    await apiAddSeason(r.data.id);
    setNewTitle(''); await loadList(); setSid(r.data.id); setBusy(false);
  };
  const addSeason = async () => { if (!sid || busy) return; setBusy(true); const r = await apiAddSeason(sid); setBusy(false); if (!r.ok) { setErr(r.error); return; } await loadFull(sid); if (r.data?.id) setSeasonId(r.data.id); };
  const season = full?.seasons.find((x) => x.id === seasonId) ?? null;
  const input = { background: K.card2, color: K.text, border: `1px solid ${K.border}` };
  return (
    <div className="space-y-3 rounded-2xl p-4" style={{ background: K.card, border: `1px solid ${K.border}` }} data-series-upload>
      <p className="text-sm font-bold" style={{ color: K.text }}>Загрузить серию сериала</p>
      <p className="text-[11px]" style={{ color: K.dim }}>Сериал собирается по сериям: выберите сериал и сезон, загрузите серию — и так каждую. Серии остаются закрытыми, пока вы не отправите весь сериал на проверку (карточка сериала).</p>
      {(list?.length ?? 0) > 0 && (
        <div className="flex gap-2">
          <select value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Сериал" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm" style={input}>
            {(list ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} aria-label="Сезон" className="rounded-xl px-3 py-2.5 text-sm" style={input}>
            {(full?.seasons ?? []).map((x) => <option key={x.id} value={x.id}>{`Сезон ${x.number}`}</option>)}
          </select>
          <button type="button" disabled={busy || !sid} onClick={() => void addSeason()} aria-label="Добавить сезон" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: K.card2, color: K.orange }}><Plus size={15} /></button>
        </div>
      )}
      <div className="flex gap-2">
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Новый сериал — название" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={input} />
        <button type="button" disabled={busy || !newTitle.trim()} onClick={() => void create()} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: K.orange }}>Создать</button>
      </div>
      {err && <p className="text-[12px]" style={{ color: '#f87171' }}>{err}</p>}
      {season && sid && <UploadEpisode key={season.id} seriesId={sid} season={season} onDone={() => { void loadFull(sid); onUploaded?.(); }} />}
    </div>
  );
};

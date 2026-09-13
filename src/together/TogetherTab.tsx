/**
 * Вкладка «Вместе».
 *
 * Экран остался прежним: список сессий карточками, кнопка создания,
 * внутри — плеер и боковая колонка. Поменялось то, что под ним.
 *
 * Было: «комнаты» в памяти браузера, синхронизация через
 * BroadcastChannel — канал между вкладками одного браузера, — и
 * воспроизведение таймером, прибавлявшим секунду к числу. Два человека
 * не видели друг друга никогда, а полоса прогресса была нарисована под
 * пять минут для любого фильма.
 *
 * Стало: сессия живёт на сервере, приглашения именные, событиями
 * обменивается тот же сокет, что и переписка, а играет тот же плеер,
 * что и при одиночном просмотре.
 *
 * Чего в этом файле нет намеренно:
 *   · списка чужих сессий — сервер отдаёт только те, где человек
 *     участвует, и другой ветки у него нет;
 *   · проверок «можно ли» — их делает сервер, здесь только показ
 *     того, что он ответил;
 *   · плеера — оба берутся из своих модулей.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Film, Music2, Plus, Search, X, Check, LogOut, Crown,
  Clock, ChevronLeft, UserPlus, Trash2, Settings2,
} from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { Player as FilmPlayer } from '@/extras/SkyFilm';
import { apiTracks } from '@/music/musicApi';
import { apiMovie, type ServerMovie } from '@/film/filmApi';
import { useTogetherStore } from './togetherState';
import { ListenTogether } from './ListenTogether';
import {
  apiTogetherCreate, apiTogetherInvite, apiTogetherJoin, apiTogetherLeave,
  apiTogetherEnd, apiTogetherAnswer, apiTogetherRemove, apiTogetherSettings,
  apiTogetherLimits, apiFindPeople, explainTogether,
  type TogetherSession, type ContentKind, type SessionType, type Limits,
} from './togetherApi';

interface Person { id: string; name: string; username: string }

const SKIP_REASONS: Record<string, string> = {
  already_in: 'уже в сессии',
  no_such_user: 'такого человека нет',
  content_forbidden: 'нет доступа к этому содержимому',
  session_full: 'больше нет мест',
};

/* ─── Выбор участников ──────────────────────────────────────────────
   Поиск идёт через общий справочник Sky ID — тот же, которым ищут
   собеседника в переписке. Своего списка людей у «Вместе» нет и быть
   не должно.                                                        */

const PeoplePicker = ({ chosen, onChange, max }: {
  chosen: Person[];
  onChange: (p: Person[]) => void;
  max: number;
}) => {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setFound([]); return; }
    setBusy(true);
    const t = window.setTimeout(() => {
      void apiFindPeople(needle).then(r => {
        setFound(r.ok && r.data ? r.data.people : []);
        setBusy(false);
      });
    }, 250);
    return () => { clearTimeout(t); setBusy(false); };
  }, [q]);

  const add = (p: Person) => {
    /* Двух одинаковых в списке не бывает. То же самое проверяет и
       сервер — пара «сессия и человек» у него первичный ключ. */
    if (chosen.some(c => c.id === p.id)) return;
    if (chosen.length >= max) return;
    onChange([...chosen, p]);
    setQ(''); setFound([]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-2xl px-3 py-2"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--t3)' }} />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Имя или ник" data-tg-people
          className="flex-1 bg-transparent text-sm text-white outline-none" />
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map(p => (
            <span key={p.id} data-tg-chosen={p.id}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {p.name}
              <button type="button" onClick={() => onChange(chosen.filter(c => c.id !== p.id))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {busy && <p className="text-xs" style={{ color: 'var(--t3)' }}>Ищу…</p>}
      {found.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {found.map(p => (
            <button key={p.id} type="button" onClick={() => add(p)} data-tg-found={p.id}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5">
              <span className="text-sm text-white">{p.name}</span>
              <span className="text-xs" style={{ color: 'var(--t3)' }}>@{p.username}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
        Выбрано {chosen.length} из {max}. Войти смогут только они.
      </p>
    </div>
  );
};

/* ─── Создание сессии ───────────────────────────────────────────── */

const CreateForm = ({ limits, onDone, onCancel }: {
  limits: Limits | null;
  onDone: (s: TogetherSession) => void;
  onCancel: () => void;
}) => {
  const movies = useFilmStore(s => s.catalog);
  /* Личная полка: то, что человек загрузил для себя. В каталоге этого
     нет и не будет — но показать своё тем, кого позвал, он вправе. */
  const mine = useFilmStore(s => s.mine);
  const loadFilm = useFilmStore(s => s.load);
  const [tracks, setTracks] = useState<{ id: string; title: string; artist: string }[]>([]);

  const [type, setType] = useState<SessionType>('watch');
  const [contentId, setContentId] = useState('');
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [control, setControl] = useState<'owner' | 'all'>('owner');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadFilm(); }, [loadFilm]);
  useEffect(() => {
    if (type !== 'listen' || tracks.length) return;
    void apiTracks({ limit: 100 }).then(list => setTracks(
      (list ?? []).map(t => ({ id: t.id, title: t.title, artist: t.artist }))));
  }, [type, tracks.length]);

  /* Потолок участников приходит с сервера. Здесь он только показан:
     присланное сверх него сервер всё равно отклонит. */
  const maxOthers = Math.max(1, (limits?.maxParticipantsDefault ?? 10) - 1);

  /* Делиться можно только личным (status private) и только тем, что
     догрузилось. Отправленное на проверку и отклонённое в список не
     попадает — сервер такие всё равно не примет. */
  const personal = useMemo(
    () => mine.filter(m => m.status === 'private' && m.bytes > 0),
    [mine]);
  const isPersonal = personal.some(m => m.id === contentId);

  const create = async () => {
    if (!contentId) { setError('Выберите, что смотреть или слушать.'); return; }
    setBusy(true); setError(null);
    const kind: ContentKind = type === 'watch' ? 'movie' : 'track';
    const r = await apiTogetherCreate({ type, contentKind: kind, contentId, title, control });
    if (!r.ok || !r.data) { setBusy(false); setError(explainTogether(r.error)); return; }

    const session = r.data.session;
    if (people.length) {
      const inv = await apiTogetherInvite(session.id, people.map(p => p.id));
      const skipped = inv.ok ? (inv.data?.skipped ?? []) : [];
      if (skipped.length) {
        setError(`Позвать не вышло: ${skipped
          .map(s => `${people.find(p => p.id === s.id)?.name ?? s.id} — ${SKIP_REASONS[s.reason] ?? s.reason}`)
          .join('; ')}`);
      }
    }
    setBusy(false);
    onDone(session);
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <p className="font-semibold text-white">Новая сессия</p>

      <div className="flex gap-2">
        {([['watch', 'Смотреть кино'], ['listen', 'Слушать музыку']] as const).map(([k, l]) => (
          <button key={k} type="button" data-tg-type={k}
            onClick={() => { setType(k); setContentId(''); }}
            className="flex-1 rounded-2xl py-2 text-sm transition-all"
            style={{
              background: type === k ? 'var(--accent-bg)' : 'var(--bg-l2)',
              border: `1px solid ${type === k ? 'var(--accent-bg)' : 'var(--border)'}`,
              color: type === k ? 'var(--accent)' : 'var(--t3)',
            }}>
            {l}
          </button>
        ))}
      </div>

      <select value={contentId} onChange={e => setContentId(e.target.value)} data-tg-content
        className="w-full rounded-2xl px-4 py-2.5 text-sm outline-none"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <option value="">— Выбрать {type === 'watch' ? 'фильм' : 'трек'} —</option>
        {type === 'watch' ? (
          <>
            {personal.length > 0 && (
              <optgroup label="Моя коллекция">
                {personal.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </optgroup>
            )}
            {movies.length > 0 && (
              <optgroup label="Из каталога">
                {movies.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </optgroup>
            )}
          </>
        ) : tracks.map(t => <option key={t.id} value={t.id}>{t.artist} — {t.title}</option>)}
      </select>

      {isPersonal && (
        <p className="rounded-xl px-3 py-2 text-[11px]" data-tg-personal-note
          style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          Это запись из вашей коллекции. Её увидят только те, кого вы позовёте,
          и только пока идёт сеанс. В каталоге она не появится.
        </p>
      )}

      <input value={title} onChange={e => setTitle(e.target.value)} data-tg-title
        placeholder="Название сессии (необязательно)"
        className="w-full rounded-2xl px-4 py-2.5 text-sm text-white outline-none"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }} />

      <div>
        <p className="mb-1.5 text-xs font-medium" style={{ color: 'var(--t2)' }}>Кого позвать</p>
        <PeoplePicker chosen={people} onChange={setPeople} max={maxOthers} />
      </div>

      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}>
        <input type="checkbox" checked={control === 'all'} data-tg-control
          onChange={e => setControl(e.target.checked ? 'all' : 'owner')} />
        Разрешить управлять воспроизведением всем участникам
      </label>

      {error && <p className="text-xs" style={{ color: 'var(--red)' }} data-tg-error>{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-2xl py-2.5 text-sm" style={{ background: 'var(--border)', color: 'var(--t2)' }}>
          Отмена
        </button>
        <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={create} disabled={busy}
          data-tg-create
          className="flex-1 rounded-2xl py-2.5 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}>
          {busy ? 'Создаю…' : 'Создать'}
        </motion.button>
      </div>
    </div>
  );
};

/* ─── Боковая колонка сессии: кто внутри ────────────────────────── */

const SidePanel = ({ session, onChanged }: { session: TogetherSession; onChanged: () => void }) => {
  const participants = useTogetherStore(s => s.participants);
  const refreshParticipants = useTogetherStore(s => s.refreshParticipants);
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const invite = async () => {
    if (!people.length) return;
    const r = await apiTogetherInvite(session.id, people.map(p => p.id));
    if (!r.ok) { setNote(explainTogether(r.error)); return; }
    const skipped = r.data?.skipped ?? [];
    setNote(skipped.length
      ? `Не позвали: ${skipped.map(s => SKIP_REASONS[s.reason] ?? s.reason).join('; ')}`
      : 'Приглашения отправлены.');
    setPeople([]); setAdding(false);
    void refreshParticipants(session.id);
  };

  const drop = async (userId: string) => {
    const r = await apiTogetherRemove(session.id, userId);
    if (!r.ok) { setNote(explainTogether(r.error)); return; }
    void refreshParticipants(session.id);
  };

  const toggleControl = async () => {
    const r = await apiTogetherSettings(session.id,
      { control: session.control === 'all' ? 'owner' : 'all' });
    if (!r.ok) { setNote(explainTogether(r.error)); return; }
    onChanged();
  };

  const label: Record<string, string> = {
    joined: 'внутри', invited: 'позван', declined: 'отказался',
    left: 'вышел', removed: 'убран',
  };

  return (
    <div className="flex w-full max-h-[40vh] shrink-0 flex-col border-t sm:w-64 sm:max-h-none sm:border-l sm:border-t-0"
      style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm font-medium text-white flex items-center gap-1.5">
          <Users size={13} /> Участники
        </p>
        {session.isOwner && session.status !== 'ended' && (
          <button type="button" onClick={() => setAdding(v => !v)} data-tg-add
            style={{ color: 'var(--accent)' }}><UserPlus size={15} /></button>
        )}
      </div>

      {adding && (
        <div className="border-b p-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <PeoplePicker chosen={people} onChange={setPeople}
            max={Math.max(1, session.maxParticipants - participants.length)} />
          <button type="button" onClick={invite} data-tg-send-invite
            className="w-full rounded-2xl py-2 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}>Позвать</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {participants.map(p => (
          <div key={p.id} className="flex items-center gap-2" data-tg-part={p.id}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>
                {p.name}
                {p.role === 'owner' && <Crown size={10} className="inline ml-1" style={{ color: 'var(--accent)' }} />}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{label[p.status] ?? p.status}</p>
            </div>
            {session.isOwner && p.role !== 'owner' && ['joined', 'invited'].includes(p.status) && (
              <button type="button" onClick={() => drop(p.id)} data-tg-drop={p.id}
                style={{ color: 'var(--t3)' }}><Trash2 size={12} /></button>
            )}
          </div>
        ))}
      </div>

      {session.isOwner && session.status !== 'ended' && (
        <button type="button" onClick={toggleControl} data-tg-toggle-control
          className="flex items-center gap-2 border-t px-3 py-2.5 text-left text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--t2)' }}>
          <Settings2 size={13} />
          {session.control === 'all' ? 'Управляют все' : 'Управляет только владелец'}
        </button>
      )}

      {note && <p className="px-3 pb-2 text-[11px]" style={{ color: 'var(--t3)' }} data-tg-note>{note}</p>}
    </div>
  );
};

/* ─── Экран открытой сессии ─────────────────────────────────────── */

const SessionScreen = ({ session, onClose }: { session: TogetherSession; onClose: () => void }) => {
  const movies = useFilmStore(s => s.catalog);
  /* Каталог кино грузим здесь, а не только в форме создания. Позванный
     попадает сюда прямо из приглашения, формы не открывает — и без
     этого экран честно, но бессмысленно сообщал бы, что фильма нет. */
  const loadFilm = useFilmStore(s => s.load);
  const refreshSession = useTogetherStore(s => s.refreshSession);
  const refreshParticipants = useTogetherStore(s => s.refreshParticipants);
  const participants = useTogetherStore(s => s.participants);
  const error = useTogetherStore(s => s.error);
  const setError = useTogetherStore(s => s.setError);

  useEffect(() => { void refreshParticipants(session.id); }, [session.id, refreshParticipants]);
  useEffect(() => { if (session.type === 'watch') void loadFilm(); }, [session.type, loadFilm]);

  /*
   * Запись о фильме спрашиваем у сервера по идентификатору, а не ищем
   * в списках. Личной загрузки владельца нет ни в каталоге, ни в
   * коллекции позванного — а показать её ему нужно. Сервер сам решит,
   * положено ли: у него для этого есть всё, а у списков — нет.
   */
  const [movie, setMovie] = useState<ServerMovie | null>(null);
  const wantedId = session.type === 'watch' ? (session.queue[0]?.id ?? null) : null;
  useEffect(() => {
    if (!wantedId) { setMovie(null); return; }
    const known = movies.find(m => m.id === wantedId);
    if (known) { setMovie(known); return; }
    let alive = true;
    void apiMovie(wantedId).then(m => { if (alive) setMovie(m ?? null); });
    return () => { alive = false; };
  }, [wantedId, movies]);

  const inside = participants.filter(p => p.status === 'joined').length;

  const leave = async () => {
    await apiTogetherLeave(session.id);
    onClose();
  };
  const end = async () => {
    const r = await apiTogetherEnd(session.id);
    if (!r.ok) { setError(explainTogether(r.error)); return; }
    void refreshSession(session.id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden sm:flex-row">
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={onClose} style={{ color: 'var(--t3)' }} data-tg-back>
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-white">{session.title}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
              {session.type === 'watch' ? 'Смотрим вместе' : 'Слушаем вместе'}
              {session.status === 'ended' && ' · завершена'}
            </p>
          </div>
          <span className="rounded-full px-2 py-1 text-xs" data-tg-count
            style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
            {inside}
          </span>
          {session.isOwner && session.status !== 'ended' && (
            <button type="button" onClick={end} data-tg-end
              className="rounded-xl px-3 py-1.5 text-xs"
              style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
              Завершить
            </button>
          )}
          <button type="button" onClick={leave} data-tg-leave
            className="rounded-xl px-3 py-1.5 text-xs"
            style={{ background: 'var(--border)', color: 'var(--t2)' }}>
            <LogOut size={12} className="inline mr-1" />Выйти
          </button>
        </div>

        {error && (
          <p className="px-4 py-2 text-xs" style={{ color: 'var(--red)' }} data-tg-session-error>{error}</p>
        )}

        {session.status === 'ended' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Clock size={36} style={{ color: 'var(--t3)', opacity: 0.5 }} />
            <p className="text-sm text-white">Сессия завершена</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>
              Она осталась в истории — ничего не удалено.
            </p>
          </div>
        ) : session.type === 'watch' ? (
          movie
            ? <FilmPlayer movie={movie} onClose={onClose}
                together={{
                  sessionId: session.id,
                  canControl: session.canControl,
                  watchers: inside,
                  onLeave: leave,
                  onEnd: session.isOwner ? end : undefined,
                }} />
            : <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="text-sm" style={{ color: 'var(--t3)' }}>
                  Фильм не открывается. Возможно, владелец убрал его или
                  завершил показ.
                </p>
              </div>
        ) : (
          <ListenTogether session={session} />
        )}
      </div>

      <SidePanel session={session} onChanged={() => void refreshSession(session.id)} />
    </div>
  );
};

/* ─── Вкладка ───────────────────────────────────────────────────── */

export const TogetherTab = () => {
  const sessions = useTogetherStore(s => s.sessions);
  const invitations = useTogetherStore(s => s.invitations);
  const openSession = useTogetherStore(s => s.session);
  const loading = useTogetherStore(s => s.loading);
  const refreshList = useTogetherStore(s => s.refreshList);
  const refreshInvitations = useTogetherStore(s => s.refreshInvitations);
  const setSession = useTogetherStore(s => s.setSession);
  const close = useTogetherStore(s => s.close);

  const [creating, setCreating] = useState(false);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void refreshList();
    void refreshInvitations();
    void apiTogetherLimits().then(r => { if (r.ok && r.data) setLimits(r.data); });
  }, [refreshList, refreshInvitations]);

  /* Уходя со вкладки, закрываем сессию у себя: иначе плеер продолжит
     подтягиваться под чужие команды из невидимого экрана. */
  useEffect(() => () => { close(); }, [close]);

  /**
   * Войти в сессию.
   *
   * Через эту же дверь идёт и создатель сразу после создания. Создать —
   * не то же самое, что войти: пока владелец не вошёл, сессия числится
   * запланированной, и сервер не примет по ней ни одной команды. Раньше
   * создатель попадал прямо в плеер, жал «играть» и не понимал, почему
   * ничего не происходит.
   */
  const enter = async (id: string) => {
    setNote(null);
    const r = await apiTogetherJoin(id);
    if (!r.ok || !r.data) { setNote(explainTogether(r.error)); return; }
    setSession(r.data.session);
  };

  const answer = async (invitationId: string, accept: boolean) => {
    setNote(null);
    const r = await apiTogetherAnswer(invitationId, accept);
    if (!r.ok || !r.data) { setNote(explainTogether(r.error)); return; }
    await refreshInvitations();
    await refreshList();
    if (r.data.accepted) await enter(r.data.sessionId);
  };

  if (openSession) {
    return <SessionScreen session={openSession} onClose={() => { close(); void refreshList(); }} />;
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Приглашения. Видно, кто позвал и на что именно, — иначе
          согласиться означало бы согласиться неизвестно на что. */}
      {invitations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--t2)' }}>Вас зовут</p>
          {invitations.map(inv => (
            <div key={inv.id} data-tg-invite={inv.id}
              className="rounded-xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--accent-bg)' }}>
              <p className="text-sm text-white">
                {inv.invitedBy.name} зовёт {inv.type === 'watch' ? 'смотреть' : 'слушать'}
              </p>
              <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--t3)' }}>
                {inv.type === 'watch' ? <Film size={11} /> : <Music2 size={11} />}
                {inv.title}
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => answer(inv.id, true)} data-tg-accept={inv.id}
                  className="flex-1 rounded-2xl py-2 text-xs font-medium text-white"
                  style={{ background: 'var(--accent)' }}>
                  <Check size={12} className="inline mr-1" />Принять
                </button>
                <button type="button" onClick={() => answer(inv.id, false)} data-tg-decline={inv.id}
                  className="flex-1 rounded-2xl py-2 text-xs"
                  style={{ background: 'var(--border)', color: 'var(--t2)' }}>
                  Отказаться
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <CreateForm limits={limits} onCancel={() => setCreating(false)}
          onDone={(s) => { setCreating(false); void enter(s.id); void refreshList(); }} />
      ) : (
        <button type="button" onClick={() => setCreating(true)} data-tg-new
          className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}>
          <Plus size={15} /> Создать сессию
        </button>
      )}

      {note && <p className="text-xs" style={{ color: 'var(--red)' }} data-tg-note>{note}</p>}

      {loading && <p className="text-sm text-center py-8" style={{ color: 'var(--t3)' }}>Загружаю…</p>}

      {!loading && sessions.length === 0 && !creating && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--t3)' }}>
          Пока ничего нет. Создайте сессию и позовите тех, с кем хотите смотреть или слушать.
        </p>
      )}

      {sessions.map(s => (
        <div key={s.id} data-tg-card={s.id}
          className="rounded-xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{s.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--t3)' }}>
                {s.type === 'watch' ? <Film size={11} /> : <Music2 size={11} />}
                {s.type === 'watch' ? 'Кино' : 'Музыка'}
                {s.isOwner && <> · <Crown size={10} style={{ color: 'var(--accent)' }} /> ваша</>}
                {' · '}{s.liveCount ?? 0} внутри
              </p>
            </div>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
              style={s.status === 'ended'
                ? { background: 'var(--border)', color: 'var(--t3)' }
                : { background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
              {s.status === 'ended' ? 'завершена' : s.status === 'live' ? 'идёт' : 'ждёт'}
            </span>
          </div>
          <button type="button" onClick={() => enter(s.id)} data-tg-enter={s.id}
            className="mt-2 w-full rounded-2xl py-2.5 text-sm font-medium text-white"
            style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-bg)' }}>
            {s.status === 'ended' ? 'Открыть' : 'Войти →'}
          </button>
        </div>
      ))}

      <p className="pt-2 text-center text-[11px]" style={{ color: 'var(--t3)' }}>
        Сессии закрытые: войти может только тот, кого позвали.
      </p>
    </div>
  );
};

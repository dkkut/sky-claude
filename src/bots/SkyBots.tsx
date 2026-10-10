/**
 * «Все боты», разговор с ботом и вызов бота через # в чате.
 *
 * Экраны остались прежними. Изменилось то, что за ними стоит.
 *
 * Было: пять ботов записаны прямо в этом файле, а «ответ бота» — это
 * функция respond(), выполнявшаяся здесь же, в браузере. Один из них
 * ходил в api.anthropic.com прямо из браузера и без ключа, то есть не
 * работал никогда; другой считал выражения через Function() — то есть
 * выполнял введённое пользователем. Ни один не был настоящим ботом:
 * написать такого мог только тот, кто правит этот файл.
 *
 * Стало: каталог приходит с сервера, а ответы пишет программа на
 * СЕРВЕРЕ ВЛАДЕЛЬЦА бота. Разговор с ботом — обычный личный чат, так
 * что история переживает перезагрузку, видна со второго устройства и
 * шифруется наравне с остальной перепиской.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Send, ChevronRight, Bot as BotGlyph, Search, BadgeCheck,
  Loader, Users, Hash, AlertTriangle,
} from 'lucide-react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { BotIcon } from './botIcons';
import {
  apiBotCatalog, apiBotDialog, apiSendToBot, apiInlineBots,
  apiInlineQuery, apiInlineConfirm, explainBot,
  type Bot, type BotMessage, type InlineBotHint, type InlineResult,
} from './botApi';

/* ─── Недавно вызванные ─────────────────────────────────────────────
   Единственное, что осталось в браузере, и осталось намеренно: это
   удобство одного устройства, а не данные. Пропадёт — ничего не
   сломается. */
const RECENT_KEY = 'sky:bots:recent:v2';
const getRecent = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '{}'); } catch { return {}; }
};
const bumpRecent = (id: string) => {
  try {
    const r = getRecent();
    r[id] = Date.now();
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch { /* приватное окно */ }
};

const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';

/** Живой ли сервер владельца. Показываем честно: иначе человек пишет в пустоту. */
const OnlineMark = ({ online }: { online: boolean }) => (
  <span className="inline-flex items-center gap-1 text-[10px] font-semibold shrink-0"
    style={{ color: online ? 'var(--green)' : 'var(--t3)' }}>
    <span className="h-1.5 w-1.5 rounded-full"
      style={{ background: online ? 'var(--green)' : 'var(--t3)' }}/>
    {online ? 'онлайн' : 'офлайн'}
  </span>
);

/* ─── Подсказка по # ───────────────────────────────────────────────
   Список inline-ботов приходит с сервера: показываются только
   опубликованные. Черновик чужого бота сюда не попадает. */

export const HashInlineMenu = ({ query, onSelect, onClose }:
{ query: string; onSelect: (bot: InlineBotHint | { __browse__: true }) => void; onClose: () => void }) => {
  const [bots, setBots] = useState<InlineBotHint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiInlineBots(query).then((r) => {
      if (!alive) return;
      const list = r.ok && r.data ? r.data.bots : [];
      /* Недавние вперёд: тем, кем пользуются, искать себя не должно. */
      const recent = getRecent();
      setBots([...list].sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0)));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [query]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.12 }}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl overflow-hidden z-50"
      style={{ background: 'var(--bg-l2)', border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 -12px 40px rgba(0,0,0,0.6)', maxHeight: 320 }}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2">
          <div className="grid h-5 w-5 place-items-center rounded-md" style={{ background: '#4e8cf7' }}>
            <Hash size={12} className="text-white"/>
          </div>
          <p className="text-xs font-bold text-white">
            {query ? `Боты: «${query}»` : 'Inline-боты'}
          </p>
        </div>
        <button type="button" onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-white/10">
          <X size={12} style={{ color: 'rgba(255,255,255,0.4)' }}/>
        </button>
      </div>

      <div className="overflow-y-auto" style={{ scrollbarWidth: 'none', maxHeight: 240 }}>
        {loading && <p className="text-center text-sm py-6" style={{ color: 'rgba(255,255,255,0.3)' }}>Ищем…</p>}
        {!loading && bots.length === 0 && (
          <p className="text-center text-sm py-6" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Inline-ботов не найдено
          </p>
        )}
        {bots.map((bot) => (
          <button key={bot.id} type="button" onClick={() => onSelect(bot)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0"
              style={{ background: `${bot.accent}20`, border: `1px solid ${bot.accent}35` }}>
              <BotIcon kind={bot.icon} size={18} color={bot.accent}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white truncate">{bot.name}</p>
                {bot.verified && <BadgeCheck size={12} style={{ color: '#4e8cf7' }}/>}
                <span className="ml-auto shrink-0"><OnlineMark online={bot.online}/></span>
              </div>
              <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                #{bot.trigger}{bot.placeholder ? ` — ${bot.placeholder}` : ''}
              </p>
            </div>
          </button>
        ))}
        <button type="button" onClick={() => onSelect({ __browse__: true })}
          className="flex w-full items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: '#4e8cf7', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          Все боты <ChevronRight size={12}/>
        </button>
      </div>
    </motion.div>
  );
};

/* ─── Подтверждение inline ─────────────────────────────────────────
   Главное здесь — что бот НЕ отправляет сообщение сам. Он предложил
   варианты; человек выбирает и нажимает «Отправить», и только тогда
   сообщение уходит — от его имени, из его сеанса. */

export const InlineConfirm = ({ chatId, trigger, query, fromName, onDone, onClose }: {
  chatId: string;
  trigger: string;
  query: string;
  fromName: string;
  onDone: () => void;
  onClose: () => void;
}) => {
  const isMobile = useIsMobile();
  const [state, setState] = useState<'asking' | 'ready' | 'sending' | 'failed'>('asking');
  const [bot, setBot] = useState<InlineBotHint | null>(null);
  const [results, setResults] = useState<InlineResult[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    apiInlineQuery(chatId, trigger, query, fromName).then((r) => {
      if (!alive) return;
      if (!r.ok || !r.data) { setErr(explainBot(r.error, r.reason)); setState('failed'); return; }
      setBot(r.data.bot);
      setResults(r.data.results);
      setPicked(r.data.results[0]?.id ?? null);
      setState('ready');
    });
    return () => { alive = false; };
  }, [chatId, trigger, query, fromName]);

  const confirm = async () => {
    if (!picked) return;
    setState('sending');
    const r = await apiInlineConfirm(chatId, picked);
    if (!r.ok) { setErr(explainBot(r.error, r.reason)); setState('failed'); return; }
    if (bot) bumpRecent(bot.id);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-end justify-center" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.5)' }}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full overflow-hidden"
        style={{
          maxWidth: isMobile ? '100%' : 420,
          background: 'var(--bg-l1)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid var(--border)',
          marginBottom: isMobile ? 0 : 24,
          borderRadius: isMobile ? '20px 20px 0 0' : 20,
          paddingBottom: isMobile ? 'var(--safe-bottom)' : 0,
        }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0"
            style={{ background: `${bot?.accent ?? 'var(--accent)'}20` }}>
            <BotIcon kind={bot?.icon} size={18} color={bot?.accent ?? 'var(--accent)'}/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>
              {bot?.name ?? `#${trigger}`}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
              Отправится от вашего имени
            </p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
            <X size={15} style={{ color: 'var(--t3)' }}/>
          </button>
        </div>

        <div className="px-4 py-3 max-h-[50vh] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {state === 'asking' && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader size={15} className="animate-spin" style={{ color: 'var(--accent)' }}/>
              <p className="text-sm" style={{ color: 'var(--t3)' }}>Спрашиваем бота…</p>
            </div>
          )}

          {state === 'failed' && (
            <div className="flex items-start gap-2.5 py-4">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--red)' }}/>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--red)' }}>{err}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
                  Бот отвечает со своего сервера. Если тот выключен, ответа не будет.
                </p>
              </div>
            </div>
          )}

          {(state === 'ready' || state === 'sending') && results.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--t3)' }}>
              Бот не предложил вариантов
            </p>
          )}

          {(state === 'ready' || state === 'sending') && results.map((r) => (
            <button key={r.id} type="button" onClick={() => setPicked(r.id)}
              className="w-full text-left rounded-2xl px-3.5 py-3 mb-2 transition-all"
              style={{
                background: picked === r.id ? 'var(--accent-bg)' : 'var(--bg-l2)',
                border: `1.5px solid ${picked === r.id ? 'rgba(79,110,247,0.4)' : 'var(--border)'}`,
              }}>
              {r.title && (
                <p className="text-[11px] font-bold mb-1" style={{ color: 'var(--accent)' }}>{r.title}</p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--t1)' }}>{r.text}</p>
            </button>
          ))}
        </div>

        {state !== 'failed' && results.length > 0 && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void confirm()}
              disabled={!picked || state === 'sending'}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              {state === 'sending'
                ? <><Loader size={14} className="animate-spin"/> Отправляем…</>
                : <><Send size={14}/> Отправить от своего имени</>}
            </motion.button>
            <p className="text-[10px] text-center mt-2" style={{ color: 'var(--t3)' }}>
              Бот предложил текст. Отправляете вы — ничего не уйдёт без этого нажатия.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
};

/* ─── Разговор с ботом ─────────────────────────────────────────────
   Это настоящий личный чат с профилем бота, а не отдельная переписка
   внутри компонента. Поэтому история остаётся после закрытия, видна со
   второго устройства и лежит в базе зашифрованной. */

export const BotChatOverlay = ({ bot, onClose }: { bot: Bot; onClose: () => void }) => {
  const isMobile = useIsMobile();
  const [msgs, setMsgs] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [showCmds, setShowCmds] = useState(false);
  const [err, setErr] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef<string>('');

  const refresh = useCallback(async () => {
    const r = await apiBotDialog(bot.id, 60);
    if (!r.ok || !r.data) { setErr(explainBot(r.error, r.reason)); return; }
    setMsgs(r.data.messages);
    const last = r.data.messages[r.data.messages.length - 1];
    if (last && last.id !== lastId.current) {
      lastId.current = last.id;
      /* Ответ пришёл — перестаём показывать «печатает». */
      if (last.authorId !== undefined && !last.fromMe) setWaiting(false);
    }
  }, [bot.id]);

  useEffect(() => { bumpRecent(bot.id); void refresh(); }, [bot.id, refresh]);

  /*
   * Опрос, пока окно открыто.
   *
   * Ответ бота приходит от его сервера отдельным запросом и
   * расходится по сокету, но это окно к сокету не подключено —
   * заводить ради него второе подключение дороже, чем спросить раз в
   * две секунды. Закрыли окно — опрос прекращается.
   */
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => { listRef.current?.scrollTo(0, 99999); }, [msgs, waiting]);

  const send = async (text?: string) => {
    const body = (text ?? input).trim();
    if (!body || sending) return;
    setInput(''); setSending(true); setErr('');
    const r = await apiSendToBot(bot.id, body);
    setSending(false);
    if (!r.ok) { setErr(explainBot(r.error, r.reason)); return; }
    await refresh();
    /* Ждём ответа, только если серверу бота есть куда его положить. */
    if (r.data?.queued) setWaiting(true);
    setTimeout(() => setWaiting(false), 30_000);
  };

  return (
    <div className={`fixed inset-0 z-[200] flex pointer-events-none ${isMobile ? 'items-stretch justify-stretch' : 'items-end justify-end'}`}>
      <motion.div initial={{ opacity: 0, x: isMobile ? 0 : 20, y: isMobile ? 20 : 0, scale: isMobile ? 1 : 0.95 }}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }} exit={{ opacity: 0, x: isMobile ? 0 : 20, y: isMobile ? 20 : 0 }}
        className={`pointer-events-auto flex flex-col overflow-hidden shadow-2xl ${isMobile ? 'w-full h-full rounded-none' : 'rounded-2xl'}`}
        style={isMobile
          ? { background: 'var(--bg-l1)', paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }
          : { width: 360, height: 520, background: 'var(--bg-l1)', border: '1px solid rgba(255,255,255,0.1)',
              margin: '0 16px 80px 0', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>

        {/* Шапка */}
        <div className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'var(--bg-l1)' }}>
          <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0"
            style={{ background: `${bot.accent}20`, border: `1px solid ${bot.accent}35` }}>
            <BotIcon kind={bot.icon} size={20} color={bot.accent}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-white truncate">{bot.name}</p>
              {bot.verified && <BadgeCheck size={12} style={{ color: '#4e8cf7' }}/>}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{bot.username}</p>
              <OnlineMark online={bot.online}/>
            </div>
          </div>
          {bot.commands.length > 0 && (
            <button type="button" onClick={() => setShowCmds((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-white/10"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <Hash size={14} style={{ color: 'rgba(255,255,255,0.5)' }}/>
            </button>
          )}
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-white/10">
            <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }}/>
          </button>
        </div>

        {/* Команды */}
        <AnimatePresence>
          {showCmds && bot.commands.length > 0 && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
              className="overflow-hidden shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {bot.commands.map((c) => (
                  <button key={c.cmd} type="button" onClick={() => { void send(c.cmd); setShowCmds(false); }}
                    className="rounded-full px-3 py-1.5 text-xs font-bold"
                    style={{ background: `${bot.accent}15`, color: bot.accent, border: `1px solid ${bot.accent}35` }}>
                    {c.cmd}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Бот офлайн — говорим об этом прямо, а не даём писать в пустоту. */}
        {!bot.online && (
          <div className="px-4 py-2 shrink-0 flex items-center gap-2"
            style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
            <AlertTriangle size={12} style={{ color: 'var(--amber)' }}/>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Бот офлайн — сервер не подключён. Сообщение дойдёт, когда его включат.
            </p>
          </div>
        )}

        {/* Лента */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
          style={{ scrollbarWidth: 'none' }}>
          {msgs.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Напишите боту — он ответит со своего сервера
            </p>
          )}
          {msgs.map((m) => (m.fromMe ? (
            <div key={m.id} className="flex justify-end">
              <div>
                <div className="rounded-2xl rounded-br-sm px-4 py-2.5"
                  style={{ background: `linear-gradient(135deg,${bot.accent},${bot.accent}cc)` }}>
                  <p className="text-sm text-white whitespace-pre-wrap break-words">{m.text}</p>
                </div>
                <p className="text-[10px] text-right mt-1 pr-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {fmtTime(m.createdAt)}
                </p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex items-end gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg shrink-0" style={{ background: `${bot.accent}20` }}>
                <BotIcon kind={bot.icon} size={16} color={bot.accent}/>
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="rounded-2xl rounded-bl-sm px-4 py-2.5"
                  style={{ background: 'var(--bg-l2)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words"
                    style={{ color: 'rgba(255,255,255,0.88)' }}>{m.text}</p>
                </div>
                <p className="text-[10px] pl-1" style={{ color: 'rgba(255,255,255,0.25)' }}>{fmtTime(m.createdAt)}</p>
              </div>
            </div>
          )))}
          {waiting && (
            <div className="flex items-end gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg shrink-0" style={{ background: `${bot.accent}20` }}>
                <BotIcon kind={bot.icon} size={16} color={bot.accent}/>
              </div>
              <div className="rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center"
                style={{ background: 'var(--bg-l2)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-1.5 w-1.5 rounded-full animate-bounce"
                    style={{ background: 'rgba(255,255,255,0.4)', animationDelay: `${i * 0.15}s` }}/>
                ))}
              </div>
            </div>
          )}
        </div>

        {err && <p className="px-4 pb-1 text-[11px] shrink-0" style={{ color: 'var(--red)' }}>{err}</p>}

        {/* Быстрые команды */}
        {bot.commands.length > 0 && (
          <div className="flex gap-2 px-4 pb-2 overflow-x-auto shrink-0" style={{ scrollbarWidth: 'none' }}>
            {bot.commands.slice(0, 3).map((c) => (
              <button key={c.cmd} type="button" onClick={() => void send(c.cmd)}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(255,255,255,0.08)' }}>
                {c.cmd}
              </button>
            ))}
          </div>
        )}

        {/* Ввод */}
        <div className="flex gap-2 items-center px-4 py-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder="Сообщение боту…"
            className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'white', caretColor: bot.accent }}/>
          <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => void send()}
            className="grid h-10 w-10 place-items-center rounded-full shrink-0"
            style={{ background: input.trim() && !sending ? bot.accent : 'rgba(255,255,255,0.07)' }}>
            <Send size={16} style={{ color: input.trim() && !sending ? 'white' : 'rgba(255,255,255,0.3)', marginLeft: 2 }}/>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

/* ─── «Все боты» ───────────────────────────────────────────────────
   Каталог опубликованных ботов. Ни токена, ни адреса сервера
   владельца, ни кода, ни внутренних идентификаторов здесь нет: сервер
   отдаёт только то, что предназначено для публикации. */

export const BotsBrowser = ({ onClose }: { onClose: () => void }) => {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Все');
  const [bots, setBots] = useState<Bot[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBot, setOpenBot] = useState<Bot | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      apiBotCatalog(q, cat).then((r) => {
        if (!alive) return;
        setBots(r.ok && r.data ? r.data.bots : []);
        if (r.ok && r.data) setCats(r.data.categories);
        setLoading(false);
      });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, cat]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <BotGlyph size={16} style={{ color: 'var(--accent)' }}/>
          <h2 className="text-base font-bold" style={{ color: 'var(--t1)' }}>Sky Боты</h2>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(79,110,247,0.12)', color: 'var(--accent)' }}>{bots.length}</span>
        </div>
        <button type="button" onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10">
          <X size={16} style={{ color: 'var(--t3)' }}/>
        </button>
      </div>

      <div className="flex items-center gap-2 mx-5 my-3 rounded-2xl px-4 py-2.5 shrink-0"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--t3)' }}/>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти бота…"
          className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--t1)' }}/>
      </div>

      <div className="flex gap-1.5 px-5 pb-3 overflow-x-auto shrink-0" style={{ scrollbarWidth: 'none' }}>
        {['Все', ...cats].map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{
              background: cat === c ? 'var(--accent)' : 'var(--bg-l2)',
              color: cat === c ? '#fff' : 'var(--t3)',
              border: `1px solid ${cat === c ? 'transparent' : 'var(--border)'}`,
            }}>{c}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2" style={{ scrollbarWidth: 'none' }}>
        {loading && <p className="text-sm text-center py-10" style={{ color: 'var(--t3)' }}>Загружаем…</p>}

        {!loading && bots.length === 0 && (
          <div className="grid place-items-center h-48 text-center">
            <div>
              <BotGlyph size={36} className="mx-auto mb-3" style={{ color: 'var(--t3)' }}/>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--t2)' }}>Ботов пока нет</p>
              <p className="text-xs max-w-[260px]" style={{ color: 'var(--t3)' }}>
                Здесь появляются боты, которых опубликовали их авторы.
                Своего можно завести во вкладке «Мои боты».
              </p>
            </div>
          </div>
        )}

        {bots.map((bot) => (
          <button key={bot.id} type="button" onClick={() => setOpenBot(bot)}
            className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-white/5"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <div className="grid h-12 w-12 place-items-center rounded-xl shrink-0"
              style={{ background: `${bot.accent}20`, border: `1px solid ${bot.accent}35` }}>
              <BotIcon kind={bot.icon} size={20} color={bot.accent}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{bot.name}</p>
                {bot.verified && <BadgeCheck size={12} style={{ color: 'var(--accent)' }}/>}
                <span className="ml-auto shrink-0"><OnlineMark online={bot.online}/></span>
              </div>
              <p className="text-xs truncate mb-1.5" style={{ color: 'var(--t3)' }}>
                {bot.shortDesc || bot.desc || bot.username}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {bot.commands.slice(0, 3).map((c) => (
                  <span key={c.cmd} className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t3)' }}>{c.cmd}</span>
                ))}
                {bot.inline && bot.inlineTrigger && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: `${bot.accent}18`, color: bot.accent }}>#{bot.inlineTrigger}</span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] ml-auto" style={{ color: 'var(--t3)' }}>
                  <Users size={9}/>{bot.users}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {openBot && <BotChatOverlay bot={openBot} onClose={() => setOpenBot(null)}/>}
      </AnimatePresence>
    </div>
  );
};

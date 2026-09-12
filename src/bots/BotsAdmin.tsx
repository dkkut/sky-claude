/**
 * Очередь ботов в админ-панели.
 *
 * Бот попадает сюда, когда владелец отправил его в каталог. До решения
 * модератора он виден только самому владельцу — «Все боты» показывают
 * лишь опубликованных, и это условие стоит в запросе к базе, а не в
 * разборе ответа.
 *
 * Право решать проверяет сервер. Здесь нет ни одной проверки «я
 * администратор»: у постороннего очередь просто не откроется.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bot, Check, X, RefreshCw, Users, Hash, Server } from 'lucide-react';
import {
  apiBotModerationQueue, apiModerateBot, explainBot, type Bot as BotRow,
} from './botApi';
import { BotIcon } from './botIcons';

type Row = BotRow & { ownerName: string; submittedAt: string };

export const BotModeration = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await apiBotModerationQueue();
    setRows(r.ok && r.data ? r.data.bots : []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (bot: Row, approve: boolean) => {
    setBusy(bot.id); setErr('');
    const r = await apiModerateBot(bot.id, approve, reason[bot.id] ?? '');
    setBusy(null);
    if (!r.ok) { setErr(explainBot(r.error, r.reason)); return; }
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={15} style={{ color: 'var(--accent)' }}/>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Боты на проверке</p>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(79,110,247,0.12)', color: 'var(--accent)' }}>{rows.length}</span>
        <button type="button" onClick={() => void load()}
          className="ml-auto grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--bg-l2)' }}>
          <RefreshCw size={12} style={{ color: 'var(--t2)' }}/>
        </button>
      </div>

      {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}

      {loading ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--t3)' }}>Загружаем…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--t3)' }}>Очередь пуста</p>
      ) : rows.map((b) => (
        <div key={b.id} data-bot-moderation-card={b.id}
          className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl shrink-0"
              style={{ background: `${b.accent}20`, border: `1px solid ${b.accent}35` }}>
              <BotIcon kind={b.icon} size={20} color={b.accent}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{b.name}</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t3)' }}>{b.category}</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--t3)' }}>{b.username} · автор {b.ownerName}</p>
              {b.shortDesc && <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>{b.shortDesc}</p>}
              {b.desc && <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--t3)' }}>{b.desc}</p>}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                <span className="inline-flex items-center gap-1 text-[10px]"
                  style={{ color: b.online ? 'var(--green)' : 'var(--amber)' }}>
                  <Server size={10}/>{b.online ? 'сервер автора на связи' : 'сервер автора не отвечает'}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--t3)' }}>
                  <Users size={10}/>{b.users}
                </span>
                {b.inline && b.inlineTrigger && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold"
                    style={{ color: b.accent }}><Hash size={10}/>{b.inlineTrigger}</span>
                )}
              </div>

              {b.commands.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {b.commands.map((c) => (
                    <span key={c.cmd} className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t3)' }}>
                      {c.cmd}{c.desc ? ` — ${c.desc}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pb-3 space-y-2">
            <input value={reason[b.id] ?? ''} onChange={(e) => setReason((p) => ({ ...p, [b.id]: e.target.value }))}
              placeholder="Причина отказа — увидит автор"
              className="w-full rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void decide(b, true)}
                disabled={busy === b.id}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: 'rgba(0,200,90,0.1)', color: 'var(--green)', border: '1px solid rgba(0,200,90,0.25)' }}>
                <Check size={13}/>Опубликовать
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void decide(b, false)}
                disabled={busy === b.id}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)', border: '1px solid rgba(244,63,94,0.2)' }}>
                <X size={13}/>Отклонить
              </motion.button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

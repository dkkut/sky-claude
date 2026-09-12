/**
 * «Мои боты».
 *
 * Экран остался прежним: список карточек, форма создания, редактор
 * кода. Изменилось то, что за ним стоит.
 *
 * Было: боты лежали в localStorage этого браузера, а код бота
 * выполнялся здесь же, в Web Worker. Бот работал, пока открыта вкладка,
 * отвечал только своему создателю и пропадал вместе с очисткой
 * хранилища. Кнопка «Тест» запускала код — то есть выполнение кода
 * пользователя происходило в самом приложении.
 *
 * Стало: бот живёт на сервере, а КОД БОТА ВЫПОЛНЯЕТСЯ НА СЕРВЕРЕ
 * ВЛАДЕЛЬЦА. Ни Sky, ни этот браузер его не запускают. Здесь можно
 * написать и сохранить черновик, проверить его на синтаксис (разбор,
 * не выполнение) и скопировать к себе. Вместо «Тест» появилась
 * «Подключить сервер».
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Plus, Trash2, Code2, ChevronLeft, Check, X, Lock, Server,
  Copy, RefreshCw, Link2, Unlink, ScrollText, Send, AlertTriangle,
  Radio, Loader, Globe, Terminal,
} from 'lucide-react';
import {
  apiMyBots, apiCreateBot, apiUpdateBot, apiDeleteBot, apiBotCode,
  apiCreatePairing, apiUnlinkRuntime, apiSetDelivery,
  apiSubmitBot, apiUnpublishBot, apiBotLog, explainBot,
  type Bot as BotRow, type BotLogLine, type RuntimeState,
} from './botApi';
import { BOT_ICONS, BotIcon } from './botIcons';

/** Черновик для нового бота. Это текст для владельца, а не программа для Sky. */
const DEFAULT_CODE = `// bot.mjs — запускается НА ВАШЕМ СЕРВЕРЕ, не в Sky.
//
//   npm install sky-bot-sdk
//   SKY_BOT_PAIRING_CODE=<код привязки> node bot.mjs
//
import { SkyBot } from 'sky-bot-sdk';

const bot = new SkyBot({ label: 'мой сервер' });

bot.on('start', () => 'Привет! Я работаю на сервере своего владельца.');

bot.on('message', ({ command, args, text }) => {
  if (command === '/help') return '/echo <текст> — повторю за вами';
  if (command === '/echo') return args || 'После /echo надо что-нибудь написать';
  return \`Вы написали: \${text}\`;
});

bot.start();
`;

const EMPTY_FORM = {
  name: '', username: '', shortDesc: '', desc: '',
  category: 'Другое', icon: 'bot', accent: '#4e8cf7',
  code: DEFAULT_CODE, codeLang: 'js',
  inline: false, inlineTrigger: '', inlinePlaceholder: '',
};

const CATEGORIES = ['Утилиты', 'Новости', 'ИИ', 'Маркет', 'Игры', 'Развлечения', 'Другое'];

/* ─── Состояние сервера владельца ───────────────────────────────────
   Четыре положения, и все различимы. «Онлайн» не показывается, если
   сервер на самом деле не подключён: это первое, что читает человек. */

const STATUS_UI: Record<RuntimeState['status'], { label: string; color: string; hint: string }> = {
  online:     { label: 'Онлайн',      color: 'var(--green)', hint: 'Ваш сервер на связи' },
  connecting: { label: 'Подключение', color: 'var(--amber)', hint: 'Связь была недавно, сейчас тишина' },
  error:      { label: 'Ошибка',      color: 'var(--red)',   hint: 'Сервер сообщил об ошибке' },
  offline:    { label: 'Офлайн',      color: 'var(--t3)',    hint: 'Бот офлайн — сервер не подключён' },
  unlinked:   { label: 'Нет сервера', color: 'var(--t3)',    hint: 'Сервер не привязан' },
};

const StatusDot = ({ status, size = 8 }: { status: RuntimeState['status']; size?: number }) => (
  <span className="inline-block rounded-full shrink-0"
    style={{ width: size, height: size, background: STATUS_UI[status].color }}/>
);

const PUBLISH_UI: Record<string, { label: string; color: string }> = {
  private:   { label: 'Черновик',   color: 'var(--t3)' },
  pending:   { label: 'На проверке', color: 'var(--amber)' },
  published: { label: 'В каталоге',  color: 'var(--green)' },
  rejected:  { label: 'Отклонён',    color: 'var(--red)' },
};

const ago = (iso?: string | null) => {
  if (!iso) return 'никогда';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};

/**
 * Проверка кода без выполнения.
 *
 * Разбирать текст движком языка нельзя: new Function и eval запрещены
 * политикой безопасности страницы (CSP), и это правильно — иначе любая
 * найденная дыра в приложении получала бы готовый способ выполнить
 * произвольный код. Первая версия этой проверки как раз спотыкалась об
 * это и объявляла ошибкой любой, даже совершенно правильный код.
 *
 * Поэтому здесь свой разбор, и он честно ограничен: считает парность
 * скобок и закрытость строк. Это ловит то, на чём спотыкаются чаще
 * всего — обрезанную при копировании строку, потерянную скобку,
 * незакрытую кавычку. Всё остальное скажет тот, кто код запускает, то
 * есть сервер владельца.
 *
 * Комментарии и строки пропускаются целиком: скобка внутри кавычек —
 * не скобка, а текст.
 */
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

const syntaxCheck = (code: string, lang: string): { ok: boolean; error?: string } => {
  /* Чужой язык не разбираем: Python и Go проверит тот, кто их запускает. */
  if (lang !== 'js' && lang !== 'ts') return { ok: true };

  const stack: { ch: string; line: number }[] = [];
  let line = 1;
  let i = 0;

  const at = (n: number) => code[i + n] ?? '';

  while (i < code.length) {
    const ch = code[i];

    if (ch === '\n') { line += 1; i += 1; continue; }

    /* Комментарии. */
    if (ch === '/' && at(1) === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && at(1) === '*') {
      const started = line;
      i += 2;
      while (i < code.length && !(code[i] === '*' && at(1) === '/')) {
        if (code[i] === '\n') line += 1;
        i += 1;
      }
      if (i >= code.length) return { ok: false, error: `Комментарий со строки ${started} не закрыт` };
      i += 2;
      continue;
    }

    /* Строки. Обратные кавычки умеют вкладывать выражения — за ними
       следим отдельно, иначе скобка внутри ${…} потеряется. */
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const started = line;
      i += 1;
      let closed = false;
      while (i < code.length) {
        const c = code[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') {
          line += 1;
          /* Обычная кавычка не переживает перевод строки. */
          if (quote !== '`') break;
          i += 1;
          continue;
        }
        if (quote === '`' && c === '$' && at(1) === '{') {
          stack.push({ ch: '{', line });
          i += 2;
          /* Возвращаемся к обычному разбору: внутри ${…} снова код. */
          let depth = 1;
          while (i < code.length && depth > 0) {
            if (code[i] === '\n') line += 1;
            else if (code[i] === '{') depth += 1;
            else if (code[i] === '}') depth -= 1;
            i += 1;
          }
          if (depth > 0) return { ok: false, error: `Вставка \${'{'}…${'}'} со строки ${started} не закрыта` };
          stack.pop();
          continue;
        }
        if (c === quote) { closed = true; i += 1; break; }
        i += 1;
      }
      if (!closed) return { ok: false, error: `Строка со строки ${started} не закрыта (${quote})` };
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') { stack.push({ ch, line }); i += 1; continue; }

    if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (!top) return { ok: false, error: `Лишняя «${ch}» в строке ${line}` };
      if (top.ch !== PAIRS[ch]) {
        return { ok: false, error: `В строке ${line} закрывается «${ch}», а открыта «${top.ch}» в строке ${top.line}` };
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  if (stack.length) {
    const left = stack[stack.length - 1];
    return { ok: false, error: `Не закрыта «${left.ch}» из строки ${left.line}` };
  }
  return { ok: true };
};

/* ─── Панель сервера ────────────────────────────────────────────── */

const ServerPanel = ({ bot, onChanged }: { bot: BotRow; onChanged: () => void }) => {
  const [pairing, setPairing] = useState<{ code: string; expiresIn: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [hookUrl, setHookUrl] = useState('');
  const [hookSecret, setHookSecret] = useState('');

  const rt = bot.runtime ?? { linked: false, status: 'unlinked' as const };
  const ui = STATUS_UI[rt.status];

  useEffect(() => {
    if (!pairing) return;
    setLeft(pairing.expiresIn);
    const t = setInterval(() => setLeft((v) => {
      if (v <= 1) { clearInterval(t); setPairing(null); return 0; }
      return v - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const issue = async () => {
    setBusy(true); setErr('');
    const r = await apiCreatePairing(bot.id);
    setBusy(false);
    if (!r.ok || !r.data) { setErr(explainBot(r.error, r.reason)); return; }
    setPairing(r.data);
    onChanged();
  };

  const unlink = async () => {
    setBusy(true); setErr('');
    const r = await apiUnlinkRuntime(bot.id);
    setBusy(false);
    if (!r.ok) { setErr(explainBot(r.error, r.reason)); return; }
    setPairing(null); setHookSecret('');
    onChanged();
  };

  const switchDelivery = async (mode: 'poll' | 'webhook') => {
    setBusy(true); setErr(''); setHookSecret('');
    const r = await apiSetDelivery(bot.id, mode, hookUrl);
    setBusy(false);
    if (!r.ok) { setErr(explainBot(r.error, r.reason)); return; }
    if (r.data?.webhookSecret) setHookSecret(r.data.webhookSecret);
    onChanged();
  };

  const copy = (value: string) => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <Server size={15} style={{ color: 'var(--t2)' }}/>
        <p className="text-sm font-bold flex-1" style={{ color: 'var(--t1)' }}>Ваш сервер</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full"
          style={{ background: `${ui.color}18`, color: ui.color }}>
          <StatusDot status={rt.status}/> {ui.label}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>
          Код бота выполняется на вашем сервере, а не в Sky. Sky передаёт
          события и принимает ответы.
        </p>

        {rt.linked && (
          <div className="grid grid-cols-2 gap-2">
            {([
              ['Последний раз на связи', ago(rt.lastSeen)],
              ['Подключён', ago(rt.connectedAt)],
              /* Метку сервер называет сам при привязке: у владельца их
                 может быть несколько, и «который из них» — первое, что
                 он захочет узнать. */
              ['Сервер', rt.label || 'без названия'],
              ['Версия', rt.version || '—'],
              ['Доставка', rt.delivery === 'webhook' ? 'вебхук' : 'опрос'],
              ['Событий отдано', String(rt.eventsSent ?? 0)],
              ['Действий принято', String(rt.actionsDone ?? 0)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="rounded-xl px-3 py-2" style={{ background: 'var(--bg-l3)' }}>
                <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{k}</p>
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{v}</p>
              </div>
            ))}
          </div>
        )}

        {rt.lastError && (
          <div className="rounded-xl px-3 py-2.5 flex items-start gap-2"
            style={{ background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.2)' }}>
            <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--red)' }}/>
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: 'var(--red)' }}>Последняя ошибка</p>
              <p className="text-xs mt-0.5 break-words" style={{ color: 'var(--t2)' }}>{rt.lastError}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{ago(rt.lastErrorAt)}</p>
            </div>
          </div>
        )}

        {!rt.linked && !pairing && (
          <p className="text-xs" style={{ color: 'var(--t3)' }}>{ui.hint}</p>
        )}
        {rt.linked && rt.status !== 'online' && (
          <p className="text-xs" style={{ color: 'var(--t3)' }}>
            {rt.status === 'offline'
              ? 'Бот офлайн — сервер не подключён. Включите его, и бот подключится сам.'
              : ui.hint}
          </p>
        )}

        {/* Код привязки. Показывается один раз — повторно его не узнать. */}
        <AnimatePresence>
          {pairing && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="rounded-xl px-3 py-3"
                style={{ background: 'rgba(79,110,247,0.07)', border: '1px solid rgba(79,110,247,0.25)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
                  Код привязки · одноразовый · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-base font-mono font-black tracking-widest"
                    style={{ color: 'var(--t1)' }}>{pairing.code}</code>
                  <button type="button" onClick={() => copy(pairing.code)}
                    className="grid h-8 w-8 place-items-center rounded-lg"
                    style={{ background: 'var(--bg-l3)' }}>
                    {copied ? <Check size={13} style={{ color: 'var(--green)' }}/>
                            : <Copy size={13} style={{ color: 'var(--t2)' }}/>}
                  </button>
                </div>
                <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--t3)' }}>
                  Введите его на своём сервере один раз:
                </p>
                <pre className="mt-1.5 rounded-lg px-2.5 py-2 text-[10.5px] font-mono overflow-x-auto"
                  style={{ background: '#0d0d14', color: '#9ca3af' }}>
{`npm install sky-bot-sdk
SKY_BOT_PAIRING_CODE=${pairing.code} node bot.mjs`}
                </pre>
                <p className="text-[10px] mt-2" style={{ color: 'var(--t3)' }}>
                  Второй раз этот код не сработает, и посмотреть его снова нельзя —
                  только выпустить новый.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ключ подписи вебхука — тоже один раз. */}
        {hookSecret && (
          <div className="rounded-xl px-3 py-3"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--amber)' }}>
              Ключ подписи вебхука · показывается один раз
            </p>
            <code className="block text-[11px] font-mono break-all" style={{ color: 'var(--t1)' }}>{hookSecret}</code>
            <button type="button" onClick={() => copy(hookSecret)}
              className="mt-2 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>Скопировать</button>
          </div>
        )}

        {err && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={issue} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? <Loader size={12} className="animate-spin"/> : <Link2 size={12}/>}
            {rt.linked ? 'Перепривязать сервер' : 'Подключить сервер'}
          </motion.button>

          {rt.linked && (
            <button type="button" onClick={unlink} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
              style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)', border: '1px solid rgba(244,63,94,0.2)' }}>
              <Unlink size={12}/>Отвязать
            </button>
          )}
        </div>

        {/* Способ доставки. По умолчанию опрос: он работает за NAT. */}
        {rt.linked && (
          <div className="rounded-xl px-3 py-3" style={{ background: 'var(--bg-l3)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>
              Как ваш сервер получает события
            </p>
            <div className="flex gap-2 mb-2">
              {([['poll', 'Сам забирает', Radio], ['webhook', 'Вебхук', Globe]] as const).map(([mode, label, Icon]) => (
                <button key={mode} type="button" onClick={() => mode === 'poll' && switchDelivery('poll')}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
                  style={{
                    background: rt.delivery === mode ? 'var(--accent-bg)' : 'transparent',
                    color: rt.delivery === mode ? 'var(--accent)' : 'var(--t3)',
                    border: `1px solid ${rt.delivery === mode ? 'rgba(79,110,247,0.3)' : 'var(--border)'}`,
                  }}>
                  <Icon size={11}/>{label}
                </button>
              ))}
            </div>
            {rt.delivery === 'poll' ? (
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
                Ваш сервер сам держит запрос к Sky и получает событие в момент
                появления. Входящий порт не нужен — работает за NAT и за
                домашним роутером.
              </p>
            ) : null}
            <div className="mt-2 flex gap-2">
              <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)}
                placeholder="https://ваш-домен/sky-hook"
                className="flex-1 rounded-lg px-2.5 py-1.5 text-[11px] outline-none"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <button type="button" onClick={() => switchDelivery('webhook')} disabled={busy || !hookUrl}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
                Включить вебхук
              </button>
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--t3)' }}>
              Только https и обычный домен в интернете. Каждая доставка
              подписывается, несёт время и номер — проверяйте всё три.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Журнал ────────────────────────────────────────────────────── */

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--t3)', warn: 'var(--amber)', error: 'var(--red)',
};

const LogPanel = ({ botId }: { botId: string }) => {
  const [lines, setLines] = useState<BotLogLine[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await apiBotLog(botId, 150);
    setLines(r.ok && r.data ? r.data.log : []);
    setLoading(false);
  }, [botId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <ScrollText size={15} style={{ color: 'var(--t2)' }}/>
        <p className="text-sm font-bold flex-1" style={{ color: 'var(--t1)' }}>Логи</p>
        <button type="button" onClick={() => void load()}
          className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--bg-l3)' }}>
          <RefreshCw size={12} style={{ color: 'var(--t2)' }}/>
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {loading ? (
          <p className="text-xs text-center py-6" style={{ color: 'var(--t3)' }}>Загружаем…</p>
        ) : lines.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: 'var(--t3)' }}>Пока пусто</p>
        ) : lines.map((l) => (
          <div key={l.id} className="px-4 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold" style={{ color: LEVEL_COLOR[l.level] }}>{l.event}</span>
              <span className="ml-auto text-[10px]" style={{ color: 'var(--t3)' }}>{ago(l.at)}</span>
            </div>
            {l.detail && <p className="text-[11px] mt-0.5" style={{ color: 'var(--t2)' }}>{l.detail}</p>}
          </div>
        ))}
      </div>
      <p className="text-[10px] px-4 py-2" style={{ color: 'var(--t3)', borderTop: '1px solid var(--border)' }}>
        Секретов здесь нет: ни токена, ни кода привязки, ни ключа подписи.
      </p>
    </div>
  );
};

/* ─── Экран ─────────────────────────────────────────────────────── */

export const BotCreatorPanel = () => {
  const [bots, setBots]   = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]   = useState<'list' | 'create' | 'edit'>('list');
  const [editBot, setEB]  = useState<BotRow | null>(null);
  const [form, setForm]   = useState(EMPTY_FORM);
  const [msg, setMsg]     = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy]   = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiMyBots();
    setBots(r.ok && r.data ? r.data.bots : []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Состояние сервера меняется само: карточка должна это показывать без
     перезагрузки страницы. Реже раза в 15 секунд «Онлайн» уже врёт. */
  useEffect(() => {
    if (view !== 'list') return;
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, [view, load]);

  const save = async () => {
    if (!form.name.trim()) { setMsg({ text: 'Введите название', ok: false }); return; }
    setBusy(true); setMsg(null);

    const payload = {
      name: form.name.trim(), shortDesc: form.shortDesc, desc: form.desc,
      category: form.category, icon: form.icon, accent: form.accent,
      code: form.code, codeLang: form.codeLang,
      inline: form.inline, inlineTrigger: form.inlineTrigger,
      inlinePlaceholder: form.inlinePlaceholder,
    };

    const r = editBot
      ? await apiUpdateBot(editBot.id, payload)
      : await apiCreateBot({ ...payload, username: form.username.trim() });
    setBusy(false);

    if (!r.ok) { setMsg({ text: explainBot(r.error, r.reason), ok: false }); return; }
    setMsg({ text: 'Сохранено', ok: true });
    await load();
    setTimeout(() => { setView('list'); setMsg(null); setEB(null); setForm(EMPTY_FORM); }, 600);
  };

  const remove = async (id: string) => {
    setBusy(true);
    await apiDeleteBot(id);
    setBusy(false);
    await load();
  };

  const publish = async (bot: BotRow) => {
    setBusy(true);
    const r = bot.status === 'published' || bot.status === 'pending'
      ? await apiUnpublishBot(bot.id)
      : await apiSubmitBot(bot.id);
    setBusy(false);
    if (!r.ok) { setMsg({ text: explainBot(r.error, r.reason), ok: false }); setTimeout(() => setMsg(null), 3000); return; }
    await load();
  };

  const openEdit = async (bot: BotRow) => {
    setEB(bot);
    const code = await apiBotCode(bot.id);
    setForm({
      name: bot.name, username: bot.username.replace('@', ''),
      shortDesc: bot.shortDesc, desc: bot.desc,
      category: bot.category, icon: bot.icon, accent: bot.accent,
      code: code.ok && code.data ? (code.data.code || DEFAULT_CODE) : DEFAULT_CODE,
      codeLang: bot.codeLang ?? 'js',
      inline: bot.inline, inlineTrigger: bot.inlineTrigger ?? '',
      inlinePlaceholder: bot.inlinePlaceholder ?? '',
    });
    setCheck(null);
    setView('edit');
  };

  /* ── Создание и правка ──────────────────────────────────────── */

  if (view === 'create' || view === 'edit') return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => { setView('list'); setEB(null); setForm(EMPTY_FORM); setMsg(null); }}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
            <ChevronLeft size={16} style={{ color: 'var(--t2)' }}/>
          </button>
          <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>
            {view === 'edit' ? 'Редактировать' : 'Создать бота'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCheck(syntaxCheck(form.code, form.codeLang))}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
            style={{
              background: check ? (check.ok ? 'rgba(0,200,90,0.1)' : 'rgba(244,63,94,0.1)') : 'var(--bg-l2)',
              color: check ? (check.ok ? 'var(--green)' : 'var(--red)') : 'var(--t2)',
              border: `1px solid ${check ? (check.ok ? 'rgba(0,200,90,0.25)' : 'rgba(244,63,94,0.25)') : 'var(--border)'}`,
            }}>
            {check
              ? (check.ok ? <><Check size={12}/>Синтаксис в порядке</> : <><X size={12}/>Ошибка в коде</>)
              : <><Terminal size={12}/>Проверить</>}
          </button>
          <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void save()} disabled={busy}
            className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}>Сохранить</motion.button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5" style={{ scrollbarWidth: 'none' }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--t3)' }}>Значок</p>
          <div className="flex flex-wrap gap-2">
            {BOT_ICONS.map((kind) => (
              <button key={kind} type="button" onClick={() => setForm((p) => ({ ...p, icon: kind }))}
                className="grid h-10 w-10 place-items-center rounded-xl transition-all"
                style={{
                  border: `2px solid ${form.icon === kind ? 'var(--accent)' : 'var(--border)'}`,
                  background: form.icon === kind ? 'var(--accent-bg)' : 'var(--bg-l2)',
                }}>
                <BotIcon kind={kind} size={18} color={form.icon === kind ? 'var(--accent)' : 'var(--t2)'}/>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>Название</p>
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Мой бот" className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
        </div>

        {/* Ник задаётся один раз: по нему на бота ссылаются. */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>Ник</p>
          <input value={form.username} disabled={view === 'edit'}
            onChange={(e) => setForm((p) => ({ ...p, username: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))}
            placeholder="myhelperbot" className="w-full rounded-2xl px-4 py-3 text-sm outline-none disabled:opacity-50"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
          <p className="text-[10px] mt-1" style={{ color: 'var(--t3)' }}>
            {view === 'edit'
              ? 'Ник изменить нельзя: по нему на бота уже ссылаются.'
              : 'Должен оканчиваться на bot — чтобы его не спутали с человеком.'}
          </p>
        </div>

        {([['Коротко', 'shortDesc', 'Одной строкой для карточки'],
           ['Описание', 'desc', 'Что умеет ваш бот…']] as [string, 'shortDesc' | 'desc', string][]).map(([l, k, ph]) => (
          <div key={k}>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>{l}</p>
            <input value={form[k]} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
              placeholder={ph} className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
          </div>
        ))}

        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>Категория</p>
          <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Inline-бот */}
        <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Inline-бот (#)</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>Вызывается через # прямо в чате</p>
            </div>
            <div className="h-6 w-11 rounded-full cursor-pointer flex items-center px-0.5"
              style={{ background: form.inline ? 'var(--accent)' : 'var(--bg-l3)' }}
              onClick={() => setForm((p) => ({ ...p, inline: !p.inline }))}>
              <div className="h-5 w-5 rounded-full bg-white shadow"
                style={{ transform: form.inline ? 'translateX(20px)' : 'translateX(0)', transition: 'transform .2s' }}/>
            </div>
          </div>
          {form.inline && (
            <div className="mt-3 space-y-2">
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--t3)' }}>Триггер (без #)</p>
                <input value={form.inlineTrigger}
                  onChange={(e) => setForm((p) => ({ ...p, inlineTrigger: e.target.value.replace(/[^a-zA-Z0-9_а-яёА-ЯЁ]/g, '') }))}
                  placeholder="например: погода" className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--t3)' }}>Подсказка в поле ввода</p>
                <input value={form.inlinePlaceholder}
                  onChange={(e) => setForm((p) => ({ ...p, inlinePlaceholder: e.target.value }))}
                  placeholder="город или координаты" className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
                Варианты, которые предложит ваш сервер, человек видит перед
                отправкой и подтверждает сам. Бот не пишет за него.
              </p>
            </div>
          )}
        </div>

        {/* Код: черновик, а не программа для Sky */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Код бота</p>
            <select value={form.codeLang} onChange={(e) => setForm((p) => ({ ...p, codeLang: e.target.value }))}
              className="rounded-lg px-2 py-1 text-[11px] outline-none"
              style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
              {[['js', 'JavaScript'], ['ts', 'TypeScript'], ['py', 'Python'], ['go', 'Go'], ['other', 'Другое']]
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div className="rounded-xl px-3 py-2.5 mb-2 flex items-start gap-2"
            style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.2)' }}>
            <Server size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}/>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
              Этот код Sky <strong style={{ color: 'var(--t2)' }}>не запускает</strong>. Он хранится,
              чтобы вам было откуда его скопировать. Выполняться он будет
              на вашем сервере — см. «Ваш сервер» в карточке бота.
            </p>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ background: '#0d0d14', border: '1px solid var(--border)' }}>
            <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Code2 size={12} style={{ color: 'var(--t3)' }}/>
              <span className="text-xs font-mono" style={{ color: 'var(--t3)' }}>bot.mjs</span>
            </div>
            <textarea value={form.code} onChange={(e) => { setForm((p) => ({ ...p, code: e.target.value })); setCheck(null); }}
              rows={16} spellCheck={false}
              className="w-full bg-transparent px-4 py-3 text-xs font-mono outline-none resize-none leading-relaxed"
              style={{ color: '#e5e7eb', tabSize: 2 }}/>
          </div>

          {check && (
            <div className="mt-2 rounded-xl px-3 py-2.5"
              style={{
                background: check.ok ? 'rgba(0,200,90,0.07)' : 'rgba(244,63,94,0.07)',
                border: `1px solid ${check.ok ? 'rgba(0,200,90,0.2)' : 'rgba(244,63,94,0.2)'}`,
              }}>
              <p className="text-xs font-semibold flex items-center gap-1.5"
                style={{ color: check.ok ? 'var(--green)' : 'var(--red)' }}>
                {check.ok ? <><Check size={12}/> Синтаксис в порядке</>
                          : <><X size={12}/> {check.error}</>}
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--t3)' }}>
                Проверяются парность скобок и закрытость строк — код при этом
                не выполняется ни здесь, ни в Sky. Остальное скажет ваш сервер
                при запуске.
              </p>
            </div>
          )}
        </div>

        {msg && (
          <div className="rounded-xl px-4 py-3"
            style={{
              background: msg.ok ? 'rgba(0,200,90,0.08)' : 'rgba(244,63,94,0.08)',
              border: `1px solid ${msg.ok ? 'rgba(0,200,90,0.2)' : 'rgba(244,63,94,0.2)'}`,
            }}>
            <p className="text-sm" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</p>
          </div>
        )}
      </div>
    </div>
  );

  /* ── Список ─────────────────────────────────────────────────── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Bot size={16} style={{ color: 'var(--accent)' }}/>
          <h2 className="text-base font-bold" style={{ color: 'var(--t1)' }}>Мои боты</h2>
        </div>
        <motion.button whileTap={{ scale: 0.95 }} type="button"
          onClick={() => { setForm(EMPTY_FORM); setCheck(null); setMsg(null); setView('create'); }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
          style={{ background: 'var(--accent)', color: '#fff' }}><Plus size={12}/>Создать</motion.button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.15)' }}>
          <div className="flex items-start gap-3">
            <Lock size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}/>
            <div>
              <p className="text-xs font-bold mb-1" style={{ color: 'var(--accent)' }}>Код работает на вашем сервере</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>
                Sky не запускает код ботов. Вы поднимаете небольшую программу
                у себя, привязываете её одноразовым кодом — и она получает
                события и отвечает через Bot API.
              </p>
            </div>
          </div>
        </div>

        {msg && !msg.ok && (
          <p className="text-xs px-1" style={{ color: 'var(--red)' }}>{msg.text}</p>
        )}

        {loading ? (
          <p className="text-sm text-center py-10" style={{ color: 'var(--t3)' }}>Загружаем…</p>
        ) : bots.length === 0 ? (
          <div className="grid place-items-center h-40 text-center">
            <div>
              <Bot size={36} className="mx-auto mb-3" style={{ color: 'var(--t3)' }}/>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--t2)' }}>Нет ботов</p>
              <p className="text-xs" style={{ color: 'var(--t3)' }}>Создайте первого и подключите свой сервер</p>
            </div>
          </div>
        ) : bots.map((b) => {
          const rt = b.runtime ?? { linked: false, status: 'unlinked' as const };
          const pub = PUBLISH_UI[b.status ?? 'private'];
          const open = openPanel === b.id;
          return (
            <div key={b.id} className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl shrink-0"
                  style={{ background: `${b.accent}20`, border: `1px solid ${b.accent}35` }}>
                  <BotIcon kind={b.icon} size={20} color={b.accent}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{b.name}</p>
                    <StatusDot status={rt.status}/>
                    <span className="text-[10px] font-bold shrink-0" style={{ color: pub.color }}>{pub.label}</span>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--t3)' }}>
                    {b.username} · {b.shortDesc || 'без описания'}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="text-[10px]" style={{ color: STATUS_UI[rt.status].color }}>
                      {STATUS_UI[rt.status].label}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--t3)' }}>
                      на связи {ago(rt.lastSeen)}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--t3)' }}>
                      событий {rt.eventsSent ?? 0}
                    </span>
                    {(b.queued ?? 0) > 0 && (
                      <span className="text-[10px]" style={{ color: 'var(--amber)' }}>в очереди {b.queued}</span>
                    )}
                    <span className="text-[10px]" style={{ color: 'var(--t3)' }}>
                      собеседников {b.users}
                    </span>
                  </div>
                  {b.status === 'rejected' && b.rejectReason && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--red)' }}>Причина: {b.rejectReason}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 px-4 pb-3">
                <button type="button" onClick={() => setOpenPanel(open ? null : b.id)}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
                  style={{
                    background: open ? 'var(--accent-bg)' : 'rgba(255,255,255,0.05)',
                    color: open ? 'var(--accent)' : 'var(--t2)',
                    border: `1px solid ${open ? 'rgba(79,110,247,0.25)' : 'var(--border)'}`,
                  }}>
                  <Server size={12}/>Сервер
                </button>
                <button type="button" onClick={() => void openEdit(b)}
                  className="flex-1 rounded-xl py-2 text-xs font-bold"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)' }}>
                  Изменить
                </button>
                <button type="button" onClick={() => void publish(b)} disabled={busy}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
                  style={{ background: 'rgba(0,200,90,0.08)', color: 'var(--green)', border: '1px solid rgba(0,200,90,0.15)' }}>
                  <Send size={12}/>{b.status === 'published' || b.status === 'pending' ? 'Снять' : 'В каталог'}
                </button>
                <button type="button" onClick={() => void remove(b.id)} disabled={busy}
                  className="rounded-xl px-3 py-2 disabled:opacity-50"
                  style={{ background: 'rgba(244,63,94,0.06)', color: 'var(--red)', border: '1px solid rgba(244,63,94,0.15)' }}>
                  <Trash2 size={14}/>
                </button>
              </div>

              <AnimatePresence>
                {open && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 space-y-3">
                      <ServerPanel bot={b} onChanged={() => void load()}/>
                      <LogPanel botId={b.id}/>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};

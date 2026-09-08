/**
 * Вкладка «Информация»: правила, оферта, согласие, политика, контакты.
 *
 * Документы лежат в docs/ одним экземпляром и подставляются сюда при
 * сборке. Копий нет намеренно: два экземпляра одного документа рано или
 * поздно разойдутся, и человек прочитает не то, что действует.
 *
 * Тексты подгружаются по требованию — открытие настроек не должно
 * тянуть за собой сотню килобайт, которые почти никто не откроет.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, ScrollText, FileText, ShieldCheck,
  Receipt, Tag, Building2, Loader2, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Markdown } from './markdown';
import type { DocKey } from './texts';

interface Doc {
  key: DocKey;
  title: string;
  sub: string;
  icon: LucideIcon;
}

const DOCS: Doc[] = [
  { key: 'rules',    title: 'Правила Sky Ecosystem',        sub: 'Что можно и чего нельзя',        icon: ScrollText },
  { key: 'sellers',  title: 'Правила продавцов',            sub: 'Для продавцов и контент-мейкеров', icon: Tag },
  { key: 'offer',    title: 'Публичная оферта',             sub: 'Договор об оказании услуг',      icon: Receipt },
  { key: 'prices',   title: 'Услуги и стоимость',           sub: 'Что платное и сколько стоит',    icon: FileText },
  { key: 'consent',  title: 'Согласие на обработку данных', sub: 'Какие данные и зачем',           icon: ShieldCheck },
  { key: 'privacy',  title: 'Политика конфиденциальности',  sub: 'И положения GDPR',               icon: ShieldCheck },
  { key: 'contacts', title: 'Контакты и реквизиты',         sub: 'С кем вы имеете дело',           icon: Building2 },
];

/**
 * `onClose` появляется, когда документы открыты поверх чего-то — до
 * входа, например. Внутри вкладки профиля закрывать нечего.
 */
export const LegalDocs = ({ onClose }: { onClose?: () => void }) => {
  const [open, setOpen] = useState<Doc | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) { setText(null); setFailed(false); return; }
    let alive = true;
    setText(null); setFailed(false);
    // Тексты приезжают одним куском и только сейчас: открытие настроек
    // не должно тянуть за собой документы, которые почти никто не читает.
    import('./texts')
      .then(m => { if (alive) setText(m.DOC_TEXTS[open.key]); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [open?.key]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        {open ? (
          <button type="button" onClick={() => setOpen(null)} aria-label="Назад"
            className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <ChevronLeft size={17} style={{ color: 'var(--t2)' }} />
          </button>
        ) : (
          <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--accent-bg)' }}>
            <ScrollText size={17} style={{ color: 'var(--accent)' }} />
          </div>
        )}
        <p className="flex-1 truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>
          {open ? open.title : 'Информация'}
        </p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Закрыть"
            className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <X size={16} style={{ color: 'var(--t2)' }} />
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!open ? (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
            {DOCS.map(d => (
              <button key={d.key} type="button" onClick={() => setOpen(d)}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--bg-l3)' }}>
                  <d.icon size={16} style={{ color: 'var(--t2)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" style={{ color: 'var(--t1)' }}>{d.title}</p>
                  <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{d.sub}</p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--t3)' }} />
              </button>
            ))}
            <p className="px-1 pt-2 text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
              Пользуясь Sky, вы принимаете эти документы. Действует та редакция,
              которая опубликована здесь и на сайте.
            </p>
          </motion.div>
        ) : (
          <motion.div key={open.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto px-4 py-4 pb-10" style={{ scrollbarWidth: 'none' }}>
            {text === null && !failed && (
              <div className="grid place-items-center py-10">
                <Loader2 size={20} className="sky-spin" style={{ color: 'var(--t3)' }} />
              </div>
            )}
            {failed && (
              <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>
                Не удалось открыть документ
              </p>
            )}
            {text !== null && <Markdown text={text} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

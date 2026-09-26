/**
 * Окно о документах при первом входе и галочка при регистрации.
 *
 * Показывается поверх любого экрана до входа — беты, входа, кода, —
 * потому что согласие относится не к экрану, а к пользованию сервисом.
 * Документы открываются здесь же, поверх: экосистема при этом не
 * открывается, читать правила можно, не входя никуда.
 *
 * Само согласие — не эта галочка, а запись на сервере: она делается при
 * создании первого профиля и хранит редакцию документов. Здесь только
 * то, что человек это видел.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText } from 'lucide-react';
import { LegalDocs } from './LegalDocs';
import { useDeviceMode } from '@/interface/tv/useDeviceMode';
import { TVFocusable } from '@/interface/tv/TVFocusable';
import { tvFocusManager } from '@/interface/tv/focusManager';
import { useTVKeyBindings } from '@/interface/tv/useTVKeyBindings';

/** Отметка, что окно уже показывали на этом устройстве. */
const SEEN_KEY = 'sky.legal.notice.v1';

/**
 * Показывали ли окно на этом устройстве. Приватный режим и
 * заблокированное хранилище бросают исключение — тогда лучше показать
 * окно лишний раз, чем упасть на старте.
 */
export const legalNoticeSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
};
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* не страшно */ } };

/** Документы поверх всего: закрывается только назад, в приложение не ведёт. */
export const LegalReader = ({ onClose }: { onClose: () => void }) =>
  createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[3000] flex flex-col"
      style={{ background: 'var(--bg)' }}>
      <LegalDocs onClose={onClose} />
    </motion.div>,
    document.body,
  );

/**
 * Окно занимает низ экрана, поэтому его владелец (main) поднимает нижний
 * отступ у экрана под ним: иначе окно накрыло бы кнопку, ради которой
 * человек сюда и пришёл.
 */
export const LegalNotice = ({ onDone }: { onDone: () => void }) => {
  const [reading, setReading] = useState(false);
  // На ТВ нет ни мыши, ни тача — без этого окно с этими кнопками было
  // непроходимым тупиком в TV-режиме (сами кнопки не видны системе
  // навигации пультом, TVFocusable/focusManager). Полный текст документов
  // (LegalDocs) сюда сознательно не тянем: читать многостраничные
  // документы с пульта — плохой опыт при любом раскладе; прочитать их
  // можно на телефоне/компьютере, а здесь пультом доступно только принять.
  const isTV = useDeviceMode() === 'tv';

  const accept = () => { markSeen(); onDone(); };

  useEffect(() => {
    if (!isTV) return;
    tvFocusManager.setScope('legal');
    return () => tvFocusManager.setScope(null);
  }, [isTV]);
  useTVKeyBindings({ mode: 'nav', enabled: isTV });

  return (
    <>
      <AnimatePresence>{reading && <LegalReader onClose={() => setReading(false)} />}</AnimatePresence>

      {createPortal(
        <motion.div
          initial={{ y: 140, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="fixed inset-x-0 bottom-0 z-[2500] px-3 pb-3"
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
          <div className="mx-auto max-w-md rounded-3xl p-4"
            style={{
              background: 'var(--bg-l1)',
              border: '1px solid var(--border)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.45)',
            }}>
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                style={{ background: 'var(--accent-bg)' }}>
                <ScrollText size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <p className="flex-1 text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                Продолжая, вы соглашаетесь с{' '}
                <button type="button" onClick={() => setReading(true)}
                  className="underline underline-offset-2"
                  style={{ color: 'var(--accent)' }}>
                  правилами, офертой и согласием на обработку данных
                </button>
              </p>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setReading(true)}
                className="flex-1 rounded-2xl py-2.5 text-[13px] font-semibold"
                style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                Читать
              </button>
              {isTV ? (
                <TVFocusable id="legal-accept" scope="legal" onEnter={accept}>
                  {({ focused }) => (
                    <div className="flex-1 rounded-2xl py-2.5 text-center text-[13px] font-bold text-white"
                      style={{ background: 'var(--accent)', outline: focused ? '2px solid #fff' : 'none' }}>
                      Продолжить
                    </div>
                  )}
                </TVFocusable>
              ) : (
                <button type="button" onClick={accept}
                  className="flex-1 rounded-2xl py-2.5 text-[13px] font-bold text-white"
                  style={{ background: 'var(--accent)' }}>
                  Продолжить
                </button>
              )}
            </div>
          </div>
        </motion.div>,
        document.body,
      )}
    </>
  );
};

/**
 * Галочка при регистрации. Отдельно от окна выше: то — «вы это видели»,
 * а это — осознанное действие в момент, когда заводится аккаунт.
 */
export const LegalCheckbox = ({
  checked, onChange,
}: { checked: boolean; onChange: (v: boolean) => void }) => {
  const [reading, setReading] = useState(false);
  return (
    <>
      <AnimatePresence>{reading && <LegalReader onClose={() => setReading(false)} />}</AnimatePresence>
      <div className="flex items-start gap-2.5">
        <button type="button" role="checkbox" aria-checked={checked}
          aria-label="Согласие с документами"
          onClick={() => onChange(!checked)}
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md transition-colors"
          style={{
            background: checked ? 'var(--accent)' : 'transparent',
            border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-s)'}`,
          }}>
          {checked && (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 6.2 4.8 8.5 9.5 3.8" stroke="#fff" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          Я принимаю{' '}
          <button type="button" onClick={() => setReading(true)}
            className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>
            правила, оферту и согласие на обработку персональных данных
          </button>
        </p>
      </div>
    </>
  );
};

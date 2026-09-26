/* ===========================================================
   SKY TV — экранная клавиатура для входа
   Тот же принцип, что в TVSearch.tsx (TVFocusable-кнопки вместо
   нативного tabIndex), но с раскладками, нужными при входе:
   латиница+цифры для почты, кириллица/латиница для имени,
   латиница+цифры+"_" для ника. Между РУС/ABC можно переключаться —
   имя иногда вводят латиницей, ник только латиницей.
=========================================================== */
import { useState } from 'react';
import { Delete } from 'lucide-react';
import { TVFocusable } from '../TVFocusable';

const CYRILLIC_ROWS = ['ЙЦУКЕНГШЩЗХ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'];
const LATIN_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const EMAIL_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '@._-'];
const USERNAME_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm_'];

export type TVKeyboardMode = 'email' | 'name' | 'username';

interface TVKeyboardProps {
  idPrefix: string;
  mode: TVKeyboardMode;
  onChar: (c: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
}

export const TVKeyboard = ({ idPrefix, mode, onChar, onBackspace, onSubmit, submitLabel, submitDisabled }: TVKeyboardProps) => {
  // Только у имени есть смысл переключать язык — ник и почта латиницей всегда.
  const [latin, setLatin] = useState(mode !== 'name');
  const rows = mode === 'email' ? EMAIL_ROWS : mode === 'username' ? USERNAME_ROWS : latin ? LATIN_ROWS : CYRILLIC_ROWS;

  return (
    <div className="inline-flex flex-col gap-2 rounded-2xl p-4" style={{ background: 'var(--bg-l1)' }}>
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-2">
          {row.split('').map(c => (
            <TVFocusable key={c} id={`${idPrefix}-kb-${ri}-${c}`} onEnter={() => onChar(c)}>
              {({ focused }) => (
                <div className="grid h-11 w-11 place-items-center rounded-lg text-[16px] font-bold"
                  style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t1)' }}>
                  {c}
                </div>
              )}
            </TVFocusable>
          ))}
        </div>
      ))}
      <div className="flex gap-2">
        {mode === 'name' && (
          <TVFocusable id={`${idPrefix}-kb-lang`} onEnter={() => setLatin(v => !v)}>
            {({ focused }) => (
              <div className="grid h-11 place-items-center rounded-lg px-4 text-[13px] font-bold"
                style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t2)' }}>
                {latin ? 'РУС' : 'ABC'}
              </div>
            )}
          </TVFocusable>
        )}
        {mode === 'name' && (
          <TVFocusable id={`${idPrefix}-kb-space`} onEnter={() => onChar(' ')}>
            {({ focused }) => <div className="grid h-11 place-items-center rounded-lg px-10 text-[14px] font-bold" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t1)' }}>Пробел</div>}
          </TVFocusable>
        )}
        <TVFocusable id={`${idPrefix}-kb-back`} onEnter={onBackspace}>
          {({ focused }) => <div className="grid h-11 w-11 place-items-center rounded-lg" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)' }}><Delete size={17} color={focused ? '#fff' : 'var(--t1)'}/></div>}
        </TVFocusable>
        <TVFocusable id={`${idPrefix}-kb-submit`} disabled={submitDisabled} onEnter={onSubmit}>
          {({ focused }) => (
            <div className="grid h-11 flex-1 place-items-center rounded-lg px-6 text-[14px] font-bold text-white"
              style={{ background: submitDisabled ? 'var(--bg-l2)' : focused ? 'var(--accent)' : 'rgba(var(--accent-rgb,79,110,247),0.6)', opacity: submitDisabled ? 0.5 : 1 }}>
              {submitLabel}
            </div>
          )}
        </TVFocusable>
      </div>
    </div>
  );
};

/* ── цифровая клавиатура для кодов подтверждения ───────────────── */

interface TVKeypadProps {
  idPrefix: string;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
}

const KEYPAD_ROWS = ['123', '456', '789'];

export const TVKeypad = ({ idPrefix, onDigit, onBackspace, onSubmit, submitLabel, submitDisabled }: TVKeypadProps) => (
  <div className="inline-flex flex-col gap-2 rounded-2xl p-4" style={{ background: 'var(--bg-l1)' }}>
    {KEYPAD_ROWS.map((row, ri) => (
      <div key={ri} className="flex gap-2">
        {row.split('').map(d => (
          <TVFocusable key={d} id={`${idPrefix}-kp-${d}`} onEnter={() => onDigit(d)}>
            {({ focused }) => (
              <div className="grid h-12 w-12 place-items-center rounded-lg text-[18px] font-bold"
                style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t1)' }}>
                {d}
              </div>
            )}
          </TVFocusable>
        ))}
      </div>
    ))}
    <div className="flex gap-2">
      <TVFocusable id={`${idPrefix}-kp-back`} onEnter={onBackspace}>
        {({ focused }) => <div className="grid h-12 w-12 place-items-center rounded-lg" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)' }}><Delete size={18} color={focused ? '#fff' : 'var(--t1)'}/></div>}
      </TVFocusable>
      <TVFocusable id={`${idPrefix}-kp-0`} onEnter={() => onDigit('0')}>
        {({ focused }) => <div className="grid h-12 w-12 place-items-center rounded-lg text-[18px] font-bold" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t1)' }}>0</div>}
      </TVFocusable>
      <TVFocusable id={`${idPrefix}-kp-submit`} disabled={submitDisabled} onEnter={onSubmit}>
        {({ focused }) => (
          <div className="grid h-12 flex-1 place-items-center rounded-lg px-6 text-[14px] font-bold text-white"
            style={{ background: submitDisabled ? 'var(--bg-l2)' : focused ? 'var(--accent)' : 'rgba(var(--accent-rgb,79,110,247),0.6)', opacity: submitDisabled ? 0.5 : 1 }}>
            {submitLabel}
          </div>
        )}
      </TVFocusable>
    </div>
  </div>
);

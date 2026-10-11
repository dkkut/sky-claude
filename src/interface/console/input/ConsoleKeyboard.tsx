/* Экранная клавиатура для полей ввода любого сервиса (поиск, вход, сообщения).
   Пишет в настоящее поле и вызывает его обычные события — сервис ничего не знает о консоли. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Delete, Globe, ArrowBigUp, Check, X } from 'lucide-react';
import { consoleNav } from './nav';

const EN = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm@._-'];
const RU = ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю.,-'];

const setNative = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

export const ConsoleKeyboard = () => {
  const target = useSyncExternalStore(
    (cb) => consoleNav.subscribeKeyboard(cb),
    () => consoleNav.getEditTarget(),
    () => null,
  ) as (HTMLInputElement | HTMLTextAreaElement) | null;
  const [ru, setRu] = useState(false);
  const [caps, setCaps] = useState(false);
  const [text, setText] = useState('');
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    setText(target.value ?? '');
    const t = setTimeout(() => consoleNav.focusAuto(sheet.current ?? document), 60);
    return () => clearTimeout(t);
  }, [target]);

  if (!target) return null;
  const secret = (target as HTMLInputElement).type === 'password';
  const isArea = target instanceof HTMLTextAreaElement;
  const rows = ru ? RU : EN;

  const write = (v: string) => { setText(v); setNative(target, v); };
  const submit = () => {
    const form = target.closest('form');
    consoleNav.closeKeyboard();
    if (isArea) return;
    if (form && 'requestSubmit' in form) { try { form.requestSubmit(); return; } catch { /* нет */ } }
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  };
  const key = 'console-card flex h-14 min-w-[3.4rem] flex-1 items-center justify-center rounded-xl text-[22px] font-semibold text-white';
  const keyStyle = { background: 'rgba(255,255,255,0.1)' };

  return (
    <div className="fixed inset-0 z-[100001] flex items-end justify-center" data-console-keyboard style={{ background: 'rgba(3,3,12,0.6)', backdropFilter: 'blur(6px)' }}>
      <div ref={sheet} className="mb-10 w-[min(1100px,94vw)] rounded-[28px] p-5"
        style={{ background: 'rgba(12,12,26,0.96)', border: '1px solid rgba(160,150,255,0.25)' }}>
        <div className="mb-4 flex items-center gap-3 rounded-2xl px-5 py-3 text-[22px] text-white" style={{ background: 'rgba(255,255,255,0.07)', minHeight: 56 }} translate="no">
          <span className="min-w-0 flex-1 truncate">{secret ? '•'.repeat(text.length) : (text || <span className="text-white/35">{target.placeholder || ''}</span>)}</span>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              {row.split('').map((c) => {
                const ch = caps ? c.toUpperCase() : c;
                return (
                  <button key={c} type="button" className={key} style={keyStyle} aria-label={ch} translate="no"
                    onClick={() => write(text + ch)}>{ch}</button>
                );
              })}
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className={key} style={{ ...keyStyle, background: caps ? 'rgba(139,124,255,0.5)' : keyStyle.background }} aria-label="Заглавные" onClick={() => setCaps((v) => !v)}><ArrowBigUp size={22} /></button>
            <button type="button" className={key} style={keyStyle} aria-label="Язык" onClick={() => setRu((v) => !v)}><Globe size={20} /><span className="ml-2" translate="no">{ru ? 'RU' : 'EN'}</span></button>
            <button type="button" className={`${key} flex-[4]`} style={keyStyle} aria-label="Пробел" onClick={() => write(text + ' ')}>␣</button>
            <button type="button" className={key} style={keyStyle} aria-label="Стереть" onClick={() => write(text.slice(0, -1))}><Delete size={22} /></button>
            <button type="button" className={key} style={keyStyle} aria-label="Закрыть" onClick={() => consoleNav.closeKeyboard()}><X size={22} /></button>
            <button type="button" className={`${key} flex-[2]`} style={{ background: '#7c6cff' }} aria-label="Готово" onClick={submit}><Check size={22} /><span className="ml-2">Готово</span></button>
          </div>
        </div>
      </div>
    </div>
  );
};

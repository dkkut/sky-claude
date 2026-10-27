import React from 'react';
import { ChevronLeft } from 'lucide-react';

export const GLASS: React.CSSProperties = { background: 'linear-gradient(135deg, rgba(139,92,246,.10), rgba(56,189,248,.05))', border: '1px solid rgba(167,139,250,.18)', backdropFilter: 'blur(14px)' };
export const Pill = ({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-pressed={on} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold"
    style={{ background: on ? 'linear-gradient(135deg,#8b5cf6,#38bdf8)' : 'rgba(255,255,255,.06)', color: on ? '#fff' : 'var(--t2)', border: '1px solid rgba(167,139,250,.2)' }}>{children}</button>
);
export const Btn = ({ children, onClick, kind = 'primary', disabled, title }: { children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string }) => (
  <button type="button" disabled={disabled} title={title} onClick={onClick} className="rounded-full px-4 py-2 text-[13px] font-bold disabled:opacity-40"
    style={kind === 'primary' ? { background: 'linear-gradient(135deg,#8b5cf6,#38bdf8)', color: '#fff' } : kind === 'danger' ? { background: 'rgba(248,113,113,.15)', color: '#fca5a5', border: '1px solid rgba(248,113,113,.3)' } : { background: 'rgba(255,255,255,.07)', color: 'var(--t1)', border: '1px solid rgba(167,139,250,.2)' }}>{children}</button>
);
export const Back = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <div className="flex items-center gap-2 px-4 py-3 shrink-0">
    <button type="button" onClick={onClick} aria-label="Назад" className="glass-btn round"><ChevronLeft size={16} style={{ color: 'var(--t2)' }} /></button>
    <h2 className="text-[16px] font-extrabold" style={{ color: 'var(--t1)' }}>{title}</h2>
  </div>
);
export const Note = ({ children }: { children: React.ReactNode }) => <p className="text-[12px] leading-snug" style={{ color: 'var(--t3)' }}>{children}</p>;
export const Spinner = ({ text = 'Загрузка…' }: { text?: string }) => <p role="status" className="p-4 text-[13px]" style={{ color: 'var(--t3)' }}>{text}</p>;
export const ErrorBox = ({ text, onRetry }: { text: string; onRetry?: () => void }) => <div role="alert" className="m-4 rounded-2xl p-4 text-[13px]" style={{ background: 'rgba(248,113,113,.1)', color: '#fca5a5' }}>{text} {onRetry && <button type="button" className="underline" onClick={onRetry}>Повторить</button>}</div>;
export const Bar = ({ value }: { value: number }) => <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: 'linear-gradient(90deg,#8b5cf6,#38bdf8)' }} /></div>;
export const input = 'w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]';
export const inputStyle: React.CSSProperties = { borderColor: 'rgba(167,139,250,.25)', color: 'var(--t1)' };

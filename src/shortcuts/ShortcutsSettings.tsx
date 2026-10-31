import { useEffect, useState } from 'react';
import { Keyboard, Plus, Trash2 } from 'lucide-react';
import { useMessengerStore } from '@/messenger/store';
import { useShortcuts, comboOf, comboLabel, checkCombo, actionLabel, MODULE_ACTIONS, EXTRAS_ACTIONS, PLAYER_ACTIONS } from './shortcuts';

const field = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;

/** Блок «Горячие клавиши» в Профиль → Настройки (только компьютер). */
export default function ShortcutsSettings() {
  const { bindings, enabled, add, update, remove, setEnabled } = useShortcuts();
  const chats = useMessengerStore((s) => s.chats);
  const chatName = (id: string) => chats.find((c) => c.id === id)?.name;
  const [capturing, setCapturing] = useState<string | null>(null); // 'new' | id записи
  const [newCombo, setNewCombo] = useState('');
  const [newAction, setNewAction] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!capturing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { setCapturing(null); return; }
      const c = comboOf(e); if (!c) return;
      const ok = checkCombo(c);
      if (!ok.ok) { setMsg(ok.why); return; }
      if (capturing === 'new') { setNewCombo(c); setMsg(''); }
      else { const r = update(capturing, { combo: c }); setMsg(r.ok ? '' : r.why || ''); }
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, update]);

  const ActionSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm" style={field}>
      <option value="">Выберите действие…</option>
      <optgroup label="Разделы">{MODULE_ACTIONS.map((m) => <option key={m.id} value={`module:${m.id}`}>{m.label}</option>)}</optgroup>
      <optgroup label="Sky Media">{EXTRAS_ACTIONS.map((m) => <option key={m.id} value={`extras:${m.id}`}>{m.label}</option>)}</optgroup>
      <optgroup label="Плеер">{PLAYER_ACTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
      <optgroup label="Чаты">{chats.slice(0, 80).map((c) => <option key={c.id} value={`chat:${c.id}`} translate="no">{c.name}</option>)}</optgroup>
      {value.startsWith('chat:') && !chats.some((c) => `chat:${c.id}` === value) && <option value={value}>{actionLabel(value)}</option>}
    </select>
  );

  const keyBtn = (id: string, combo: string) => (
    <button type="button" data-shortcut-capture onClick={() => { setMsg(''); setCapturing(capturing === id ? null : id); }}
      className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium" style={{ ...field, borderColor: capturing === id ? 'var(--accent)' : 'var(--border)' }}>
      {capturing === id ? 'Нажмите сочетание…' : combo ? comboLabel(combo) : 'Назначить клавиши'}
    </button>
  );

  return (
    <div className="px-4 pb-3">
      <label className="flex items-center gap-2 py-2 text-sm" style={{ color: 'var(--t1)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}/>
        <Keyboard size={15}/> Горячие клавиши включены
      </label>
      <p className="pb-2 text-xs" style={{ color: 'var(--t3)' }}>
        Нужен Ctrl, Alt или Win/⌘ (либо клавиша F1–F12). Сочетания хранятся на этом устройстве. Некоторые сочетания с Alt могут занять браузер или система — тогда выберите другое.
      </p>
      <div className="space-y-2">
        {bindings.map((b) => (
          <div key={b.id} className="flex items-center gap-2">
            {keyBtn(b.id, b.combo)}
            <ActionSelect value={b.action} onChange={(v) => { const r = update(b.id, { action: v }); setMsg(r.ok ? '' : r.why || ''); }}/>
            <button type="button" aria-label="Удалить" onClick={() => remove(b.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={field}><Trash2 size={14}/></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          {keyBtn('new', newCombo)}
          <ActionSelect value={newAction} onChange={setNewAction}/>
          <button type="button" aria-label="Добавить" disabled={!newCombo || !newAction}
            onClick={() => { const r = add(newCombo, newAction); setMsg(r.ok ? '' : r.why || ''); if (r.ok) { setNewCombo(''); setNewAction(''); } }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}><Plus size={15}/></button>
        </div>
      </div>
      {msg && <p role="alert" className="pt-2 text-xs" style={{ color: '#f87171' }}>{msg}</p>}
    </div>
  );
}

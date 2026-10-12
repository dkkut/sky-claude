/**
 * Вкладка «Регистрация»: ограничение создания новых аккаунтов (Sky ID).
 * Вход уже зарегистрированных не затрагивается. Цифры — настоящие строки базы; правки пишутся в журнал администрации.
 * Сервер — server/registration.mjs, право `registration`.
 */
import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Loader2, Save } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Settings { enabled: boolean; dailyLimit: number; perIpLimit: number; perIpHours: number; message: string; updatedAt: string | null }
interface Overview {
  settings: Settings; open: boolean;
  stats: { lastHour: number; last24h: number; last7d: number; total: number; blocked24h: { closed: number; daily_limit: number; ip_limit: number } };
}

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

const Stat = ({ k, v }: { k: string; v: number }) => (
  <div className="rounded-xl p-3" style={{ background: C.l2 }}>
    <p className="text-lg font-bold tabular-nums" style={{ color: C.t1 }}>{v}</p>
    <p className="text-[10px]" style={{ color: C.t3 }}>{k}</p>
  </div>
);

export const RegistrationTab = () => {
  const [ov, setOv] = useState<Overview | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<Overview>('/api/admin/registration');
    if (!r.ok || !r.data) { setErr(r.error === 'not_allowed' ? 'Недостаточно прав.' : (r.reason ?? 'Не удалось загрузить')); return; }
    setErr(undefined); setOv(r.data); setForm(r.data.settings);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (err) return <p className="text-sm" style={{ color: C.red }}>{err}</p>;
  if (!ov || !form) return <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;

  const dirty = JSON.stringify(form) !== JSON.stringify(ov.settings);
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const save = async () => {
    setBusy(true);
    const r = await apiCall<{ settings: Settings }>('/api/admin/registration', {
      method: 'PUT',
      body: JSON.stringify({ dailyLimit: form.dailyLimit, perIpLimit: form.perIpLimit, perIpHours: form.perIpHours, message: form.message }),
    });
    setBusy(false);
    if (!r.ok) { flash(r.reason ?? 'Не удалось сохранить'); return; }
    flash('Сохранено'); void load();
  };

  const toggle = async () => {
    setBusy(true);
    const r = await apiCall<{ settings: Settings }>('/api/admin/registration', { method: 'PUT', body: JSON.stringify({ enabled: !ov.settings.enabled }) });
    setBusy(false); setConfirm(false);
    if (!r.ok) { flash(r.reason ?? 'Не удалось применить'); return; }
    flash(ov.settings.enabled ? 'Регистрация новых аккаунтов запрещена' : 'Регистрация снова разрешена'); void load();
  };

  const s = ov.stats;
  return (
    <div className="space-y-3">
      {/* Главная кнопка: действует сразу и для всех. Текст людям — из поля «Сообщение» ниже. */}
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${ov.settings.enabled ? C.brd : C.red}` }}>
        {confirm ? (
          <>
            <p className="text-sm" style={{ color: C.t1 }}>
              {ov.settings.enabled
                ? 'Новые люди не смогут создать аккаунт: после ввода почты Sky Island покажет баннер о запрете. Уже зарегистрированные входят как обычно. Запретить?'
                : 'Регистрация новых аккаунтов снова откроется для всех. Разрешить?'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirm(false)} className="rounded-xl py-2 text-sm font-semibold" style={{ background: C.l2, color: C.t2 }}>Отмена</button>
              <button type="button" disabled={busy} onClick={() => void toggle()} className="rounded-xl py-2 text-sm font-bold"
                style={{ background: ov.settings.enabled ? C.red : C.green, color: '#fff' }}>{ov.settings.enabled ? 'Да, запретить' : 'Да, разрешить'}</button>
            </div>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => setConfirm(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold" style={{ background: ov.settings.enabled ? C.red : C.green, color: '#fff' }}>
            <UserPlus size={15} /> {ov.settings.enabled ? 'Временно запретить регистрацию' : 'Снова разрешить регистрацию'}
          </button>
        )}
        <p className="text-[11px]" style={{ color: C.t3 }}>
          {ov.settings.enabled ? 'Кнопка действует сразу, без перезапуска.' : 'Сейчас новые аккаунты не создаются. Эту кнопку можно нажать в любой момент, чтобы открыть регистрацию.'}
        </p>
      </div>
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
          <UserPlus size={14} style={{ color: ov.open ? C.green : C.red }} />
          {ov.open ? 'Регистрация открыта' : 'Регистрация сейчас закрыта для новых людей'}
        </p>
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>
          Ограничение действует только при создании нового аккаунта. Те, кто уже зарегистрирован, входят как обычно.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat k="Новых за час" v={s.lastHour} />
          <Stat k="Новых за 24 часа" v={s.last24h} />
          <Stat k="Новых за 7 дней" v={s.last7d} />
          <Stat k="Всего аккаунтов" v={s.total} />
        </div>
        <p className="mt-3 text-[11px]" style={{ color: C.t3 }}>
          Отказов за 24 часа: закрыта — {s.blocked24h.closed} · предел в сутки — {s.blocked24h.daily_limit} · предел с адреса — {s.blocked24h.ip_limit}
        </p>
      </div>

      <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div>
          <p className="mb-1 text-[11px] font-semibold" style={{ color: C.t2 }}>Не больше новых аккаунтов за последние 24 часа (0 — без предела)</p>
          <input type="number" min={0} value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: num(e.target.value) })}
            className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Предел в сутки" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold" style={{ color: C.t2 }}>С одного адреса (0 — без предела)</p>
            <input type="number" min={0} value={form.perIpLimit} onChange={(e) => setForm({ ...form, perIpLimit: num(e.target.value) })}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Предел с одного адреса" />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold" style={{ color: C.t2 }}>за сколько часов (1–720)</p>
            <input type="number" min={1} max={720} value={form.perIpHours} onChange={(e) => setForm({ ...form, perIpHours: Math.min(720, Math.max(1, num(e.target.value))) })}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Часов для предела с адреса" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold" style={{ color: C.t2 }}>Сообщение людям (необязательно, до 300 знаков)</p>
          <textarea value={form.message} maxLength={300} rows={2} onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Например: набор откроется в понедельник" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Сообщение людям" />
        </div>
        <p className="text-[10px]" style={{ color: C.t3 }}>
          Адрес хранится только в виде хеша — для подсчёта «сколько с одного адреса». Предел с адреса не защищает от тех, кто меняет адрес, и может задеть людей за общим Wi-Fi или мобильным оператором.
        </p>
        <button type="button" disabled={!dirty || busy} onClick={() => void save()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Сохранить
        </button>
      </div>
    </div>
  );
};

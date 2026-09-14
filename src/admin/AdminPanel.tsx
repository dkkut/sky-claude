/**
 * Панель администратора Sky.
 *
 * Через неё управляется вся экосистема, и относиться к ней как к
 * обычной странице нельзя. Поэтому здесь важно, чего экран НЕ делает:
 *
 *   — не решает, что человеку можно. Список прав приходит с сервера, и
 *     нарисованная кнопка ничего не разрешает: нажатие всё равно уйдёт
 *     на сервер, а тот спросит базу;
 *   — не выполняет опасное сам. Выдача прав, смена роли и начисления
 *     оформляются заявкой, которую подтверждает владелец;
 *   — не хранит подтверждений. Код живёт минуты и тратится один раз.
 *
 * Скрытая кнопка защитой не является, поэтому спрятанное здесь спрятано
 * ради порядка на экране, а не ради безопасности.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Loader2, Check, X, KeyRound,
  Wallet, Crown, ScrollText, AlertTriangle, RefreshCw, Users,
} from 'lucide-react';
import {
  adminCall, errorText, ROLE_LABEL, PERMISSION_LABEL,
  type MyRights, type AdminRow, type PendingAction, type LogEntry, type SecurityEvent,
  type AdminPermission,
} from './adminWire';

const C = {
  bg: 'var(--bg-l1)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)',
};

const inputStyle = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

const fmtTs = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('ru', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/* ─── Подтверждение личности ───────────────────────────────────────── */

/**
 * Перед опасным сервер просит подтвердить, что за клавиатурой тот же
 * человек. Код приходит из приложения двухэтапной защиты или письмом —
 * решает сервер, а не этот экран: дать выбор способа значило бы дать
 * выбрать самый слабый.
 */
const StepUp = ({ purpose, onCode, onCancel }: {
  purpose: string;
  onCode: (code: string) => void;
  onCancel: () => void;
}) => {
  const [method, setMethod] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    void adminCall({ action: 'step-up', purpose }).then((r) => {
      if (!alive) return;
      setBusy(false);
      if (r.type === 'admin-step-up') setMethod(r.payload.method ?? null);
      else setFailed(errorText(r.payload?.error));
    });
    return () => { alive = false; };
  }, [purpose]);

  return (
    <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.acc}` }}>
      <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
        <KeyRound size={13} style={{ color: C.acc }} /> Подтвердите личность
      </p>

      {busy && <Loader2 size={14} className="mt-2 animate-spin" style={{ color: C.t3 }} />}
      {failed && <p className="mt-1.5 text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {method && (
        <>
          <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>
            {method === 'app'
              ? 'Введите код из приложения двухэтапной защиты.'
              : 'Код отправлен на вашу почту. Он действует пять минут.'}
          </p>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" placeholder="000000"
              className="flex-1 rounded-xl px-3 py-2 text-sm tracking-widest outline-none" style={inputStyle} />
            <button type="button" disabled={code.length < 6} onClick={() => onCode(code)}
              className="rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: C.acc, color: '#fff' }}>
              Подтвердить
            </button>
          </div>
        </>
      )}

      <button type="button" onClick={onCancel}
        className="mt-2 text-[11px]" style={{ color: C.t3 }}>Отмена</button>
    </div>
  );
};

/* ─── Начисления ───────────────────────────────────────────────────── */

type GrantWhat = 'money' | 'points' | 'prime';

const GRANT_LABEL: Record<GrantWhat, string> = {
  money: 'Деньги, ₽', points: 'Баллы', prime: 'Prime, дней',
};

/**
 * Начислить на счёт: деньги, баллы или Prime.
 *
 * Само начисление здесь не происходит. Экран оформляет заявку, и деньги
 * появляются на счету только после того, как владелец повернёт второй
 * ключ. Деньги из ничего — это ровно то, ради чего административный
 * аккаунт и крадут.
 */
const GrantForm = ({ onSent }: { onSent: () => void }) => {
  const [what, setWhat] = useState<GrantWhat>('money');
  const [userId, setUserId] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(false);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');

  const send = async (code: string) => {
    setStep(false); setFailed(''); setSent('');
    const n = Number(value);
    const r = await adminCall({
      action: 'grant', what, userId: userId.trim(), code, reason: reason.trim(),
      ...(what === 'prime' ? { days: n } : { amount: n }),
    });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка отправлена владельцу на подтверждение. '
      + 'Деньги появятся на счету только после того, как он её подтвердит.');
    setValue(''); setReason('');
    onSent();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
        <Wallet size={13} style={{ color: C.acc }} /> Начислить на счёт
      </p>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Начисление проходит в два ключа: вы оформляете заявку, подтверждает владелец.
        В одиночку деньги не появятся ни у кого, включая вас.
      </p>

      <div className="flex gap-1">
        {(Object.keys(GRANT_LABEL) as GrantWhat[]).map((k) => (
          <button key={k} type="button" onClick={() => setWhat(k)}
            className="flex-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{ background: what === k ? C.acc : C.l2, color: what === k ? '#fff' : C.t3 }}>
            {GRANT_LABEL[k]}
          </button>
        ))}
      </div>

      <input value={userId} onChange={(e) => setUserId(e.target.value)}
        placeholder="Идентификатор профиля получателя (acc-…)"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        inputMode="numeric" placeholder={GRANT_LABEL[what]}
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
      <input value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Основание — его увидит владелец"
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {step ? (
        <StepUp purpose={`pending:grant_${what}`} onCode={(c) => void send(c)}
          onCancel={() => setStep(false)} />
      ) : (
        <button type="button"
          disabled={!userId.trim() || !value || Number(value) <= 0}
          onClick={() => { setFailed(''); setSent(''); setStep(true); }}
          className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          Оформить заявку
        </button>
      )}
    </div>
  );
};

/* ─── Очередь заявок ───────────────────────────────────────────────── */

const STATUS_LABEL: Record<PendingAction['status'], string> = {
  pending: 'Ждёт владельца', approved: 'Подтверждена', rejected: 'Отклонена',
  executed: 'Выполнена', failed: 'Не выполнена', expired: 'Просрочена',
};

const PendingList = ({ rights, actions, onChanged }: {
  rights: MyRights; actions: PendingAction[]; onChanged: () => void;
}) => {
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState('');

  const decide = async (code: string) => {
    if (!deciding) return;
    const { id, approve } = deciding;
    setDeciding(null); setFailed('');
    const r = await adminCall({ action: 'decide', id, approve, code, note: note.trim() });
    if (r.type !== 'admin-done') setFailed(errorText(r.payload?.error));
    setNote('');
    onChanged();
  };

  if (actions.length === 0) {
    return <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Заявок нет.</p>;
  }

  return (
    <div className="space-y-2">
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {actions.map((a) => (
        <div key={a.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{a.title}</p>
            <span className="shrink-0 text-[10px] font-bold" style={{
              color: a.status === 'executed' ? C.green
                : a.status === 'pending' ? C.amber : C.t3,
            }}>{STATUS_LABEL[a.status]}</span>
          </div>

          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {a.actorName ? `от ${a.actorName}` : ''}
            {a.targetName ? ` · кому: ${a.targetName}` : ''} · {fmtTs(a.createdAt)}
          </p>

          {Object.keys(a.payload).length > 0 && (
            <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
              {Object.entries(a.payload).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </p>
          )}
          {a.reason && <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>Основание: {a.reason}</p>}
          {a.outcome && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Итог: {a.outcome}</p>}

          {rights.owner && a.status === 'pending' && (
            deciding?.id === a.id ? (
              <div className="mt-2 space-y-2">
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Примечание к решению"
                  className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
                <StepUp purpose="pending:decide" onCode={(c) => void decide(c)}
                  onCancel={() => setDeciding(null)} />
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => { setDeciding({ id: a.id, approve: true }); setNote(''); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                  style={{ background: C.green, color: '#fff' }}>
                  <Check size={12} /> Подтвердить
                </button>
                <button type="button" onClick={() => { setDeciding({ id: a.id, approve: false }); setNote(''); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                  style={{ background: C.l2, color: C.red }}>
                  <X size={12} /> Отклонить
                </button>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
};

/* ─── Администраторы и роли ────────────────────────────────────────── */

const AdminsList = ({ admins, roles, onChanged }: {
  admins: AdminRow[]; roles: string[]; onChanged: () => void;
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [role, setRole] = useState('read_only_admin');
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState('');

  const send = async (code: string) => {
    const id = editing;
    setEditing(null); setFailed(''); setSent('');
    const r = await adminCall({ action: 'set-role', userId: id, role, code });
    if (r.type !== 'admin-pending') { setFailed(errorText(r.payload?.error)); return; }
    setSent('Заявка на смену роли отправлена владельцу.');
    onChanged();
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Роль определяет, что человеку доступно. Сменить её в одиночку нельзя:
        заявку подтверждает владелец.
      </p>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {sent && <p className="text-[11px]" style={{ color: C.green }}>{sent}</p>}

      {admins.map((a) => (
        <div key={a.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>
                {a.owner && <Crown size={11} style={{ color: C.amber, display: 'inline', marginRight: 4 }} />}
                {a.name} <span className="font-normal" style={{ color: C.t3 }}>@{a.username}</span>
              </p>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                {ROLE_LABEL[a.role] ?? a.role}
                {a.banned && <span style={{ color: C.red }}> · ограничен</span>}
              </p>
            </div>
            {!a.owner && (
              <button type="button" onClick={() => { setEditing(a.id); setRole(a.role === 'super_admin' ? 'read_only_admin' : a.role); }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
                style={{ background: C.l2, color: C.t2 }}>
                Роль
              </button>
            )}
          </div>

          {a.legacy && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[10px]" style={{ color: C.amber }}>
              <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              Роль не назначена — права шире, чем нужно для работы. Назначьте подходящую.
            </p>
          )}

          {editing === a.id && (
            <div className="mt-2 space-y-2">
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
              </select>
              <StepUp purpose="pending:role_set" onCode={(c) => void send(c)}
                onCancel={() => setEditing(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/* ─── Панель ───────────────────────────────────────────────────────── */

type Tab = 'overview' | 'pending' | 'admins' | 'grant' | 'log' | 'events';

export const AdminPanel = () => {
  const [rights, setRights] = useState<MyRights | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [integrity, setIntegrity] = useState<{ intact: boolean; checked: number } | null>(null);
  const [lockStep, setLockStep] = useState(false);
  const [failed, setFailed] = useState('');

  const loadRights = useCallback(async () => {
    const r = await adminCall({ action: 'whoami' });
    /* Панель рисует то, что ответил сервер, и ничего сверх: поля,
       которых он не прислал, означают «нет», а не «наверное, есть». */
    setRights(r.type === 'admin-me' ? {
      admin: r.payload.admin === true,
      owner: r.payload.owner === true,
      role: r.payload.role ?? null,
      roleLabel: r.payload.roleLabel ?? '',
      permissions: r.payload.permissions ?? [],
      legacy: r.payload.legacy === true,
      lockdown: r.payload.lockdown ?? { active: false, reason: '', since: null },
    } : {
      admin: false, owner: false, role: null, roleLabel: '',
      permissions: [], legacy: false,
      lockdown: { active: false, reason: '', since: null },
    });
  }, []);

  useEffect(() => { void loadRights(); }, [loadRights]);

  const has = (p: AdminPermission) => rights?.permissions?.includes(p) ?? false;

  const loadPending = useCallback(async () => {
    const r = await adminCall({ action: 'pending', limit: 50 });
    if (r.type === 'admin-pending-list') setActions(r.payload.actions ?? []);
  }, []);

  const loadAdmins = useCallback(async () => {
    const r = await adminCall({ action: 'admins' });
    if (r.type === 'admin-list') {
      setAdmins(r.payload.admins ?? []);
      setRoles(r.payload.roles ?? []);
    }
  }, []);

  const loadLog = useCallback(async () => {
    const r = await adminCall({ action: 'log', limit: 100 });
    if (r.type === 'admin-log') setLog(r.payload.entries ?? []);
  }, []);

  const loadEvents = useCallback(async () => {
    const r = await adminCall({ action: 'security-events', limit: 100 });
    if (r.type === 'admin-security-events') setEvents(r.payload.events ?? []);
  }, []);

  useEffect(() => {
    if (tab === 'pending') void loadPending();
    if (tab === 'admins') void loadAdmins();
    if (tab === 'log') void loadLog();
    if (tab === 'events') void loadEvents();
  }, [tab, loadPending, loadAdmins, loadLog, loadEvents]);

  const setLockdown = async (code: string, on: boolean) => {
    setLockStep(false); setFailed('');
    const r = await adminCall({ action: 'set-lockdown', on, code, reason: 'Из панели' });
    if (r.type !== 'admin-lockdown') { setFailed(errorText(r.payload?.error)); return; }
    void loadRights();
  };

  if (!rights) {
    return <div className="grid place-items-center py-12"><Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} /></div>;
  }

  if (!rights.admin) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <Shield size={22} style={{ color: C.t3 }} />
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Панель закрыта</p>
        <p className="max-w-[260px] text-xs" style={{ color: C.t3 }}>
          Доступ выдаёт владелец сервиса.
        </p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Обзор', show: true },
    { key: 'pending', label: 'Заявки', show: true },
    { key: 'grant', label: 'Начисления', show: has('finance') },
    { key: 'admins', label: 'Администраторы', show: has('security') },
    { key: 'log', label: 'Журнал', show: has('security') },
    { key: 'events', label: 'События', show: has('security') },
  ];

  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TABS.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: tab === t.key ? C.acc : C.l2, color: tab === t.key ? '#fff' : C.t3 }}>
            {t.label}
          </button>
        ))}
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {rights.lockdown.active && (
        <div className="flex items-start gap-2 rounded-2xl p-3"
          style={{ background: 'rgba(255,80,80,0.08)', border: `1px solid ${C.red}` }}>
          <ShieldAlert size={14} style={{ color: C.red, flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-xs font-bold" style={{ color: C.red }}>Аварийный режим</p>
            <p className="text-[11px]" style={{ color: C.t2 }}>
              Административные действия закрыты с {fmtTs(rights.lockdown.since)}.
              Обычная работа сервиса продолжается.
            </p>
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="flex items-center gap-2 text-xs font-bold" style={{ color: C.t1 }}>
              {rights.owner ? <Crown size={13} style={{ color: C.amber }} />
                : <ShieldCheck size={13} style={{ color: C.acc }} />}
              {rights.roleLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {rights.permissions.map((p) => (
                <span key={p} className="rounded-lg px-2 py-0.5 text-[10px]"
                  style={{ background: C.l2, color: C.t2 }}>
                  {PERMISSION_LABEL[p] ?? p}
                </span>
              ))}
              {rights.permissions.length === 0 && (
                <span className="text-[10px]" style={{ color: C.t3 }}>Только чтение</span>
              )}
            </div>
            {rights.legacy && (
              <p className="mt-2 flex items-start gap-1.5 text-[10px]" style={{ color: C.amber }}>
                <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                Роль не назначена, поэтому права полные — так было до появления ролей.
                Попросите владельца назначить подходящую.
              </p>
            )}
          </div>

          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>КАК УСТРОЕНА ПАНЕЛЬ</p>
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: C.t2 }}>
              Опасное делается в два ключа: администратор оформляет заявку, подтверждает
              владелец. Перед оформлением сервер спрашивает подтверждение личности —
              украденная сессия не должна сразу открывать критические действия.
              Каждое действие попадает в журнал, скреплённый цепочкой отпечатков.
            </p>
          </div>

          {rights.owner && (
            <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[10px] font-bold" style={{ color: C.t3 }}>АВАРИЙНЫЙ РЕЖИМ</p>
              <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
                Закрывает панель целиком и отключает открытые административные подключения.
                Обычная жизнь сервиса при этом продолжается.
              </p>
              {lockStep ? (
                <div className="mt-2">
                  <StepUp purpose="lockdown"
                    onCode={(c) => void setLockdown(c, !rights.lockdown.active)}
                    onCancel={() => setLockStep(false)} />
                </div>
              ) : (
                <button type="button" onClick={() => setLockStep(true)}
                  className="mt-2 w-full rounded-xl py-2.5 text-xs font-bold"
                  style={{
                    background: rights.lockdown.active ? C.l2 : C.red,
                    color: rights.lockdown.active ? C.green : '#fff',
                  }}>
                  {rights.lockdown.active ? 'Снять аварийный режим' : 'Включить аварийный режим'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'pending' && (
        <>
          <button type="button" onClick={() => void loadPending()}
            className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
            <RefreshCw size={11} /> Обновить
          </button>
          <PendingList rights={rights} actions={actions} onChanged={() => void loadPending()} />
        </>
      )}

      {tab === 'grant' && <GrantForm onSent={() => void loadPending()} />}

      {tab === 'admins' && (
        <>
          <p className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: C.t3 }}>
            <Users size={11} /> АДМИНИСТРАТОРЫ
          </p>
          <AdminsList admins={admins} roles={roles} onChanged={() => void loadAdmins()} />
        </>
      )}

      {tab === 'log' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void loadLog()}
              className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
              <RefreshCw size={11} /> Обновить
            </button>
            <button type="button"
              onClick={() => void adminCall({ action: 'verify-log' }).then((r) => {
                if (r.type === 'admin-log-verified') {
                  setIntegrity({
                    intact: r.payload.intact === true,
                    checked: r.payload.checked ?? 0,
                  });
                }
              })}
              className="flex items-center gap-1.5 text-[11px]" style={{ color: C.acc }}>
              <ScrollText size={11} /> Проверить целостность
            </button>
          </div>

          {integrity && (
            <p className="text-[11px]" style={{ color: integrity.intact ? C.green : C.red }}>
              {integrity.intact
                ? `Цепочка цела, проверено записей: ${integrity.checked}`
                : 'Цепочка расходится — журнал правили. Это само по себе событие безопасности.'}
            </p>
          )}

          {log.map((e) => (
            <div key={e.id} className="rounded-xl px-3 py-2"
              style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold" style={{
                  color: e.result === 'ok' ? C.t1 : C.red,
                }}>{e.type}</p>
                <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}</span>
              </div>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                {e.actorRole ? `${ROLE_LABEL[e.actorRole] ?? e.actorRole} · ` : ''}
                {e.result !== 'ok' ? `${e.result} · ` : ''}{e.detail}
              </p>
            </div>
          ))}
          {log.length === 0 && (
            <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Журнал пуст.</p>
          )}
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-2">
          <button type="button" onClick={() => void loadEvents()}
            className="flex items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
            <RefreshCw size={11} /> Обновить
          </button>
          {events.map((e) => (
            <div key={e.id} className="rounded-xl px-3 py-2"
              style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold" style={{ color: C.t1 }}>{e.kind}</p>
                <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(e.createdAt)}</span>
              </div>
              {e.detail && <p className="text-[10px]" style={{ color: C.t3 }}>{e.detail}</p>}
            </div>
          ))}
          {events.length === 0 && (
            <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Событий нет.</p>
          )}
        </div>
      )}
    </div>
  );
};

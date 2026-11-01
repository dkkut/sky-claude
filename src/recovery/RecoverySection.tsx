/**
 * Профиль → Sky ID → «Восстановление»: резервная почта, резервные коды, сессии, история восстановления,
 * для администратора — токен восстановления («Административный доступ Sky»), для владельца — секрет владельца.
 * Сервер: server/routes/recovery.mjs (/api/skyid/recovery*). Секреты показываются один раз и в хранилищах клиента не сохраняются.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Mail, ShieldCheck, KeyRound, Crown, Copy, Download, LogOut, Loader2, ExternalLink, Check } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Overview {
  primaryEmail: { masked: string; verified: boolean } | null; primaryPhone: { verified: boolean } | null;
  backupEmail: { masked: string; verifiedAt: string | null; usableAfter: string | null } | null; pendingBackupEmail: { masked: string; expiresAt: string } | null;
  twoFactor: { enabled: boolean; method: string }; backupCodesLeft: number; sessions: number;
  history: { kind: string; event: string; factor?: string; result: string; at: string }[]; holdHours: number;
  adminToken: { exists: boolean; pendingReveal?: boolean; createdAt?: string; revealedAt?: string | null; lastUsedAt?: string | null };
  isAdmin: boolean; isOwner: boolean; ownerSecret?: { set: boolean; setAt?: string; locked?: boolean };
}
const EVENTS: Record<string, string> = {
  started: 'Запрос восстановления', factor_ok: 'Фактор подтверждён', factor_failed: 'Неудачная проверка', completed: 'Доступ восстановлен', waiting_started: 'Назначено ожидание',
  cancelled_by_owner: 'Запрос отменён владельцем', backup_email_started: 'Начата смена резервной почты', backup_email_confirmed: 'Резервная почта подтверждена', sessions_ended: 'Сессии завершены',
  admin_token_issued: 'Выпущен токен администратора', admin_token_revealed: 'Токен администратора показан', admin_token_revoked: 'Токен администратора отозван', owner_secret_set: 'Секрет владельца изменён',
  email_code_sent: 'Код отправлен на резервную почту', session_issued: 'Выдана новая сессия', case_created: 'Создано обращение в поддержку',
};
const ERR: Record<string, string> = {
  invalid_code: 'Код не подошёл.', two_factor_required: 'Введите код приложения.', guard_code_required: 'Введите код подтверждения.', same_as_primary: 'Резервная почта должна отличаться от основной.',
  invalid_email: 'Проверьте адрес почты.', cannot_prove_ownership: 'Нечем подтвердить владение. Подтвердите основную почту или включите аутентификатор.', too_many_requests: 'Слишком часто. Подождите.',
  step_up_invalid: 'Код не подошёл.', step_up_required: 'Нужен код подтверждения.', weak_secret: 'Секрет слишком простой: от 20 знаков, с буквами и цифрами.', owner_only: 'Только для владельца.',
  nothing_to_show: 'Показывать нечего: токен уже был показан. Выпустите новый.', not_allowed: 'Недостаточно прав.',
};
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const Box = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <section className="rounded-2xl p-4 mb-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
    <p className="flex items-center gap-2 text-sm font-black mb-2" style={{ color: 'var(--t1)' }}>{icon}{title}</p>{children}
  </section>
);
const In = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none mt-2" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)' }} />
);
const Btn = ({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'plain' | 'red' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-40 mr-2 mt-2"
    style={tone === 'plain' ? { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: 'var(--red)' } : { background: 'var(--accent)', color: '#fff' }}>{children}</button>
);
const errText = (e?: string) => ERR[e ?? ''] ?? 'Не получилось. Попробуйте ещё раз.';

export const RecoverySection = () => {
  const [o, setO] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<Overview>('/api/skyid/recovery'); if (r.ok && r.data) { setO(r.data); setFailed(false); } else setFailed(true); }, []);
  useEffect(() => { void load(); }, [load]);

  // резервная почта
  const [email, setEmail] = useState(''); const [guard, setGuard] = useState(''); const [guardSent, setGuardSent] = useState(false); const [tf, setTf] = useState(''); const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string[] | null>(null);
  const [codeTf, setCodeTf] = useState('');
  // токен администратора / секрет владельца
  const [step, setStep] = useState<null | { purpose: 'admin' | 'owner'; action: 'reveal' | 'rotate' | 'secret' }>(null);
  const [stepCode, setStepCode] = useState(''); const [stepMethod, setStepMethod] = useState('app'); const [secret, setSecret] = useState('');
  const [token, setToken] = useState<string | null>(null); const [saved, setSaved] = useState(false);

  if (failed) return <p className="text-sm" style={{ color: 'var(--red)' }}>Не удалось загрузить. Проверьте связь и попробуйте позже.</p>;
  if (!o) return <Loader2 size={18} className="animate-spin" style={{ color: 'var(--t3)' }} />;
  const needGuard = !o.twoFactor.enabled;

  const sendGuard = async () => { setBusy(true); const r = await apiCall('/api/skyid/recovery/guard-code', { method: 'POST', body: '{}' }); setBusy(false); if (r.ok) { setGuardSent(true); flash('Код отправлен'); } else flash(errText(r.error)); };
  const setBackup = async () => {
    setBusy(true);
    const r = await apiCall<{ masked: string }>('/api/skyid/recovery/backup-email', { method: 'POST', body: JSON.stringify({ email, ...(needGuard ? { guardCode: guard } : { twoFactorCode: tf }) }) });
    setBusy(false);
    if (!r.ok) return flash(errText(r.error));
    flash(`Письмо со ссылкой отправлено на ${r.data?.masked}`); setEmail(''); setGuard(''); setTf(''); void load();
  };
  const makeCodes = async () => {
    const r = await apiCall<{ codes: string[] }>('/api/skyid/recovery/backup-codes', { method: 'POST', body: JSON.stringify({ twoFactorCode: codeTf }) });
    if (!r.ok) return flash(errText(r.error));
    setShown(r.data?.codes ?? null); setCodeTf(''); void load();
  };
  const endOthers = async () => { const r = await apiCall<{ ended: number }>('/api/skyid/recovery/end-other-sessions', { method: 'POST', body: '{}' }); flash(r.ok ? `Завершено сеансов: ${r.data?.ended ?? 0}` : errText(r.error)); void load(); };
  const download = (name: string, lines: string[]) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

  const startStep = async (purpose: 'admin' | 'owner', action: 'reveal' | 'rotate' | 'secret') => {
    const r = await apiCall<{ method?: string }>(purpose === 'admin' ? '/api/skyid/recovery/admin-token/step-up' : '/api/skyid/recovery/owner-secret/step-up', { method: 'POST', body: '{}' });
    if (!r.ok) return flash(errText(r.error));
    setStepMethod(r.data?.method ?? 'app'); setStepCode(''); setStep({ purpose, action });
  };
  const runStep = async () => {
    if (!step) return; setBusy(true);
    if (step.purpose === 'owner') {
      const r = await apiCall('/api/skyid/recovery/owner-secret', { method: 'POST', body: JSON.stringify({ secret, stepUpCode: stepCode }) });
      setBusy(false); if (!r.ok) return flash(errText(r.error));
      flash('Секрет владельца сохранён'); setSecret(''); setStep(null); void load(); return;
    }
    const r = await apiCall<{ token: string }>(`/api/skyid/recovery/admin-token/${step.action}`, { method: 'POST', body: JSON.stringify({ stepUpCode: stepCode }) });
    setBusy(false); if (!r.ok) return flash(errText(r.error));
    setToken(r.data?.token ?? null); setSaved(false); setStep(null); void load();
  };

  return (
    <div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--t3)' }}>Здесь настраивается всё, что поможет вернуть доступ, если вы потеряете телефон или почту. Сайт восстановления работает, даже когда обычный вход недоступен.</p>

      <Box icon={<Mail size={16} />} title="Резервная почта">
        <p className="text-xs" style={{ color: 'var(--t2)' }}>
          Основная почта: {o.primaryEmail ? `${o.primaryEmail.masked}${o.primaryEmail.verified ? '' : ' (не подтверждена)'}` : 'не указана'}.{' '}
          Резервная: {o.backupEmail ? <b translate="no">{o.backupEmail.masked}</b> : 'не добавлена'}
          {o.backupEmail?.verifiedAt ? `, подтверждена ${dt(o.backupEmail.verifiedAt)}` : ''}.
        </p>
        {o.backupEmail?.usableAfter && <p className="text-xs mt-1" style={{ color: 'var(--amber, #f59e0b)' }}>{`Для восстановления адрес заработает после ${dt(o.backupEmail.usableAfter)} (защита от подмены).`}</p>}
        {o.pendingBackupEmail && <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>{`Ждёт подтверждения письмом: ${o.pendingBackupEmail.masked} (до ${dt(o.pendingBackupEmail.expiresAt)}).`}</p>}
        {!o.backupEmail && <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Добавьте резервную почту — она поможет вернуть доступ при потере основных способов входа.</p>}
        <In type="email" placeholder="Новая резервная почта" aria-label="Новая резервная почта" value={email} onChange={(e) => setEmail(e.target.value)} />
        {needGuard ? (
          <>
            <Btn tone="plain" disabled={busy} onClick={() => void sendGuard()}>{guardSent ? 'Отправить код ещё раз' : 'Получить код подтверждения'}</Btn>
            {guardSent && <In inputMode="numeric" placeholder="Код из письма или SMS" aria-label="Код подтверждения" value={guard} onChange={(e) => setGuard(e.target.value)} />}
          </>
        ) : <In inputMode="numeric" placeholder="Код приложения-аутентификатора" aria-label="Код аутентификатора" value={tf} onChange={(e) => setTf(e.target.value)} />}
        <Btn disabled={busy || !email.trim() || (needGuard ? !guard : !tf)} onClick={() => void setBackup()}>{o.backupEmail ? 'Начать смену резервной почты' : 'Добавить резервную почту'}</Btn>
      </Box>

      <Box icon={<ShieldCheck size={16} />} title="Двухфакторная защита и резервные коды">
        <p className="text-xs" style={{ color: 'var(--t2)' }}>Аутентификатор: {o.twoFactor.enabled ? 'включён' : 'выключен (включается во вкладке «Защита»)'}. Неиспользованных резервных кодов: {o.backupCodesLeft}.</p>
        {o.twoFactor.enabled && (
          <>
            <In inputMode="numeric" placeholder="Код приложения для создания новых кодов" aria-label="Код приложения" value={codeTf} onChange={(e) => setCodeTf(e.target.value)} />
            <Btn disabled={!codeTf.trim()} onClick={() => void makeCodes()}>Создать резервные коды</Btn>
            <p className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>Новый набор отменяет прежний. Коды показываются один раз.</p>
          </>
        )}
        {shown && (
          <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold mb-2" style={{ color: 'var(--t1)' }}>Сохраните коды — повторно они не покажутся</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm" translate="no" style={{ color: 'var(--t1)' }}>{shown.map((c) => <span key={c}>{c}</span>)}</div>
            <Btn tone="plain" onClick={() => download('sky-backup-codes.txt', ['Резервные коды Sky ID (каждый действует один раз)', ...shown])}><Download size={12} className="inline mr-1" />Сохранить в файл</Btn>
            <Btn tone="plain" onClick={() => setShown(null)}>Я сохранил коды</Btn>
          </div>
        )}
      </Box>

      <Box icon={<LogOut size={16} />} title="Сессии">
        <p className="text-xs" style={{ color: 'var(--t2)' }}>Активных сессий: {o.sessions}.</p>
        <Btn tone="red" onClick={() => void endOthers()}>Завершить все остальные сеансы</Btn>
      </Box>

      {o.isAdmin && (
        <Box icon={<KeyRound size={16} />} title="Административный доступ Sky: токен восстановления">
          <p className="text-xs" style={{ color: 'var(--t2)' }}>
            {o.adminToken.exists ? `Токен создан ${dt(o.adminToken.createdAt)}${o.adminToken.pendingReveal ? ' и ждёт, пока вы его сохраните.' : '; значение уже было показано.'}` : 'Токен ещё не выпущен.'} Потерянный токен восстановить нельзя — можно только выпустить новый.
          </p>
          {o.adminToken.pendingReveal && <Btn disabled={!!step} onClick={() => void startStep('admin', 'reveal')}>Показать токен (один раз)</Btn>}
          <Btn tone="plain" disabled={!!step} onClick={() => void startStep('admin', 'rotate')}>{o.adminToken.exists ? 'Выпустить новый токен' : 'Получить токен'}</Btn>
        </Box>
      )}
      {o.isOwner && (
        <Box icon={<Crown size={16} />} title="Секрет владельца">
          <p className="text-xs" style={{ color: 'var(--t2)' }}>{o.ownerSecret?.set ? `Секрет задан ${dt(o.ownerSecret.setAt)}. Он нигде не показывается и не хранится открытым.` : 'Секрет не задан: без него экстренное восстановление владельца невозможно.'}</p>
          <In type="password" placeholder="Новый секрет (от 20 знаков, буквы и цифры)" aria-label="Секрет владельца" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
          <Btn disabled={secret.length < 20 || !!step} onClick={() => void startStep('owner', 'secret')}>{o.ownerSecret?.set ? 'Заменить секрет' : 'Задать секрет'}</Btn>
        </Box>
      )}

      {step && (
        <Box icon={<KeyRound size={16} />} title="Подтвердите личность">
          <p className="text-xs" style={{ color: 'var(--t2)' }}>{'Введите код из приложения-аутентификатора.'}</p>
          <In inputMode="numeric" placeholder="000000" aria-label="Код подтверждения личности" value={stepCode} onChange={(e) => setStepCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <Btn disabled={busy || stepCode.length < 6} onClick={() => void runStep()}>Подтвердить</Btn><Btn tone="plain" onClick={() => setStep(null)}>Отмена</Btn>
        </Box>
      )}
      {token && (
        <div className="fixed inset-0 z-[10050] grid place-items-center px-4" style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-[460px] rounded-3xl p-5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }} role="dialog" aria-modal="true" aria-label="Административный доступ Sky">
            <p className="flex items-center gap-2 text-base font-black" style={{ color: 'var(--t1)' }}><Crown size={18} />Административный доступ Sky</p>
            <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>Токен восстановления создан. Он показывается один раз.</p>
            <div className="mt-3 rounded-xl p-3 font-mono text-sm break-all select-all" translate="no" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>{token}</div>
            <Btn tone="plain" onClick={() => { void navigator.clipboard?.writeText(token); flash('Скопировано'); }}><Copy size={12} className="inline mr-1" />Копировать</Btn>
            <Btn tone="plain" onClick={() => download('sky-admin-recovery-token.txt', ['Токен восстановления администратора Sky (храните отдельно от телефона)', token])}><Download size={12} className="inline mr-1" />В файл</Btn>
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--amber, #f59e0b)' }}>Токен нельзя восстановить из базы данных: в ней хранится только его хеш. Никому его не сообщайте — токен сам не даёт доступа, но нужен для восстановления вашего административного аккаунта. Храните в менеджере паролей или в бумажной копии в надёжном месте.</p>
            <label className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--t1)' }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />Я сохранил токен</label>
            <Btn disabled={!saved} onClick={() => { setToken(null); setSaved(false); }}><Check size={12} className="inline mr-1" />Готово</Btn>
          </div>
        </div>
      )}

      <Box icon={<ShieldCheck size={16} />} title="История восстановления доступа">
        {o.history.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Событий пока не было.</p> : (
          <ul className="space-y-1">{o.history.map((h, i) => <li key={i} className="text-xs flex flex-wrap gap-2" style={{ color: h.result === 'ok' ? 'var(--t2)' : 'var(--red)' }}><span>{dt(h.at)}</span><span>{EVENTS[h.event] ?? h.event}</span>{h.factor && <span style={{ color: 'var(--t3)' }}>{h.factor}</span>}</li>)}</ul>
        )}
        <a href="https://recovery.skymessenger.online" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold mt-3" style={{ color: 'var(--accent)' }}><ExternalLink size={12} />Сайт восстановления доступа</a>
      </Box>
    </div>
  );
};

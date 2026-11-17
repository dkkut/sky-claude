/** Админка → «Переводы»: настройки переводов по Sky ID (владелец, с кодом), метки подозрительного, итоги по валютам, учёт международных провайдеров (ничего не подключает). */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, useCode, type D } from './kit';

const FLAG: Record<string, string> = { many_recipients: 'Много получателей за сутки', round_trip: 'Встречный перевод на близкую сумму', large_first: 'Крупный первый перевод получателю', new_account: 'Перевод с нового аккаунта', amount_too_large: 'Попытка сверх лимита', daily_limit: 'Превышение суточного лимита', new_account_limit: 'Лимит нового аккаунта', too_fast: 'Слишком частые переводы', amount_too_small: 'Слишком малая сумма' };
const CHECK: Record<string, string> = { contract: 'Договор', license: 'Лицензия/регистрация провайдера', kyc_aml: 'Проверка клиентов и ПОД/ФТ', sanctions_check: 'Санкционная проверка', currency_control: 'Валютное регулирование', adapter_written: 'Адаптер написан', test_mode_verified: 'Проверка в тестовом режиме', secrets_in_env: 'Ключи в окружении сервера' };
const fmtC = (c: string, n: number) => (c === 'RUB' ? `${n.toLocaleString('ru')} ₽` : `${(n / 100).toFixed(2)} ${c}`);

export const P2pTab = () => {
  const [d, load] = useLoad<D>('/api/admin/p2p'); const [intl, loadI] = useLoad<D>('/api/admin/skykassa-intl');
  const [s, setS] = useState<D | null>(null); const { code, field, reset } = useCode('/api/admin/p2p/step-up'); const [note, setNote] = useState('');
  const [np, setNp] = useState({ name: '', country: '', legalName: '', currencies: '' });
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const cur = s ?? d.settings;
  const set = (k: string, v: unknown) => setS({ ...cur, [k]: v });
  const save = async () => { const r = await call('/api/admin/p2p/settings', 'PUT', { ...cur, stepUpCode: code }); if (r) { flash('Сохранено'); reset(); setS(null); void load(); } };
  return (
    <div className="space-y-4">
      <Box title="Переводы по Sky ID — настройки">
        <Note>Комиссия и лимиты видны людям до подтверждения перевода. Менять может только владелец, с кодом подтверждения. По умолчанию комиссия 0.</Note>
        <label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={cur.enabled} onChange={(e) => set('enabled', e.target.checked)} />Переводы включены</label>
        <div className="grid grid-cols-2 gap-2">
          {([['feePercent', 'Комиссия, %'], ['feeMin', 'Мин. комиссия, ₽'], ['feeMax', 'Макс. комиссия, ₽ (0 — без потолка)'], ['minAmount', 'Минимум перевода, ₽ экв.'], ['maxAmount', 'Максимум перевода, ₽ экв.'], ['dailyLimit', 'Лимит в сутки, ₽ экв.'], ['newDays', 'Новый аккаунт: дней'], ['newDailyLimit', 'Новый аккаунт: лимит в сутки'], ['velocityMax', 'Макс. переводов за 10 минут'], ['recipientsFlag', 'Получателей за сутки → метка']] as const).map(([k, l]) => (
            <label key={k} className="space-y-1 text-[11px]" style={{ color: K.t3 }}>{l}<input className={inp} style={fieldSty} type="number" step="any" value={cur[k]} onChange={(e) => set(k, Number(e.target.value))} /></label>
          ))}
        </div>
        {field}<Btn onClick={() => void save()}>Сохранить</Btn>
      </Box>
      <Box title="Итоги за 30 дней (валюты раздельно)">
        {(d.totals30d as D[]).length === 0 ? <Note>Переводов пока не было.</Note> : (d.totals30d as D[]).map((t) => <p key={t.currency} className="text-xs" style={{ color: K.t1 }}><b>{t.currency}</b>: {t.count} шт., сумма {fmtC(t.currency, t.amount)}, комиссия {fmtC(t.currency, t.fee)}</p>)}
      </Box>
      <Box title={`Подозрительные переводы (${(d.items as D[]).length})`}>
        <Note>Деньги по меткам не замораживаются: это сигнал для проверки. Блокируются только попытки сверх лимитов — до выполнения.</Note>
        <input className={inp} style={fieldSty} value={note} placeholder="Заметка к решению (от 5 знаков)" onChange={(e) => setNote(e.target.value)} />
        {(d.items as D[]).map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: K.l2, color: K.t1 }}>
            <span><b>{FLAG[f.reason] ?? f.reason}</b> · {f.user} · {f.detail} · {new Date(f.at).toLocaleString('ru')}{f.level === 'blocked' ? ' · заблокировано' : ''}</span>
            <Btn tone="plain" onClick={async () => { if (await call('/api/admin/p2p/review', 'POST', { id: f.id, note })) { setNote(''); void load(); } }}>Проверено</Btn>
          </div>
        ))}
      </Box>
      <Box title="Иностранные организации и платёжные провайдеры (учёт)">
        <Note>Здесь только заявки и чек-лист допуска. Ничего не подключается и не имитируется: настоящее подключение требует договора, ключей на сервере и написанного адаптера.</Note>
        {intl && (intl.items as D[]).map((p) => (
          <div key={p.id} className="space-y-1 rounded-xl p-3 text-xs" style={{ background: K.l2, color: K.t1 }}>
            <p><b>{p.name}</b> · {p.country} · {p.currencies.join(', ') || '—'} · <i>{({ draft: 'черновик', checking: 'проверяется', ready_for_adapter: 'готово к адаптеру', rejected: 'отклонено' } as D)[p.status]}</i> · не подключён</p>
            <p style={{ color: K.t3 }}>{Object.entries(p.checklist as D).map(([k, v]) => `${v ? '✓' : '·'} ${CHECK[k] ?? k}`).join('  ')}</p>
            <div className="flex gap-2">{(['checking', 'ready_for_adapter', 'rejected'] as const).map((st) => <Btn key={st} tone="plain" onClick={async () => { const reason = window.prompt('Причина (от 5 знаков)') ?? ''; if (reason && await call('/api/admin/skykassa-intl/status', 'POST', { id: p.id, status: st, reason })) void loadI(); }}>{({ checking: 'На проверку', ready_for_adapter: 'Готово к адаптеру', rejected: 'Отклонить' } as D)[st]}</Btn>)}</div>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} style={fieldSty} placeholder="Название" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <input className={inp} style={fieldSty} placeholder="Страна (DE)" value={np.country} maxLength={2} onChange={(e) => setNp({ ...np, country: e.target.value })} />
          <input className={inp} style={fieldSty} placeholder="Юрлицо" value={np.legalName} onChange={(e) => setNp({ ...np, legalName: e.target.value })} />
          <input className={inp} style={fieldSty} placeholder="Валюты через запятую" value={np.currencies} onChange={(e) => setNp({ ...np, currencies: e.target.value })} />
        </div>
        <Btn onClick={async () => { if (await call('/api/admin/skykassa-intl', 'POST', { ...np, currencies: np.currencies.split(',').map((x) => x.trim()) })) { setNp({ name: '', country: '', legalName: '', currencies: '' }); void loadI(); } }}>Добавить заявку</Btn>
      </Box>
    </div>
  );
};

/**
 * Вкладка «Карты»: состояние поставщиков (Яндекс, Google), что из Sky Maps реально подключено, проверка ключей живым запросом,
 * переключатели функций, суточные пределы, расход и ошибки. Ключи не показываются вовсе — только «подключён / нет».
 * Просмотр — право maps или analytics; изменения — право maps и код подтверждения (maps_settings). Сервер — server/mapsusage.mjs, skymaps.mjs.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, Map as MapIcon, Activity, AlertTriangle, Sliders } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/maps';
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FEAT: Record<string, string> = { geocode: 'Поиск адреса (геокодер)', static: 'Картинка карты', route: 'Маршруты', friends: 'Карта друзей', safety: 'Sky Safety' };
const PROV: Record<string, string> = { yandex: 'Яндекс', google: 'Google' };
const ERR: Record<string, string> = { step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Попытки кода исчерпаны — запросите новый.', bad_limit: 'Неверный предел.', bad_limit_key: 'Неверный ключ предела.', not_allowed: 'Недостаточно прав.' };
const CODE: Record<string, string> = { no_key: 'ключ не задан', net: 'нет связи или отказ поставщика', denied_or_empty: 'ключ отклонён или пустой ответ', limit: 'предел исчерпан', feature_off: 'функция выключена', exception: 'ошибка' };
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const Card = ({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) => (
  <section className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
    <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}>{icon}{title}</h3>{children}</section>);
const Btn = ({ children, onClick, disabled, plain }: { children: ReactNode; onClick: () => void; disabled?: boolean; plain?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={plain ? { background: C.l2, color: C.t1 } : { background: C.acc, color: '#fff' }}>{children}</button>);
const Dot = ({ on }: { on: boolean }) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: on ? C.green : C.t3 }} />;

export const MapsTab = () => {
  const [d, setD] = useState<D | null>(null);
  const [failed, setFailed] = useState('');
  const [draft, setDraft] = useState<D | null>(null);
  const [code, setCode] = useState('');
  const [asking, setAsking] = useState(false);
  const [checking, setChecking] = useState('');
  const [checks, setChecks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await apiCall<D>(A);
    if (r.ok && r.data) { setD(r.data); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const check = async (provider: string) => {
    setChecking(provider);
    const r = await apiCall<D>(`${A}/check`, { method: 'POST', body: JSON.stringify({ provider }) });
    setChecks((c) => ({ ...c, [provider]: r.ok && r.data?.ok ? 'Ключ работает' : `Не работает: ${CODE[r.data?.code ?? ''] ?? r.data?.code ?? r.error ?? '—'}` }));
    setChecking(''); await load();
  };
  const askCode = async () => {
    const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setCode(''); setAsking(true);
  };
  const save = async () => {
    const r = await apiCall<D>(`${A}/settings`, { method: 'PUT', body: JSON.stringify({ settings: draft, stepUpCode: code.trim() }) });
    flash(r.ok ? 'Сохранено' : errText(r.error));
    if (r.ok) { setAsking(false); setDraft(null); await load(); }
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const cap = d.capabilities as D; const edit = Boolean(d.canEdit);
  const s = draft ?? d.settings as D;
  const setFeat = (k: string, v: boolean) => setDraft({ ...s, features: { ...s.features, [k]: v } });
  const setLim = (k: string, v: string) => setDraft({ ...s, limits: { ...s.limits, [k]: v === '' ? 0 : Number(v) } });
  const usage = (d.report.usage as D[]);
  const today = usage.filter((u) => u.day === usage[0]?.day);

  return (
    <div className="space-y-4">
      <Card title="Поставщики" icon={<MapIcon size={15} />}>
        {(['yandex', 'google'] as const).map((p) => (
          <div key={p} className="flex flex-wrap items-center gap-2 text-sm" style={{ color: C.t1 }}>
            <Dot on={Boolean(cap.providers[p].configured)} /><b>{PROV[p]}</b>
            <span style={{ color: C.t2 }}>{cap.providers[p].configured ? 'ключ подключён' : 'ключ не задан'}</span>
            {edit && cap.providers[p].configured && <Btn plain disabled={checking === p} onClick={() => void check(p)}>{checking === p ? 'Проверяю…' : 'Проверить ключ'}</Btn>}
            {checks[p] && <span className="text-xs" style={{ color: checks[p].startsWith('Ключ работает') ? C.green : C.red }}>{checks[p]}</span>}
          </div>))}
        <p className="text-xs" style={{ color: C.t3 }}>Ключи хранятся только в окружении сервера (YANDEX_MAPS_KEY, YANDEX_GEOCODER_KEY, GOOGLE_MAPS_KEY) и здесь не показываются. Проверка — один обычный запрос геокодера по известному адресу.</p>
      </Card>

      <Card title="Что подключено в Sky Maps" icon={<MapIcon size={15} />}>
        <ul className="space-y-1 text-xs" style={{ color: C.t2 }}>
          <li><Dot on={Boolean(cap.features.staticMap.yandex)} /> Картинка карты Яндекса · <Dot on={Boolean(cap.features.staticMap.google)} /> Google</li>
          <li><Dot on={Boolean(cap.features.geocode.yandex)} /> Геокодер Яндекса · <Dot on={Boolean(cap.features.geocode.google)} /> Google</li>
          <li><Dot on={false} /> Интерактивная карта Яндекса (JS API) — не подключена: нужен публичный ключ и разрешение домена api-maps.yandex.ru в политике безопасности</li>
          <li><Dot on={false} /> Поиск организаций (Yandex Search API) — не подключён: отдельный коммерческий ключ</li>
        </ul>
        <div className="mt-2 text-xs font-bold" style={{ color: C.t1 }}>Sky Routing — режимы</div>
        {(cap.routing as D[]).map((m) => (
          <div key={m.mode} className="flex flex-wrap items-center gap-2 text-xs" style={{ color: C.t2 }}>
            <b style={{ color: C.t1 }}>{m.label}</b>
            <span><Dot on={m.google.available} /> Google {m.google.available ? `(${m.google.via})` : '— нет ключа'}</span>
            <span><Dot on={false} /> Яндекс — не подключён (Routing API: отдельный платный продукт)</span>
          </div>))}
        <p className="text-xs" style={{ color: C.t3 }}>Пешеходные и велосипедные маршруты Google в России доступны не везде — это ограничение поставщика. Если маршрута нет, Sky его не рисует.</p>
      </Card>

      <Card title="Функции и пределы" icon={<Sliders size={15} />}>
        {Object.keys(FEAT).map((f) => (
          <div key={f} className="flex flex-wrap items-center gap-2 text-sm" style={{ color: C.t1 }}>
            <label className="flex min-w-[210px] items-center gap-2">
              <input type="checkbox" disabled={!edit} checked={s.features[f] !== false} onChange={(e) => setFeat(f, e.target.checked)} />{FEAT[f]}</label>
            {['yandex', 'google'].filter(() => ['geocode', 'static', 'route'].includes(f)).map((p) => (
              <label key={p} className="flex items-center gap-1 text-xs" style={{ color: C.t2 }}>{PROV[p]}, в сутки:
                <input disabled={!edit} inputMode="numeric" value={s.limits[`${p}:${f}`] ? String(s.limits[`${p}:${f}`]) : ''} placeholder="без предела"
                  onChange={(e) => setLim(`${p}:${f}`, e.target.value.replace(/\D/g, ''))} className="w-24 rounded-lg px-2 py-1" style={field} /></label>))}
          </div>))}
        {edit && draft && !asking && <div className="flex gap-2"><Btn onClick={() => void askCode()}>Сохранить</Btn><Btn plain onClick={() => setDraft(null)}>Отмена</Btn></div>}
        {asking && <div className="flex flex-wrap items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Код подтверждения" className="rounded-xl px-3 py-2 text-sm" style={field} />
          <Btn disabled={code.length < 6} onClick={() => void save()}>Подтвердить</Btn><Btn plain onClick={() => setAsking(false)}>Отмена</Btn></div>}
        {!edit && <p className="text-xs" style={{ color: C.t3 }}>Менять настройки может сотрудник с правом «Карты».</p>}
        <p className="text-xs" style={{ color: C.t3 }}>Выключенная функция или исчерпанный предел не ломают сервисы: они показывают «карта временно недоступна» вместо картинки.</p>
      </Card>

      <Card title={`Расход (${d.report.days} дн.)`} icon={<Activity size={15} />}>
        {usage.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Обращений к поставщикам пока не было.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs" style={{ color: C.t2 }}>
            <thead><tr style={{ color: C.t3 }}><th className="text-left">День</th><th className="text-left">Поставщик</th><th className="text-left">Функция</th><th>Успешно</th><th>Сбоев</th><th>Отказ по пределу</th></tr></thead>
            <tbody>{usage.map((u) => <tr key={`${u.day}${u.provider}${u.feature}`}><td>{u.day}</td><td>{PROV[u.provider] ?? u.provider}</td><td>{FEAT[u.feature] ?? u.feature}</td><td className="text-center">{u.ok}</td><td className="text-center" style={{ color: u.failed ? C.red : undefined }}>{u.failed}</td><td className="text-center">{u.limited}</td></tr>)}</tbody></table></div>)}
        {today.length > 0 && <p className="text-xs" style={{ color: C.t3 }}>Считаются обращения нашего сервера к поставщику; запросы, обслуженные из кэша адресов, сюда не попадают.</p>}
      </Card>

      <Card title="Ошибки" icon={<AlertTriangle size={15} />}>
        {(d.report.topErrors as D[]).length > 0 && <div className="text-xs" style={{ color: C.t2 }}>За сутки: {(d.report.topErrors as D[]).map((e) => `${PROV[e.provider] ?? e.provider} · ${FEAT[e.feature] ?? e.feature} · ${CODE[e.code] ?? e.code} — ${e.n}`).join('; ')}</div>}
        {(d.report.errors as D[]).length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Ошибок нет.</p> : (
          <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs" style={{ color: C.t2 }}>
            {(d.report.errors as D[]).map((e, i) => <li key={i}>{new Date(e.created_at).toLocaleString('ru-RU')} · {PROV[e.provider] ?? e.provider} · {FEAT[e.feature] ?? e.feature} · {CODE[e.code] ?? e.code}</li>)}</ul>)}
      </Card>
    </div>
  );
};

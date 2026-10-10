/**
 * Sky Market: «Проверка продавца» в кабинете.
 *
 * Здесь выбирают налоговый статус, заполняют анкету, прикладывают
 * документы и следят за решением. Статус «подтверждён» экран не ставит
 * никогда: он только показывает то, что ответил сервер после ручной
 * проверки сотрудником. Автоматической сверки с ФНС и реестрами нет, и
 * экран об этом говорит прямо.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldCheck, FileText, Upload, Trash2, Loader2, CheckCircle2, AlertCircle, Clock, XCircle, Eye,
} from 'lucide-react';
import { C, Field, inputStyle, Alert, fmtTime } from './ui';
import { COUNTRIES } from './countries';
import {
  apiVerifyConfig, apiMyVerification, apiSaveApplication, apiSubmitApplication, apiStartChange,
  apiUploadDoc, apiDeleteDoc, openDoc, apiAppeal, apiReportsAboutMe, REPORT_REASONS,
  type VerifyConfig, type MyVerification, type ApplicationView, type DocView, type MyReport,
} from './verifyApi';
import type { TaxKind, VerificationState } from './types';

const STATE_LABEL: Record<VerificationState, string> = {
  none: 'Заявка не подана', draft: 'Черновик', submitted: 'Отправлена', in_review: 'На проверке',
  needs_changes: 'Требуются исправления', approved: 'Одобрена', rejected: 'Отклонена',
  suspended: 'Приостановлена', reverify: 'Требуется повторная проверка', legacy: 'Работает без проверки (старый магазин)',
};
const STATE_TINT: Record<VerificationState, string> = {
  none: C.t3, draft: C.t3, submitted: C.acc, in_review: C.acc, needs_changes: C.amber,
  approved: C.green, rejected: C.red, suspended: C.red, reverify: C.amber, legacy: C.amber,
};
const STATE_ICON: Record<VerificationState, typeof Clock> = {
  none: FileText, draft: FileText, submitted: Clock, in_review: Eye, needs_changes: AlertCircle,
  approved: CheckCircle2, rejected: XCircle, suspended: XCircle, reverify: AlertCircle, legacy: ShieldCheck,
};

const KIND_HINT: Record<TaxKind, string> = {
  individual: 'Продаёте личные вещи, в том числе бывшие в употреблении. Регулярная торговля — не здесь.',
  npd: 'Продаёте товары собственного производства или услуги. Перепродажа купленного недоступна.',
  ip: 'Любая допустимая торговля, включая перепродажу. Нужна выписка из ЕГРИП.',
  legal: 'Организация (ООО и др.). Любая допустимая торговля. Нужна выписка из ЕГРЮЛ.',
};

const ACTION_LABEL: Record<string, string> = {
  created: 'Создан черновик', submitted: 'Отправлена на проверку', review_started: 'Взята на проверку',
  changes_requested: 'Запрошены исправления', approved: 'Одобрена', rejected: 'Отклонена',
  change_requested: 'Запрос на изменение статуса', appeal_accepted: 'Апелляция принята',
  seller_suspend: 'Магазин приостановлен', seller_reinstate: 'Магазин возобновлён',
  seller_reverify: 'Нужна повторная проверка',
};

const ERR: Record<string, string> = {
  shop_required: 'Сначала откройте магазин.', locked: 'Заявка на проверке — изменить её можно после ответа.',
  docs_missing: 'Не хватает обязательных документов.', description_required: 'Опишите деятельность подробнее.',
  already_submitted: 'Заявка уже отправлена.', bad_fields: 'Проверьте заполненные поля.',
  bad_country: 'Неверная страна.', nothing_to_submit: 'Нечего отправлять.', too_many_docs: 'Слишком много документов.',
  unsupported_document: 'Допустимы PDF, JPEG и PNG.', too_large: 'Файл слишком большой (до 10 МБ).',
  too_many_requests: 'Слишком часто. Подождите минуту.',
};
const errOf = (r: { error?: string; reason?: string; data?: any }) =>
  r.data?.message ?? ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось. Попробуйте ещё раз.';

/* ── Документы заявки ─────────────────────────────────────────────── */

export const DocList = ({ docs, editable, onChanged }: { docs: DocView[]; editable: boolean; onChanged: () => void }) => (
  <div className="space-y-1.5">
    {docs.map((d) => (
      <div key={d.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
        <FileText size={13} style={{ color: C.t3 }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" style={{ color: C.t1 }}>{d.typeLabel}</p>
          <p className="truncate" style={{ color: C.t3 }} translate="no">{d.label}</p>
          {d.comment && <p style={{ color: d.status === 'rejected' ? C.red : C.t2 }} translate="no">{d.comment}</p>}
        </div>
        <span className="shrink-0 font-bold" style={{ color: d.status === 'accepted' ? C.green : d.status === 'rejected' ? C.red : C.amber }}>
          {d.status === 'accepted' ? 'Принят' : d.status === 'rejected' ? 'Отклонён' : 'Ждёт проверки'}
        </span>
        <button type="button" aria-label="Открыть" onClick={() => void openDoc(d.id)} style={{ color: C.acc }}><Eye size={14} /></button>
        {editable && d.status !== 'accepted' && (
          <button type="button" aria-label="Удалить" style={{ color: C.red }}
            onClick={async () => { await apiDeleteDoc(d.id); onChanged(); }}><Trash2 size={14} /></button>
        )}
      </div>
    ))}
  </div>
);

export const DocUpload = ({ scope, refId, type, label, docs, onChanged, editable = true }: {
  scope: 'application' | 'product' | 'pvz'; refId: string; type: string; label: string;
  docs: DocView[]; onChanged: () => void; editable?: boolean;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = docs.filter((d) => d.type === type);
  const ok = mine.some((d) => d.status !== 'rejected');

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError('');
    const r = await apiUploadDoc(file, { scope, refId, type });
    setBusy(false);
    if (!r.ok) { setError(errOf(r)); return; }
    onChanged();
  };

  return (
    <div className="space-y-1.5 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${ok ? C.brd : C.amber}` }}>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 size={14} style={{ color: C.green }} /> : <AlertCircle size={14} style={{ color: C.amber }} />}
        <p className="flex-1 text-[12px] font-semibold" style={{ color: C.t1 }}>{label}</p>
        {editable && (
          <>
            <button type="button" disabled={busy} onClick={() => input.current?.click()}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold disabled:opacity-40"
              style={{ background: C.accBg, color: C.acc }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Загрузить
            </button>
            <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        )}
      </div>
      {mine.length > 0 && <DocList docs={mine} editable={editable} onChanged={onChanged} />}
      {error && <p className="text-[11px]" style={{ color: C.red }}>{error}</p>}
      <p className="text-[10px]" style={{ color: C.t3 }}>PDF, JPEG или PNG до 10 МБ. Файл хранится в зашифрованном виде и виден только вам и проверяющим.</p>
    </div>
  );
};

/* ── Анкета ───────────────────────────────────────────────────────── */

const ApplicationForm = ({ config, my, onChanged }: { config: VerifyConfig; my: MyVerification; onChanged: () => void }) => {
  const app = my.application;
  const [kind, setKind] = useState<TaxKind | ''>(app?.kind ?? '');
  const [activities, setActivities] = useState<string[]>(app?.activities ?? []);
  const [categories, setCategories] = useState<string[]>(app?.categories ?? []);
  const [desc, setDesc] = useState(app?.activityDescription ?? '');
  const [fields, setFields] = useState<Record<string, string | boolean>>(app?.fields ?? {});
  const [country, setCountry] = useState(app?.sellerCountry ?? 'RU');
  const [uncertain, setUncertain] = useState(app?.uncertain ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<{ field?: string; message: string }[]>([]);
  const [ok, setOk] = useState('');

  const kindCfg = config.kinds.find((k) => k.key === kind);
  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async (): Promise<ApplicationView | null> => {
    if (!kind) { setError('Выберите статус продавца.'); return null; }
    setBusy(true); setError(''); setProblems([]); setOk('');
    const r = await apiSaveApplication({
      kind, activities, categories, activityDescription: desc, fields, uncertain, sellerCountry: country,
    });
    setBusy(false);
    if (!r.ok) {
      setError(errOf(r));
      if (r.data?.problems) setProblems(r.data.problems);
      return null;
    }
    onChanged();
    return r.data.application;
  };

  const submit = async () => {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    const r = await apiSubmitApplication();
    setBusy(false);
    if (!r.ok) {
      setError(errOf(r));
      if (r.data?.problems) setProblems(r.data.problems);
      if (r.data?.missing) setProblems(r.data.missing.map((m: { label: string }) => ({ message: `Приложите: ${m.label}` })));
      onChanged();
      return;
    }
    setOk('Заявка отправлена на проверку.');
    onChanged();
  };

  const docs = app?.docs ?? [];
  const refId = app?.id;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {config.kinds.map((k) => (
          <button key={k.key} type="button" onClick={() => { setKind(k.key); setActivities([]); }}
            className="rounded-2xl p-3 text-left"
            style={{ background: kind === k.key ? C.accBg : C.l1, border: `1px solid ${kind === k.key ? C.acc : C.brd}` }}>
            <p className="text-[13px] font-bold" style={{ color: C.t1 }}>{k.label}</p>
            <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>{KIND_HINT[k.key]}</p>
          </button>
        ))}
      </div>

      {kindCfg && (
        <>
          <div className="space-y-1.5">
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Чем будете торговать</p>
            {config.activities.map((a) => (
              <label key={a.key} className="flex items-center gap-2 text-[12px]" style={{ color: C.t2 }}>
                <input type="checkbox" checked={activities.includes(a.key)} onChange={() => toggle(activities, a.key, setActivities)} />
                {a.label}
              </label>
            ))}
            <p className="text-[10px]" style={{ color: C.t3 }}>
              Сервер сам проверит, доступен ли вид деятельности для выбранного статуса. Выбор в форме прав не даёт —
              их выдаёт только одобрение заявки.
            </p>
          </div>

          <Field label="Что планируете продавать (категории)">
            <div className="flex flex-wrap gap-1.5">
              {config.categories.map((c) => (
                <button key={c} type="button" onClick={() => toggle(categories, c, setCategories)}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: categories.includes(c) ? C.accBg : C.l2, color: categories.includes(c) ? C.acc : C.t3 }}>
                  {({ electronics: 'Электроника', clothing: 'Одежда', home: 'Дом', beauty: 'Красота', sports: 'Спорт', books: 'Книги', toys: 'Игрушки', food: 'Еда', other: 'Другое' } as Record<string, string>)[c] ?? c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Описание деятельности" hint="Кратко: что за товары, откуда они, как работаете.">
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={2000}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          </Field>

          {kindCfg.fields.map((f) => (
            f.type === 'bool' ? (
              <label key={f.key} className="flex items-center gap-2 text-[12px]" style={{ color: C.t2 }}>
                <input type="checkbox" checked={fields[f.key] === true} onChange={(e) => setFields({ ...fields, [f.key]: e.target.checked })} />
                {f.label}
              </label>
            ) : (
              <Field key={f.key} label={f.label + (f.required ? '' : ' (необязательно)')}>
                <input value={String(fields[f.key] ?? '')} translate="no" maxLength={f.max}
                  inputMode={f.type?.startsWith('inn') || f.type === 'ogrn' || f.type === 'ogrnip' ? 'numeric' : undefined}
                  onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                {problems.filter((p) => p.field === f.key).map((p) => (
                  <p key={p.message} className="mt-1 text-[11px]" style={{ color: C.red }}>{p.message}</p>
                ))}
              </Field>
            )
          ))}

          <Field label="Страна продавца">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </Field>

          <label className="flex items-start gap-2 text-[12px]" style={{ color: C.t2 }}>
            <input type="checkbox" className="mt-0.5" checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />
            Не уверен(а), подходит ли мой вид деятельности — прошу проверить вручную
          </label>

          <div className="space-y-2">
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Документы</p>
            {!refId && <p className="text-[11px]" style={{ color: C.t3 }}>Сохраните черновик, чтобы приложить документы.</p>}
            {refId && kindCfg.docs.length === 0 && (
              <p className="text-[11px]" style={{ color: C.t3 }}>Для этого статуса обязательных документов нет.</p>
            )}
            {refId && (kind === 'legal' && fields.repIsHead !== true
              ? [...kindCfg.docs, { type: 'authority_doc', label: config.docTypes.authority_doc }]
              : kindCfg.docs).map((d) => (
                <DocUpload key={d.type} scope="application" refId={refId} type={d.type} label={d.label} docs={docs} onChanged={onChanged} />
              ))}
          </div>
        </>
      )}

      {problems.filter((p) => !p.field).map((p) => <Alert key={p.message} text={p.message} />)}
      {error && <Alert text={error} />}
      {ok && <Alert kind="info" text={ok} />}

      <div className="flex gap-2 pb-2">
        <button type="button" disabled={busy || !kind} onClick={() => void save().then((a) => a && setOk('Черновик сохранён.'))}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
          style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          Сохранить черновик
        </button>
        <button type="button" disabled={busy || !kind} onClick={() => void submit()}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {busy ? 'Подождите…' : 'Отправить на проверку'}
        </button>
      </div>
    </div>
  );
};

/* ── Основная панель ──────────────────────────────────────────────── */

export const VerificationPanel = ({ onChanged }: { onChanged?: () => void }) => {
  const [config, setConfig] = useState<VerifyConfig | null>(null);
  const [my, setMy] = useState<MyVerification | null>(null);
  const [reports, setReports] = useState<MyReport[]>([]);
  const [appeal, setAppeal] = useState('');
  const [msg, setMsg] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const [c, m, r] = await Promise.all([apiVerifyConfig(), apiMyVerification(), apiReportsAboutMe()]);
    if (c.ok) setConfig(c.data);
    if (m.ok) { setMy(m.data); setLoadFailed(false); } else setLoadFailed(true);
    if (r.ok) setReports(r.data.items);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Состояние магазина в кабинете обновляется после действий, но не при
     каждой загрузке: иначе обновление магазина перерисовывало бы панель
     и запускало загрузку снова по кругу. */
  const reload = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);

  if (loadFailed) return <div className="p-4"><Alert text="Не удалось загрузить статус проверки." /></div>;
  if (!config || !my) return <div className="grid place-items-center p-8"><Loader2 className="animate-spin" style={{ color: C.t3 }} /></div>;

  const v = my.verification;
  const Icon = STATE_ICON[v];
  const app = my.application;
  const editable = !app || app.status === 'draft' || app.status === 'needs_changes';
  const canChange = ['approved', 'legacy', 'reverify'].includes(v) && (!app || ['approved', 'rejected'].includes(app.status));

  const appealNow = async (subjectType: 'application' | 'shop', subjectId: string) => {
    const r = await apiAppeal({ subjectType, subjectId, text: appeal });
    setMsg(r.ok ? 'Апелляция отправлена.' : r.error === 'already_appealed' ? 'Апелляция уже подана.' : errOf(r));
    if (r.ok) setAppeal('');
  };

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${STATE_TINT[v]}` }}>
        <div className="flex items-center gap-2">
          <Icon size={18} style={{ color: STATE_TINT[v] }} />
          <p className="text-[14px] font-bold" style={{ color: C.t1 }}>{STATE_LABEL[v]}</p>
        </div>
        {app?.submittedAt && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Заявка подана: {fmtTime(app.submittedAt)}</p>}
        {my.taxKind && v !== 'none' && (
          <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>
            Подтверждённый статус: {config.kinds.find((k) => k.key === my.taxKind)?.label}
          </p>
        )}
        {app?.adminComment && (
          <p className="mt-2 rounded-lg p-2 text-[12px]" style={{ background: C.l2, color: C.t1 }} translate="no">
            Комментарий администратора: {app.adminComment}
          </p>
        )}
        {app?.missing?.length ? (
          <div className="mt-2">
            <p className="text-[11px] font-bold" style={{ color: C.amber }}>Чего не хватает:</p>
            <ul className="ml-4 list-disc text-[12px]" style={{ color: C.t1 }} translate="no">
              {app.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        ) : null}
        {app?.status === 'rejected' && app.rejectReason && (
          <p className="mt-2 text-[12px]" style={{ color: C.red }} translate="no">Причина отклонения: {app.rejectReason}</p>
        )}
        {(v === 'suspended') && my.suspendReason && (
          <p className="mt-2 text-[12px]" style={{ color: C.red }} translate="no">Причина приостановки: {my.suspendReason}</p>
        )}
        <p className="mt-2 text-[10px]" style={{ color: C.t3 }}>
          Проверку проводят сотрудники Sky вручную по вашей анкете и документам. Автоматической сверки с ФНС и
          государственными реестрами нет, и «подтверждено государством» мы не утверждаем.
        </p>
      </div>

      {v === 'legacy' && (
        <Alert kind="info" text="Ваш магазин открыт до введения проверки и продолжает работать. Подайте заявку, чтобы подтвердить статус: администрация может запросить её в любой момент." />
      )}

      {my.capabilities && (
        <div className="space-y-1 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Что вам разрешено</p>
          {my.capabilities.activities.map((a) => (
            <p key={a.key} className="text-[11px]" style={{ color: a.approved ? C.green : C.t3 }}>
              {a.approved ? '✓' : a.allowedForStatus ? '○' : '✕'} {a.label}
              {!a.allowedForStatus && a.reason ? ` — ${a.reason}` : ''}
            </p>
          ))}
          <p className="text-[11px]" style={{ color: my.capabilities.pvz ? C.green : C.t3 }}>
            {my.capabilities.pvz ? '✓' : '✕'} Открытие пункта выдачи (ПВЗ){my.capabilities.pvz ? '' : ' — только для ИП и юридических лиц'}
          </p>
        </div>
      )}

      {editable && !['approved', 'legacy', 'reverify'].includes(v) && <ApplicationForm config={config} my={my} onChanged={() => void reload()} />}
      {editable && ['approved', 'legacy', 'reverify'].includes(v) && app && <ApplicationForm config={config} my={my} onChanged={() => void reload()} />}

      {app && !editable && app.status !== 'approved' && app.status !== 'rejected' && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{app.kindLabel}</p>
          <p className="text-[11px]" style={{ color: C.t2 }}>Заявка на проверке. Её можно будет изменить, если администратор запросит исправления.</p>
          <DocList docs={app.docs} editable={false} onChanged={() => void reload()} />
        </div>
      )}

      {canChange && (
        <button type="button" onClick={async () => { const r = await apiStartChange(); if (r.ok) setMy(r.data); else setMsg(errOf(r)); }}
          className="w-full rounded-xl py-2.5 text-[12px] font-bold"
          style={{ background: C.accBg, color: C.acc }}>
          {v === 'reverify' ? 'Обновить данные и отправить на повторную проверку' : 'Запросить изменение статуса (например, НПД → ИП)'}
        </button>
      )}
      {canChange && (
        <p className="text-[10px]" style={{ color: C.t3 }}>
          До одобрения нового статуса магазин работает по текущему. История заказов и операций при смене статуса сохраняется.
        </p>
      )}

      {((app?.status === 'rejected') || v === 'suspended') && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Не согласны с решением?</p>
          <textarea value={appeal} onChange={(e) => setAppeal(e.target.value)} rows={3} maxLength={2000} placeholder="Опишите, что нужно пересмотреть"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          <button type="button" disabled={appeal.trim().length < 10}
            onClick={() => void appealNow(v === 'suspended' ? 'shop' : 'application', v === 'suspended' ? my.profileId : app!.id)}
            className="rounded-xl px-4 py-2 text-[12px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
            Подать апелляцию
          </button>
        </div>
      )}
      {msg && <Alert kind="info" text={msg} />}

      {reports.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Жалобы на ваш магазин и товары</p>
          {reports.map((r) => (
            <div key={r.id} className="rounded-xl p-2.5 text-[11px]" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t2 }}>
              {REPORT_REASONS[r.reason] ?? r.reason} · {({ open: 'ждёт рассмотрения', in_review: 'на рассмотрении', upheld: 'подтверждена', dismissed: 'отклонена' } as Record<string, string>)[r.status] ?? r.status}
              {r.resolution && <span translate="no"> · {r.resolution}</span>}
            </div>
          ))}
        </div>
      )}

      {my.history.length > 0 && (
        <div className="space-y-1">
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История</p>
          {my.history.map((e, i) => (
            <div key={i} className="flex gap-2 text-[11px]" style={{ color: C.t2 }}>
              <span className="shrink-0" style={{ color: C.t3 }}>{fmtTime(e.at)}</span>
              <span>
                {ACTION_LABEL[e.action] ?? e.action}
                {e.comment && <span style={{ color: C.t3 }} translate="no"> · {e.comment}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

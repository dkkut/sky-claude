/** Sky GO: регистрация исполнителя (НПД / ИП / ООО). Проверка — вручную администрацией; реестры ФНС не подключены, и интерфейс об этом не умалчивает. */
import { useRef, useState } from 'react';
import { FileUp, Trash2, Check } from 'lucide-react';
import { goApi, goError, DOC_LABEL, LEGAL_LABEL, ROLE_LABEL, type ExecutorRow, type GoRole, type LegalForm } from './api';
import { Back, Btn, Card, Chip, Col, Input, Notice, fail, C } from './ui';
import { flash } from '@/shared/flash';

/** Фото с телефона бывают по 5–15 МБ: уменьшаем до ~1,5 МБ, чтобы загрузка не упиралась в лимиты сервера и в слабую сеть. PDF и небольшие файлы не трогаем. */
const prepareDoc = async (f: File): Promise<{ file: File } | { error: string }> => {
  const MAX = 8 * 1024 * 1024;
  if (f.type === 'application/pdf') return f.size > MAX ? { error: 'PDF слишком большой (до 8 МБ). Сожмите файл или сфотографируйте документ.' } : { file: f };
  const ok = /^image\/(jpeg|png|webp)$/.test(f.type);
  if (ok && f.size <= 1.5 * 1024 * 1024) return { file: f };
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) throw new Error('encode');
    return { file: new File([blob], 'doc.jpg', { type: 'image/jpeg' }) };
  } catch {
    if (ok && f.size <= MAX) return { file: f };
    return { error: /heic|heif/i.test(f.type + f.name) ? 'Формат HEIC не поддерживается. Выберите JPG или PNG либо сделайте фото через камеру.' : 'Не удалось открыть изображение. Нужен JPG, PNG, WebP или PDF до 8 МБ.' };
  }
};

type Field = [key: string, label: string, opts?: { type?: string; max?: number; ph?: string }];
const FIELDS: Record<LegalForm, Field[]> = {
  npd: [['fullName', 'ФИО полностью'], ['inn', 'ИНН (12 цифр)', { max: 12 }], ['phone', 'Телефон', { type: 'tel', ph: '+7…' }]],
  ip: [['fullName', 'ФИО предпринимателя'], ['inn', 'ИНН (12 цифр)', { max: 12 }], ['ogrnip', 'ОГРНИП (15 цифр)', { max: 15 }], ['phone', 'Телефон', { type: 'tel' }], ['email', 'Почта', { type: 'email' }]],
  ooo: [['orgName', 'Название организации'], ['inn', 'ИНН (10 цифр)', { max: 10 }], ['ogrn', 'ОГРН (13 цифр)', { max: 13 }], ['orgPhone', 'Телефон организации', { type: 'tel' }], ['orgEmail', 'Почта организации', { type: 'email' }], ['repName', 'ФИО представителя'], ['repPosition', 'Должность']],
};
const EXTRA: Partial<Record<GoRole, Field[]>> = {
  taxi_driver: [['carMake', 'Марка'], ['carModel', 'Модель'], ['carColor', 'Цвет'], ['plate', 'Госномер', { max: 12 }], ['licenseNumber', 'Номер водительского удостоверения', { max: 20 }], ['carYear', 'Год выпуска', { max: 4 }]],
  food_seller: [['placeName', 'Название заведения']],
  company: [['brand', 'Название для заказов']],
  tour_operator: [['brand', 'Название организации']],
  hotel: [['brand', 'Название организации']],
};
const STATUS: Record<string, [string, string]> = {
  draft: ['Черновик', '#64748b'], submitted: ['На проверке', '#f59e0b'], in_review: ['На проверке', '#f59e0b'], needs_info: ['Нужны уточнения', '#f59e0b'],
  approved: ['Одобрено', '#10b981'], rejected: ['Отклонено', '#ef4444'], suspended: ['Допуск приостановлен', '#ef4444'], blocked: ['Заблокировано', '#ef4444'],
};
export const StatusChip = ({ s }: { s: string }) => <Chip color={(STATUS[s] ?? ['', '#64748b'])[1]}>{(STATUS[s] ?? [s])[0]}</Chip>;

export const RegisterScreen = ({ role, existing, cities, onBack, onDone }: { role: GoRole; existing: ExecutorRow | null; cities: string[]; onBack: () => void; onDone: () => void }) => {
  const [legal, setLegal] = useState<LegalForm>(existing?.legalForm ?? (role === 'tour_operator' || role === 'hotel' ? 'ip' : 'npd'));
  const [city, setCity] = useState(existing?.city ?? cities[0] ?? '');
  const [f, setF] = useState<Record<string, any>>(existing?.fields ?? {});
  const [x, setX] = useState<Record<string, any>>(existing?.extra ?? {});
  const [id, setId] = useState(existing?.id ?? '');
  const [docs, setDocs] = useState(existing?.docs ?? []);
  const [busy, setBusy] = useState(false); const [problems, setProblems] = useState<string[]>([]);
  const [dob, setDob] = useState(''); const [submitErr, setSubmitErr] = useState('');
  const [docErr, setDocErr] = useState('');
  const needsAge = role === 'taxi_driver' || role === 'courier';
  const file = useRef<HTMLInputElement>(null); const kindRef = useRef('');

  const required = (() => {
    const need: string[] = [];
    if (role === 'taxi_driver') need.push('driver_license', 'vehicle_registration');
    if (role === 'courier') need.push('id_doc');
    if (legal === 'ooo' && f.repIsHead !== true) need.push('authority_doc');
    return need;
  })();
  const save = async (): Promise<string | null> => {
    const r = await goApi.saveExecutor({ role, legalForm: legal, city, fields: f, extra: x });
    if (!r.ok) { setProblems(((r.data as any)?.problems ?? []).map((p: any) => p.message)); fail(r); return null; }
    setProblems([]); setId(r.data!.id); return r.data!.id;
  };
  const upload = async (file0: File) => {
    setBusy(true); setDocErr('');
    const prepared = await prepareDoc(file0);
    if ('error' in prepared) { setBusy(false); setDocErr(prepared.error); return; }
    const eid = id || await save();
    if (!eid) {
      // Причина видна рядом с кнопкой «Загрузить», а не только внизу экрана.
      setBusy(false); setDocErr('Анкета пока не сохраняется — исправьте поля выше и загрузите документ снова.'); return;
    }
    const r = await goApi.uploadDoc(eid, kindRef.current, prepared.file);
    if (!r.ok) { setBusy(false); setDocErr(r.status === 413 ? 'Файл слишком большой для сервера. Выберите фото поменьше или PDF до 8 МБ.' : r.status === 0 ? 'Нет связи с сервером. Проверьте интернет и повторите.' : goError(r)); return fail(r); }
    const fresh = await goApi.executors(); setBusy(false);
    if (fresh.ok) setDocs(fresh.data!.executors.find((e) => e.id === eid)?.docs ?? docs);
  };
  const submit = async () => {
    setBusy(true); const eid = await save();
    if (!eid) return setBusy(false);
    setSubmitErr('');
    const r = await goApi.submitExecutor(eid, dob || undefined); setBusy(false);
    if (!r.ok) {
      // Причина остаётся на экране (а не только всплывает): человек должен видеть, что поправить.
      const text = r.error === 'docs_missing' ? `Не хватает документов: ${((r.data as any)?.missing ?? []).map((k: string) => DOC_LABEL[k] ?? k).join(', ')}`
        : r.error === 'invalid_fields' ? ((r.data as any)?.problems ?? []).map((p2: any) => p2.message).join(' ') || goError(r) : goError(r);
      setSubmitErr(text); fail(r);
      return;
    }
    flash('Заявка отправлена на проверку'); onDone();
  };
  const render = (list: Field[], src: Record<string, any>, set: (v: Record<string, any>) => void) => list.map(([k, label, o]) => (
    <Input key={k} label={label} type={o?.type} max={o?.max} placeholder={o?.ph} value={String(src[k] ?? '')} onChange={(v) => set({ ...src, [k]: v })} />));

  return (
    <>
      <Back onClick={onBack} title={`Регистрация: ${ROLE_LABEL[role]}`} />
      <Col>
        {existing?.status === 'needs_info' && existing.reviewNote && <Notice tone="warn">Администрация просит уточнить: {existing.reviewNote}</Notice>}
        {existing?.status === 'rejected' && existing.reviewNote && <Notice tone="warn">Отказ: {existing.reviewNote}. Можно исправить сведения и отправить заново.</Notice>}
        <Card><Col>
          <div style={{ fontWeight: 800, color: C.t1 }}>Статус налогоплательщика</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(LEGAL_LABEL) as LegalForm[]).filter((k) => !(k === 'npd' && (role === 'tour_operator' || role === 'hotel'))).map((k) => <Btn key={k} kind={legal === k ? 'main' : 'soft'} onClick={() => setLegal(k)} style={{ height: 38, fontSize: 13 }}>{LEGAL_LABEL[k]}</Btn>)}
          </div>
          <label style={{ fontSize: 12, color: C.t2 }}>Город работы
            <select value={city} onChange={(e) => setCity(e.target.value)} style={{ display: 'block', width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 12px', fontSize: 15, marginTop: 5 }}>
              {cities.map((c) => <option key={c}>{c}</option>)}</select></label>
          {render(FIELDS[legal], f, setF)}
          {legal === 'ooo' && <label style={{ display: 'flex', gap: 8, color: C.t1, fontSize: 14 }}><input type="checkbox" checked={f.repIsHead === true} onChange={(e) => setF({ ...f, repIsHead: e.target.checked })} />Представитель — руководитель организации (доверенность не нужна)</label>}
        </Col></Card>
        {EXTRA[role] && <Card><Col><div style={{ fontWeight: 800, color: C.t1 }}>{role === 'taxi_driver' ? 'Автомобиль' : role === 'food_seller' ? 'Заведение' : role === 'hotel' ? 'Отель' : role === 'tour_operator' ? 'Туроператор' : 'Компания'}</div>{render(EXTRA[role]!, x, setX)}</Col></Card>}
        {role === 'courier' && <Card><div style={{ fontWeight: 800, color: C.t1, marginBottom: 8 }}>Как доставляете</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['foot', 'Пешком'], ['bike', 'Велосипед'], ['scooter', 'Самокат/мото'], ['car', 'Авто'], ['truck', 'Грузовой']].map(([k, t]) => <Btn key={k} kind={(x.transport ?? 'foot') === k ? 'main' : 'soft'} onClick={() => setX({ ...x, transport: k })} style={{ height: 38, fontSize: 13 }}>{t}</Btn>)}</div></Card>}
        {role === 'taxi_driver' && <Card><div style={{ fontWeight: 800, color: C.t1, marginBottom: 8 }}>Класс автомобиля</div>
          <div style={{ display: 'flex', gap: 6 }}>{[['economy', 'Эконом'], ['comfort', 'Комфорт'], ['business', 'Бизнес']].map(([k, t]) => <Btn key={k} kind={(x.carClass ?? 'economy') === k ? 'main' : 'soft'} onClick={() => setX({ ...x, carClass: k })} style={{ height: 38, fontSize: 13 }}>{t}</Btn>)}</div></Card>}
        {required.length > 0 && (
          <Card><Col>
            <div style={{ fontWeight: 800, color: C.t1 }}>Документы</div>
            <Notice>Фото или PDF (до 8 МБ; большие фото уменьшаются сами). Документы хранятся зашифрованными и видны только проверяющим.</Notice>
            {required.map((k) => {
              const d = docs.find((x2) => x2.kind === k);
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 14, color: C.t1 }}>{DOC_LABEL[k]}</div>
                  {d ? <><Check size={18} color="#10b981" /><button aria-label="Удалить" onClick={async () => { const r = await goApi.removeDoc(id, d.id); if (!r.ok) return fail(r); setDocs(docs.filter((y) => y.id !== d.id)); }} style={{ border: 'none', background: 'none', color: C.t3 }}><Trash2 size={17} /></button></>
                    : <Btn kind="soft" busy={busy} onClick={() => { kindRef.current = k; file.current?.click(); }} style={{ height: 38, fontSize: 13 }}><FileUp size={15} /> Загрузить</Btn>}
                </div>);
            })}
            {docErr && <Notice tone="warn"><div>{docErr}</div>{problems.map((p2, i) => <div key={i} translate="no">{p2}</div>)}</Notice>}
            <input ref={file} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) void upload(fl); }} />
          </Col></Card>)}
        {needsAge && <Card><Col>
          <div style={{ fontWeight: 800, color: C.t1 }}>Возраст</div>
          <Input label="Дата рождения (исполнителем может быть только совершеннолетний)" type="date" value={dob} onChange={setDob} />
          <div style={{ fontSize: 12, color: C.t3 }}>Если дата уже указана в профиле, поле можно не заполнять.</div>
        </Col></Card>}
        {submitErr && <Notice tone="warn">{submitErr}</Notice>}
        {problems.length > 0 && <Notice tone="warn">{problems.map((p, i) => <div key={i}>{p}</div>)}</Notice>}
        <Notice>Заявку проверяют сотрудники Sky вручную. Автоматической сверки с реестрами ФНС (ЕГРИП/ЕГРЮЛ, статус НПД) нет, поэтому одобрение — решение человека, а не гарантия достоверности.</Notice>
        <Btn busy={busy} onClick={submit}>Отправить на проверку</Btn>
      </Col>
    </>
  );
};

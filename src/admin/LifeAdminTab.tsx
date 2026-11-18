/** Админка → «Sky Life»: проверка публичных деловых публикаций и жалоб, ограничения, настройки тарифов и категорий, статистика, журналы.
 *  Личные записи, документы и приватные проекты людей администрации недоступны — здесь только публичные деловые данные и числа. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, type D } from './kit';

const KIND: D = { partner: 'Ищу партнёра', cofounder: 'Ищу сооснователя', investor_ask: 'Ищу инвестора', investor: 'Я инвестор' };
const SET: [string, string][] = [['free_items', 'Записей — Free'], ['prime_items', 'Записей — Prime'], ['free_storage_mb', 'Хранилище, МБ — Free'], ['prime_storage_mb', 'Хранилище, МБ — Prime'], ['free_posts', 'Публикаций — Free'], ['prime_posts', 'Публикаций — Prime'], ['free_projects', 'Проектов — Free'], ['prime_projects', 'Проектов — Prime'], ['free_match', 'Выдача подбора — Free'], ['prime_match', 'Выдача подбора — Prime'], ['proposals_per_day', 'Предложений в сутки на человека']];

const Queue = () => {
  const [q, load] = useLoad<D>('/api/admin/life/queue'); const [reason, setReason] = useState('');
  if (!q) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const decide = async (type: string, id: string, action: string) => { if (action !== 'approve' && reason.trim().length < 5) return flash('Укажите причину (не короче 5 знаков)'); if (await call(`/api/admin/life/${type}/${encodeURIComponent(id)}/decide`, 'POST', { action, reason })) { flash('Готово'); setReason(''); void load(); } };
  const Row = ({ type, id, title, lines }: { type: string; id: string; title: string; lines: string[] }) => (
    <div className="space-y-1 rounded-xl p-3" style={{ background: K.l2 }}><p className="text-sm font-bold" style={{ color: K.t1 }} translate="no">{title}</p>{lines.map((l, i) => <p key={i} className="text-xs" style={{ color: K.t2 }} translate="no">{l}</p>)}
      <div className="flex flex-wrap gap-2 pt-1"><Btn onClick={() => void decide(type, id, 'approve')}>Одобрить</Btn><Btn tone="plain" onClick={() => void decide(type, id, 'reject')}>Отклонить</Btn><Btn tone="red" onClick={() => void decide(type, id, 'block')}>Заблокировать</Btn></div></div>
  );
  return (
    <div className="space-y-3">
      <Note>Видны только публичные поля. Скрытые автором финансовые параметры, контакты, документы и личные записи не показываются. Отказ и блокировка — с причиной; она будет отправлена автору. Свою публикацию решать нельзя.</Note>
      <input className={inp} style={fieldSty} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (для отказа и блокировки)" />
      <Box title={`Публикации на проверке: ${q.posts.length}`}>{!q.posts.length ? <Note>Очередь пуста.</Note> : (q.posts as D[]).map((p) => <Row key={p.id} type="post" id={p.id} title={`${KIND[p.kind]} — ${p.title}`} lines={[...(p.riskFlags?.length ? ['⚠ подозрительные формулировки'] : []), ...Object.entries(p.data as D).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)]} />)}</Box>
      <Box title={`Деловые карточки на проверке: ${q.profiles.length}`}>{!q.profiles.length ? <Note>Очередь пуста.</Note> : (q.profiles as D[]).map((p) => <Row key={p.ownerId} type="profile" id={p.ownerId} title={p.name} lines={[`${p.city ?? ''} ${p.country ?? ''}`, `Сферы: ${(p.industries ?? []).join(', ')}`, p.about ?? '']} />)}</Box>
      <Box title={`Открытые жалобы: ${q.reports.length}`}>{!q.reports.length ? <Note>Жалоб нет.</Note> : (q.reports as D[]).map((r) => (
        <div key={r.id} className="space-y-1 rounded-xl p-3" style={{ background: K.l2 }}><p className="text-xs" style={{ color: K.t1 }}>{r.targetType} · {r.targetId} · {r.reason}</p>{r.text && <p className="text-xs" style={{ color: K.t2 }} translate="no">{r.text}</p>}
          <div className="flex gap-2"><Btn tone="plain" onClick={async () => { if (reason.trim().length < 5) return flash('Укажите причину'); if (await call(`/api/admin/life/reports/${r.id}/decide`, 'POST', { action: 'dismiss', note: reason })) void load(); }}>Жалоба необоснована</Btn>
            {(r.targetType === 'post' || r.targetType === 'profile' || r.targetType === 'project') && <Btn tone="red" onClick={() => void decide(r.targetType, r.targetId, 'block')}>Заблокировать объект</Btn>}</div></div>))}</Box>
    </div>
  );
};
const Restrict = () => {
  const [q, load] = useLoad<D>('/api/admin/life/queue'); const [f, setF] = useState({ profileId: '', days: '7', reason: '' });
  return (
    <div className="space-y-3">
      <Box title="Ограничить деловые функции человека"><Note>Человек не сможет публиковать, отправлять предложения и менять деловую карточку; его публикации скрываются. Личные записи не затрагиваются. Причина обязательна, действие пишется в журнал. Укажите id профиля (acc-…) из жалобы.</Note>
        <input className={inp} style={fieldSty} placeholder="id профиля" value={f.profileId} onChange={(e) => setF({ ...f, profileId: e.target.value })} /><input className={inp} style={fieldSty} placeholder="Дней (пусто — бессрочно)" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /><input className={inp} style={fieldSty} placeholder="Причина" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <Btn tone="red" onClick={async () => { if (await call('/api/admin/life/restrict', 'POST', { profileId: f.profileId.trim(), days: Number(f.days) || 0, reason: f.reason })) { flash('Ограничено'); void load(); } }}>Ограничить</Btn></Box>
      <Box title="Действующие ограничения">{!q?.restrictions?.length ? <Note>Нет.</Note> : (q.restrictions as D[]).map((r) => <div key={r.profile_id} className="flex items-center justify-between gap-2"><span className="text-xs" style={{ color: K.t1 }}>{r.profile_id} · {r.reason} · {r.until ? `до ${new Date(r.until).toLocaleDateString('ru')}` : 'бессрочно'}</span><Btn tone="plain" onClick={async () => { if (await call('/api/admin/life/restrict', 'POST', { profileId: r.profile_id, lift: true, reason: 'снято' })) void load(); }}>Снять</Btn></div>)}</Box>
    </div>
  );
};
const Settings = () => {
  const [d, load] = useLoad<D>('/api/admin/life/settings'); const [form, setForm] = useState<D>({}); const [cat, setCat] = useState('');
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const s = { ...d.settings, ...form };
  return (
    <div className="space-y-3">
      <Box title="Включение"><label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={s.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Sky Life включён</label><label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={s.biz_enabled} onChange={(e) => setForm({ ...form, biz_enabled: e.target.checked })} />Деловые связи включены</label></Box>
      <Box title="Ограничения тарифов"><Note>Лимиты ограничивают только создание нового. Чтение, изменение, выгрузка и удаление своих данных работают всегда, в том числе после окончания подписки.</Note>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{SET.map(([k, l]) => <label key={k} className="space-y-1"><span className="text-[11px]" style={{ color: K.t3 }}>{l}</span><input className={inp} style={fieldSty} type="number" value={s[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} /></label>)}</div>
        <Btn onClick={async () => { if (await call('/api/admin/life/settings', 'PUT', form)) { flash('Сохранено'); setForm({}); void load(); } }}>Сохранить</Btn></Box>
      <Box title="Системные категории «Моей жизни»"><Note>Пользователи дополнительно создают свои. Удаление категории не удаляет записи.</Note>
        {(d.categories as D[]).map((c) => <div key={c.id} className="flex items-center gap-2"><span className="flex-1 text-xs" style={{ color: c.enabled ? K.t1 : K.t3 }}>{c.name}{c.enabled ? '' : ' (скрыта)'}</span><Btn tone="plain" onClick={async () => { if (await call('/api/admin/life/categories', 'POST', { id: c.id, name: c.name, enabled: !c.enabled })) void load(); }}>{c.enabled ? 'Скрыть' : 'Показать'}</Btn><Btn tone="red" onClick={async () => { if (window.confirm('Удалить категорию?') && await call('/api/admin/life/categories', 'POST', { delete: c.id })) void load(); }}>Удалить</Btn></div>)}
        <div className="flex gap-2"><input className={inp} style={fieldSty} value={cat} placeholder="Новая категория" onChange={(e) => setCat(e.target.value)} /><Btn onClick={async () => { if (await call('/api/admin/life/categories', 'POST', { name: cat })) { setCat(''); void load(); } }}>Добавить</Btn></div></Box>
    </div>
  );
};
const Stats = () => {
  const [s] = useLoad<D>('/api/admin/life/stats'); const [l] = useLoad<D>('/api/admin/life/logs');
  if (!s) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const cells: [string, unknown][] = [['Людей с записями', s.users], ['Записей', s.items], ['Целей', s.goals], ['Проектов', s.projects], ['Файлов', s.files], ['Хранилище, МБ', s.storageMb], ['Опубликовано', s.posts.published], ['На проверке', s.posts.pending], ['Заблокировано', s.posts.blocked], ['Деловых карточек', s.profiles], ['Предложений', s.proposals], ['Жалоб открыто', s.openReports], ['Ограничено', s.restricted]];
  return (
    <div className="space-y-3">
      <Note>Только числа. Содержимое записей, документов и приватных проектов администрации недоступно.</Note>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{cells.map(([k, v]) => <div key={k} className="rounded-xl p-3 text-center" style={{ background: K.l1, border: `1px solid ${K.brd}` }}><p className="text-xl font-black" style={{ color: K.t1 }}>{String(v)}</p><p className="text-[10px]" style={{ color: K.t3 }}>{k}</p></div>)}</div>
      {l && <><Box title="Действия администрации">{!(l.actions as D[]).length ? <Note>Пока пусто.</Note> : (l.actions as D[]).map((a, i) => <p key={i} className="text-[11px]" style={{ color: K.t2 }}>{new Date(a.at).toLocaleString('ru')} · {a.actor ?? '—'} · {a.action}{a.target ? ` · ${a.target}` : ''}{a.reason ? ` — ${a.reason}` : ''}</p>)}</Box>
        <Box title="Технические ошибки (без данных пользователей)">{!(l.errors as D[]).length ? <Note>Ошибок нет.</Note> : (l.errors as D[]).map((a, i) => <p key={i} className="text-[11px]" style={{ color: K.t2 }}>{new Date(a.at).toLocaleString('ru')} · {a.where_} · {a.code}</p>)}</Box></>}
    </div>
  );
};
export const LifeAdminTab = () => {
  const [t, setT] = useState<'queue' | 'restrict' | 'settings' | 'stats'>('queue');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{([['queue', 'Проверка и жалобы'], ['restrict', 'Ограничения'], ['settings', 'Настройки и тарифы'], ['stats', 'Статистика и журналы']] as const).map(([k, l]) => <Btn key={k} tone={t === k ? 'acc' : 'plain'} onClick={() => setT(k)}>{l}</Btn>)}</div>
      {t === 'queue' && <Queue />}{t === 'restrict' && <Restrict />}{t === 'settings' && <Settings />}{t === 'stats' && <Stats />}
    </div>
  );
};

/** Админка → «Модерация каналов» (право `channel_mod`): очередь дел автомодерации, решения, апелляции владельцев, настройки. Решение всегда за человеком. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, useCode, type D } from './kit';

const CAT: Record<string, string> = { violence: 'Угрозы насилием', terror: 'Терроризм и экстремизм', drugs: 'Продажа наркотиков', fraud: 'Мошенничество и фишинг', weapons: 'Продажа оружия', child_safety: 'Безопасность детей' };
const ST: Record<string, string> = { review: 'На проверке', restricted: 'Ограничен', appealed: 'Апелляции', dismissed: 'Отклонены', restored: 'Восстановлены', closed: 'Закрыты' };
const ACT: Record<string, string> = { opened: 'Дело открыто', viewed: 'Просмотр', dismissed: 'Отклонено', warned: 'Предупреждение владельцу', restricted: 'Временное ограничение', appealed: 'Апелляция владельца', appeal_accepted: 'Апелляция принята', appeal_rejected: 'Апелляция отклонена', brigade_suspected: 'Подозрение на налёт жалоб' };

export const ChanModTab = () => {
  const [status, setStatus] = useState('review');
  const [d, load] = useLoad<D>(`/api/admin/channel-mod?status=${status}`);
  const [open, setOpen] = useState<D | null>(null); const [why, setWhy] = useState(''); const [hours, setHours] = useState(72);
  const { code, field, reset } = useCode('/api/admin/channel-mod/step-up'); const [st, setSt] = useState<D | null>(null);
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const cur = st ?? d.settings;
  const view = async (id: string) => { const r = await call<D>(`/api/admin/channel-mod/cases/${id}`); if (r) setOpen({ ...r, id }); };
  const act = async (path: string, body: D) => { const r = await call(`/api/admin/channel-mod/cases/${open!.id}/${path}`, 'POST', body); if (r) { flash('Готово'); setOpen(null); setWhy(''); void load(); } };
  return (
    <div className="space-y-4">
      <Note>Система только подсказывает: одно слово дело не открывает, контекст (новости, цитаты, предупреждения) снижает вес, приватные каналы не сканируются. Ограничить можно только «серьёзный» случай — с подтверждением и причиной; владелец канала сможет обжаловать.</Note>
      <div className="flex flex-wrap gap-2">{Object.entries(ST).map(([k, v]) => <Btn key={k} tone={status === k ? 'acc' : 'plain'} onClick={() => { setStatus(k); setOpen(null); }}>{v}</Btn>)}</div>
      <Box title={`Дела: ${ST[status]} (${(d.items as D[]).length})`}>
        {(d.items as D[]).length === 0 && <Note>Дел нет.</Note>}
        {(d.items as D[]).map((c) => (
          <button key={c.id} type="button" onClick={() => void view(c.id)} className="block w-full rounded-xl px-3 py-2 text-left text-sm" style={{ background: K.l2, color: K.t1 }}>
            <b translate="no">{c.title}</b> {c.handle && <span translate="no">{c.handle}</span>} · {c.score} баллов{c.serious ? ' · серьёзное' : ''} · {c.source === 'reports' ? 'по жалобам' : 'по тексту'} · {(c.categories as string[]).map((x) => CAT[x] ?? x).join(', ') || 'жалобы'}
          </button>
        ))}
      </Box>
      {open && (
        <Box title={`Дело · ${open.score} баллов${open.serious ? ' · серьёзное' : ''} · ${ST[open.status]}`}>
          {(open.signals as D[]).map((s, i) => <p key={i} className="rounded-lg px-3 py-2 text-xs" style={{ background: K.l2, color: K.t1 }}><b>{CAT[s.category] ?? s.category}</b> ({s.source === 'description' ? 'описание' : 'публикация'}, вес {s.weight}){(s.ctx as string[]).length ? ` — ${(s.ctx as string[]).join(', ')}` : ''}<br /><span translate="no" style={{ color: K.t3 }}>…{s.ex}…</span></p>)}
          {(open.reports as D[]).length > 0 && <Note>Жалоб: {(open.reports as D[]).length}, суммарный вес {(open.reports as D[]).reduce((a, r) => a + r.weight, 0).toFixed(1)}</Note>}
          <input className={inp} style={fieldSty} value={why} placeholder="Причина решения (отклонение — от 5 знаков, остальное — от 10)" onChange={(e) => setWhy(e.target.value)} />
          {open.status === 'review' && (
            <div className="flex flex-wrap items-center gap-2">
              <Btn tone="plain" onClick={() => void act('decide', { action: 'dismiss', reason: why })}>Отклонить</Btn>
              <Btn tone="plain" onClick={() => void act('decide', { action: 'warn', reason: why })}>Предупредить владельца</Btn>
              {open.serious && <><input className="w-20 rounded-xl px-2 py-1.5 text-xs" style={fieldSty} type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value))} /><span className="text-[11px]" style={{ color: K.t3 }}>ч</span>
                <Btn tone="red" onClick={() => { if (window.confirm('Временно ограничить канал? Данные не удаляются, владелец сможет обжаловать.')) void act('decide', { action: 'restrict', reason: why, hours, confirm: true }); }}>Ограничить канал</Btn></>}
            </div>
          )}
          {['restricted', 'appealed'].includes(open.status) && (
            <div className="flex gap-2"><Btn onClick={() => void act('appeal', { outcome: 'accepted', note: why })}>Принять апелляцию (снять)</Btn><Btn tone="plain" onClick={() => void act('appeal', { outcome: 'rejected', note: why })}>Отклонить апелляцию</Btn></div>
          )}
          <p className="text-[11px] font-semibold" style={{ color: K.t2 }}>История решения</p>
          {(open.history as D[]).map((h, i) => <p key={i} className="text-[11px]" style={{ color: K.t3 }}>{new Date(h.at).toLocaleString('ru')} · {ACT[h.action] ?? h.action} · {h.actor}{h.detail ? ` — ${h.detail}` : ''}</p>)}
        </Box>
      )}
      <Box title="Настройки">
        <label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={cur.enabled} onChange={(e) => setSt({ ...cur, enabled: e.target.checked })} />Автомодерация включена</label>
        <div className="grid grid-cols-3 gap-2">
          {([['reviewScore', 'Порог проверки'], ['seriousScore', 'Порог «серьёзного»'], ['restrictHours', 'Срок ограничения, ч']] as const).map(([k, l]) => <label key={k} className="space-y-1 text-[11px]" style={{ color: K.t3 }}>{l}<input className={inp} style={fieldSty} type="number" value={cur[k]} onChange={(e) => setSt({ ...cur, [k]: Number(e.target.value) })} /></label>)}
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="checkbox" checked={cur.autoRestrict} onChange={(e) => setSt({ ...cur, autoRestrict: e.target.checked })} />Автоограничение без человека (только очень серьёзные случаи; включает владелец)</label>
        {field}<Btn onClick={async () => { const r = await call('/api/admin/channel-mod/settings', 'PUT', { ...cur, stepUpCode: code || undefined }); if (r) { flash('Сохранено'); reset(); setSt(null); void load(); } }}>Сохранить</Btn>
        <Note>Снижение порогов и автоограничение меняет только владелец, с кодом подтверждения.</Note>
      </Box>
    </div>
  );
};

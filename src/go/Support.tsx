/** Sky GO: обращение в поддержку по заказу и настройки уведомлений. Обращение — обычный тикет Sky (ответы приходят в раздел поддержки и уведомления). */
import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { goApi, goError } from './api';
import { Btn, Card, Chip, Col, Input, Notice, fail, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

const STATUS: Record<string, string> = { open: 'Открыто', in_progress: 'В работе', waiting: 'Ждёт вашего ответа', closed: 'Закрыто' };

/** Форма «Сообщить о проблеме». orderId — если обращение по конкретному заказу. */
export const SupportForm = ({ orderId, onDone }: { orderId?: string; onDone?: () => void }) => {
  const [cats] = useLoad(() => goApi.supportList(), []);
  const [cat, setCat] = useState(''); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const categories = cats?.ok ? cats.data!.categories : {};
  const send = async () => {
    setBusy(true); const r = await goApi.supportSend({ category: cat, orderId, text }); setBusy(false);
    if (!r.ok) return fail(r);
    flash('Обращение отправлено — ответ придёт в уведомления'); setCat(''); setText(''); onDone?.();
  };
  return (
    <Card><Col gap={10}>
      <div style={{ fontWeight: 800, color: C.t1, display: 'flex', alignItems: 'center', gap: 8 }}><LifeBuoy size={18} color={GO} />Сообщить о проблеме</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(categories).map(([k, t]) => (
          <button key={k} onClick={() => setCat(k)} aria-pressed={cat === k} style={{ padding: '7px 12px', borderRadius: 12, border: 'none', fontSize: 12.5, fontWeight: 700, background: cat === k ? GO : C.l2, color: cat === k ? '#fff' : C.t1 }}>{t}</button>))}
      </div>
      {cat === 'safety' && <Notice tone="warn">Если вам угрожает опасность, сначала свяжитесь с экстренными службами. Обращение увидит поддержка Sky — оно будет в начале очереди.</Notice>}
      <Input area label="Что случилось" value={text} onChange={setText} max={2000} />
      <Btn busy={busy} disabled={!cat || text.trim().length < 5} onClick={send}>Отправить</Btn>
    </Col></Card>
  );
};

/** Мои обращения со статусами. */
export const MySupport = () => {
  const [res] = useLoad(() => goApi.supportList(), [], 20000);
  if (!res?.ok || !res.data!.tickets.length) return null;
  return (
    <Card><Col gap={6}>
      <div style={{ fontWeight: 800, color: C.t1 }}>Мои обращения</div>
      {res.data!.tickets.map((t) => (
        <div key={t.ticketId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5, color: C.t1 }}>
          <span>{t.label}</span><Chip>{STATUS[t.status] ?? t.status}</Chip>
        </div>))}
    </Col></Card>
  );
};

/** Какие пуши присылать. Записи в «Уведомлениях» остаются всегда; споры и безопасность отключить нельзя. */
export const NotifyPrefs = () => {
  const [res, reload] = useLoad(() => goApi.notifyPrefs(), []);
  if (!res?.ok) return null;
  const d = res.data!;
  const toggle = async (g: string) => { const r = await goApi.setNotifyPrefs({ [g]: !d.push[g] }); if (!r.ok) return fail(r); reload(); };
  return (
    <Card><Col gap={8}>
      <div style={{ fontWeight: 800, color: C.t1 }}>Уведомления Sky GO</div>
      {Object.entries(d.groups).map(([g, title]) => (
        <label key={g} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 14, color: C.t1 }}>
          <span>{title}</span>
          <input type="checkbox" checked={d.push[g]} onChange={() => void toggle(g)} aria-label={title} style={{ width: 20, height: 20 }} />
        </label>))}
      <div style={{ fontSize: 12, color: C.t3 }}>{d.note}</div>
    </Col></Card>
  );
};
export { goError };

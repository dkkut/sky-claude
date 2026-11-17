/** Админка → «Реклама Sky» (право `ads_manage`): кампании администрации (создать, запустить/остановить), собственные объявления Sky, статистика по местам размещения. Ссылки подписываются на сервере. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { apiUploadAdMediaEx } from '@/ads/adsApi';
import { Box, Btn, Note, K, fieldSty, inp, call, useLoad, type D } from './kit';

const PL: Record<string, string> = { video_preroll: 'Перед видео', film_preroll: 'Перед кино', video_banner: 'Баннер у видео', bloom_feed: 'Лента Bloom', bloom_stories: 'Истории', channel_post: 'Пост в канале', channel_pin: 'Закреп в канале' };
const FMT: Record<string, string[]> = { video_preroll: ['video', 'image'], film_preroll: ['video', 'image'], video_banner: ['image', 'text_image'], bloom_feed: ['text', 'text_image', 'image'], bloom_stories: ['image', 'video'], channel_post: ['text', 'text_image'], channel_pin: ['text', 'text_image', 'image'] };
const FL: Record<string, string> = { video: 'Видео', image: 'Изображение', text: 'Текст', text_image: 'Текст и картинка' };
const ST: Record<string, string> = { active: 'Идёт', scheduled: 'Запланирована', paused: 'Остановлена', completed: 'Завершена', cancelled: 'Отменена', moderation: 'На модерации', approved: 'Одобрена', rejected: 'Отклонена', draft: 'Черновик' };
const SVC: Record<string, string> = { messages: 'Чаты', extras: 'Sky Media', studio: 'Студия', business: 'Бизнес', bloom: 'Bloom', gaming: 'Игры', video: 'Видео' };
const iso = (d: string) => (d ? new Date(d).toISOString() : '');

export const AdsPlusTab = () => {
  const [days, setDays] = useState(30);
  const [stats] = useLoad<D>(`/api/ads/admin/stats?days=${days}`); const [house, loadH] = useLoad<D>(`/api/ads/admin/house?days=${days}`); const [list, loadL] = useLoad<D>('/api/ads/admin/campaigns?limit=100');
  const [f, setF] = useState<D>({ name: '', title: '', description: '', linkUrl: '', placement: 'bloom_feed', format: 'text', startsAt: '', endsAt: '', priority: 10, maxPerUserDay: 3, mediaId: '' });
  const [busy, setBusy] = useState(false);
  if (!stats || !house || !list) return <Loader2 size={16} className="animate-spin" style={{ color: K.t3 }} />;
  const upload = async (file?: File) => { if (!file) return; setBusy(true); const r = await apiUploadAdMediaEx(file); setBusy(false); if (r.media) { setF({ ...f, mediaId: r.media.mediaId }); flash('Файл загружен'); } else flash(r.error ?? 'Не получилось'); };
  const create = async (start: boolean) => { const r = await call<D>('/api/ads/admin/campaigns', 'POST', { ...f, startsAt: iso(f.startsAt) || undefined, endsAt: iso(f.endsAt), mediaId: f.mediaId || undefined, linkUrl: f.linkUrl || undefined, start }); if (r) { flash(`Кампания создана (${ST[r.status] ?? r.status})`); void loadL(); } };
  const toggle = async (c: D, action: string) => { if (await call(`/api/ads/admin/campaigns/${c.id}/${action}`, 'POST', {})) void loadL(); };
  const admin = (list.items as D[]).filter((c) => c.adminCreated);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{[7, 30, 90].map((n) => <Btn key={n} tone={days === n ? 'acc' : 'plain'} onClick={() => setDays(n)}>{n} дн.</Btn>)}</div>
      <Box title="Показы и переходы по местам размещения">
        <Note>Внешние кампании и собственные объявления Sky считаются раздельно. Переходы у собственных — внутрь Sky.</Note>
        {(stats.byPlacement as D[]).length === 0 && <Note>Данных за период пока нет.</Note>}
        {(stats.byPlacement as D[]).map((p) => <p key={p.placement} className="text-xs" style={{ color: K.t1 }}><b>{PL[p.placement] ?? p.placement}</b>: показы {p.impressions}, переходы {p.clicks}, CTR {p.ctr}% · свои: {p.houseImpressions} / {p.houseClicks} ({p.houseCtr}%)</p>)}
        {stats.linkTamperEvents > 0 && <p className="text-xs" style={{ color: K.red }}>Обнаружена подмена ссылок в данных кампаний: {stats.linkTamperEvents} раз — такие кампании не показывались.</p>}
      </Box>
      <Box title="Новая кампания администрации">
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} style={fieldSty} placeholder="Название (внутреннее)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={inp} style={fieldSty} placeholder="Заголовок объявления" value={f.title} maxLength={100} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <select className={inp} style={fieldSty} value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value, format: FMT[e.target.value][0], mediaId: '' })}>{Object.entries(PL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={inp} style={fieldSty} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>{FMT[f.placement].map((x) => <option key={x} value={x}>{FL[x]}</option>)}</select>
          <label className="space-y-1 text-[11px]" style={{ color: K.t3 }}>Начало (пусто — сейчас)<input className={inp} style={fieldSty} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></label>
          <label className="space-y-1 text-[11px]" style={{ color: K.t3 }}>Окончание<input className={inp} style={fieldSty} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>
          <label className="space-y-1 text-[11px]" style={{ color: K.t3 }}>Приоритет (0–100)<input className={inp} style={fieldSty} type="number" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></label>
          <label className="space-y-1 text-[11px]" style={{ color: K.t3 }}>Частота: показов человеку в сутки<input className={inp} style={fieldSty} type="number" value={f.maxPerUserDay} onChange={(e) => setF({ ...f, maxPerUserDay: Number(e.target.value) })} /></label>
        </div>
        <textarea className={inp} style={fieldSty} rows={2} maxLength={400} placeholder="Текст" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input className={inp} style={fieldSty} placeholder="Ссылка (только https://)" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} />
        {f.format !== 'text' && <div className="flex items-center gap-2 text-xs" style={{ color: K.t1 }}><input type="file" accept="image/*,video/mp4,video/webm" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />{f.mediaId ? '✓ файл загружен' : 'файл не выбран'}</div>}
        <div className="flex gap-2"><Btn onClick={() => void create(true)}>Создать и запустить</Btn><Btn tone="plain" onClick={() => void create(false)}>Создать остановленной</Btn></div>
        <Note>Реклама размечается словом «Реклама». Ссылка подписывается сервером: изменённая в обход админки не показывается.</Note>
      </Box>
      <Box title={`Кампании администрации (${admin.length})`}>
        {admin.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: K.l2, color: K.t1 }}>
            <span><b>{c.name ?? c.title}</b> · {PL[c.placement]} · {ST[c.status] ?? c.status} · приоритет {c.priority} · {c.startDate ? new Date(c.startDate).toLocaleDateString('ru') : ''}–{c.endDate ? new Date(c.endDate).toLocaleDateString('ru') : ''} · показы {c.impressions}, переходы {c.clicks}, CTR {c.ctr}%</span>
            <span className="flex gap-1">{c.status === 'active' || c.status === 'scheduled' ? <Btn tone="plain" onClick={() => void toggle(c, 'pause')}>Остановить</Btn> : c.status === 'paused' ? <Btn onClick={() => void toggle(c, 'resume')}>Запустить</Btn> : null}</span>
          </div>
        ))}
      </Box>
      <Box title="Собственная реклама Sky (когда внешних материалов нет)">
        <Note>Показывается не-Prime людям. Объявления ведут только внутрь Sky; внешнюю ссылку указать нельзя.</Note>
        {(house.items as D[]).map((h) => <HouseRow key={h.id} h={h} modules={house.modules} tabs={house.extrasTabs} places={house.placements} onSaved={() => void loadH()} />)}
      </Box>
    </div>
  );
};

const HouseRow = ({ h, modules, tabs, places, onSaved }: { h: D; modules: D; tabs: string[]; places: string[]; onSaved: () => void }) => {
  const [v, setV] = useState<D>(h);
  const save = async (patch: D = {}) => { if (await call(`/api/ads/admin/house/${h.id}`, 'PUT', { ...v, ...patch })) { flash('Сохранено'); onSaved(); } };
  return (
    <div className="space-y-1 rounded-xl p-3 text-xs" style={{ background: K.l2, color: K.t1 }}>
      <p><b>{h.service}</b> · показы {h.impressions}, переходы {h.clicks}, CTR {h.ctr}% · {v.status === 'active' ? 'включено' : 'выключено'}</p>
      <input className={inp} style={fieldSty} value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <input className={inp} style={fieldSty} value={v.body} maxLength={200} onChange={(e) => setV({ ...v, body: e.target.value })} />
      <div className="grid grid-cols-4 gap-2">
        <input className={inp} style={fieldSty} value={v.cta} maxLength={30} onChange={(e) => setV({ ...v, cta: e.target.value })} />
        <select className={inp} style={fieldSty} value={v.module} onChange={(e) => setV({ ...v, module: e.target.value, tab: undefined })}>{Object.entries(modules).map(([k, l]) => <option key={k} value={k}>{String(SVC[k] ?? l)}</option>)}</select>
        <select className={inp} style={fieldSty} disabled={v.module !== 'extras'} value={v.tab ?? ''} onChange={(e) => setV({ ...v, tab: e.target.value || undefined })}><option value="">—</option>{tabs.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <input className={inp} style={fieldSty} type="number" value={v.priority} onChange={(e) => setV({ ...v, priority: Number(e.target.value) })} />
      </div>
      <div className="flex flex-wrap gap-2">{places.map((p) => <label key={p} className="flex items-center gap-1"><input type="checkbox" checked={(v.placements as string[]).includes(p)} onChange={(e) => setV({ ...v, placements: e.target.checked ? [...v.placements, p] : (v.placements as string[]).filter((x) => x !== p) })} />{PL[p] ?? p}</label>)}</div>
      <div className="flex gap-2"><Btn onClick={() => void save()}>Сохранить</Btn><Btn tone="plain" onClick={() => void save({ status: v.status === 'active' ? 'paused' : 'active' })}>{v.status === 'active' ? 'Выключить' : 'Включить'}</Btn></div>
    </div>
  );
};

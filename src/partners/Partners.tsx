/**
 * «Партнёры» Sky: список настоящих партнёров, которых подтвердила администрация (server/partners.mjs).
 * Людям приходят только публичные поля: название, логотип, описание, категория, сайт, предложения и промокоды.
 * Неподтверждённые, приостановленные и архивные партнёры сюда не попадают; внутренних контактов у клиента нет.
 */
import { useEffect, useState } from 'react';
import { Handshake, ExternalLink, Copy, Check, Loader2 } from 'lucide-react';
import { apiCall, apiBlob } from '@/core/auth/api';

interface Offer { title: string; terms: string; promoCode: string; endsAt: string }
interface Partner { id: string; name: string; description: string; category: string; categoryLabel: string; website: string; hasLogo: boolean; startsAt: string | null; endsAt: string | null; conditions: string; offers: Offer[] }

/** Логотип отдаётся только с токеном сессии — обычный <img> его не пошлёт, поэтому берём через apiBlob. */
const Logo = ({ p }: { p: Partner }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!p.hasLogo) return;
    let url = ''; let live = true;
    void apiBlob(`/api/partners/${p.id}/logo`).then((r) => { if (live && r.ok && r.blob) { url = URL.createObjectURL(r.blob); setSrc(url); } });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [p.id, p.hasLogo]);
  return src
    ? <img src={src} alt="" className="h-12 w-12 shrink-0 rounded-xl object-contain" style={{ background: 'var(--bg-l2)' }} />
    : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-base font-black" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</div>;
};

const Promo = ({ code }: { code: string }) => {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-bold" style={{ background: 'rgba(168,85,247,.12)', color: '#a855f7' }} aria-label="Скопировать промокод">
      <span translate="no" className="font-mono">{code}</span>{done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
};

export const Partners = () => {
  const [list, setList] = useState<Partner[] | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [cat, setCat] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void apiCall<{ partners: Partner[]; categories: Record<string, string> }>('/api/partners').then((r) => {
      if (r.ok && r.data) { setList(r.data.partners); setCats(r.data.categories); } else setFailed(true);
    });
  }, []);

  const shown = (list ?? []).filter((p) => !cat || p.category === cat);
  const present = Object.keys(cats).filter((k) => (list ?? []).some((p) => p.category === k));

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-4" style={{ background: 'var(--bg)' }}>
      <div className="mb-3 flex items-center gap-2"><Handshake size={20} style={{ color: 'var(--accent)' }} /><p className="text-lg font-black" style={{ color: 'var(--t1)' }}>Партнёры</p></div>
      <p className="mb-3 text-[12px]" style={{ color: 'var(--t3)' }}>Только партнёры, сотрудничество с которыми подтверждено администрацией Sky.</p>
      {list === null && !failed && <Loader2 size={18} className="animate-spin" style={{ color: 'var(--t3)' }} />}
      {failed && <p className="text-sm" style={{ color: 'var(--red)' }}>Не удалось загрузить список партнёров. Попробуйте позже.</p>}
      {list && list.length === 0 && <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>Партнёров пока нет.</p>}
      {present.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="toolbar" aria-label="Категории партнёров">
          {['', ...present].map((k) => (
            <button key={k || 'all'} type="button" onClick={() => setCat(k)} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold"
              style={{ background: cat === k ? 'var(--accent)' : 'var(--bg-l2)', color: cat === k ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>{k ? cats[k] : 'Все'}</button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((p) => (
          <div key={p.id} className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <Logo p={p} />
              <div className="min-w-0 flex-1">
                <p translate="no" className="truncate text-[14px] font-bold" style={{ color: 'var(--t1)' }}>{p.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{`${p.categoryLabel} · Официальный партнёр`}</p>
              </div>
            </div>
            {p.description && <p translate="no" className="whitespace-pre-line text-[12.5px]" style={{ color: 'var(--t2)' }}>{p.description}</p>}
            {p.offers.length > 0 && (
              <div className="space-y-1.5">
                {p.offers.map((o, i) => (
                  <div key={i} className="rounded-xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
                    <p translate="no" className="text-[12.5px] font-bold" style={{ color: 'var(--t1)' }}>{o.title}</p>
                    {o.terms && <p translate="no" className="text-[11.5px]" style={{ color: 'var(--t2)' }}>{o.terms}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {o.promoCode && <Promo code={o.promoCode} />}
                      {o.endsAt && <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{`до ${new Date(o.endsAt).toLocaleDateString('ru-RU')}`}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {p.conditions && <p translate="no" className="text-[11.5px]" style={{ color: 'var(--t3)' }}>{p.conditions}</p>}
            {p.website && (
              <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[12px] font-bold" style={{ color: 'var(--accent)' }}>
                Официальный сайт<ExternalLink size={12} />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

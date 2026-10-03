/**
 * «Поделиться» и «Доступ имеют» — один диалог на кино и музыку.
 *
 * Права решает сервер (storageshare.mjs): здесь только показ и вызовы.
 * VIEW — сам факт строки; DOWNLOAD — отдельный флажок, по умолчанию
 * выключен, как и в брифе («скачивание не включается само собой»).
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Trash2, Share2 } from 'lucide-react';
import { apiFindPeople } from '@/together/togetherApi';
import {
  apiStorageShare, apiStorageRevoke, apiStorageShares, explainStorageShare,
  type FileKind, type ShareEntry,
} from './storageShareApi';

interface Person { id: string; name: string; username: string }

export const ShareDialog = ({ kind, fileId, title, onClose }: {
  kind: FileKind; fileId: string; title: string; onClose: () => void;
}) => {
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [canDownload, setCanDownload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const r = await apiStorageShares(kind, fileId);
    setShares(r.ok && r.data ? r.data.shares : []);
    setLoading(false);
  };
  useEffect(() => { void reload(); }, [kind, fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setFound([]); return; }
    const t = window.setTimeout(() => {
      void apiFindPeople(needle).then(r => setFound(r.ok && r.data ? r.data.people : []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const share = async (p: Person) => {
    setError(null);
    const r = await apiStorageShare(kind, fileId, p.id, canDownload);
    if (!r.ok) { setError(explainStorageShare(r.error)); return; }
    setQ(''); setFound([]);
    void reload();
  };

  const revoke = async (userId: string) => {
    await apiStorageRevoke(kind, fileId, userId);
    void reload();
  };

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
        <motion.div data-share-dialog onClick={e => e.stopPropagation()}
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          className="w-full max-w-sm rounded-t-3xl p-4 sm:rounded-3xl space-y-3"
          style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 font-semibold text-white">
              <Share2 size={16} /> Поделиться
            </p>
            <button type="button" onClick={onClose} data-share-close style={{ color: 'var(--t3)' }}>
              <X size={18} />
            </button>
          </div>
          <p className="truncate text-xs" style={{ color: 'var(--t3)' }}>{title}</p>

          <div className="flex items-center gap-2 rounded-2xl px-3 py-2"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <Search size={14} style={{ color: 'var(--t3)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} data-share-search
              placeholder="Имя или ник" className="flex-1 bg-transparent text-sm text-white outline-none" />
          </div>

          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}>
            <input type="checkbox" checked={canDownload} data-share-download
              onChange={e => setCanDownload(e.target.checked)} />
            Разрешить скачивание
          </label>

          {found.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {found.map(p => (
                <button key={p.id} type="button" onClick={() => void share(p)} data-share-found={p.id}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5">
                  <span className="text-sm text-white">{p.name}</span>
                  <span className="text-xs" style={{ color: 'var(--t3)' }}>@{p.username}</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-xs" style={{ color: 'var(--red)' }} data-share-error>{error}</p>}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold" style={{ color: 'var(--t2)' }}>Доступ имеют</p>
            {loading && <p className="text-xs" style={{ color: 'var(--t3)' }}>Загружаю…</p>}
            {!loading && shares.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--t3)' }}>Пока никто.</p>
            )}
            {shares.map(s => (
              <div key={s.id} data-share-entry={s.userId}
                className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: 'var(--bg-l2)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{s.name}</p>
                  <p className="text-[10px]" style={{ color: 'var(--t3)' }}>
                    Просмотр ✓ · Скачивание {s.canDownload ? '✓' : '✕'}
                  </p>
                </div>
                <button type="button" onClick={() => void revoke(s.userId)} data-share-revoke={s.userId}
                  style={{ color: 'var(--t3)' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

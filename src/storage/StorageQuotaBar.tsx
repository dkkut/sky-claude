/**
 * Личное хранилище: сколько занято из сколько есть.
 *
 * Квота одна на весь Sky ID и общая для кино и музыки (storagequota.mjs
 * на сервере), поэтому строка одинаковая и в «Мои фильмы», и в «Мои
 * треки» — это один и тот же остаток места, не два разных.
 */
import { useEffect, useState } from 'react';
import { apiStorageQuota } from './storageShareApi';

const fmtGb = (bytes: number) => (bytes / (1024 ** 3)).toFixed(1);

export const StorageQuotaBar = () => {
  const [state, setState] = useState<{ quotaBytes: number; usedBytes: number } | null>(null);

  useEffect(() => {
    void apiStorageQuota().then(r => { if (r.ok && r.data) setState(r.data); });
  }, []);

  if (!state) return null;
  const pct = state.quotaBytes > 0 ? Math.min(100, (state.usedBytes / state.quotaBytes) * 100) : 0;
  const near = pct >= 90;

  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--t2)' }}>Личное хранилище</span>
        <span style={{ color: near ? 'var(--red)' : 'var(--t3)' }}>
          {fmtGb(state.usedBytes)} ГБ из {fmtGb(state.quotaBytes)} ГБ
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: near ? 'var(--red)' : 'var(--accent)' }} />
      </div>
    </div>
  );
};

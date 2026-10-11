/* Sky Calls в консоли: настоящая история звонков из хранилища звонков.
   Сам звонок запускается из чата тем же способом, что и везде (Messenger). */
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import { useCallStore } from '@/calls/store';
import { openService } from './services';

export const ConsoleCalls = () => {
  const history = useCallStore((s) => s.history);
  return (
    <div className="h-full overflow-y-auto px-[5vw] py-8 text-white" style={{ background: 'var(--bg-l1)' }} data-keep-dark>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-4 text-[40px] font-bold"><Phone size={36} /> Sky Calls</h1>
        <button type="button" onClick={() => openService('messenger')} className="rounded-full px-8 py-3 text-[22px] font-semibold text-[#0b0b14] outline-none" style={{ background: '#fff' }} data-console-autofocus="">Позвонить из чата</button>
      </div>
      {history.length === 0 ? (
        <p className="text-[22px] text-white/55">Звонков пока не было. Откройте Messenger и нажмите кнопку звонка в нужном чате.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {history.slice(0, 30).map((h) => {
            const Icon = h.status === 'missed' ? PhoneMissed : h.direction === 'in' ? PhoneIncoming : PhoneOutgoing;
            return (
              <li key={h.id}>
                <button type="button" onClick={() => openService('messenger')} className="flex w-full items-center gap-5 rounded-2xl px-6 py-4 text-left outline-none" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <Icon size={28} className={h.status === 'missed' ? 'text-rose-400' : 'text-emerald-300'} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[24px] font-semibold" translate="no">{h.peerName}</span>
                    <span className="block text-[16px] text-white/55" translate="no">{new Date(h.startedAt).toLocaleString()}</span></span>
                  {h.mode === 'video' && <Video size={22} className="text-white/60" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

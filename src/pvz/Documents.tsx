/* ======================================================================
   SKY ПВЗ  —  Документы
====================================================================== */
import { useState, useRef, type ChangeEvent } from 'react';
import { FileText, Upload, Trash2, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState } from './shared';
import type { PVZ, PVZDocument } from './types';

const DOC_TYPES: { key: PVZDocument['type'] | 'all'; label: string }[] = [
  { key:'all', label:'Все' }, { key:'contract', label:'Договоры' }, { key:'act', label:'Акты' },
  { key:'license', label:'Лицензии' }, { key:'certificate', label:'Сертификаты' }, { key:'finance', label:'Финансы' },
];

const fileToDataUrl = (file: File): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
});

export const DocumentsScreen = ({ pvz }: { pvz: PVZ }) => {
  const { addDocument, removeDocument } = usePVZStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<PVZDocument['type'] | 'all'>('all');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<PVZDocument['type']>('contract');
  const [pending, setPending] = useState(false);

  const docs = filter === 'all' ? pvz.documents : pvz.documents.filter(d => d.type === filter);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !title.trim()) return;
    setPending(true);
    const data = await fileToDataUrl(file);
    addDocument(pvz.id, { type, title: title.trim(), fileName: file.name, fileData: data, expiresAt: null });
    setTitle(''); setPending(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const exportAll = (fmt: 'pdf'|'excel') => {
    const rows = pvz.documents.map(d => `${d.title},${d.type},${d.fileName},${new Date(d.uploadedAt).toLocaleDateString('ru-RU')}`).join('\n');
    const blob = new Blob([`Название,Тип,Файл,Загружен\n${rows}`], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `documents_${pvz.id}.${fmt==='excel'?'csv':'txt'}`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Документы</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => exportAll('pdf')} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1" style={{ background: C.l2, color: C.t2 }}><Download size={12}/> PDF</button>
          <button type="button" onClick={() => exportAll('excel')} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1" style={{ background: C.l2, color: C.t2 }}><FileSpreadsheet size={12}/> Excel</button>
        </div>
      </div>

      <div className="px-5 mt-3">
        <GlassCard className="p-3 space-y-2">
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Загрузить документ</p>
          <select value={type} onChange={e => setType(e.target.value as PVZDocument['type'])} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}>
            {DOC_TYPES.filter(d=>d.key!=='all').map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            <option value="other">Прочее</option>
          </select>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название документа" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
          <button type="button" disabled={!title.trim() || pending} onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
            {pending ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>} Выбрать файл
          </button>
          <input ref={fileRef} type="file" hidden onChange={onFile}/>
        </GlassCard>
      </div>

      <div className="px-5 mt-3">
        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {DOC_TYPES.map(d => (
            <button key={d.key} type="button" onClick={() => setFilter(d.key)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: filter===d.key ? C.accBg : C.l2, color: filter===d.key ? C.acc : C.t3 }}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 mt-3 mb-6 space-y-2">
        {docs.length === 0 ? <EmptyState icon={FileText} title="Документы не найдены"/> : docs.map(d => (
          <GlassCard key={d.id} className="p-3 flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0" style={{ background: C.accBg }}><FileText size={15} style={{ color: C.acc }}/></div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{d.title}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>{DOC_TYPES.find(t=>t.key===d.type)?.label ?? 'Прочее'} · {new Date(d.uploadedAt).toLocaleDateString('ru-RU')}</p>
            </div>
            <button type="button" onClick={() => removeDocument(pvz.id, d.id)} className="grid h-7 w-7 place-items-center rounded-lg shrink-0" style={{ background: C.l2 }}>
              <Trash2 size={13} style={{ color: C.red }}/>
            </button>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};

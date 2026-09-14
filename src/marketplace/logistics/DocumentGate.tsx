/**
 * Принятие документа.
 *
 * Галочка «я согласен» под свёрнутым текстом — это согласие с тем, чего
 * человек не открывал. Здесь текст показан целиком, а кнопка становится
 * доступной только после того, как его пролистали до конца. Это не
 * доказательство прочтения — такого доказательства не бывает, — но и не
 * притворство, будто одной галочки достаточно.
 *
 * Что именно записано в согласие, решает сервер: он берёт текст со
 * своего диска, считает его отпечаток и кладёт рядом с датой. Отсюда не
 * уходит ни редакция, ни отпечаток — иначе «согласен» можно было бы
 * подписать под чем угодно.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { Markdown } from '@/info/markdown';
import { apiDocument, apiAcceptDocument, type DocCode } from './sharedApi';

export const DocumentGate = ({
  code, onAccepted, note,
}: {
  code: DocCode;
  onAccepted: () => void;
  /** Зачем его принимают — одной строкой над текстом. */
  note?: string;
}) => {
  const [doc, setDoc] = useState<{ title: string; revision: string; text: string } | null>(null);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void apiDocument(code).then((r) => {
      if (r.ok && r.data) setDoc(r.data);
      else setFailed('Документ не загрузился. Обновите страницу.');
    });
  }, [code]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setRead(true);
  };

  const accept = async () => {
    setBusy(true);
    const r = await apiAcceptDocument(code);
    setBusy(false);
    if (r.ok) onAccepted();
    else setFailed('Согласие не записалось. Попробуйте ещё раз.');
  };

  if (!doc) {
    return (
      <div className="grid place-items-center py-10">
        {failed
          ? <p className="text-xs" style={{ color: C.red }}>{failed}</p>
          : <Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} />}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-3">
        <p className="text-sm font-bold" style={{ color: C.t1 }}>{doc.title}</p>
        <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>Редакция от {doc.revision}</p>
        {note && <p className="mt-2 text-[11px]" style={{ color: C.t2 }}>{note}</p>}
      </div>

      <div ref={box} onScroll={onScroll}
        className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 text-[12px]"
        style={{ color: C.t2, scrollbarWidth: 'none' }}>
        <Markdown text={doc.text} />
        <div className="h-6" />
      </div>

      <div className="shrink-0 px-4 py-3" style={{ borderTop: `1px solid ${C.brd}` }}>
        {failed && <p className="mb-2 text-[11px]" style={{ color: C.red }}>{failed}</p>}
        {!read && (
          <p className="mb-2 text-[10px]" style={{ color: C.t3 }}>
            Пролистайте документ до конца — кнопка станет доступной.
          </p>
        )}
        <button type="button" disabled={!read || busy} onClick={() => void accept()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold"
          style={{
            background: read && !busy ? C.acc : C.l2,
            color: read && !busy ? '#fff' : C.t3,
          }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Принимаю
        </button>
      </div>
    </div>
  );
};

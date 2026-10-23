import { fmtPos, type HKind } from './handoffApi';

/** «Где остановились»: время или глава книги. Книги — целой фразой, чтобы перевод не склеивал слово и число. */
export const Place = ({ kind, position, extra }: { kind: HKind; position: number; extra?: Record<string, number | string | null> }) => {
  if (kind !== 'book') return <span translate="no">{fmtPos(position)}</span>;
  const e = extra ?? {};
  if (e.mode === 'audio') return <span>{`глава ${e.audioChapter ?? e.chapter ?? 1}, ${fmtPos(position)}`}</span>;
  return <span>{`глава ${e.textChapter ?? e.chapter ?? 1}`}</span>;
};

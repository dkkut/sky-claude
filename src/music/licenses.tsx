/**
 * Лицензии треков Sky Music. Значения совпадают с серверными (server/music.mjs, MUSIC_LICENSES).
 * Площадка лишь даёт доступ к сервису: за права на загруженное отвечает загрузивший (см. Правила, п. 9.1).
 */
import { Info, Scale } from 'lucide-react';

export interface LicenseDef { key: string; label: string; short: string; hint: string; needsSource: boolean }

export const LICENSES: LicenseDef[] = [
  { key: 'own', label: 'Моё произведение — права принадлежат мне', short: 'Авторский', hint: 'Вы автор или правообладатель трека.', needsSource: false },
  { key: 'cc0', label: 'CC0 — без ограничений', short: 'CC0', hint: 'Автор отказался от прав: можно использовать свободно.', needsSource: false },
  { key: 'public-domain', label: 'Общественное достояние', short: 'Public Domain', hint: 'Срок охраны прав истёк.', needsSource: false },
  { key: 'cc-by', label: 'CC BY — с указанием автора', short: 'CC BY', hint: 'Можно использовать, указывая автора.', needsSource: true },
  { key: 'cc-by-sa', label: 'CC BY-SA — с указанием автора и той же лицензией', short: 'CC BY-SA', hint: 'Указывайте автора; производные работы — на той же лицензии.', needsSource: true },
  { key: 'cc-by-nc', label: 'CC BY-NC — без коммерческого использования', short: 'CC BY-NC', hint: 'Указывайте автора; коммерческое использование запрещено.', needsSource: true },
  { key: 'cc-by-nd', label: 'CC BY-ND — без изменений', short: 'CC BY-ND', hint: 'Указывайте автора; изменять трек нельзя.', needsSource: true },
  { key: 'cc-by-nc-sa', label: 'CC BY-NC-SA', short: 'CC BY-NC-SA', hint: 'Автор, без коммерции, производные — на той же лицензии.', needsSource: true },
  { key: 'cc-by-nc-nd', label: 'CC BY-NC-ND', short: 'CC BY-NC-ND', hint: 'Автор, без коммерции, без изменений.', needsSource: true },
];

export const licenseOf = (key?: string) => LICENSES.find((l) => l.key === key) ?? LICENSES[0];

const field: React.CSSProperties = { background: 'rgba(128,128,128,0.14)', color: 'var(--t1)', border: '1px solid rgba(128,128,128,0.35)' };

export const LicensePicker = ({ license, source, onChange }: { license: string; source: string; onChange: (license: string, source: string) => void }) => {
  const cur = licenseOf(license);
  return (
    <div className="space-y-2">
      <label className="block text-[12px] font-semibold" style={{ opacity: 0.7 }}>Лицензия</label>
      <select value={cur.key} onChange={(e) => onChange(e.target.value, source)} className="w-full rounded-full px-4 py-2.5 text-[13px] outline-none" style={field}>
        {LICENSES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
      </select>
      <p className="px-1 text-[11.5px]" style={{ opacity: 0.65 }}>{cur.hint}</p>
      {cur.key !== 'own' && (
        <input value={source} onChange={(e) => onChange(cur.key, e.target.value)} placeholder="Ссылка на автора или источник (https://…)" maxLength={300} inputMode="url"
          className="w-full rounded-full px-4 py-2.5 text-[13px] outline-none" style={field} />
      )}
      <p className="px-1 text-[11px] leading-snug" style={{ opacity: 0.6 }}>
        Вы сами отвечаете за права на трек и верность лицензии. Sky лишь предоставляет доступ к сервису и не отвечает за авторские права.
      </p>
    </div>
  );
};

/** Значок лицензии в карточке трека. */
export const LicenseBadge = ({ license, source }: { license?: string; source?: string }) => {
  const l = licenseOf(license);
  const inner = (<><Scale size={11} />{l.short}</>);
  const cls = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold';
  const style = { background: 'rgba(128,128,128,0.2)', color: 'inherit' };
  return source && /^https?:\/\//i.test(source)
    ? <a href={source} target="_blank" rel="noopener noreferrer nofollow" className={cls} style={style} title={l.hint} onClick={(e) => e.stopPropagation()}>{inner}</a>
    : <span className={cls} style={style} title={l.hint}>{inner}</span>;
};

/** Текст для правообладателей — в описании каждого трека. */
export const RightsholderNotice = ({ onSupport, tone = 'rgba(255,255,255,0.55)' }: { onSupport?: () => void; tone?: string }) => (
  <p className="flex items-start gap-1.5 text-[11.5px] leading-snug" style={{ color: tone }}>
    <Info size={13} className="mt-[1px] shrink-0" />
    <span>
      Вы правообладатель и вас не устраивает, что трек доступен на платформе? Создайте тикет (Профиль → Тех. поддержка), и мы решим вопрос.
      {onSupport && <> <button type="button" onClick={onSupport} className="underline">Открыть поддержку</button></>}
    </span>
  </p>
);

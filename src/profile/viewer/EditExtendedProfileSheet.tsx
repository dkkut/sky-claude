import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Plus, Trash2 } from 'lucide-react';
import { useAuthStore, type Account } from '@/core/auth/store';
import { usePrivacyStore } from '@/profile/privacyStore';

const TIMEZONES = [
  'Калининград (UTC+2)', 'Москва (UTC+3)', 'Самара (UTC+4)', 'Екатеринбург (UTC+5)',
  'Омск (UTC+6)', 'Красноярск (UTC+7)', 'Иркутск (UTC+8)', 'Якутск (UTC+9)',
  'Владивосток (UTC+10)', 'Магадан (UTC+11)', 'Камчатка (UTC+12)',
];

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--t3)' }}>{label}</div>
    {children}
  </div>
);
const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm outline-none";
const inputStyle = { background: 'var(--bg-l2)', color: 'var(--t1)' } as const;

const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
  <button type="button" onClick={onClick}
    className="w-10 h-6 rounded-full relative transition-colors shrink-0"
    style={{ background: on ? 'var(--accent)' : 'var(--bg-l3)' }}>
    <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
  </button>
);

export const EditExtendedProfileSheet = ({ account, onClose }: { account: Account; onClose: () => void }) => {
  const updateProfile = useAuthStore(s => s.updateProfile);
  const privacy = usePrivacyStore(s => s.privacy);
  const savePrivacy = usePrivacyStore(s => s.save);
  const [customStatus, setCustomStatus] = useState(account.customStatus ?? '');
  const [statusEmoji, setStatusEmoji] = useState(account.statusEmoji ?? '');
  const [birthDate, setBirthDate] = useState(account.birthDate ?? '');
  const [links, setLinks] = useState<string[]>(account.links ?? []);
  const [country, setCountry] = useState(account.country ?? '');
  const [language, setLanguage] = useState(account.language ?? '');
  const [timezone, setTimezone] = useState(account.timezone ?? '');
  // Реальные тумблеры приватности живут на сервере (profile_visibility) и
  // приходят сюда через usePrivacyStore, а не через account.privacy — тот
  // объект собирается для ЧУЖОГO профиля из publicProfile() и для своего
  // никогда не обновляется, так что читать из него тумблеры своей же
  // приватности означало бы всегда видеть значение по умолчанию.
  const [showCountry, setShowCountry] = useState(privacy.profileVisibility?.showCountry ?? true);
  const [showTimezone, setShowTimezone] = useState(privacy.profileVisibility?.showTimezone ?? true);
  const [showActivity, setShowActivity] = useState(privacy.profileVisibility?.showActivity ?? true);

  const save = () => {
    updateProfile({
      customStatus: customStatus.trim() || undefined,
      statusEmoji: statusEmoji || undefined,
      birthDate: birthDate || undefined,
      links: links.map(l => l.trim()).filter(Boolean),
      country: country.trim() || undefined,
      language: language.trim() || undefined,
      timezone: timezone || undefined,
    });
    savePrivacy({ profileVisibility: { ...privacy.profileVisibility, showCountry, showTimezone, showActivity } });
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10030] flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
        <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          onClick={e => e.stopPropagation()}
          className="w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl overflow-hidden flex flex-col"
          style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', maxHeight: '85vh' }}>
          <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="font-bold text-base" style={{ color: 'var(--t1)' }}>Расширенный профиль</h3>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-l2)' }}>
              <X size={16} style={{ color: 'var(--t2)' }} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <Field label="Статус">
              <div className="flex items-center gap-2">
                <input value={statusEmoji} onChange={e => setStatusEmoji([...e.target.value].slice(0, 2).join(''))}
                  placeholder="🙂" maxLength={4}
                  className="w-12 h-10 rounded-xl text-center text-lg outline-none" style={inputStyle} />
                <input value={customStatus} onChange={e => setCustomStatus(e.target.value.slice(0, 60))}
                  placeholder="Например: в отпуске до 20-го"
                  className={`${inputCls} flex-1`} style={inputStyle} />
              </div>
            </Field>

            <Field label="Дата рождения">
              <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)}
                className={inputCls} style={inputStyle} />
            </Field>

            <Field label="Ссылки">
              <div className="space-y-2">
                {links.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={l} onChange={e => setLinks(links.map((x, j) => j === i ? e.target.value : x))}
                      placeholder="site.ru или соцсеть" className={inputCls} style={inputStyle} />
                    <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))}
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-l2)' }}>
                      <Trash2 size={14} style={{ color: 'var(--red)' }} />
                    </button>
                  </div>
                ))}
                {links.length < 3 && (
                  <button type="button" onClick={() => setLinks([...links, ''])}
                    className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                    <Plus size={13} /> Добавить ссылку
                  </button>
                )}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Страна">
                <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Россия" className={inputCls} style={inputStyle} />
              </Field>
              <Field label="Язык">
                <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="Русский" className={inputCls} style={inputStyle} />
              </Field>
            </div>

            <Field label="Часовой пояс">
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputCls} style={inputStyle}>
                <option value="">Не указан</option>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>

            <div className="pt-1 space-y-3">
              <div className="text-xs font-semibold" style={{ color: 'var(--t3)' }}>Видимость в профиле</div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--t1)' }}>Показывать страну и язык</span>
                <Toggle on={showCountry} onClick={() => setShowCountry(v => !v)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--t1)' }}>Показывать часовой пояс</span>
                <Toggle on={showTimezone} onClick={() => setShowTimezone(v => !v)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--t1)' }}>Показывать активность (видео, сообщества)</span>
                <Toggle on={showActivity} onClick={() => setShowActivity(v => !v)} />
              </div>
            </div>
          </div>

          <div className="px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={save}
              className="w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              <Check size={15} /> Сохранить
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

import { motion } from 'framer-motion';
import { ArrowLeft, ShieldAlert, Lock, Unlock, LogOut, Check, ShieldCheck } from 'lucide-react';
import { FamilyIcon } from '../familyIcons';
import { useFamilyStore } from '../store';

const EVENT_LABEL: Record<string, string> = {
  login: 'Вход в аккаунт', login_new_device: 'Вход с нового устройства', login_fail: 'Неудачная попытка входа',
  password_change: 'Смена пароля', '2fa_enable': 'Включена 2FA', '2fa_disable': 'Отключена 2FA', logout_all: 'Завершены все сессии',
};

export const FamilySecurity = ({ onBack }: { onBack: () => void }) => {
  const { family, myMember, isAdult, resolveSOS, blockMemberAccess, unblockMemberAccess, logoutMemberEverywhere, securityFeed } = useFamilyStore();
  if (!family) return null;
  const me = myMember();
  const canManage = me ? (me.role === 'owner' || me.role === 'adult') : false;
  const activeSOS = family.sosAlerts.filter(a => !a.resolved);
  const feed = securityFeed();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Центр безопасности</h2>
      </div>

      <div className="px-4 py-3 space-y-4">
        {activeSOS.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--red)' }}>Активные SOS-сигналы</p>
            {activeSOS.map(a => (
              <motion.div key={a.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                className="mb-2 flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <motion.div animate={{ scale: [1,1.15,1] }} transition={{ duration: 1, repeat: Infinity }} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.2)' }}>
                  <ShieldAlert size={16} style={{ color: 'var(--red)' }}/>
                </motion.div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{a.memberName} нажал(а) SOS</p>
                  <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{new Date(a.createdAt).toLocaleString('ru-RU')}</p>
                </div>
                <button type="button" onClick={() => resolveSOS(a.id)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white" style={{ background: 'var(--red)' }}>
                  <Check size={11} className="inline"/> Всё хорошо
                </button>
              </motion.div>
            ))}
          </div>
        )}

        {activeSOS.length === 0 && (
          <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <ShieldCheck size={17} style={{ color: 'var(--green)' }}/>
            <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>Активных SOS-сигналов нет — всё спокойно</p>
          </div>
        )}

        {canManage && (
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Управление доступом</p>
            <div className="space-y-2">
              {family.members.filter(m => m.role !== 'owner').map(m => {
                const acc = m.accountId ? true : false;
                return (
                  <div key={m.id} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: m.avatarColor }}>{m.name[0]}</div>
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>{m.name}</p>
                    {acc ? (
                      <>
                        <button type="button" onClick={() => logoutMemberEverywhere(m.id)} className="rounded-lg p-2" style={{ background: 'var(--bg-l2)' }} title="Выйти со всех устройств">
                          <LogOut size={13} style={{ color: 'var(--t2)' }}/>
                        </button>
                        <button type="button" onClick={() => blockMemberAccess(m.id)} className="rounded-lg p-2" style={{ background: 'rgba(239,68,68,0.12)' }} title="Заблокировать">
                          <Lock size={13} style={{ color: 'var(--red)' }}/>
                        </button>
                        <button type="button" onClick={() => unblockMemberAccess(m.id)} className="rounded-lg p-2" style={{ background: 'rgba(34,197,94,0.12)' }} title="Разблокировать">
                          <Unlock size={13} style={{ color: 'var(--green)' }}/>
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--t3)' }}>без входа</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Журнал действий</p>
          {feed.length === 0 ? (
            <div className="sky-empty"><div className="sky-empty-icon"><FamilyIcon kind="safe" size={30} color="var(--t3)"/></div><p style={{ color: 'var(--t2)' }}>Событий пока нет</p></div>
          ) : (
            <div className="space-y-2">
              {feed.map((e, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}><ShieldCheck size={13} style={{ color: 'var(--t3)' }}/></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px]" style={{ color: 'var(--t1)' }}><span className="font-semibold">{e.memberName}</span> · {EVENT_LABEL[e.type] ?? e.text}</p>
                  </div>
                  <span className="shrink-0 text-[10.5px]" style={{ color: 'var(--t3)' }}>{new Date(e.at).toLocaleDateString('ru-RU')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

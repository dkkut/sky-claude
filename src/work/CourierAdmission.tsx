/**
 * Допуск к работе курьером: дата рождения (16+) и проверка паспорта.
 *
 * Возраст и статус паспорта считает и хранит только сервер
 * (server/courierverify.mjs) — здесь только форма и то, что сервер
 * вернул в ответ. «Заявка одобрена» тоже решает не этот экран, а
 * администратор: пока courier.status !== 'approved', курьер видит
 * этот экран вместо рабочего кабинета.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Clock, XCircle, Upload, FileCheck2, AlertTriangle } from 'lucide-react';
import { useCourierStore } from '@/marketplace/logistics/courierStore';
import type { Courier } from '@/marketplace/logistics/types';
import type { IconComponent } from '@/shared/icon';

const STATUS_CFG: Record<string, { label: string; color: string; icon: IconComponent }> = {
  pending:   { label: 'Заявка на рассмотрении', color: '#f59e0b', icon: Clock },
  rejected:  { label: 'Заявка отклонена',       color: '#ef4444', icon: XCircle },
  suspended: { label: 'Работа приостановлена',  color: '#ef4444', icon: AlertTriangle },
};

const VERIFY_CFG: Record<string, { label: string; color: string; icon: IconComponent }> = {
  pending:  { label: 'Паспорт на проверке',    color: '#f59e0b', icon: Clock },
  verified: { label: 'Паспорт подтверждён',    color: 'var(--green)', icon: FileCheck2 },
  rejected: { label: 'Паспорт отклонён',       color: '#ef4444', icon: XCircle },
  expired:  { label: 'Проверка устарела',      color: '#ef4444', icon: XCircle },
  invalid:  { label: 'Документ недействителен',color: '#ef4444', icon: XCircle },
};

export const CourierAdmission = ({ courier }: { courier: Courier }) => {
  const { verification, loadVerification, setBirthdate, submitVerification, uploadVerificationDoc } = useCourierStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [dob, setDob] = useState('');
  const [fullName, setFullName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadVerification(); }, [loadVerification]);

  const canResubmit = verification && ['rejected', 'expired', 'invalid'].includes(verification.status);
  const showIntake = !verification || canResubmit;

  const submit = async () => {
    setError('');
    if (!dob) { setError('Укажите дату рождения'); return; }
    if (!fullName.trim()) { setError('Укажите ФИО, как в документе'); return; }
    if (!file) { setError('Приложите скан или фото документа'); return; }
    setBusy(true);
    try {
      const dobRes = await setBirthdate(dob);
      if (!dobRes.ok) { setError(dobRes.error === 'bad_date' ? 'Проверьте дату рождения' : 'Не получилось сохранить дату'); return; }
      const subRes = await submitVerification(fullName.trim());
      if (!subRes.ok) {
        setError(subRes.error === 'underage' ? 'Курьером может стать человек не младше 16 лет'
          : subRes.error === 'already_pending' ? 'Заявка уже на проверке' : 'Не получилось подать заявку');
        return;
      }
      const verId = useCourierStore.getState().verification?.id;
      if (verId) {
        const docRes = await uploadVerificationDoc(verId, file);
        if (!docRes.ok) {
          setError(docRes.error === 'unsupported_media' ? 'Файл не похож на документ — приложите фото или скан целиком'
            : docRes.error === 'too_large' ? 'Файл слишком большой' : 'Не получилось загрузить документ');
          return;
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const reattachDoc = async () => {
    if (!file || !verification) return;
    setBusy(true);
    setError('');
    try {
      const r = await uploadVerificationDoc(verification.id, file);
      if (!r.ok) setError(r.error === 'unsupported_media' ? 'Файл не похож на документ' : 'Не получилось загрузить документ');
      else setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const statusCfg = STATUS_CFG[courier.status] ?? STATUS_CFG.pending;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
      <div className="rounded-3xl p-5" style={{ background: `${statusCfg.color}12`, border: `1px solid ${statusCfg.color}40` }}>
        <div className="flex items-center gap-2">
          <StatusIcon size={18} style={{ color: statusCfg.color }} />
          <p className="text-[14px] font-black" style={{ color: 'var(--t1)' }}>{statusCfg.label}</p>
        </div>
        {courier.statusReason && (
          <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--t3)' }}>{courier.statusReason}</p>
        )}
        {courier.status === 'pending' && (
          <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--t3)' }}>
            Чтобы начать работать, нужно подтвердить возраст (16+) и паспорт. Решение принимает администрация Sky.
          </p>
        )}
        {courier.status === 'suspended' && (
          <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--t3)' }}>
            Выход на связь и новые заказы из пула временно недоступны.
          </p>
        )}
      </div>

      {!showIntake && verification && (
        <div className="mt-3 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          {(() => {
            const cfg = VERIFY_CFG[verification.status] ?? VERIFY_CFG.pending;
            const Icon = cfg.icon;
            return (
              <div className="flex items-center gap-2">
                <Icon size={16} style={{ color: cfg.color }} />
                <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{cfg.label}</p>
              </div>
            );
          })()}
          {verification.status === 'pending' && !verification.hasDoc && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Нужно приложить скан или фото документа.</p>
              <input ref={fileRef} type="file" accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-[12px]" style={{ color: 'var(--t2)' }} />
              {error && <p className="text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}
              <button type="button" disabled={!file || busy} onClick={reattachDoc}
                className="sky-btn-primary w-full justify-center py-2.5 text-[13px] disabled:opacity-50">
                <Upload size={14} />Загрузить документ
              </button>
            </div>
          )}
        </div>
      )}

      {showIntake && (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>
              <ShieldCheck size={14} />Проверка личности
            </p>
            <p className="mb-3 text-[11.5px]" style={{ color: 'var(--t3)' }}>
              Данные проверяет администрация Sky, видны только ей. Курьером может стать человек не младше 16 лет.
            </p>

            <label className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Дата рождения</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
              className="mb-3 w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />

            <label className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>ФИО как в документе</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович"
              className="mb-3 w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />

            <label className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Скан или фото документа</label>
            <input ref={fileRef} type="file" accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[12px]" style={{ color: 'var(--t2)' }} />

            {error && <p className="mt-2 text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}
          </div>

          <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={busy} onClick={submit}
            className="sky-btn-primary w-full justify-center py-3.5 text-[14px] disabled:opacity-50">
            {busy ? 'Отправляем…' : 'Отправить на проверку'}
          </motion.button>
        </div>
      )}
    </div>
  );
};

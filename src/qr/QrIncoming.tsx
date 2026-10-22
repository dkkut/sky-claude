/** Ссылка/QR Sky, открытая обычной камерой (`/?qr=КОД`): после входа показываем карточку человека. */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/core/auth/store';
import { takeIncomingQr } from './qrApi';
import { ScanContact } from './ScanContact';

export function QrIncoming() {
  const authed = useAuthStore((s) => s.isAuthenticated && Boolean(s.currentUserId));
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => { if (authed) { const c = takeIncomingQr(); if (c) setCode(c); } }, [authed]);
  return code ? <ScanContact code={code} onClose={() => setCode(null)} /> : null;
}

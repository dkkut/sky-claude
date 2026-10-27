/**
 * Данные для виджетов Media Home, у которых нет своего удобного запроса: популярные билеты, активные брони, личное хранилище, защита аккаунта.
 * Только данные самого человека (profileId из сессии) и публичная афиша. Секретов нет: у защиты — только да/нет по факторам, без значений.
 */
import { query } from './db.mjs';
import { quotaBytesFor, usedBytesFor } from './storagequota.mjs';

/** Билеты, которые покупают чаще всего: ближайшие мероприятия по числу проданных билетов. Если продаж нет — пусто, а не выдумка. */
export const popularEvents = async () => {
  const { rows } = await query(
    `SELECT e.id, e.title, e.city, e.venue, e.starts_at, e.category, COALESCE(SUM(t.sold), 0)::int AS sold
       FROM ticket_events e JOIN ticket_types t ON t.event_id = e.id
      WHERE e.status = 'published' AND e.starts_at > now()
      GROUP BY e.id HAVING COALESCE(SUM(t.sold), 0) > 0
      ORDER BY sold DESC, e.starts_at ASC LIMIT 6`);
  return { events: rows.map((r) => ({ id: r.id, title: r.title, city: r.city, venue: r.venue, startsAt: r.starts_at.toISOString(), category: r.category, sold: r.sold })) };
};

/** Активные брони человека: записи в организациях Sky GO и жильё/туры/отели. */
export const activeBookings = async (me) => {
  const [places, stays] = await Promise.all([
    query(`SELECT bk.id, bk.status, bk.starts_at, b.name AS place, bk.item_title
             FROM gop_bookings bk JOIN kb_businesses b ON b.id = bk.business_id
            WHERE bk.buyer_id = $1 AND bk.status IN ('awaiting_payment','requested','confirmed') AND bk.ends_at > now()
            ORDER BY bk.starts_at LIMIT 10`, [me]),
    query(`SELECT o.id, o.status, o.data->>'checkIn' AS check_in, o.data->>'checkOut' AS check_out, l.title
             FROM go_orders o LEFT JOIN go_listings l ON l.id = o.data->>'listingId'
            WHERE o.customer_id = $1 AND o.kind = 'stay' AND o.status IN ('requested','awaiting_payment','payment_reported','paid')
              AND (o.data->>'checkOut') >= to_char(current_date, 'YYYY-MM-DD')
            ORDER BY o.data->>'checkIn' LIMIT 10`, [me]),
  ]);
  const items = [
    ...places.rows.map((r) => ({ kind: 'place', id: r.id, title: r.place, sub: r.item_title ?? '', at: r.starts_at.toISOString(), status: r.status })),
    ...stays.rows.map((r) => ({ kind: 'stay', id: r.id, title: r.title ?? 'Бронь', sub: `${r.check_in ?? ''} — ${r.check_out ?? ''}`, at: r.check_in ? new Date(`${r.check_in}T12:00:00`).toISOString() : '', status: r.status })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 8);
  return { bookings: items };
};

/** Занятость личного хранилища (личные кино и музыка) и квота. */
export const storageUsage = async (me) => {
  const [used, quota] = await Promise.all([usedBytesFor(me), quotaBytesFor(me)]);
  return { usedBytes: used, quotaBytes: quota };
};

/** Насколько защищён аккаунт: сумма весов включённых факторов. Показываются только «есть/нет». */
export const securitySummary = async (me) => {
  const sid = (await query('SELECT sky_id FROM profiles WHERE id=$1', [me])).rows[0]?.sky_id;
  if (!sid) return { score: 0, level: 'low', factors: [] };
  const [s, codes, pk, be, lock] = await Promise.all([
    query('SELECT email_verified, two_factor_enabled, ip_pin_enabled FROM sky_ids WHERE id=$1', [sid]),
    query('SELECT count(*)::int AS n FROM sky_backup_codes WHERE sky_id=$1 AND used_at IS NULL', [sid]),
    query(`SELECT count(*)::int AS n FROM sky_passkeys WHERE sky_id=$1 AND status='active'`, [sid]),
    query('SELECT 1 FROM sky_backup_emails WHERE sky_id=$1 AND email IS NOT NULL AND verified_at IS NOT NULL', [sid]),
    query('SELECT 1 FROM app_lock_devices WHERE sky_id=$1 LIMIT 1', [sid]),
  ]);
  const r = s.rows[0] ?? {};
  const factors = [
    { key: 'email', label: 'Подтверждённая почта', weight: 15, on: Boolean(r.email_verified) },
    { key: '2fa', label: 'Код аутентификатора', weight: 35, on: Boolean(r.two_factor_enabled) },
    { key: 'codes', label: 'Резервные коды', weight: 10, on: codes.rows[0].n > 0 },
    { key: 'passkey', label: 'Ключ доступа', weight: 15, on: pk.rows[0].n > 0 },
    { key: 'backup_email', label: 'Резервная почта', weight: 10, on: Boolean(be.rows[0]) },
    { key: 'app_lock', label: 'Замок приложения', weight: 10, on: Boolean(lock.rows[0]) },
    { key: 'ip_pin', label: 'PIN при смене адреса', weight: 5, on: Boolean(r.ip_pin_enabled) },
  ];
  const score = factors.reduce((a, f) => a + (f.on ? f.weight : 0), 0);
  return { score, level: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low', factors };
};

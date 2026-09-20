/**
 * Sky Family: серверная семейная группа.
 *
 * Раньше вся семья жила в localStorage одного браузера
 * (src/family/store.ts) — «приглашение» мгновенно добавляло участника
 * из локального списка аккаунтов устройства (второй профиль на этом же
 * телефоне), Prime выдавался локальным флагом, а ролями, лимитами и
 * владением управлял сам клиент. Здесь — настоящая серверная сущность:
 * приглашение уходит реальному Sky ID через справочник людей
 * (server/directory.mjs), принять/отклонить может только сам
 * приглашённый, а роль, лимит участников и владелец решает только
 * сервер.
 *
 * Что этот файл не делает никогда:
 *   · не читает role/ownerId/familyId, присланные клиентом, как истину —
 *     принадлежность и роль всегда берутся из базы по actorId;
 *   · не меняет владельца иначе как через transferFamilyOwnership —
 *     нет пути, которым роль в базе стала бы 'owner' помимо него;
 *   · не выдаёт Prime дольше оплаченного — количество дней всегда
 *     берётся из серверного прайса (FAMILY_PLANS), а не от клиента;
 *   · не двигает деньги мимо wallet.mjs — Sky Family не второй кошелёк.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { wallet } from './wallet.mjs';
import { grantPrime } from './skyid.mjs';
import { pushFamily } from './signal.mjs';

export const FAMILY_ID_RE = /^fam-[0-9a-f-]{36}$/;
export const MEMBER_ID_RE = /^fm-[0-9a-f-]{36}$/;
export const INVITE_ID_RE = /^fi-[0-9a-f-]{36}$/;

const MAX_NAME = 40;
const INVITE_DAYS = 7;
const INVITABLE_ROLES = ['adult', 'teen', 'guest'];
const EDITABLE_ROLES = ['adult', 'teen', 'child', 'guest'];

/** Цена и срок Sky Prime Family — только здесь, сервер не спрашивает клиента. */
export const FAMILY_PRIME_PLANS = {
  month: { id: 'month', label: 'Месяц', price: 599, days: 30 },
  year: { id: 'year', label: 'Год', price: 4990, days: 365 },
};

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/**
 * Журнал Sky Family. Отдельная функция, не общий admin-журнал: действие
 * может совершить обычный участник (принял приглашение, вышел), а не
 * только администратор.
 */
const logFamily = async (familyId, actorId, action, targetId, detail = {}) => {
  try {
    await query(
      `INSERT INTO family_audit_log (id, family_id, actor_id, action, target_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [`fal-${generateId()}`, familyId ?? null, actorId ?? null, text(action, 64),
        targetId ? text(targetId, 128) : null, JSON.stringify(detail ?? {})]);
  } catch { /* журнал не должен ронять то, что он описывает */ }
};

const notifyFamily = async (userId, familyId, kind, textLine) => {
  if (!userId) return;
  const id = `fnn-${generateId()}`;
  await query(
    `INSERT INTO family_notifications (id, user_id, family_id, kind, text)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, userId, familyId ?? null, text(kind, 40), text(textLine, 200)]);
  pushFamily([userId], { type: 'family-notification', payload: { id, kind, text: text(textLine, 200), familyId: familyId ?? null } });
};

/* ─── Выдача наружу ────────────────────────────────────────────────── */

const toMember = (row) => ({
  id: row.id,
  familyId: row.family_id,
  profileId: row.profile_id ?? null,
  name: row.display_name ?? row.profile_name ?? 'Участник',
  username: row.profile_username ?? undefined,
  role: row.role,
  status: row.status,
  permissions: row.permissions ?? {},
  joinedAt: row.joined_at?.toISOString?.() ?? undefined,
});

const toFamily = (row) => ({
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  status: row.status,
  memberLimit: row.member_limit,
  adultLimit: row.adult_limit,
  primeUntil: row.prime_paid_until?.toISOString?.() ?? null,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

const toInvitation = (row) => ({
  id: row.id,
  familyId: row.family_id,
  familyName: row.family_name ?? undefined,
  senderId: row.sender_id,
  senderName: row.sender_name ?? undefined,
  recipientId: row.recipient_id,
  role: row.role,
  status: row.status,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  expiresAt: row.expires_at?.toISOString?.() ?? undefined,
});

/* ─── Своя семья ───────────────────────────────────────────────────── */

const myActiveMembership = async (profileId) => {
  const { rows } = await query(
    `SELECT * FROM family_members WHERE profile_id = $1 AND status = 'active'`, [profileId]);
  return rows[0] ?? null;
};

const familyRow = async (familyId) => {
  const { rows } = await query('SELECT * FROM families WHERE id = $1', [familyId]);
  return rows[0] ?? null;
};

const familyMembersOf = async (familyId) => {
  const { rows } = await query(
    `SELECT m.*, p.name AS profile_name, p.username AS profile_username
       FROM family_members m LEFT JOIN profiles p ON p.id = m.profile_id
      WHERE m.family_id = $1 AND m.status = 'active'
      ORDER BY (m.role = 'owner') DESC, m.joined_at`, [familyId]);
  return rows.map(toMember);
};

/** Моя семья, участники, мой членский ряд — то, что рисует главный экран. */
export const myFamily = async (profileId) => {
  const membership = await myActiveMembership(profileId);
  if (!membership) return null;
  const family = await familyRow(membership.family_id);
  if (!family) return null;
  const members = await familyMembersOf(family.id);
  const result = { family: toFamily(family), members, me: toMember({ ...membership, profile_name: null, profile_username: null }) };

  // Отправленные и ещё не решённые приглашения видит только владелец —
  // это его собственное управление семьёй, а не общая информация.
  if (family.owner_id === profileId) {
    const { rows: pending } = await query(
      `SELECT i.*, f.name AS family_name, p.name AS sender_name
         FROM family_invitations i JOIN families f ON f.id = i.family_id JOIN profiles p ON p.id = i.sender_id
        WHERE i.family_id = $1 AND i.status = 'pending' AND i.expires_at > now()
        ORDER BY i.created_at DESC`, [family.id]);
    result.pendingInvitations = pending.map(toInvitation);
  }
  return result;
};

/** Приглашения, ждущие моего решения. */
export const myInvitations = async (profileId) => {
  const { rows } = await query(
    `SELECT i.*, f.name AS family_name, p.name AS sender_name
       FROM family_invitations i
       JOIN families f ON f.id = i.family_id
       JOIN profiles p ON p.id = i.sender_id
      WHERE i.recipient_id = $1 AND i.status = 'pending' AND i.expires_at > now()
      ORDER BY i.created_at DESC`, [profileId]);
  return rows.map(toInvitation);
};

/* ─── Жизненный цикл семьи ─────────────────────────────────────────── */

export const createFamily = async (profileId, name) => {
  const clean = text(name, MAX_NAME);
  if (!clean) return { error: 'bad_name' };
  if (await myActiveMembership(profileId)) return { error: 'already_in_family' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const famId = `fam-${generateId()}`;
    await client.query(
      `INSERT INTO families (id, owner_id, name) VALUES ($1,$2,$3)`,
      [famId, profileId, clean]);
    await client.query(
      `INSERT INTO family_members (id, family_id, profile_id, role) VALUES ($1,$2,$3,'owner')`,
      [`fm-${generateId()}`, famId, profileId]);
    await client.query('COMMIT');
    await logFamily(famId, profileId, 'family_created', famId, { name: clean });
    return await myFamily(profileId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return { error: 'already_in_family' };
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Ребёнок без собственного входа — карточка внутри семьи, не аккаунт.
 * Заводит только владелец, приглашения тут нет и быть не может: войти
 * под этим участником нельзя.
 */
export const addPlaceholderMember = async (actorId, familyId, name, role) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? ''))) return { error: 'not_found' };
  const clean = text(name, 20);
  if (!clean) return { error: 'bad_name' };
  if (!['child', 'teen'].includes(String(role))) return { error: 'bad_role' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: fam } = await client.query('SELECT * FROM families WHERE id = $1 FOR UPDATE', [familyId]);
    const family = fam[0];
    if (!family || family.status !== 'active' || family.owner_id !== actorId) {
      await client.query('ROLLBACK'); return { error: 'not_allowed' };
    }
    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS n FROM family_members WHERE family_id = $1 AND status = 'active'`, [familyId]);
    if (cnt[0].n >= family.member_limit) { await client.query('ROLLBACK'); return { error: 'member_limit' }; }

    const id = `fm-${generateId()}`;
    await client.query(
      `INSERT INTO family_members (id, family_id, display_name, role) VALUES ($1,$2,$3,$4)`,
      [id, familyId, clean, role]);
    await client.query('COMMIT');
    await logFamily(familyId, actorId, 'placeholder_added', id, { name: clean, role });
    return { member: toMember({ id, family_id: familyId, display_name: clean, role, status: 'active' }) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Приглашения ──────────────────────────────────────────────────── */

export const inviteMember = async (actorId, familyId, recipientId, role) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? ''))) return { error: 'not_found' };
  const rid = String(recipientId ?? '');
  if (!rid) return { error: 'not_found' };
  if (rid === actorId) return { error: 'self_invite' };
  if (!INVITABLE_ROLES.includes(String(role))) return { error: 'bad_role' };

  const family = await familyRow(familyId);
  if (!family || family.status !== 'active') return { error: 'not_found' };
  if (family.owner_id !== actorId) return { error: 'not_allowed' };

  const { rows: recipient } = await query('SELECT id FROM profiles WHERE id = $1', [rid]);
  if (!recipient[0]) return { error: 'no_such_user' };

  if (await myActiveMembership(rid)) return { error: 'recipient_in_family' };

  const { rows: cnt } = await query(
    `SELECT count(*)::int AS n FROM family_members WHERE family_id = $1 AND status = 'active'`, [familyId]);
  if (cnt[0].n >= family.member_limit) return { error: 'member_limit' };

  if (role === 'adult') {
    const { rows: adults } = await query(
      `SELECT count(*)::int AS n FROM family_members
        WHERE family_id = $1 AND status = 'active' AND role IN ('owner','adult')`, [familyId]);
    if (adults[0].n >= family.adult_limit) return { error: 'adult_limit' };
  }

  const id = `fi-${generateId()}`;
  try {
    await query(
      `INSERT INTO family_invitations (id, family_id, sender_id, recipient_id, role, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6::int * interval '1 day'))`,
      [id, familyId, actorId, rid, role, INVITE_DAYS]);
  } catch (err) {
    if (err.code === '23505') return { error: 'already_pending' };
    throw err;
  }
  await logFamily(familyId, actorId, 'invitation_sent', id, { recipientId: rid, role });
  await notifyFamily(rid, familyId, 'invited', `Вас пригласили в семью «${family.name}»`);
  const { rows } = await query(
    `SELECT i.*, f.name AS family_name, p.name AS sender_name
       FROM family_invitations i JOIN families f ON f.id = i.family_id JOIN profiles p ON p.id = i.sender_id
      WHERE i.id = $1`, [id]);
  return { invitation: toInvitation(rows[0]) };
};

export const cancelInvitation = async (actorId, invitationId) => {
  if (!INVITE_ID_RE.test(String(invitationId ?? ''))) return { error: 'not_found' };
  const { rows: cur } = await query(
    `SELECT i.*, f.owner_id FROM family_invitations i JOIN families f ON f.id = i.family_id WHERE i.id = $1`,
    [invitationId]);
  const row = cur[0];
  if (!row || row.owner_id !== actorId) return { error: 'not_found' };
  if (row.status !== 'pending') return { error: 'already_decided' };

  const { rows: upd } = await query(
    `UPDATE family_invitations SET status = 'cancelled', resolved_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`,
    [invitationId]);
  if (!upd[0]) return { error: 'already_decided' };
  await logFamily(row.family_id, actorId, 'invitation_cancelled', invitationId);
  return { ok: true };
};

/**
 * Принять приглашение. Всё решающее — под блокировкой строк семьи и
 * приглашения в одной транзакции: лимит участников/взрослых и «уже
 * состоит в другой семье» проверяются заново, а не по значению,
 * прочитанному до захода в транзакцию — иначе два одновременных
 * приглашения одному лимиту могли бы оба пройти.
 */
export const acceptInvitation = async (profileId, invitationId) => {
  if (!INVITE_ID_RE.test(String(invitationId ?? ''))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: inv } = await client.query(
      `SELECT * FROM family_invitations WHERE id = $1 AND recipient_id = $2 FOR UPDATE`,
      [invitationId, profileId]);
    const invitation = inv[0];
    if (!invitation) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (invitation.status !== 'pending') { await client.query('ROLLBACK'); return { error: 'already_decided' }; }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE family_invitations SET status = 'expired' WHERE id = $1`, [invitationId]);
      await client.query('COMMIT');
      return { error: 'expired' };
    }

    const { rows: fam } = await client.query('SELECT * FROM families WHERE id = $1 FOR UPDATE', [invitation.family_id]);
    const family = fam[0];
    if (!family || family.status !== 'active') { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const { rows: already } = await client.query(
      `SELECT 1 FROM family_members WHERE profile_id = $1 AND status = 'active'`, [profileId]);
    if (already[0]) { await client.query('ROLLBACK'); return { error: 'already_in_family' }; }

    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS n FROM family_members WHERE family_id = $1 AND status = 'active'`, [family.id]);
    if (cnt[0].n >= family.member_limit) { await client.query('ROLLBACK'); return { error: 'member_limit' }; }

    if (invitation.role === 'adult') {
      const { rows: adults } = await client.query(
        `SELECT count(*)::int AS n FROM family_members
          WHERE family_id = $1 AND status = 'active' AND role IN ('owner','adult')`, [family.id]);
      if (adults[0].n >= family.adult_limit) { await client.query('ROLLBACK'); return { error: 'adult_limit' }; }
    }

    const memberId = `fm-${generateId()}`;
    await client.query(
      `INSERT INTO family_members (id, family_id, profile_id, role) VALUES ($1,$2,$3,$4)`,
      [memberId, family.id, profileId, invitation.role]);
    await client.query(
      `UPDATE family_invitations SET status = 'accepted', resolved_at = now() WHERE id = $1`, [invitationId]);
    await client.query('COMMIT');

    await logFamily(family.id, profileId, 'invitation_accepted', invitationId);
    await notifyFamily(invitation.sender_id, family.id, 'accepted', 'Приглашение в семью принято');

    // Семье уже оплачен Prime — новый участник получает его на остаток срока.
    if (family.prime_paid_until && new Date(family.prime_paid_until).getTime() > Date.now()) {
      const days = Math.ceil((new Date(family.prime_paid_until).getTime() - Date.now()) / 86400000);
      const { rows: prof } = await query('SELECT sky_id FROM profiles WHERE id = $1', [profileId]);
      if (prof[0]?.sky_id && days > 0) {
        await grantPrime(prof[0].sky_id, profileId, 'family', days, { additive: true }).catch(() => {});
      }
    }
    return await myFamily(profileId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return { error: 'already_in_family' };
    throw err;
  } finally {
    client.release();
  }
};

export const rejectInvitation = async (profileId, invitationId) => {
  if (!INVITE_ID_RE.test(String(invitationId ?? ''))) return { error: 'not_found' };
  const { rows: upd } = await query(
    `UPDATE family_invitations SET status = 'rejected', resolved_at = now()
      WHERE id = $1 AND recipient_id = $2 AND status = 'pending' RETURNING *`,
    [invitationId, profileId]);
  if (!upd[0]) return { error: 'not_found' };
  await logFamily(upd[0].family_id, profileId, 'invitation_rejected', invitationId);
  await notifyFamily(upd[0].sender_id, upd[0].family_id, 'rejected', 'Приглашение в семью отклонено');
  return { ok: true };
};

/* ─── Участники ────────────────────────────────────────────────────── */

export const removeMember = async (actorId, familyId, memberId) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? '')) || !MEMBER_ID_RE.test(String(memberId ?? ''))) {
    return { error: 'not_found' };
  }
  const family = await familyRow(familyId);
  if (!family || family.status !== 'active' || family.owner_id !== actorId) return { error: 'not_allowed' };

  const { rows: cur } = await query(
    `SELECT * FROM family_members WHERE id = $1 AND family_id = $2 AND status = 'active'`, [memberId, familyId]);
  const member = cur[0];
  if (!member) return { error: 'not_found' };
  if (member.role === 'owner') return { error: 'cannot_remove_owner' };

  const { rows: upd } = await query(
    `UPDATE family_members SET status = 'removed', left_at = now(), removed_by = $2
      WHERE id = $1 AND status = 'active' RETURNING *`, [memberId, actorId]);
  if (!upd[0]) return { error: 'not_found' };

  await logFamily(familyId, actorId, 'member_removed', memberId, { role: member.role });
  if (member.profile_id) await notifyFamily(member.profile_id, familyId, 'removed', `Вы удалены из семьи «${family.name}»`);
  return { ok: true };
};

/**
 * Выйти из семьи. Владелец так выйти не может — семья не должна
 * остаться без владельца: сначала передать владение или закрыть семью.
 */
export const leaveFamily = async (profileId) => {
  const membership = await myActiveMembership(profileId);
  if (!membership) return { error: 'not_in_family' };
  if (membership.role === 'owner') return { error: 'owner_must_transfer_or_close' };

  const { rows: upd } = await query(
    `UPDATE family_members SET status = 'left', left_at = now()
      WHERE id = $1 AND status = 'active' RETURNING *`, [membership.id]);
  if (!upd[0]) return { error: 'not_in_family' };
  await logFamily(membership.family_id, profileId, 'member_left', membership.id);
  const family = await familyRow(membership.family_id);
  if (family) await notifyFamily(family.owner_id, family.id, 'left', 'Участник покинул семью');
  return { ok: true };
};

/** Владелец меняет роль/разрешения обычного участника (не себя, не в owner). */
export const updateMember = async (actorId, familyId, memberId, patch = {}) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? '')) || !MEMBER_ID_RE.test(String(memberId ?? ''))) {
    return { error: 'not_found' };
  }
  const family = await familyRow(familyId);
  if (!family || family.status !== 'active' || family.owner_id !== actorId) return { error: 'not_allowed' };

  const { rows: cur } = await query(
    `SELECT * FROM family_members WHERE id = $1 AND family_id = $2 AND status = 'active'`, [memberId, familyId]);
  const member = cur[0];
  if (!member || member.role === 'owner') return { error: 'not_found' };

  const sets = [];
  const args = [memberId];
  if (patch.role !== undefined) {
    if (!EDITABLE_ROLES.includes(String(patch.role))) return { error: 'bad_role' };
    if (patch.role === 'adult' && member.role !== 'adult') {
      const { rows: adults } = await query(
        `SELECT count(*)::int AS n FROM family_members
          WHERE family_id = $1 AND status = 'active' AND role IN ('owner','adult')`, [familyId]);
      if (adults[0].n >= family.adult_limit) return { error: 'adult_limit' };
    }
    args.push(patch.role); sets.push(`role = $${args.length}`);
  }
  if (patch.permissions !== undefined && typeof patch.permissions === 'object' && patch.permissions !== null) {
    args.push(JSON.stringify(patch.permissions)); sets.push(`permissions = $${args.length}::jsonb`);
  }
  if (sets.length === 0) return { error: 'nothing_to_update' };

  const { rows: upd } = await query(
    `UPDATE family_members SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
  await logFamily(familyId, actorId, 'member_updated', memberId, patch);
  return { member: toMember(upd[0]) };
};

/**
 * Передать владение. Атомарно: старый владелец становится взрослым
 * участником, новый — владельцем, families.owner_id обновляется той же
 * транзакцией — снаружи нет момента, когда у семьи два владельца или ни
 * одного.
 */
export const transferOwnership = async (actorId, familyId, newOwnerMemberId) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? '')) || !MEMBER_ID_RE.test(String(newOwnerMemberId ?? ''))) {
    return { error: 'not_found' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: fam } = await client.query('SELECT * FROM families WHERE id = $1 FOR UPDATE', [familyId]);
    const family = fam[0];
    if (!family || family.status !== 'active' || family.owner_id !== actorId) {
      await client.query('ROLLBACK'); return { error: 'not_allowed' };
    }
    const { rows: cur } = await client.query(
      `SELECT * FROM family_members WHERE family_id = $1 AND profile_id = $2 AND status = 'active' FOR UPDATE`,
      [familyId, actorId]);
    const oldOwner = cur[0];
    const { rows: next } = await client.query(
      `SELECT * FROM family_members WHERE id = $1 AND family_id = $2 AND status = 'active' FOR UPDATE`,
      [newOwnerMemberId, familyId]);
    const newOwner = next[0];
    if (!oldOwner || !newOwner || !newOwner.profile_id || newOwner.role === 'owner') {
      await client.query('ROLLBACK'); return { error: 'not_found' };
    }

    await client.query(`UPDATE family_members SET role = 'adult' WHERE id = $1`, [oldOwner.id]);
    await client.query(`UPDATE family_members SET role = 'owner' WHERE id = $1`, [newOwner.id]);
    await client.query(`UPDATE families SET owner_id = $2, updated_at = now() WHERE id = $1`, [familyId, newOwner.profile_id]);
    await client.query('COMMIT');

    await logFamily(familyId, actorId, 'ownership_transferred', newOwner.id, { toProfileId: newOwner.profile_id });
    await notifyFamily(newOwner.profile_id, familyId, 'ownership', 'Вы стали владельцем семьи');
    await notifyFamily(actorId, familyId, 'ownership', 'Вы передали владение семьёй');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Закрыть семью: владелец подтвердил, все членства завершаются. */
export const closeFamily = async (actorId, familyId) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? ''))) return { error: 'not_found' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: fam } = await client.query('SELECT * FROM families WHERE id = $1 FOR UPDATE', [familyId]);
    const family = fam[0];
    if (!family || family.status !== 'active' || family.owner_id !== actorId) {
      await client.query('ROLLBACK'); return { error: 'not_allowed' };
    }
    const { rows: members } = await client.query(
      `UPDATE family_members SET status = 'removed', left_at = now(), removed_by = $2
        WHERE family_id = $1 AND status = 'active' RETURNING profile_id`, [familyId, actorId]);
    await client.query(
      `UPDATE families SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`, [familyId]);
    await client.query(
      `UPDATE family_invitations SET status = 'cancelled', resolved_at = now()
        WHERE family_id = $1 AND status = 'pending'`, [familyId]);
    await client.query('COMMIT');
    await logFamily(familyId, actorId, 'family_closed', familyId);
    for (const m of members) if (m.profile_id && m.profile_id !== actorId) {
      await notifyFamily(m.profile_id, familyId, 'closed', `Семья «${family.name}» закрыта владельцем`);
    }
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Sky Prime Family ─────────────────────────────────────────────── */

/**
 * Купить/продлить Sky Prime Family. Платит владелец — с личного
 * кошелька, через тот же wallet.spend, что и любая другая подписка
 * Sky (paySellerSubscription, ticket-organizer). Цена и срок — только
 * из FAMILY_PRIME_PLANS, присланный planId лишь выбирает из них.
 *
 * Продление добавляет ровно plan.days и семье, и — тем же числом дней
 * — каждому активному участнику: так семья и участники не расходятся
 * по дате, сколько бы раз ни продлевали.
 */
export const purchaseFamilyPrime = async (actorId, familyId, planId) => {
  if (!FAMILY_ID_RE.test(String(familyId ?? ''))) return { error: 'not_found' };
  const plan = FAMILY_PRIME_PLANS[String(planId)];
  if (!plan) return { error: 'bad_plan' };

  const family = await familyRow(familyId);
  if (!family || family.status !== 'active' || family.owner_id !== actorId) return { error: 'not_allowed' };

  const paid = await wallet.spend(actorId, plan.price, 'family_prime', `Sky Prime Family · ${plan.label}`);
  if (paid.error) return paid;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: upd } = await client.query(
      `UPDATE families
          SET prime_paid_until = GREATEST(COALESCE(prime_paid_until, now()), now()) + ($2::int * interval '1 day'),
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [familyId, plan.days]);
    await client.query('COMMIT');

    const members = await familyMembersOf(familyId);
    const { rows: profs } = await query(
      `SELECT id, sky_id FROM profiles WHERE id = ANY($1::text[])`,
      [members.map((m) => m.profileId).filter(Boolean)]);
    for (const p of profs) {
      await grantPrime(p.sky_id, p.id, 'family', plan.days, { additive: true }).catch(() => {});
    }
    await logFamily(familyId, actorId, 'prime_purchased', familyId, { plan: plan.id, days: plan.days, price: plan.price });
    for (const m of members) if (m.profileId && m.profileId !== actorId) {
      await notifyFamily(m.profileId, familyId, 'prime', 'Sky Prime Family активирован для всей семьи');
    }
    return { family: toFamily(upd[0]), balance: paid.balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Деньги списаны, а продление не прошло — возвращаем: платёж без
    // услуги хуже, чем услуга без платежа (тот же приём, что и в Sky Market).
    await wallet.refund(actorId, plan.price, 'Sky Prime Family: возврат за сбой продления').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Уведомления ──────────────────────────────────────────────────── */

export const listNotifications = async (profileId, { limit } = {}) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await query(
    `SELECT * FROM family_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [profileId, lim]);
  return rows.map((r) => ({
    id: r.id, familyId: r.family_id, kind: r.kind, text: r.text, read: r.read,
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};

export const readNotification = async (profileId, id) => {
  const { rowCount } = await query(
    `UPDATE family_notifications SET read = TRUE WHERE id = $1 AND user_id = $2`, [String(id ?? ''), profileId]);
  return rowCount > 0;
};

/* ─── Админ-панель ─────────────────────────────────────────────────── */

/** Право 'moderation' — то же, чем в проекте смотрят на людей и бан их. */
export const adminListFamilies = async (adminId, { q, limit } = {}) => {
  if (!(await can(adminId, 'moderation'))) return null;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const args = [];
  const where = [];
  const needle = text(q, 60).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`(lower(f.name) LIKE $${args.length} ESCAPE '\\' OR lower(p.username) LIKE $${args.length} ESCAPE '\\')`);
  }
  args.push(lim);
  const { rows } = await query(
    `SELECT f.*, p.name AS owner_name, p.username AS owner_username,
            (SELECT count(*)::int FROM family_members m WHERE m.family_id = f.id AND m.status = 'active') AS member_count
       FROM families f JOIN profiles p ON p.id = f.owner_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY f.created_at DESC LIMIT $${args.length}`, args);
  return rows.map((r) => ({
    ...toFamily(r), ownerName: r.owner_name, ownerUsername: r.owner_username, memberCount: r.member_count,
  }));
};

export const adminFamilyDetail = async (adminId, familyId) => {
  if (!(await can(adminId, 'moderation'))) return null;
  if (!FAMILY_ID_RE.test(String(familyId ?? ''))) return null;
  const family = await familyRow(familyId);
  if (!family) return null;
  const members = await familyMembersOf(familyId);
  const { rows: invites } = await query(
    `SELECT i.*, f.name AS family_name, p.name AS sender_name
       FROM family_invitations i JOIN families f ON f.id = i.family_id JOIN profiles p ON p.id = i.sender_id
      WHERE i.family_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [familyId]);
  const { rows: log } = await query(
    `SELECT * FROM family_audit_log WHERE family_id = $1 ORDER BY created_at DESC LIMIT 100`, [familyId]);
  return {
    family: toFamily(family), members, invitations: invites.map(toInvitation),
    log: log.map((r) => ({
      id: r.id, actorId: r.actor_id, action: r.action, targetId: r.target_id,
      detail: r.detail, createdAt: r.created_at?.toISOString?.() ?? undefined,
    })),
  };
};

/** Приостановить/восстановить проблемную семью — как бан, только для семьи. */
export const adminSetFamilyStatus = async (adminId, familyId, status) => {
  if (!(await can(adminId, 'moderation'))) return { error: 'not_allowed' };
  if (!FAMILY_ID_RE.test(String(familyId ?? ''))) return { error: 'not_found' };
  if (!['active', 'suspended'].includes(String(status))) return { error: 'bad_status' };

  const { rows } = await query(
    `UPDATE families SET status = $2, updated_at = now()
      WHERE id = $1 AND status IN ('active','suspended') RETURNING *`,
    [familyId, status]);
  if (!rows[0]) return { error: 'not_found' };
  await logFamily(familyId, adminId, status === 'suspended' ? 'admin_suspended' : 'admin_restored', familyId);
  return { family: toFamily(rows[0]) };
};

/**
 * Нарушения и штрафы Market/Warehouse/PVZ по HTTP.
 *
 * Здесь только вход и предел частоты — кому что можно решает
 * server/violations.mjs по actorId, а не по тому, что прислал клиент
 * (module/violatorId/status/amount никогда не берутся из тела как
 * истина мимо проверок там).
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { createPendingAction } from './../adminsec.mjs';
import {
  listRules, createRule, updateRule,
  getPaymentSettings, setPaymentSettings,
  createViolation, decideViolation,
  declarePenaltyPaid, confirmPenaltyPaid,
  violatorOf, penaltyOwnerOf,
  listViolationsForProfile, listViolationsForOrg, getViolationDetail, listViolationsForAdmin, violationStats,
  VIOLATION_ID_RE, PENALTY_ID_RE, RULE_ID_RE,
} from './../violations.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 20;
const CREATE_PER_HOUR = 30;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  owner_only: 403,
  bad_module: 400,
  bad_code: 400,
  bad_title: 400,
  bad_severity: 400,
  bad_sanction: 400,
  bad_amount: 400,
  bad_multiplier: 400,
  bad_escalation: 400,
  bad_violator_kind: 400,
  violator_not_found: 400,
  bad_rule: 400,
  bad_requisites: 400,
  bad_decision: 400,
  bad_status: 409,
  description_required: 400,
  reason_required: 400,
  already_final: 409,
  no_payment_settings: 409,
  code_taken: 409,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

export const violationsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/violations')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const readOk = () => rateLimit(`vio:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`vio:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  /* ══ Регламент ══════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/violations/rules') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listRules(me, { module: params.get('module'), activeOnly: params.get('activeOnly') === '1' });
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  if (req.method === 'POST' && path === '/api/violations/rules') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await createRule(me, await body());
    return done.error ? fail(res, done) : json(res, 201, done);
  }
  const rulePath = path.match(/^\/api\/violations\/rules\/(vr-[0-9a-f-]{36})$/);
  if (rulePath && req.method === 'POST') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    if (!RULE_ID_RE.test(rulePath[1])) return json(res, 404, { error: 'not_found' });
    const done = await updateRule(me, rulePath[1], await body());
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Реквизиты оплаты — чтение всем с правом, правка — только владелец ══ */

  if (req.method === 'GET' && path === '/api/violations/payment-settings') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await getPaymentSettings(me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  if (req.method === 'POST' && path === '/api/violations/payment-settings') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await setPaymentSettings(me, (await body()).requisites);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Статистика и админский список ═════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/violations/admin/stats') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await violationStats(me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  if (req.method === 'GET' && path === '/api/violations/admin/list') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listViolationsForAdmin(me, {
      module: params.get('module'), status: params.get('status'), severity: params.get('severity'),
      violatorId: params.get('violatorId'), ruleId: params.get('ruleId'), orgId: params.get('orgId'),
    });
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Вкладка «Нарушения и штрафы» — своя (магазин/ПВЗ) или чужая (админ) ══ */

  if (req.method === 'GET' && path === '/api/violations/profile/me') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listViolationsForProfile(me, me, { module: params.get('module') });
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const profilePath = path.match(/^\/api\/violations\/profile\/([a-zA-Z0-9_-]{1,64})$/);
  if (profilePath && req.method === 'GET') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listViolationsForProfile(me, profilePath[1], { module: params.get('module') });
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* Вкладка «Нарушения и штрафы» внутри кабинета ПВЗ — нарушения всей
     точки (владельца и сотрудников), не только текущего пользователя. */
  const orgPath = path.match(/^\/api\/violations\/org\/(pvz|warehouse)\/([a-zA-Z0-9_-]{1,64})$/);
  if (orgPath && req.method === 'GET') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listViolationsForOrg(me, orgPath[1], orgPath[2]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Создание и решение по нарушению ═══════════════════════════════ */

  if (req.method === 'POST' && path === '/api/violations') {
    if (!rateLimitPerHour(`vio:create:${me}`, CREATE_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
    const done = await createViolation(me, await body());
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  const violationPath = path.match(/^\/api\/violations\/(vio-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (violationPath) {
    const violationId = violationPath[1];
    const tail = violationPath[2] ?? '';
    if (!VIOLATION_ID_RE.test(violationId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && !tail) {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await getViolationDetail(me, violationId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/decide') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await decideViolation(me, violationId, b.decision, b);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/cancel') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      /* Аннулирование снимает уже начисленный штраф — тот же риск, что
         у выдачи денег, так что отсюда оно только предлагается, а не
         выполняется: исполняет executePending в adminsec.mjs вторым
         ключом владельца (см. PENDING_KINDS.cancel_violation). */
      const target = await violatorOf(violationId);
      if (!target) return json(res, 404, { error: 'not_found' });
      const done = await createPendingAction(me, 'cancel_violation', target,
        { violationId, reason: b.reason });
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Штрафы — заявить оплату / подтвердить / отменить ══════════════ */

  const penaltyPath = path.match(/^\/api\/violations\/penalties\/(pen-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (penaltyPath) {
    const penaltyId = penaltyPath[1];
    const tail = penaltyPath[2] ?? '';
    if (!PENALTY_ID_RE.test(penaltyId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'POST' && tail === '/declare-paid') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await declarePenaltyPaid(me, penaltyId, (await body()).paymentReference);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/confirm-paid') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await confirmPenaltyPaid(me, penaltyId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/cancel') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const target = await penaltyOwnerOf(penaltyId);
      if (!target) return json(res, 404, { error: 'not_found' });
      const done = await createPendingAction(me, 'cancel_penalty', target,
        { penaltyId, reason: b.reason });
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  return json(res, 404, { error: 'not_found' });
};

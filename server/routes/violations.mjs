/**
 * Нарушения и штрафы Market/Warehouse/PVZ по HTTP.
 *
 * Здесь только вход и предел частоты — кому что можно решает
 * server/violations.mjs по actorId, а не по тому, что прислал клиент
 * (module/violatorId/status/amount никогда не берутся из тела как
 * истина мимо проверок там).
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, mediaBody } from './../http.mjs';
import { issueTicket, ticketCookies, ticketFromCookies, readTicket } from './../marketticket.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { createPendingAction } from './../adminsec.mjs';
import {
  listRules, createRule, updateRule,
  getPaymentSettings, setPaymentSettings,
  createViolation, decideViolation,
  declarePenaltyPaid, confirmPenaltyPaid,
  violatorOf, penaltyOwnerOf,
  listViolationsForProfile, listViolationsForOrg, getViolationDetail, listViolationsForAdmin, violationStats,
  submitAppeal, decideAppeal, appealSubmitterOf, getAppealDetail, listAppealsForProfile, listAppealsForAdmin,
  beginEvidence, finishEvidence, dropEvidence, evidenceAccess,
  VIOLATION_ID_RE, PENALTY_ID_RE, RULE_ID_RE, APPEAL_ID_RE, EVIDENCE_ID_RE, EVIDENCE_KINDS, MAX_EVIDENCE_BYTES,
} from './../violations.mjs';
import { saveStream, openStream, sizeOf as evidenceSizeOf } from './../evidencestore.mjs';

/* ─── Приём файла доказательства ─────────────────────────────────────
 * Опознаём реальный формат по первым байтам, а не верим заголовку
 * Content-Type — тот же приём, что у картинок в routes/market.mjs и
 * у видеообзора в routes/sharedwh.mjs, здесь просто оба набора вместе
 * плюс минимальная подпись PDF: доказательство может быть и тем, и
 * тем. Для «данных» (order_data/tracking/qr_operation/system_event/
 * message) подписи не бывает — это не файл с камеры, а текстовый
 * снимок состояния, который сохраняют мимо файловых форматов. */
const BINARY_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
];
const DATA_KINDS = ['order_data', 'tracking', 'qr_operation', 'system_event', 'message'];
const DATA_MIME = new Set(['text/plain', 'application/json']);

const sniffEvidence = (buf) => {
  if (!buf || buf.length < 16) return null;
  for (const s of BINARY_SIGNATURES) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};

const peek = (req, bytes) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  const onData = (c) => {
    chunks.push(c);
    size += c.length;
    if (size >= bytes) { req.pause(); req.off('data', onData); resolve(Buffer.concat(chunks)); }
  };
  const onEnd = () => { req.off('data', onData); resolve(Buffer.concat(chunks)); };
  req.on('data', onData);
  req.once('end', onEnd);
});

const withHead = (head, rest) => Readable.from((async function* () {
  yield head;
  for await (const chunk of rest) yield chunk;
})());

const rejectBody = (req, res, code, body) => {
  json(res, code, body);
  let drained = 0;
  let done = false;
  let timer = null;
  const finish = (hard) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    req.off('data', onData);
    if (hard === true) req.destroy();
  };
  const onData = (chunk) => { drained += chunk.length; if (drained > MAX_EVIDENCE_BYTES + 1024 * 1024) finish(true); };
  timer = setTimeout(() => finish(true), 10_000);
  timer.unref();
  req.on('data', onData);
  req.once('end', () => finish(false));
  req.once('error', () => finish(false));
  req.once('close', () => finish(false));
  return true;
};

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
  already_appealed: 409,
  already_decided: 409,
  nothing_to_change: 400,
  bad_kind: 400,
  bad_target: 400,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

/**
 * Загрузка доказательства — общая для /violations/:id/evidence и
 * /appeals/:id/evidence: заводим строку метаданных (beginEvidence сам
 * решает, можно ли этому actorId), затем пишем файл на диск, и если
 * запись не удалась — убираем осиротевшую строку, а не оставляем
 * запись «доказательство есть», когда файла на самом деле нет.
 */
const handleEvidenceUpload = async (req, res, me, target) => {
  const qs = new URL(req.url, 'http://x').searchParams;
  const kind = String(qs.get('kind') ?? '');
  if (!EVIDENCE_KINDS.includes(kind)) return rejectBody(req, res, 400, { error: 'bad_kind' });

  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_EVIDENCE_BYTES) return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_EVIDENCE_BYTES });

  const head = await peek(req, 32);
  const sniffed = sniffEvidence(head);
  const declaredMime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  const mime = sniffed ?? (DATA_KINDS.includes(kind) && DATA_MIME.has(declaredMime) ? declaredMime : null);
  if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_format' });

  const description = qs.get('description') ?? '';
  const begun = await beginEvidence(me, { ...target, kind, mime, description });
  if (begun.error) return rejectBody(req, res, CODES[begun.error] ?? 400, begun);

  const saved = await saveStream(begun.id, withHead(head, req), MAX_EVIDENCE_BYTES);
  if (saved.error) {
    await dropEvidence(begun.id);
    return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
  }
  await finishEvidence(begun.id, saved.bytes);
  return json(res, 201, { id: begun.id, bytes: saved.bytes, mime });
};

export const violationsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/violations')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Байты доказательства браузер тянет сам тегом <img>/<video>, и
     заголовок Authorization туда не подставить — тот же пропуск, что у
     картинок маркета (см. server/marketticket.mjs), остальной API
     этой ручки продолжает требовать обычную сессию. */
  const isEvidenceFile = req.method === 'GET' && /^\/api\/violations\/evidence\/vev-[0-9a-f-]{36}$/.test(path);

  let me;
  if (isEvidenceFile) {
    const session = await readSession(req);
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  const readOk = () => rateLimit(`vio:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`vio:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  /* Пропуск выдаётся отдельной ручкой — клиент просит его один раз при
     открытии вкладки «Нарушения», обычным запросом с токеном. */
  if (req.method === 'POST' && path === '/api/violations/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookies(me, ticket));
    return json(res, 200, mediaBody(req, { ok: true }, { ticket }));
  }

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
        { violationId, reason: b.reason }, { stepUpCode: b.code });
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    /* Подать апелляцию на своё подтверждённое нарушение — сам
       нарушитель, без права 'violations' (submitAppeal проверяет это
       сама по violator_id). */
    if (req.method === 'POST' && tail === '/appeal') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await submitAppeal(me, violationId, b.reason, b.comment);
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    /* Доказательство к самому нарушению — прикладывает расследующий
       администратор (beginEvidence проверяет право 'violations' сама). */
    if (req.method === 'POST' && tail === '/evidence') {
      if (!writeOk()) return rejectBody(req, res, 429, { error: 'too_many_requests' });
      return handleEvidenceUpload(req, res, me, { violationId });
    }
  }

  /* ══ Апелляции ══════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/violations/appeals/mine') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listAppealsForProfile(me, me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  if (req.method === 'GET' && path === '/api/violations/admin/appeals') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listAppealsForAdmin(me, { status: params.get('status') });
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  const appealPath = path.match(/^\/api\/violations\/appeals\/(vap-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (appealPath) {
    const appealId = appealPath[1];
    const tail = appealPath[2] ?? '';
    if (!APPEAL_ID_RE.test(appealId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && !tail) {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await getAppealDetail(me, appealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/decide') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const decision = String(b.decision ?? '');
      /* REJECTED ничего не прощает (решение остаётся в силе) — решается
         прямо здесь, как и обычное decideViolation. APPROVED и
         PARTIALLY_APPROVED снимают уже назначенное наказание — тот же
         риск прощения долга, что у cancel_violation/cancel_penalty,
         поэтому только через заявку на второй ключ владельца. */
      if (decision === 'REJECTED') {
        const done = await decideAppeal(me, appealId, 'REJECTED', { reason: b.reason, comment: b.comment });
        return done.error ? fail(res, done) : json(res, 200, done);
      }
      if (decision === 'APPROVED' || decision === 'PARTIALLY_APPROVED') {
        const target = await appealSubmitterOf(appealId);
        if (!target) return json(res, 404, { error: 'not_found' });
        const done = await createPendingAction(me, 'resolve_appeal', target, {
          appealId, decision, reason: b.reason, comment: b.comment,
          liftSanctionId: b.liftSanctionId, cancelPenaltyId: b.cancelPenaltyId,
        }, { stepUpCode: b.code });
        return done.error ? fail(res, done) : json(res, 200, done);
      }
      return json(res, 400, { error: 'bad_decision' });
    }
    /* Доказательство к апелляции — прикладывает сам обжалующий (это его
       защита) или администратор, решающий апелляцию (beginEvidence
       проверяет это сама по submitted_by). */
    if (req.method === 'POST' && tail === '/evidence') {
      if (!writeOk()) return rejectBody(req, res, 429, { error: 'too_many_requests' });
      return handleEvidenceUpload(req, res, me, { appealId });
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
        { penaltyId, reason: b.reason }, { stepUpCode: b.code });
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Выдача байт доказательства — тот же периметр self/'violations',
     что у его метаданных в getViolationDetail/getAppealDetail ══════ */

  const evidencePath = path.match(/^\/api\/violations\/evidence\/(vev-[0-9a-f-]{36})$/);
  if (evidencePath && req.method === 'GET') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const evidenceId = evidencePath[1];
    if (!EVIDENCE_ID_RE.test(evidenceId)) return json(res, 404, { error: 'not_found' });
    const access = await evidenceAccess(evidenceId, me);
    if (!access) return json(res, 403, { error: 'not_allowed' });
    const size = await evidenceSizeOf(evidenceId);
    if (size === null) return json(res, 404, { error: 'not_found' });
    res.writeHead(200, {
      'Content-Type': access.mime || 'application/octet-stream',
      'Content-Length': String(size),
      // Файл пришёл от человека — угадывать тип и исполнять его браузер
      // не должен никогда, независимо от того, что внутри.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=600',
      'Vary': 'Cookie',
    });
    openStream(evidenceId).pipe(res);
    return true;
  }

  return json(res, 404, { error: 'not_found' });
};

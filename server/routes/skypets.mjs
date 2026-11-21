/** Sky Pets: люди — /api/skypets/*, администрация — /api/admin/skypets/* (права pets_create / pets_moderate / pets_publish). */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as core from './../spcore.mjs';
import * as fun from './../spfun.mjs';
import * as adm from './../spadmin.mjs';

const MULT = Math.max(1, Number(process.env.PETS_RATE_MULT) || 1);
const STATUS = { not_found: 404, forbidden: 403, private: 403, not_allowed: 403, self_review: 403, slow_down: 429, rate_limited: 429, insufficient_coins: 402, insufficient_points: 402, sleeping: 409, bad_state: 409, already_claimed: 409, already_decided: 409,
  already_invited: 409, already_pending: 409, already_owned: 409, already_full: 409, already_clean: 409, already_healthy: 409, incubator_full: 409, not_ready: 409, needs_interaction: 409, too_tired: 409, too_hungry: 409, level_too_low: 409, room_locked: 409, room_exists: 409,
  house_full: 409, not_approved: 409, not_for_sale: 409, out_of_season: 409, expired: 410, file_too_large: 413, scan_unavailable: 503, file_blocked: 422, content_blocked: 422, name_not_allowed: 422, background_not_transparent: 422, bad_format: 415, storage_failed: 503, storage_unavailable: 503 };
const readBody = (req, max) => new Promise((resolve) => {
  const declared = Number(req.headers['content-length'] ?? 0); if (declared > max) { req.resume(); return resolve({ error: 'file_too_large' }); }
  const chunks = []; let n = 0; let over = false;
  req.on('data', (c) => { n += c.length; if (n > max) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
  req.on('end', () => resolve(over ? { error: 'file_too_large' } : { buf: Buffer.concat(chunks) })); req.on('error', () => resolve({ error: 'read_failed' }));
});
const PID = 'pet-[0-9a-f-]{36}';

export const skyPetsRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const admin = path.startsWith('/api/admin/skypets'); if (!admin && !path.startsWith('/api/skypets')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const method = req.method; const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(`pets:${write ? 'w' : 'r'}:${me}`, (write ? 240 : 900) * MULT)) return json(res, 429, { error: 'rate_limited' });
  const reply = (r, ok = 200) => json(res, r?.error ? STATUS[r.error] ?? 400 : ok, r ?? { ok: true });
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  const q = Object.fromEntries(u.searchParams); let m;
  try {
    if (admin) {
      await adm.publishDue();
      const rest = path.slice('/api/admin/skypets'.length);
      if (method === 'GET' && rest === '/overview') return reply(await adm.overviewAdmin(me));
      if (method === 'GET' && rest === '/meta') return reply({ ...adm.meta, rights: await adm.rights(me) });
      if (method === 'POST' && rest === '/images') { const r = await readBody(req, 2.2 * 1024 * 1024); if (r.error) return reply(r); return reply(await adm.uploadImage(me, r.buf, { opaqueOk: q.opaque === '1' }), 201); }
      if (method === 'GET' && rest === '/events') return reply(await adm.listEvents(me));
      if (method === 'POST' && rest === '/events') return reply(await adm.saveEvent(me, null, await body()), 201);
      if (method === 'PUT' && (m = rest.match(/^\/events\/(pev-[0-9a-f-]{36})$/))) return reply(await adm.saveEvent(me, m[1], await body()));
      if (method === 'GET' && rest === '/tasks') return reply(await adm.listTasks(me));
      if (method === 'POST' && rest === '/tasks') return reply(await adm.saveTask(me, null, await body()), 201);
      if (method === 'PUT' && (m = rest.match(/^\/tasks\/([a-z0-9-]{3,60})$/))) return reply(await adm.saveTask(me, m[1], await body()));
      if ((m = rest.match(/^\/(species|skin|egg|item)$/))) { if (method === 'GET') return reply(await adm.list(me, m[1], q)); if (method === 'POST') return reply(await adm.save(me, m[1], null, await body()), 201); }
      if ((m = rest.match(/^\/(species|skin|egg|item)\/([a-z]{3}-[0-9a-f-]{36})(?:\/(submit|moderate|publish|unpublish|restore))?$/))) {
        const [, subj, id, act] = m;
        if (!act && method === 'GET') return reply(await adm.detail(me, subj, id));
        if (!act && method === 'PUT') return reply(await adm.save(me, subj, id, await body()));
        if (method === 'POST') { const b = await body();
          if (act === 'submit') return reply(await adm.submit(me, subj, id)); if (act === 'moderate') return reply(await adm.moderate(me, subj, id, String(b.action), b.reason));
          if (act === 'publish') return reply(await adm.publish(me, subj, id, b)); if (act === 'unpublish') return reply(await adm.unpublish(me, subj, id, b.reason)); if (act === 'restore') return reply(await adm.restoreVersion(me, subj, id, b.version)); }
      }
      return json(res, 404, { error: 'not_found' });
    }
    // ── люди ──
    await adm.publishDue();
    const rest = path.slice('/api/skypets'.length); let b;
    if (method === 'GET' && (m = rest.match(/^\/img\/(pim-[0-9a-f-]{36}(?:-t)?)$/))) {
      const r = await adm.imageStream(me, m[1], m[1].endsWith('-t') || q.t === '1'); if (r.error) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.size, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" });
      r.stream.on('error', () => res.destroy()); res.on('close', () => r.stream.destroy()); r.stream.pipe(res); return true;
    }
    if (method === 'GET' && rest === '/overview') return reply(await core.overview(me));
    if (method === 'POST' && rest === '/daily') return reply(await core.daily(me));
    if (method === 'POST' && rest === '/settings') return reply(await core.settings(me, await body()));
    if (method === 'GET' && (m = rest.match(new RegExp(`^/pet/(${PID})$`)))) return reply(await core.petView(me, m[1]));
    if (method === 'POST' && (m = rest.match(new RegExp(`^/pet/(${PID})/(act|rename|favorite|room|skin|equip|unequip|evolve|transfer|streak-seen)$`)))) {
      b = await body(); const id = m[1];
      switch (m[2]) {
        case 'act': return reply(await core.act(me, id, String(b.action), b));
        case 'streak-seen': return reply(await core.streakSeen(me, id, b.milestone));
        case 'rename': return reply(await core.rename(me, id, b.name));
        case 'favorite': return reply(await core.setFavorite(me, id, b.on));
        case 'room': return reply(await core.moveRoom(me, id, String(b.room)));
        case 'skin': return reply(await core.setSkin(me, id, b.skinId || null));
        case 'equip': return reply(await core.equip(me, id, b.itemId));
        case 'unequip': return reply(await core.unequip(me, id, String(b.slot)));
        case 'evolve': return reply(await core.evolve(me, id));
        default: return reply(await fun.startTransfer(me, id, String(b.kind), b.toId || null), 201);
      }
    }
    if (method === 'GET' && rest === '/eggs') return reply({ eggs: await core.myEggs(me) });
    if (method === 'GET' && (m = rest.match(/^\/eggs\/([a-z0-9-]{3,60})\/odds$/))) return reply(await core.eggOdds(m[1]));
    if (method === 'POST' && (m = rest.match(/^\/egg\/(peg-[0-9a-f-]{36})\/(incubate|touch|hatch)$/))) { b = await body(); return reply(m[2] === 'incubate' ? await core.incubate(me, m[1]) : m[2] === 'touch' ? await core.touchEgg(me, m[1]) : await core.hatch(me, m[1], b.name)); }
    if (method === 'POST' && rest === '/invite') { b = await body(); return reply(await core.invite(me, b.toId, b.eggId), 201); }
    if (method === 'POST' && (m = rest.match(/^\/invite\/(pin-[0-9a-f-]{36})\/respond$/))) { b = await body(); return reply(await core.respondInvite(me, m[1], b.cancel ? 'cancel' : Boolean(b.accept))); }
    if (method === 'GET' && (m = rest.match(/^\/with\/([A-Za-z0-9_-]{3,80})$/))) return reply({ pets: await core.petsWith(me, m[1]) });
    if (method === 'GET' && rest === '/house') return reply(await fun.getHouse(me, q.scope || 'me'));
    if (method === 'POST' && (m = rest.match(/^\/house\/(place|remove|expand|rename)$/))) { b = await body(); const sc = b.scope || 'me'; return reply(m[1] === 'place' ? await fun.placeItem(me, sc, b) : m[1] === 'remove' ? await fun.removePlaced(me, sc, String(b.uid)) : m[1] === 'expand' ? await fun.expandHouse(me, sc, b.itemId) : await fun.renameHouse(me, sc, b.name)); }
    if (method === 'GET' && rest === '/shop') return reply(await fun.shop(me));
    if (method === 'POST' && rest === '/shop/buy') return reply(await fun.buy(me, await body()), 201);
    if (method === 'GET' && rest === '/tasks') return reply(await fun.tasks(me));
    if (method === 'POST' && (m = rest.match(/^\/tasks\/([a-z0-9-]{3,60})\/claim$/))) return reply(await fun.claimTask(me, m[1]));
    if (method === 'GET' && rest === '/events') return reply(await fun.events(me));
    if (method === 'POST' && (m = rest.match(/^\/events\/(pev-[0-9a-f-]{36})\/claim$/))) return reply(await fun.claimEvent(me, m[1]));
    if (method === 'GET' && rest === '/achievements') return reply(await core.achievements(me));
    if (method === 'POST' && rest === '/achievements/claim') { b = await body(); return reply(await core.claimAchievement(me, String(b.key), b.petId || null)); }
    if (method === 'GET' && rest === '/city') return reply(await fun.city(me, q.q, q.offset));
    if (method === 'GET' && (m = rest.match(/^\/city\/([A-Za-z0-9_-]{3,80})$/))) return reply(await fun.visit(me, m[1]));
    if (method === 'POST' && (m = rest.match(/^\/city\/([A-Za-z0-9_-]{3,80})\/(react|play)$/))) { b = await body(); return reply(m[2] === 'react' ? await fun.react(me, m[1], String(b.kind), b.petId || null) : await fun.playTogether(me, m[1], String(b.myPetId), String(b.theirPetId))); }
    if (method === 'GET' && rest === '/gifts') return reply(await fun.myGifts(me));
    if (method === 'POST' && rest === '/gifts') { b = await body(); return reply(await fun.sendGift(me, b.toId, String(b.kind), String(b.refId), b.qty, b.message), 201); }
    if (method === 'POST' && (m = rest.match(/^\/gifts\/(pgf-[0-9a-f-]{36})\/answer$/))) { b = await body(); return reply(await fun.answerGift(me, m[1], String(b.how))); }
    if (method === 'GET' && rest === '/transfers') return reply(await fun.myTransfers(me));
    if (method === 'POST' && (m = rest.match(/^\/transfers\/(ptr-[0-9a-f-]{36})\/(respond|cancel)$/))) { b = await body(); return reply(m[2] === 'cancel' ? await fun.cancelTransfer(me, m[1]) : await fun.respondTransfer(me, m[1], Boolean(b.agree))); }
    return json(res, 404, { error: 'not_found' });
  } catch (e) { console.error('[pets]', e.message); return json(res, 500, { error: 'server_error' }); }
};

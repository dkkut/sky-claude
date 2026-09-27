/**
 * Sky Pets + Sky Skin Market по HTTP. Раздача медиа скинов — тот же
 * приём диапазонов, что и в routes/stories.mjs; админ-подразделы гейтит
 * `can(me, 'content')` прямо здесь, по образцу routes/campaigns.mjs —
 * своего отдельного админ-роутера у фичи нет.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { createPendingAction } from './../adminsec.mjs';
import { parseRange } from './../skyvideostore.mjs';
import {
  listPetTypes, getMyPets, createPet, setActivePet, renamePet, careForPet,
  evolvePet, getVisibility, setVisibility, adminCreatePetType, adminRetirePetType,
} from './../pets.mjs';
import {
  getWallet, getLedger, listAchievements, claimAchievement,
  getDailyQuests, claimQuest, getActiveEvents, claimEventReward, adminEconomyStats,
} from './../petEconomy.mjs';
import {
  listItems, getItem, purchaseItem, getMySkins, equipItem, unequipSlot, getEquipment,
  createListing, cancelListing, mediaMimeOf,
  adminListItems, adminCreateItem, adminUpdateItem, adminRetireItem, adminItemSales,
} from './../skinMarket.mjs';
import { openStream, sizeOf } from './../skinstore.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 40;
const STREAM_PER_MIN = 300;

const PET_ID_RE = /^pet-[0-9a-f-]{36}$/;
const ITEM_ID_RE = /^ski-[0-9a-f-]{36}$/;
const MEDIA_ID_RE = /^skm-[0-9a-f-]{36}$/;

const errCode = (error) => (
  error === 'not_found' || error === 'not_owned' || error === 'unavailable' ? 404
    : error === 'not_allowed' ? 403
      : error === 'cooldown' || error === 'already_owned' || error === 'already_claimed'
        || error === 'sold_out' || error === 'already_listed' ? 409
        : 400
);

const streamMedia = async (req, res, mediaId) => {
  const mime = await mediaMimeOf(mediaId);
  if (!mime) return json(res, 404, { error: 'not_found' });
  const size = await sizeOf(mediaId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400, immutable',
    'Vary': 'Authorization',
  };
  const range = parseRange(req.headers.range, size);
  if (range?.invalid) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` });
    res.end();
    return true;
  }
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, { ...common, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(length) });
    const stream = openStream(mediaId, range);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  }
  res.writeHead(200, { ...common, 'Content-Length': String(size) });
  const stream = openStream(mediaId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

export const petsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/pets')) return false;
  const path = url.split('?')[0];
  const q = Object.fromEntries(new URL(url, 'http://x').searchParams);

  const mediaMatch = /^\/api\/pets\/market\/media\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && mediaMatch && MEDIA_ID_RE.test(mediaMatch[1])) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!rateLimit(`pets:stream:${session.profileId}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return streamMedia(req, res, mediaMatch[1]);
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  /* ─── Админка: питомцы + скины (право content) ──────────────────── */

  if (path === '/api/pets/admin/types' && req.method === 'POST') {
    if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminCreatePetType(me, await parseBody(req));
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }
  const adminTypeMatch = /^\/api\/pets\/admin\/types\/([^/]+)\/retire$/.exec(path);
  if (adminTypeMatch && req.method === 'POST') {
    if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await adminRetirePetType(me, adminTypeMatch[1]));
  }

  if (path === '/api/pets/admin/economy' && req.method === 'GET') {
    const r = await adminEconomyStats(me);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (path === '/api/pets/admin/economy/grant' && req.method === 'POST') {
    if (!(await can(me, 'content'))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    /* Массовая/разовая выдача Pet Coins — опасное действие: оформляется
       заявкой, которую подтверждает владелец, а не выдаётся отсюда сразу. */
    const r = await createPendingAction(me, 'grant_pet_coins', String(body?.profileId ?? ''),
      { amount: body?.amount }, { reason: String(body?.reason ?? '').slice(0, 300) });
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (path === '/api/pets/admin/market/items' && req.method === 'GET') {
    const r = await adminListItems(me);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }
  if (path === '/api/pets/admin/market/items' && req.method === 'POST') {
    if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminCreateItem(me, await parseBody(req));
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }
  const adminItemMatch = /^\/api\/pets\/admin\/market\/items\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (adminItemMatch) {
    const itemId = adminItemMatch[1];
    const tail = adminItemMatch[2] ?? '';
    if (!ITEM_ID_RE.test(itemId)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await adminUpdateItem(me, itemId, await parseBody(req));
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/retire') {
      if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await adminRetireItem(me, itemId);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'GET' && tail === '/sales') {
      const r = await adminItemSales(me, itemId);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
  }

  /* ─── Каталог типов питомцов / коллекция ─────────────────────────── */

  if (path === '/api/pets/types' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { types: await listPetTypes() });
  }

  if (path === '/api/pets/mine' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { pets: await getMyPets(me) });
  }

  if (path === '/api/pets' && req.method === 'POST') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createPet(me, String(body?.typeId ?? ''), { source: 'shop', makeActive: !!body?.makeActive });
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (path === '/api/pets/visibility' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await getVisibility(me));
  }
  if (path === '/api/pets/visibility' && req.method === 'POST') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await setVisibility(me, await parseBody(req) ?? {}));
  }

  /* ─── Кошелёк / достижения / задания / события ───────────────────── */

  if (path === '/api/pets/wallet' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await getWallet(me));
  }
  if (path === '/api/pets/wallet/ledger' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { transactions: await getLedger(me, Number(q.limit) || 50) });
  }

  if (path === '/api/pets/achievements' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { achievements: await listAchievements(me) });
  }
  const achClaimMatch = /^\/api\/pets\/achievements\/([^/]+)\/claim$/.exec(path);
  if (achClaimMatch && req.method === 'POST') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await claimAchievement(me, achClaimMatch[1]);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (path === '/api/pets/quests' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { quests: await getDailyQuests(me) });
  }
  const questClaimMatch = /^\/api\/pets\/quests\/([^/]+)\/claim$/.exec(path);
  if (questClaimMatch && req.method === 'POST') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await claimQuest(me, questClaimMatch[1]);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (path === '/api/pets/events' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { events: await getActiveEvents(me) });
  }
  const eventClaimMatch = /^\/api\/pets\/events\/([^/]+)\/claim$/.exec(path);
  if (eventClaimMatch && req.method === 'POST') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await claimEventReward(me, eventClaimMatch[1]);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  /* ─── Sky Skin Market ─────────────────────────────────────────────── */

  if (path === '/api/pets/market/items' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { items: await listItems(me, q) });
  }
  if (path === '/api/pets/market/mine' && req.method === 'GET') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { skins: await getMySkins(me) });
  }
  if (path === '/api/pets/market/listings' && req.method === 'POST') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createListing(me, String(body?.inventoryId ?? ''), body?.pricePetCoins);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }
  const listingMatch = /^\/api\/pets\/market\/listings\/([^/]+)$/.exec(path);
  if (listingMatch && req.method === 'DELETE') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await cancelListing(me, listingMatch[1]);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  const itemMatch = /^\/api\/pets\/market\/items\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (itemMatch) {
    const itemId = itemMatch[1];
    const tail = itemMatch[2] ?? '';
    if (!ITEM_ID_RE.test(itemId)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const item = await getItem(me, itemId);
      if (!item) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { item });
    }
    if (req.method === 'POST' && tail === '/purchase') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await purchaseItem(me, itemId, { idempotencyKey: body?.idempotencyKey, currency: body?.currency });
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
  }

  /* ─── Конкретный питомец: активный/имя/уход/эволюция/экипировка ─── */

  const petMatch = /^\/api\/pets\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (petMatch && PET_ID_RE.test(petMatch[1])) {
    const petId = petMatch[1];
    const tail = petMatch[2] ?? '';

    if (req.method === 'POST' && tail === '/active') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await setActivePet(me, petId);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/rename') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await renamePet(me, petId, body?.name);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/care') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await careForPet(me, petId, String(body?.action ?? ''));
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/evolve') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await evolvePet(me, petId);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'GET' && tail === '/equipment') {
      if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await getEquipment(petId));
    }
    if (req.method === 'POST' && tail === '/equip') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await equipItem(me, petId, String(body?.itemId ?? ''), body?.position);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/unequip') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await unequipSlot(me, petId, String(body?.slot ?? ''), body?.position);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
  }

  return false;
};

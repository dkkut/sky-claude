import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getProfileMusic, setProfileMusic, setTrackNote, listExceptions, setException } from './../profilemusic.mjs';
import { setNftHidden } from './../nft.mjs';

const CODE = { note_too_long: 413, user_not_found: 404, not_found: 404, bad_track: 400, bad_playlist: 400, bad_scope: 400, bad_mode: 400, self: 400, too_many: 409 };
const send = (res, r) => (r.error ? json(res, CODE[r.error] ?? 400, r) : json(res, 200, r));

/** /api/profile-music/:id, /api/privacy/exceptions, /api/gifts/nft/:id/hidden. */
export const profileMusicRoutes = async (req, res, url) => {
  const path = url.split('?')[0]; const m = req.method;
  const pm = path.match(/^\/api\/profile-music(?:\/([A-Za-z0-9_-]{1,64}))?$/);
  const pn = path.match(/^\/api\/profile-music\/note\/([A-Za-z0-9_-]{1,64})$/);
  const ex = path === '/api/privacy/exceptions';
  const nh = path.match(/^\/api\/gifts\/nft\/([A-Za-z0-9_-]{1,64})\/hidden$/);
  if (!pm && !pn && !ex && !nh) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`pmx:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  if (pn && m === 'PUT') return send(res, await setTrackNote(me, pn[1], (await parseBody(req))?.text));
  if (pm) {
    if (m === 'GET') return json(res, 200, await getProfileMusic(me, pm[1] ?? me));
    if (m === 'PUT' && !pm[1]) return send(res, await setProfileMusic(me, (await parseBody(req)) ?? {}));
  }
  if (ex) {
    if (m === 'GET') return json(res, 200, await listExceptions(me));
    if (m === 'PUT') return send(res, await setException(me, (await parseBody(req)) ?? {}));
  }
  if (nh && m === 'PUT') return send(res, await setNftHidden(me, nh[1], (await parseBody(req))?.hidden === true));
  return json(res, 404, { error: 'not_found' });
};

import { readFileSync } from 'node:fs';
export const B = process.env.API_BASE ?? 'http://127.0.0.1:8080';
export const call = async (path, o = {}, tok, extra = {}) => {
  const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra, ...(o.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, headers: r.headers, text: t };
};
export const mkuser = async (S, tag, username) => {
  const email = `${tag.toLowerCase()}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
  await new Promise(r => setTimeout(r, 1500));
  const log = readFileSync(S + '/api.log', 'utf8');
  const code = [...log.matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: username || tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  if (!r.data.profile) throw new Error(JSON.stringify(r.data)); const pid = r.data.profile.id;
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { tok: r.data.accessToken ?? tok, pid, email };
};

// Sky Ads: видео-креатив, длительность, подтверждение просмотра, частота. API с ADMIN_GATE=off OWNER_USERNAME=ownertest
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const J = (b, method = 'POST') => ({ method, body: JSON.stringify(b) });
const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
const mvhd = (seconds, v1 = false) => { const b = Buffer.alloc(v1 ? 112 : 100); if (v1) { b[0] = 1; b.writeUInt32BE(1000, 20); b.writeBigUInt64BE(BigInt(Math.round(seconds * 1000)), 24); } else { b.writeUInt32BE(1000, 12); b.writeUInt32BE(Math.round(seconds * 1000), 16); } return box('mvhd', b); };
const mp4 = (sec, { moovFirst = true, v1 = false, noMoov = false } = {}) => {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomiso2')]));
  const mdat = box('mdat', Buffer.alloc(3000, 7));
  const moov = noMoov ? Buffer.alloc(0) : box('moov', mvhd(sec, v1));
  return moovFirst ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov]);
};
const up = (buf, tok) => fetch(`${B}/api/ads/media`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body: buf }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const AD = (p, o, tok) => call('/api/ads' + p, o ?? {}, tok);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);

const adv = await mkuser(S, 'avAdv'), oth = await mkuser(S, 'avOth'), vw = await mkuser(S, 'avViewer'), pr = await mkuser(S, 'avPrime');
const mod = await mkuser(S, 'avMod'); q(`update profiles set is_admin=true, admin_role='content_admin' where id='${mod.pid}'`);
q(`insert into prime_subscriptions(id, profile_id, status, plan) values ('prime-av-${pr.pid}','${pr.pid}','active','standard') on conflict (id) do nothing`);
q(`insert into wallet_accounts(user_id, balance) values ('${adv.pid}', 100000) on conflict (user_id) do update set balance=100000`);

let r = await up(mp4(12), adv.tok); t('MP4 12 с принят, длительность из заголовка', r.status === 200 && r.data.durationSec === 12, r.data); const vid = r.data.mediaId;
r = await up(mp4(7.5, { moovFirst: false }), adv.tok); t('moov в конце файла тоже читается', r.status === 200 && r.data.durationSec === 7.5, r.data);
r = await up(mp4(20, { v1: true }), adv.tok); t('mvhd версии 1', r.status === 200 && r.data.durationSec === 20, r.data);
r = await up(mp4(90), adv.tok); t('слишком длинное отклонено', r.status === 400 && r.data.error === 'video_too_long', r.data);
r = await up(mp4(10, { noMoov: true }), adv.tok); t('без заголовка длительности — bad_video', r.status === 400 && r.data.error === 'bad_video', r.data);
r = await up(Buffer.from('MZ' + 'x'.repeat(300)), adv.tok); t('исполняемый/мусор отклонён', r.status === 415, r.data);
r = await up(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 2)]), adv.tok); t('WebM принят, длительность неизвестна', r.status === 200 && r.data.durationSec === null, r.data);
r = await up(png, adv.tok); t('картинка принята', r.status === 200 && r.data.kind === 'image', r.data); const img = r.data.mediaId;
t('сведения записаны в БД', q(`select count(*) from ad_media_meta where owner_id='${adv.pid}'`) === '5');

const camp = (mediaId, fmt = 'video') => ({ title: 'Тест', description: '', placement: 'video_preroll', format: fmt, mediaId, linkUrl: 'https://example.com', durationDays: 3, dailyLimit: 1500, targetRegions: [] });
r = await AD('/campaigns', J(camp(vid)), oth.tok); t('чужое медиа подставить нельзя', r.data.error === 'bad_media', r.data);
r = await AD('/campaigns', J(camp(img)), adv.tok); t('картинка для видеоформата — нельзя', r.data.error === 'bad_media', r.data);
r = await AD('/campaigns', J(camp('adm-00000000-0000-0000-0000-000000000000')), adv.tok); t('несуществующее медиа', r.data.error === 'bad_media', r.data);
r = await AD('/campaigns', J(camp(vid)), adv.tok); t('кампания создана', !!r.data.campaign?.id, r.data); const cid = r.data.campaign?.id;
const bal = () => Number(q(`select balance from wallet_accounts where user_id='${adv.pid}'`));
t('списан бюджет (4500)', bal() === 100000 - 4500, bal());
r = await AD(`/admin/campaigns/${cid}/approve`, J({}), mod.tok); t('модератор одобрил', r.status === 200, r.data);

// показ
r = await AD('/serve?placement=video_preroll', null, vw.tok); t('зритель получает видеорекламу с длительностью', r.data.ad?.campaignId === cid && r.data.ad.durationSec === 12, r.data);
r = await AD('/serve?placement=video_preroll', null, pr.tok); t('Prime рекламы не видит', r.data.ad === null, r.data);
r = await AD('/impression', J({ campaignId: cid, placement: 'video_preroll' }), vw.tok); t('показ записан', !!r.data.impressionId, r.data); const imp = r.data.impressionId;
r = await AD('/serve?placement=video_preroll', null, vw.tok); t('повторно сразу — пауза между видеорекламами', r.data.ad === null, r.data);
r = await AD('/impression', J({ campaignId: cid, placement: 'video_preroll' }), vw.tok); t('второй показ без паузы не пишется', r.status === 409, r.data);

// подтверждение просмотра
r = await AD('/view', J({ impressionId: imp, watchedSec: 12 }), vw.tok); t('нельзя «досмотреть» 12 с за доли секунды', r.data.ok && r.data.watchedSec < 4 && !r.data.completed, r.data);
r = await AD('/view', J({ impressionId: imp, watchedSec: 9999 }), vw.tok); t('нереальное число отклонено', r.status === 409 || r.status === 400, r.data);
r = await AD('/view', J({ impressionId: imp, watchedSec: 3 }), oth.tok); t('чужой показ — 404', r.status === 404, r.data);
q(`update ad_impressions set created_at = created_at - interval '15 seconds' where id='${imp}'`);
r = await AD('/view', J({ impressionId: imp, watchedSec: 12 }), vw.tok); t('после реального времени просмотр засчитан', r.data.completed === true && r.data.watchedSec === 12, r.data);
r = await AD('/view', J({ impressionId: imp, watchedSec: 2 }), vw.tok); t('записанное не уменьшается', r.data.watchedSec === 12, r.data);
r = await AD(`/campaigns/${cid}`, null, adv.tok); t('рекламодатель видит досмотры', r.data.campaign.completedViews === 1 && r.data.campaign.impressions === 1, r.data);
r = await AD('/click', J({ campaignId: cid, impressionId: imp, placement: 'video_preroll' }), vw.tok); t('клик по своему показу', r.data.ok === true, r.data);
r = await AD('/click', J({ campaignId: cid, impressionId: imp, placement: 'video_preroll' }), vw.tok); t('повторный клик не удваивается', q(`select count(*) from ad_clicks where impression_id='${imp}'`) === '1', r.data);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);

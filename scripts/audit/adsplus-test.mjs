/** Sky Ads: кампании администрации, приоритет и частота, подпись ссылок, свои объявления Sky, Prime без рекламы, статистика, права. Модуль на Postgres `skytest`. */
process.env.OWNER_USERNAME = 'adsowner';
const A = await import('../../server/ads.mjs');
const H = await import('../../server/adsplus.mjs');
const { query } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
const sfx = Date.now().toString(36);
const mk = async (tag, { username, admin = false } = {}) => { const i = `acc-ad${tag}${sfx}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [`sky-${i}`, `${i}@t.test`]); await query('INSERT INTO profiles (id, username, name, sky_id, is_admin) VALUES ($1,$2,$3,$4,$5)', [i, username ?? `u${tag}${sfx}`, `Имя ${tag}`, `sky-${i}`, admin]); return { id: i, sky: `sky-${i}` }; };
await query("DELETE FROM profiles WHERE username = 'adsowner'");
const OW = await mk('o', { username: 'adsowner' }), ADM = await mk('a', { admin: true }), U1 = await mk('u'), U2 = await mk('v'), PR = await mk('p');
await query("UPDATE ad_campaigns SET status = 'cancelled' WHERE status IN ('active','scheduled','paused')");
await query("DELETE FROM ad_house WHERE id = 'house-garant'"); await query("UPDATE ad_house SET status = 'active'");
const future = (d) => new Date(Date.now() + d * 86400000).toISOString();
const media = async (owner, kind = 'image') => { const id = `adm-${crypto.randomUUID()}`; await query("INSERT INTO ad_media_meta (media_id, owner_id, kind, mime) VALUES ($1,$2,$3,$4)", [id, owner, kind, kind === 'video' ? 'video/mp4' : 'image/png']); return id; };

// Свои объявления Sky: внешних кампаний нет
let ad = await A.resolveAdForPlacement(U1.id, 'bloom_feed');
t('no campaigns → own Sky ad, labelled', ad?.house === true && ad.label === 'Реклама Sky' && ad.campaignId.startsWith('house:') && !ad.linkUrl && ad.target?.module);
t('own ad: internal target only, no external url', !('linkUrl' in ad) || !ad.linkUrl);
await query("INSERT INTO prime_subscriptions (id, profile_id, plan, status, expires_at) VALUES ($1,$2,'standard','active', now() + interval '30 days')", [`pr-${sfx}`, PR.id]);
t('prime viewer: no ads at all (own ads too)', (await A.resolveAdForPlacement(PR.id, 'bloom_feed')) === null && (await A.recordImpression(PR.id, 'house:house-prime', 'bloom_feed')).error === 'not_eligible');
// показ и клик по своему объявлению
let imp = await A.recordImpression(U1.id, ad.campaignId, 'bloom_feed');
t('house impression recorded', imp.impressionId?.startsWith('hsi-'));
let ck = await A.recordClick(U1.id, ad.campaignId, imp.impressionId, 'bloom_feed');
t('house click returns internal target', ck.ok && ck.target?.module === ad.target.module);
t('house click with forged impression refused', (await A.recordClick(U1.id, ad.campaignId, 'hsi-other-1', 'bloom_feed')).error === 'bad_impression');
t('house impression for paused/unknown refused', (await A.recordImpression(U1.id, 'house:nope', 'bloom_feed')).error === 'not_eligible');
t('house ad only on its placements', (await A.recordImpression(U2.id, ad.campaignId, 'bloom_stories')).error === 'not_eligible');
// права
t('user cannot create admin campaign', (await A.adminCreateCampaign(U1.id, { name: 'x' })).error === 'not_allowed');
t('user cannot read stats/house', (await H.adminStats(U1.id)).error === 'not_allowed' && (await H.adminHouseList(U1.id)).error === 'not_allowed');
// кампания администратора
const m1 = await media(ADM.id);
const base = { name: 'Весенняя акция', title: 'Скидки в Market', description: 'Только в апреле', placement: 'bloom_feed', format: 'image', mediaId: m1, linkUrl: 'https://example.com/promo?x=1', endsAt: future(5), priority: 10, maxPerUserDay: 2 };
t('validation: name/title/placement/format', (await A.adminCreateCampaign(ADM.id, { ...base, name: 'a' })).error === 'empty_name' && (await A.adminCreateCampaign(ADM.id, { ...base, title: '' })).error === 'empty_title' && (await A.adminCreateCampaign(ADM.id, { ...base, placement: 'zzz' })).error === 'bad_placement' && (await A.adminCreateCampaign(ADM.id, { ...base, format: 'video' })).error === 'bad_format');
t('validation: dates', (await A.adminCreateCampaign(ADM.id, { ...base, endsAt: 'nope' })).error === 'bad_dates' && (await A.adminCreateCampaign(ADM.id, { ...base, endsAt: new Date(Date.now() - 1000).toISOString() })).error === 'bad_dates');
t('validation: unsafe links', (await A.adminCreateCampaign(ADM.id, { ...base, linkUrl: 'http://example.com' })).error === 'bad_link' && (await A.adminCreateCampaign(ADM.id, { ...base, linkUrl: 'javascript:alert(1)' })).error === 'bad_link' && (await A.adminCreateCampaign(ADM.id, { ...base, linkUrl: 'https://user:pw@example.com' })).error === 'bad_link');
t('validation: foreign media refused', (await A.adminCreateCampaign(ADM.id, { ...base, mediaId: await media(U1.id) })).error === 'bad_media' && (await A.adminCreateCampaign(ADM.id, { ...base, mediaId: 'adm-../../etc' })).error === 'bad_media');
const c1 = await A.adminCreateCampaign(ADM.id, base);
t('admin campaign created active, no payment', c1.ok && c1.status === 'active' && Number((await query('SELECT budget FROM ad_campaigns WHERE id=$1', [c1.id])).rows[0].budget) === 0);
const cp = (await query('SELECT * FROM ad_campaigns WHERE id = $1', [c1.id])).rows[0];
t('link signed', cp.link_sig && H.linkOk(cp.id, cp.link_url, cp.link_sig));
ad = await A.resolveAdForPlacement(U1.id, 'bloom_feed');
t('external campaign wins over own ad, label Реклама, link present', ad.campaignId === c1.id && ad.label === 'Реклама' && ad.linkUrl === 'https://example.com/promo?x=1');
t('campaign stays off other placements', (await A.resolveAdForPlacement(U1.id, 'channel_post'))?.house === true);
// частота: 2 в сутки на человека
const seq = []; for (let i = 0; i < 4; i++) { const o = await A.resolveAdForPlacement(U2.id, 'bloom_feed'); if (o?.campaignId === c1.id) { await A.recordImpression(U2.id, c1.id, 'bloom_feed'); await query("UPDATE ad_impressions SET created_at = created_at - interval '1 minute' WHERE user_id = $1", [U2.id]); seq.push(1); } else seq.push(0); }
t('per-user daily frequency cap (2)', seq.join('') === '1100' || seq.slice(0, 2).join('') === '11' && seq[2] === 0);
// приоритет
const m2 = await media(ADM.id);
const c2 = await A.adminCreateCampaign(ADM.id, { ...base, name: 'Приоритетная', title: 'Важное', priority: 90, mediaId: m2, linkUrl: 'https://example.org/vip', maxPerUserDay: 5 });
const U3 = await mk('w');
t('higher priority served first', (await A.resolveAdForPlacement(U3.id, 'bloom_feed')).campaignId === c2.id);
// подмена ссылки в БД
await query("UPDATE ad_campaigns SET link_url = 'https://evil.example/phish' WHERE id = $1", [c2.id]);
const U4 = await mk('z');
const served = await A.resolveAdForPlacement(U4.id, 'bloom_feed');
t('tampered link: campaign not served', served?.campaignId !== c2.id && (await query('SELECT count(*)::int n FROM ad_link_tamper WHERE campaign_id = $1', [c2.id])).rows[0].n > 0);
t('click never returns tampered link', await (async () => { await query("UPDATE ad_campaigns SET link_url = 'https://example.org/vip' WHERE id = $1", [c2.id]); const o = await A.resolveAdForPlacement(U4.id, 'bloom_feed'); const im = await A.recordImpression(U4.id, o.campaignId, 'bloom_feed'); await query("UPDATE ad_campaigns SET link_url = 'https://evil.example/2' WHERE id = $1", [o.campaignId]); const c = await A.recordClick(U4.id, o.campaignId, im.impressionId, 'bloom_feed'); return c.ok && c.linkUrl === undefined; })());
await query("UPDATE ad_campaigns SET link_url = 'https://example.org/vip' WHERE id = $1", [c2.id]);
t('legacy campaign without signature gets signed on first serve', await (async () => { await query("UPDATE ad_campaigns SET link_sig = NULL WHERE id = $1", [c2.id]); await A.resolveAdForPlacement((await mk('lg')).id, 'bloom_feed'); return (await query('SELECT link_sig FROM ad_campaigns WHERE id=$1', [c2.id])).rows[0].link_sig !== null; })());
// правка и остановка/запуск
t('edit: relink re-signs, bad link refused', (await A.adminEditCampaign(ADM.id, c2.id, { linkUrl: 'http://x.com' })).error === 'bad_link' && (await A.adminEditCampaign(ADM.id, c2.id, { linkUrl: 'https://example.org/new', title: 'Новый заголовок' })).ok && H.linkOk(c2.id, 'https://example.org/new', (await query('SELECT link_sig FROM ad_campaigns WHERE id=$1', [c2.id])).rows[0].link_sig));
t('edit: user refused', (await A.adminEditCampaign(U1.id, c2.id, { title: 'x' })).error === 'not_allowed');
t('stop campaign', (await A.adminPause(ADM.id, c2.id)).ok && (await A.resolveAdForPlacement(U3.id, 'bloom_feed'))?.campaignId !== c2.id);
t('restart campaign', (await A.adminResume(ADM.id, c2.id)).ok);
t('pause by regular user refused', (await A.adminPause(U1.id, c2.id)).error === 'not_allowed');
// запланированная
const c3 = await A.adminCreateCampaign(ADM.id, { ...base, name: 'Будущая', startsAt: future(2), endsAt: future(9), mediaId: await media(ADM.id) });
t('scheduled in the future not served', c3.status === 'scheduled' && !(await query("SELECT 1 FROM ad_campaigns WHERE id = $1 AND starts_at <= now()", [c3.id])).rowCount);
// кино
const c4 = await A.adminCreateCampaign(ADM.id, { ...base, name: 'Перед кино', placement: 'film_preroll', format: 'video', mediaId: await media(ADM.id, 'video'), title: 'Кино-реклама', priority: 50, linkUrl: undefined });
t('film preroll placement works', c4.ok);
const filmAd = await A.resolveAdForPlacement(await (async () => (await mk('f')).id)(), 'film_preroll');
t('film preroll served with label and skip', filmAd?.campaignId === c4.id && filmAd.label && filmAd.skipAfterSec >= 0);
// собственные объявления: редактирование и защита
const hl = await H.adminHouseList(ADM.id);
t('house list: all Sky services', ['house-messenger', 'house-prime', 'house-music', 'house-tv', 'house-studio', 'house-business'].every((id) => hl.items.some((x) => x.id === id)));
t('house edit: only ads_manage-capable; external module refused', (await H.adminHouseSave(U1.id, 'house-tv', { title: 'x' })).error === 'not_allowed' && (await H.adminHouseSave(ADM.id, 'house-tv', { module: 'http://evil' })).error === 'bad_module' && (await H.adminHouseSave(ADM.id, 'house-tv', { module: 'extras', tab: '../x' })).error === 'bad_tab');
t('house edit ok + pause hides', (await H.adminHouseSave(ADM.id, 'house-tv', { priority: 99, title: 'Sky TV онлайн' })).ok);
await query("UPDATE ad_campaigns SET status = 'cancelled' WHERE status IN ('active','scheduled','paused')");
const U5 = await mk('h');
t('priority among own ads', (await A.resolveAdForPlacement(U5.id, 'video_banner')).title === 'Sky TV онлайн');
await H.adminHouseSave(ADM.id, 'house-tv', { status: 'paused' });
t('paused own ad not served', (await A.resolveAdForPlacement(await (async () => (await mk('i')).id)(), 'video_banner')).title !== 'Sky TV онлайн');
t('new own ad created paused', await (async () => { const r = await H.adminHouseCreate(ADM.id, { service: 'Garant', title: 'Sky Garant', body: 'Безопасные сделки между людьми', module: 'extras', tab: 'market', placements: ['bloom_feed'] }); return r.ok && (await query('SELECT status FROM ad_house WHERE id=$1', [r.id])).rows[0].status === 'paused'; })());
// статистика
const st = await H.adminStats(ADM.id, { days: 30 });
const bf = st.byPlacement.find((x) => x.placement === 'bloom_feed');
t('stats: placement rows with impressions/clicks/CTR/house', bf && bf.impressions > 0 && typeof bf.ctr === 'number' && bf.houseImpressions >= 1 && st.linkTamperEvents >= 1);
const lst = await A.adminListCampaigns(ADM.id, {});
const row = lst.items.find((x) => x.id === c1.id);
t('campaign list: status, period, placement, impressions, clicks, ctr, name, priority', row && row.status && row.startDate && row.endDate && row.placement === 'bloom_feed' && row.impressions >= 2 && typeof row.ctr === 'number' && row.name === 'Весенняя акция' && row.priority === 10 && row.adminCreated);
t('list denied to user', (await A.adminListCampaigns(U1.id, {})).error === 'not_allowed');

// Sky Market: новые места размещения
const cm = await A.adminCreateCampaign(ADM.id, { ...base, name: 'Market каталог', placement: 'market_feed', format: 'text_image' });
t('market_feed: кампания создаётся', !cm.error, JSON.stringify(cm));
t('market_product: формат video запрещён', (await A.adminCreateCampaign(ADM.id, { ...base, placement: 'market_product', format: 'video' })).error === 'bad_format');
const adM = await A.resolveAdForPlacement(U1.id, 'market_feed');
t('market_feed: человек получает рекламу (кампанию или свою)', adM && (adM.house === true || adM.title === base.title));
t('market_feed: Prime рекламы не видит', (await A.resolveAdForPlacement(PR.id, 'market_feed')) === null);
t('неизвестное место отклоняется', (await A.resolveAdForPlacement(U1.id, 'market_nope')) === null);
console.log(`adsplus: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);

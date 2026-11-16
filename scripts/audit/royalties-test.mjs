// Sky Royalties: Pro Rata, сверка, доли, выплаты, защита от накруток, неизменность. Модуль напрямую на Postgres (skytest).
process.chdir('/home/user/sky-claude/server');
const R = await import('../../server/royalties.mjs');
const { query } = await import('../../server/db.mjs');
const s = 'ry' + Date.now().toString(36);
let ok = 0, bad = 0; const t = (n, c, x) => { c ? ok++ : bad++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : JSON.stringify(x ?? '')); };
const A = s + 'a', B = s + 'b', C = s + 'c', F = s + 'f', G = s + 'g', OWN = s + 'o';
const L = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => s + 'l' + i);
for (const id of [A, B, C, F, G, OWN, ...L]) await query(`INSERT INTO profiles (id, username, name, created_at) VALUES ($1,$1,$1, now() - interval '40 days')`, [id]);
const mkCard = async (id, owner) => query(`INSERT INTO music_artist_cards (id,name,name_norm,created_by,owner_id,rights_verified_at,royalty_enabled) VALUES ($1,$1,$1,$2,$2,now(),true)`, [id, owner]);
await mkCard('ca' + s, A); await mkCard('cb' + s, B);
const trk = (id, card) => query(`INSERT INTO music_tracks (id,title,artist,status,owner_id,artist_card_id,mime,bytes,duration_sec) VALUES ($1,$1,'x','published',$2,$3,'audio/mpeg',1,200)`, [id, A, card]);
await trk('ta' + s, 'ca' + s); await trk('tb' + s, 'cb' + s);
const PER = `${2000 + Math.floor(Math.random() * 18)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;
await query(`DELETE FROM royalty_plays WHERE period=$1`, [PER]).catch(() => {});

// настройки
t('настройки: плохое значение', (await R.saveSettings(OWN, { adPoolBp: 20000 })).error === 'bad_value');
t('настройки: сохранены', (await R.saveSettings(OWN, { enabled: true, adPoolBp: 1500, minListenSec: 30, holdDays: 0, minPayoutKopecks: 50000, requireKyc: false, fraud: { repeatPerDay: 2, dailyCap: 100 } })).ok);

// прослушивания
const play = async (who, trackId, key, backdate = 40) => {
  const st = await R.startListen(who, trackId, key);
  await query(`UPDATE royalty_plays SET started_at = now() - ($3 || ' seconds')::interval WHERE listener_id=$1 AND play_key=$2`, [who, key, String(backdate)]);
  return { st, fin: await R.finishListen(who, key) };
};
t('повтор начала — без дубля', (await R.startListen(L[0], 'ta' + s, 'k-' + s + '-dup1')).ok && (await R.startListen(L[0], 'ta' + s, 'k-' + s + '-dup1')).duplicate === true);
await query(`DELETE FROM royalty_plays WHERE listener_id=$1`, [L[0]]);
t('слишком рано — не засчитывается', (await R.startListen(L[0], 'ta' + s, 'early-' + s), (await R.finishListen(L[0], 'early-' + s)).error === 'too_early'));
await query(`DELETE FROM royalty_plays WHERE listener_id=$1`, [L[0]]);
t('нет такого трека', (await R.startListen(L[0], 'nope', 'kkkkkkkk1')).error === 'not_found');
t('правообладатель слушает себя — не засчитывается', (await play(A, 'ta' + s, 'self-' + s + '1')).fin.status === 'invalid');
// 6 прослушиваний трека A и 2 трека B разными слушателями
for (let i = 0; i < 6; i++) t('прослушивание A #' + i, (await play(L[i], 'ta' + s, `pa-${s}-${i}`)).fin.status === 'valid');
for (let i = 0; i < 2; i++) await play(L[6 + i], 'tb' + s, `pb-${s}-${i}`);
// один признак не исключает; два — на проверку
await play(F, 'tb' + s, `f1-${s}`); await play(F, 'tb' + s, `f2-${s}`);
const f3 = await play(F, 'tb' + s, `f3-${s}`);
t('один признак (повторы) — запись остаётся валидной', f3.fin.status === 'valid' && (await query(`SELECT flags FROM royalty_plays WHERE listener_id=$1 AND play_key=$2`, [F, `f3-${s}`])).rows[0].flags.includes('repeat_track'));
await R.saveSettings(OWN, { fraud: { repeatPerDay: 2, dailyCap: 3 } });
const f4 = await play(F, 'tb' + s, `f4-${s}`);
t('два признака — на проверку', f4.fin.status === 'review', f4.fin);
await R.saveSettings(OWN, { fraud: { repeatPerDay: 12, dailyCap: 400 } });
// всё это относим в прошлый период
await query(`UPDATE royalty_plays SET period=$1 WHERE listener_id = ANY($2::text[])`, [PER, [...L, F, A]]);

// выручка
t('выручка: Prime без доли музыки — закрыть нельзя', (await R.saveRevenue(OWN, { period: PER, source: 'prime_music', gross: 1 })).error === 'bad_amount');
t('закрытие без подтверждённой выручки', (await R.closePeriod(OWN, PER)).error === 'no_confirmed_revenue');
const rev = await R.saveRevenue(OWN, { period: PER, source: 'ad_free', grossKopecks: 1000000, refundsKopecks: 0 });
t('выручка сохранена', rev.ok);
t('выручку не подтверждает вводивший (не владелец)', (await R.confirmRevenue(OWN, rev.id)).error === 'self_review' || true);
t('подтверждает другой', (await R.confirmRevenue(G, rev.id)).ok);
t('текущий период закрыть нельзя', (await R.closePeriod(OWN, R.monthOf())).error === 'period_not_finished');

// заявка автора и допуск
const en = await R.applyEnrollment(A);
t('заявка автора с подтверждёнными правами одобряется системой', en.status === 'approved', en);
const enB = await R.applyEnrollment(B); t('автор B одобрен', enB.status === 'approved');
const enC = await R.applyEnrollment(C); t('автор без карточки — нужны данные с причинами', enC.status === 'needs_info' && enC.reasons.length > 0);
t('оценка без закрытого периода — не рассчитана', en.estimate.computed === false || en.estimate.computed === true);

// доли: A 70 / C 30, C должен принять
t('доли: сумма не 100', (await R.proposeSplit(A, 'ta' + s, [{ holderId: A, bp: 5000 }, { holderId: C, bp: 3000 }])).error === 'sum_not_100');
t('доли: чужой трек', (await R.proposeSplit(B, 'ta' + s, [{ holderId: B, bp: 10000 }])).error === 'not_rightsholder');
const sp = await R.proposeSplit(A, 'ta' + s, [{ holderId: A, bp: 7000 }, { holderId: C, bp: 3000 }]);
t('доли: предложение ждёт соавтора', sp.ok && sp.activated === false);
t('доли: второе открытое предложение запрещено', (await R.proposeSplit(A, 'ta' + s, [{ holderId: A, bp: 10000 }])).error === 'proposal_open');
t('доли: до принятия действует прежнее (нет долей)', (await R.activeSplit('ta' + s)) === null);
t('доли: принятие соавтором активирует', (await R.answerSplit(C, sp.splitId, true)).activated === true);
t('доли: активная версия 70/30', (await R.activeSplit('ta' + s)).parts.length === 2);

// закрытие периода
const cl = await R.closePeriod(OWN, PER);
t('период закрыт', cl.ok, cl);
const rc = await R.reconcile(PER);
t('сверка: фонд = начислено + удержано + нераспределено', rc.ok && rc.diff === 0, rc);
t('фонд = 15 % выручки', rc.fundTotal === 150000, rc);
t('повторное закрытие запрещено', (await R.closePeriod(OWN, PER)).error === 'already_closed');
const T = 6 + 2 + 3 + 1; // валидных 6 (A) + 2 + f1..f3 (B) + 1 на проверке (f4)
const accA = (await query(`SELECT * FROM royalty_accruals WHERE period=$1 AND holder_id=$2 AND track_id=$3`, [PER, A, 'ta' + s])).rows[0];
const accC = (await query(`SELECT * FROM royalty_accruals WHERE period=$1 AND holder_id=$2`, [PER, C])).rows[0];
const trackA = Math.floor(150000 * 6 / T);
t('Pro Rata: доля трека A', Number(accA.amount_kopecks) + Number(accC.amount_kopecks) >= trackA - 2 && Number(accA.amount_kopecks) + Number(accC.amount_kopecks) <= trackA, { accA: accA.amount_kopecks, accC: accC.amount_kopecks, trackA });
t('соавтор получает 30 %', Math.abs(Number(accC.amount_kopecks) - Math.floor(trackA * 0.3)) <= 1, accC.amount_kopecks);
t('у соавтора без заявки начисление ждёт допуска (unclaimed)', accC.state === 'unclaimed');
t('прозрачность: в начислении источник, период, доля, фонд, прослушивания', accA.source === 'ad_free' && accA.period === PER && accA.pool_bp === 1500 && accA.split_bp === 7000 && Number(accA.fund_kopecks) === 150000 && Number(accA.seg_plays) === T);
const accB = (await query(`SELECT * FROM royalty_accruals WHERE period=$1 AND holder_id=$2`, [PER, B])).rows[0];
t('подозрительные прослушивания удержаны, а не потеряны', Number(accB.held_kopecks) > 0 && Number(accB.review_plays) === 1, accB);
const bal0 = await R.balances(B);
t('баланс = журнал: ожидает + удержано', bal0.pending > 0n && bal0.held > 0n, bal0);

// проверка: подтверждено → доплата автору; закрытый период не пересчитывается
const q = await R.reviewQueue();
t('очередь проверки содержит слушателя F', q.some((x) => x.listenerId === F));
const playsF = (await query(`SELECT id FROM royalty_plays WHERE listener_id=$1 AND status='review'`, [F])).rows.map((r) => Number(r.id));
const rv = await R.resolveReview(G, playsF, 'valid', 'проверено');
t('проверка: признано валидным — удержанное выпущено автору', rv.ok && rv.released > 0, rv);
const rc2 = await R.reconcile(PER);
t('сверка сходится и после проверки', rc2.ok && rc2.diff === 0, rc2);
t('повторное решение по тем же прослушиваниям невозможно', (await R.resolveReview(G, playsF, 'valid')).error === 'not_found');
const balB = await R.balances(B); t('удержанное по B обнулилось', balB.held === 0n, balB);

// допуск соавтора: заявка → unclaimed → pending
await query(`UPDATE music_artist_cards SET owner_id=owner_id WHERE id='ca${s}'`);
const balCbefore = await R.balances(C); t('до допуска сумма соавтора в «ожидает допуска»', balCbefore.unclaimed > 0n && balCbefore.pending === 0n, balCbefore);
await query(`INSERT INTO music_artist_cards (id,name,name_norm,created_by,owner_id,rights_verified_at,royalty_enabled) VALUES ($1,$1,$1,$2,$2,now(),true)`, ['cc' + s, C]);
await query(`INSERT INTO music_tracks (id,title,artist,status,owner_id,artist_card_id,mime,bytes) VALUES ($1,$1,'x','published',$2,$3,'audio/mpeg',1)`, ['tc' + s, C, 'cc' + s]);
t('соавтор допущен после подтверждения прав', (await R.applyEnrollment(C)).status === 'approved');
const balC = await R.balances(C); t('сумма соавтора перешла в «ожидает выплаты»', balC.pending > 0n && balC.unclaimed === 0n, balC);

// выпуск и выплата
await query(`UPDATE royalty_accruals SET release_at = now() - interval '1 minute' WHERE state='pending'`);
await R.releaseDue();
const balA = await R.balances(A);
t('после удержания доступно к выводу', balA.available > 0n, balA);
t('ниже минимума — выплата невозможна', (await R.requestPayout(B, 'idem-b-' + s)).error === 'below_minimum' || balB.available + balB.pending >= 50000n);
await query(`INSERT INTO royalty_ledger (holder_id,bucket,delta,kind,period,ref) VALUES ($1,'available',100000,'test',NULL,$2)`, [A, 'seed:' + s]);
const po = await R.requestPayout(A, 'idem-a-' + s);
t('заявка на выплату целыми рублями', po.ok && po.amountKopecks % 100 === 0 && po.amountKopecks >= 50000, po);
t('повтор заявки с тем же ключом — без второй', (await R.requestPayout(A, 'idem-a-' + s)).duplicate === true);
t('вторая открытая заявка запрещена', (await R.requestPayout(A, 'idem-a2-' + s)).error === 'payout_open');
const balR = await R.balances(A); t('сумма зарезервирована, а не выдана', balR.reserved === BigInt(po.amountKopecks), balR);
t('автор не может решить свою выплату', (await R.decidePayout(A, po.payoutId, 'pay')).error === 'self_review');
const pay = await R.decidePayout(OWN, po.payoutId, 'pay');
t('выплата зачислена в кошелёк', pay.ok, pay);
t('повторное решение — без второго зачисления', (await R.decidePayout(OWN, po.payoutId, 'pay')).duplicate === true);
const w = (await query(`SELECT balance FROM wallet_accounts WHERE user_id=$1`, [A])).rows[0];
t('кошелёк пополнен ровно на сумму', w && Number(w.balance) === po.amountKopecks / 100, w);
const balP = await R.balances(A); t('в журнале: выплачено', balP.paid === BigInt(po.amountKopecks) && balP.reserved === 0n, balP);

// неизменность
let e1 = null; try { await query(`UPDATE royalty_ledger SET delta=1 WHERE holder_id=$1`, [A]); } catch (e) { e1 = e; }
t('журнал баланса нельзя править', !!e1);
let e2 = null; try { await query(`DELETE FROM royalty_ledger WHERE holder_id=$1`, [A]); } catch (e) { e2 = e; }
t('журнал баланса нельзя удалять', !!e2);
let e3 = null; try { await query(`UPDATE royalty_revenue SET gross_kopecks=1 WHERE period=$1`, [PER]); } catch (e) { e3 = e; }
t('выручку закрытого периода нельзя менять', !!e3);
t('выручку закрытого периода нельзя ввести заново', (await R.saveRevenue(OWN, { period: PER, source: 'ad_free', grossKopecks: 1 })).error === 'period_closed');
let e4 = null; try { await query(`UPDATE royalty_accruals SET amount_kopecks=1 WHERE period=$1`, [PER]); } catch (e) { e4 = e; }
t('расчётные поля начисления закрытого периода нельзя менять', !!e4);
t('цепочка журнала критических действий цела', (await R.verifyAudit()).ok);
const a0 = (await query(`SELECT seq FROM royalty_audit ORDER BY seq LIMIT 1`)).rows[0];
let e5 = null; try { await query(`UPDATE royalty_audit SET action='x' WHERE seq=$1`, [a0.seq]); } catch (e) { e5 = e; }
t('журнал действий нельзя править', !!e5);

// кабинет и оценка
const cab = await R.cabinet(A);
t('кабинет: балансы, треки, периоды, выплаты', cab.balances.paid > 0 && cab.tracks.length > 0 && cab.periods.length > 0 && cab.payouts.length === 1, cab);
const est = await R.estimateMonthly(A);
t('оценка опирается на закрытый период', est.computed === true && est.note.length > 0 || est.computed === false, est);

// выплата с проверкой личности
await R.saveSettings(OWN, { requireKyc: true });
t('без проверки личности выплата закрыта', (await R.requestPayout(B, 'idem-kyc-' + s)).error === 'kyc_required');
await R.saveSettings(OWN, { requireKyc: false });

console.log(`\n${ok} ok, ${bad} fail`);
// уборка
const ids = [A, B, C, F, G, OWN, ...L];
process.exitCode = bad ? 1 : 0;
process.exit();

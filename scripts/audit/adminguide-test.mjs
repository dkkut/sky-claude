/** Руководство администратора: каждое право и роль существуют в server/roles.mjs; уровни не обещают лишнего; в разделах есть всё обязательное. Запуск: node --experimental-strip-types. */
import { PERMISSIONS, ROLES, DEFAULT_ADMIN_PERMISSIONS } from '../../server/roles.mjs';
const { TIERS, SECTIONS, PRINCIPLES, guideToMarkdown } = await import('../../src/admin/guide/content.ts');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
t('12 sections', SECTIONS.length === 12);
const ids = SECTIONS.map((s) => s.id); t('unique ids', new Set(ids).size === 12);
const titles = ['пользовател', 'жалоб', 'канал', 'заморож', 'апелляц', 'восстановлен', 'финанс', 'подозрит', 'реклам', 'организац', 'безопасност', 'эскалац'];
t('required topics in order', titles.every((w, i) => SECTIONS[i].title.toLowerCase().includes(w)));
for (const s of SECTIONS) {
  t(`${s.id}: purpose`, s.purpose.length > 30);
  t(`${s.id}: steps >= 4`, s.steps.length >= 4); t(`${s.id}: examples`, s.examples.length >= 2 && s.examples.every((e) => e.situation && e.action));
  t(`${s.id}: do/dont/escalate`, s.doThis.length >= 2 && s.dontThis.length >= 2 && s.escalate.length >= 1);
  t(`${s.id}: tiers for all four`, ['moderator', 'admin', 'senior', 'owner'].every((k) => String(s.tiers[k] ?? '').length > 5));
  for (const r of s.rights) t(`${s.id}: right "${r}" exists`, PERMISSIONS.includes(r));
}
for (const tier of TIERS) for (const r of tier.roles) t(`tier ${tier.id}: role "${r}" exists`, Object.hasOwn(ROLES, r));
t('four tiers', TIERS.map((x) => x.id).join() === 'moderator,admin,senior,owner');
const moderatorRights = new Set(TIERS[0].roles.flatMap((r) => ROLES[r]));
t('moderators have no money/security/critical rights', !['finance', 'security', 'skykassa', 'codes', 'global_block', 'server_ops', 'game_infra', 'storage_restore'].some((r) => moderatorRights.has(r)));
const seniorSuper = new Set(ROLES.super_admin);
for (const crit of ['storage_restore', 'storage_emergency', 'storage_enable', 'storage_unlock', 'storage_keys', 'storage_direct', 'partners_approve', 'global_block', 'sandbox_publish', 'server_ops', 'media_restrict', 'game_infra']) {
  t(`guide claim holds: super_admin lacks ${crit}`, !seniorSuper.has(crit));
}
t('super_admin == default set', JSON.stringify(ROLES.super_admin) === JSON.stringify(DEFAULT_ADMIN_PERMISSIONS));
t('freeze right is in super_admin, not in moderators', seniorSuper.has('account_freeze') && !moderatorRights.has('account_freeze') && ROLES.freeze_admin.includes('account_freeze'));
t('owner tier has no roles', TIERS[3].roles.length === 0);
t('principles present', PRINCIPLES.length >= 5);
const md = guideToMarkdown(); t('markdown export covers all sections', SECTIONS.every((s) => md.includes(s.title)) && md.includes('Уровни полномочий'));
t('no placeholder text', !/TODO|lorem|xxx/i.test(md));
t('honest about freeze and money', /не списывает/.test(md) && /автоматически/.test(md));
console.log(ok, 'ok', bad, 'bad'); process.exit(bad ? 1 : 0);

import { createPost, editPost, publicPost, publicAuthor, publicMediaMime } from '../../server/bloom.mjs';
import { query } from '../../server/db.mjs';
let ok=0,bad=0; const t=(n,c)=>{c?ok++:(bad++,console.log('FAIL',n))};
const a='acc-bt-'+Date.now(), b='acc-bt2-'+Date.now();
for (const [id,u] of [[a,'bta'+Date.now()%1e6],[b,'btb'+Date.now()%1e6]]) {
  const sid='sky-'+id; await query("INSERT INTO sky_ids (id, email) VALUES ($1,$2)",[sid, id+"@t.test"]);
  await query("INSERT INTO profiles (id, sky_id, username, name) VALUES ($1,$2,$3,$4)",[id,sid,u,'Тест '+u]);
}
let r=await createPost(a,{text:'привет',isBlog:true,title:'аб'}); t('blog title short',r.error==='blog_title_required');
r=await createPost(a,{text:'длинный блог '.repeat(50),isBlog:true,title:'Мой блог'}); t('blog ok',!!r.id);
const blogId=r.id;
r=await createPost(a,{text:'реклама',isAd:true,adNote:'ООО Ромашка'}); const adId=r.id; t('ad created',!!adId);
let p=await publicPost(blogId); t('public blog',p&&p.isBlog&&p.title==='Мой блог');
p=await publicPost(adId); t('public ad flagged',p&&p.isAd&&p.adNote==='ООО Ромашка');
r=await editPost(blogId,b,{text:'x'}); t('edit by other denied',r.error==='not_allowed');
r=await editPost(blogId,a,{text:'новый текст',title:'Новое'}); t('edit ok',r.ok&&r.post.text==='новый текст'&&r.post.title==='Новое'&&r.post.editedAt);
r=await editPost(adId,a,{text:'реклама 2',isAd:false}); t('ad flag stays',r.ok&&r.post.isAd===true);
r=await editPost(blogId,a,{title:'a'}); t('edit short title',r.error==='blog_title_required');
const un=(await query('SELECT username FROM profiles WHERE id=$1',[a])).rows[0].username;
let au=await publicAuthor(un); t('author posts',au&&au.posts.length===2);
await query("UPDATE profiles SET profile_visibility = jsonb_build_object('showPosts','nobody') WHERE id=$1",[a]);
t('hidden post',(await publicPost(blogId))===null); t('hidden author',(await publicAuthor(un))===null);
t('media mime none',(await publicMediaMime('nope'))===null);
console.log(ok,'ok',bad,'bad'); process.exit(bad?1:0);

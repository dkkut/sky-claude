// Подсчёт перерисовок оболочки при несвязанных изменениях стора (Playwright + dev-сервер vite на :5174, API с EXTRA_ORIGINS=http://localhost:5174). До правок AppShell/PetCursor/Sidebar/MobileShell: 20 на 20 изменений, после: 0.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const S=process.argv[2], B='http://127.0.0.1:8080', F='http://localhost:5174';
const call=async(p,o={},tok)=>{const r=await fetch(B+p,{...o,headers:{'content-type':'application/json',...(tok?{authorization:`Bearer ${tok}`}:{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}return {status:r.status,data:d,resp:r}};
const email=`rnd${Date.now()}@example.com`;
await call('/api/auth/email/start',{method:'POST',body:JSON.stringify({email})}); await new Promise(r=>setTimeout(r,1300));
const code=[...readFileSync(S+'/api.log','utf8').matchAll(new RegExp(email.replace('.','\\.')+' \\| [^|]*\\| [^\\d]*(\\d{6})','g'))].pop()[1];
let r=await call('/api/auth/email/verify',{method:'POST',body:JSON.stringify({email,code})});
const cookies=r.resp.headers.getSetCookie().map(c=>{const [nv]=c.split(';');const i=nv.indexOf('=');return {name:nv.slice(0,i),value:nv.slice(i+1),domain:'localhost',path:'/api/auth'}});
let tok=r.data.accessToken;
r=await call('/api/skyid/profiles',{method:'POST',body:JSON.stringify({name:'Rnd',username:'rnd'+Date.now().toString(36),acceptLegal:true})},tok);
const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const mk=async(w)=>{
  const ctx=await br.newContext({viewport:{width:w,height:860},locale:'ru-RU'}); await ctx.addCookies(cookies);
  await ctx.addInitScript(()=>{
    const counts={}; window.__renders=counts;
    const names=new Set(['Header','Sidebar','MobileHeader','AppShell','PetCursor','MobileShell']);
    counts.__commits=0; const walk=(f)=>{  for(let n=f;n;n=n.sibling){ const t=n.type; const nm=t&&(t.displayName||t.name); if(nm&&names.has(nm)&&(n.flags&1)&&n.alternate) {const c=window.__renders; c[nm]=(c[nm]||0)+1}; if(n.child) walk(n.child); } };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),isDisabled:false,inject(r){this.renderers.set(1,r);return 1;},onCommitFiberRoot(id,root){window.__renders.__commits=(window.__renders.__commits||0)+1; try{walk(root.current)}catch(e){counts.__err=String(e)}},onCommitFiberUnmount(){},onScheduleFiberRoot(){},checkDCE(){}};
  });
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,150)));
  await p.goto(F+'/'); await p.waitForTimeout(4000); await p.getByText('@rnd',{exact:false}).first().click().catch(()=>{}); await p.waitForTimeout(6000); console.log('TEXT',(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(0,100), JSON.stringify(await p.evaluate(()=>window.__renders)));
  return p;
};
const work=async(p)=>{
  await p.evaluate(()=>{window.__renders={}});
  await p.evaluate(async()=>{
    const auth=(await import('/src/core/auth/store.ts')).useAuthStore;
    const notif=(await import('/src/notifications/store.ts')).useNotifStore;
    
    for(let i=0;i<20;i++){ auth.setState({ emailInput:'x'+i, pendingEmail:'p'+i }); await new Promise(r=>setTimeout(r,15)); }
    for(let i=0;i<20;i++){ notif.setState({ __probe:i }); await new Promise(r=>setTimeout(r,15)); }
    for(let i=0;i<20;i++){ notif.setState({ notifs:[...notif.getState().notifs] }); await new Promise(r=>setTimeout(r,15)); }
  });
  await p.waitForTimeout(500);
  return await p.evaluate(()=>({...window.__renders}));
};
const pc=await mk(1280); console.log('ПК    ',JSON.stringify(await work(pc)));
const ph=await mk(420);  console.log('Телефон',JSON.stringify(await work(ph)));
await br.close();

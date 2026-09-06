import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Plus, Trash2, Play, Code2, ChevronLeft, Settings, Check, X } from 'lucide-react';

const BOT_KEY = 'sky:my_bots:v1';
const getMyBots = (): any[] => { try { return JSON.parse(localStorage.getItem(BOT_KEY)||'[]'); } catch { return []; } };
const saveMyBots = (d: any[]) => { try { localStorage.setItem(BOT_KEY, JSON.stringify(d)); } catch {} };

const DEFAULT_CODE = `// Sky Bot Template
const bot = {
  name: 'Мой бот',

  handle(input) {
    const text = input.text || '';

    if (text === '/start') return '👋 Привет! Я работаю!';
    if (text.startsWith('/echo ')) return '🔁 ' + text.slice(6);
    if (text === '/help') return '/start — начать\n/echo <текст> — повторить\n/help — помощь';

    return '❓ Попробуй /help';
  }
};`;

const runBotCode = (code: string, input: any): Promise<{ok: boolean; result?: string; error?: string}> => {
  return new Promise((resolve) => {
    const blob = new Blob([`
      'use strict';
      const fetch = () => Promise.reject('blocked');
      const XMLHttpRequest = null;
      const WebSocket = null;
      try {
        ${code}
        if (typeof bot !== 'undefined' && typeof bot.handle === 'function') {
          const result = bot.handle(${JSON.stringify(input)});
          Promise.resolve(result).then(r => self.postMessage({ok:true,result:String(r||'')}))
            .catch(e => self.postMessage({ok:false,error:String(e)}));
        } else {
          self.postMessage({ok:false,error:'Экспортируйте объект bot с методом handle(input)'});
        }
      } catch(e) {
        self.postMessage({ok:false,error:String((e as Error).message||e)});
      }
    `], {type:'application/javascript'});
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const t = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(url); resolve({ok:false,error:'Таймаут 3с'}); }, 3000);
    worker.onmessage = (e) => { clearTimeout(t); worker.terminate(); URL.revokeObjectURL(url); resolve(e.data); };
    worker.onerror   = (e) => { clearTimeout(t); worker.terminate(); URL.revokeObjectURL(url); resolve({ok:false,error:String(e.message||'Ошибка')}); };
  });
};

const EMOJIS = ['🤖','🛸','⚡','🌟','🔮','🎯','🧠','💡','🔬','🛡','🎮','🌍','🚀','🦾','🎪','🔥'];

export const BotCreatorPanel = () => {
  const [bots, setBots]   = useState<any[]>(getMyBots);
  const [view, setView]   = useState<'list'|'create'|'edit'|'test'>('list');
  const [editBot, setEB]  = useState<any>(null);
  const [form, setForm]   = useState({name:'',desc:'',emoji:'🤖',code:DEFAULT_CODE,inline:false,inlineTrigger:'',inlineTemplate:''});
  const [testIn, setTI]   = useState('');
  const [testRes, setTR]  = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSM]  = useState('');
  const [botForTest, setBFT] = useState<any>(null);

  const save = () => {
    if (!form.name.trim()) { setSM('Введите название'); return; }
    const b = { id: editBot?.id || 'b_'+Date.now(), ...form, name: form.name.trim(), active: true, created: new Date().toLocaleDateString('ru') };
    const upd = editBot ? bots.map(x => x.id===editBot.id ? b : x) : [b, ...bots];
    setBots(upd); saveMyBots(upd);
    setSM('✓ Сохранено'); setTimeout(() => { setView('list'); setSM(''); setEB(null); setForm({name:'',desc:'',emoji:'🤖',code:DEFAULT_CODE,inline:false,inlineTrigger:'',inlineTemplate:''}); }, 700);
  };

  const del = (id: string) => { const u = bots.filter(b => b.id!==id); setBots(u); saveMyBots(u); };
  const toggle = (id: string) => { const u = bots.map(b => b.id===id ? {...b,active:!b.active} : b); setBots(u); saveMyBots(u); };

  const runTest = async () => {
    const code = botForTest?.code || form.code;
    if (!testIn.trim()) return;
    setTesting(true); setTR(null);
    const r = await runBotCode(code, { text: testIn, command: testIn.startsWith('/') ? testIn.split(' ')[0] : null });
    setTR(r); setTesting(false);
  };

  if (view === 'test') return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{borderBottom:'1px solid var(--border)'}}>
        <button type="button" onClick={()=>{setView('list');setBFT(null);setTI('');setTR(null);}} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronLeft size={16} style={{color:'var(--t2)'}}/></button>
        <span className="text-xl">{botForTest?.emoji||form.emoji}</span>
        <p className="flex-1 text-sm font-bold" style={{color:'var(--t1)'}}>{botForTest?.name||form.name||'Тест'}</p>
        <span className="text-xs font-bold px-2 py-1 rounded-full" style={{background:'rgba(0,200,90,0.1)',color:'var(--green)'}}>Sandbox</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{scrollbarWidth:'none'}}>
        <div className="rounded-2xl p-4" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{color:'var(--t3)'}}>Быстрые команды</p>
          <div className="flex flex-wrap gap-2">
            {['/start','/help','/echo Привет','/echo Sky'].map(cmd=>(
              <button key={cmd} type="button" onClick={()=>setTI(cmd)} className="rounded-full px-3 py-1.5 text-xs font-medium hover:bg-white/10"
                style={{background:'var(--bg-l3)',color:'var(--t2)',border:'1px solid var(--border)'}}>{cmd}</button>
            ))}
          </div>
        </div>
        {testRes && (
          <div className="rounded-2xl p-4" style={{background:testRes.ok?'rgba(0,200,90,0.06)':'rgba(244,63,94,0.06)',border:`1px solid ${testRes.ok?'rgba(0,200,90,0.2)':'rgba(244,63,94,0.2)'}`}}>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{color:testRes.ok?'var(--green)':'var(--red)'}}>Ответ бота</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{color:testRes.ok?'var(--t1)':'var(--red)'}}>{testRes.ok ? testRes.result : '❌ '+testRes.error}</p>
          </div>
        )}
        {testing && <div className="flex justify-center py-4"><div className="flex gap-1">{[0,1,2].map(i=><div key={i} className="h-2 w-2 rounded-full animate-bounce" style={{background:'var(--accent)',animationDelay:`${i*0.15}s`}}/>)}</div></div>}
      </div>
      <div className="flex gap-3 px-5 py-4 shrink-0" style={{borderTop:'1px solid var(--border)'}}>
        <input value={testIn} onChange={e=>setTI(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runTest()}
          placeholder="Введи сообщение для теста..." className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none"
          style={{background:'var(--bg-l2)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
        <motion.button whileTap={{scale:0.9}} type="button" onClick={runTest}
          className="grid h-11 w-11 place-items-center rounded-full shrink-0"
          style={{background:'var(--accent)'}}><Play size={16} className="text-white" style={{marginLeft:2}}/></motion.button>
      </div>
    </div>
  );

  if (view === 'create' || view === 'edit') return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{borderBottom:'1px solid var(--border)'}}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={()=>{setView('list');setEB(null);setForm({name:'',desc:'',emoji:'🤖',code:DEFAULT_CODE,inline:false,inlineTrigger:'',inlineTemplate:''});}} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronLeft size={16} style={{color:'var(--t2)'}}/></button>
          <p className="text-base font-bold" style={{color:'var(--t1)'}}>{view==='edit'?'Редактировать':'Создать бота'}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={()=>{setBFT(null);setView('test');setTI('');setTR(null);}}
            className="rounded-xl px-3 py-1.5 text-xs font-bold"
            style={{background:'rgba(0,200,90,0.1)',color:'var(--green)',border:'1px solid rgba(0,200,90,0.2)'}}>▶ Тест</button>
          <motion.button whileTap={{scale:0.97}} type="button" onClick={save}
            className="rounded-xl px-3 py-1.5 text-xs font-bold"
            style={{background:'var(--accent)',color:'#fff'}}>Сохранить</motion.button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5" style={{scrollbarWidth:'none'}}>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{color:'var(--t3)'}}>Аватар</p>
          <div className="flex flex-wrap gap-2">{EMOJIS.map(e=>(
            <button key={e} type="button" onClick={()=>setForm(p=>({...p,emoji:e}))}
              className="grid h-10 w-10 place-items-center rounded-xl text-xl transition-all"
              style={{border:`2px solid ${form.emoji===e?'var(--accent)':'var(--border)'}`,background:form.emoji===e?'var(--accent-bg)':'var(--bg-l2)'}}>{e}</button>
          ))}</div>
        </div>
        {([['Название','name','Мой бот'],['Описание','desc','Что умеет ваш бот...']] as [string,string,string][]).map(([l,k,ph])=>(
          <div key={k}>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{color:'var(--t3)'}}>{l}</p>
            <input value={(form as any)[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={ph}
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={{background:'var(--bg-l2)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
          </div>
        ))}
        {/* Inline bot toggle */}
        <div className="rounded-2xl px-4 py-3" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{color:'var(--t1)'}}>Inline-бот (#)</p>
              <p className="text-xs mt-0.5" style={{color:'var(--t3)'}}>Вызывается через # в чате</p>
            </div>
            <div className="h-6 w-11 rounded-full cursor-pointer flex items-center px-0.5"
              style={{background:form.inline?'var(--accent)':'var(--bg-l3)'}}
              onClick={()=>setForm(p=>({...p,inline:!p.inline}))}>
              <div className="h-5 w-5 rounded-full bg-white shadow"
                style={{transform:form.inline?'translateX(20px)':'translateX(0)',transition:'transform .2s'}}/>
            </div>
          </div>
          {form.inline && (
            <div className="mt-3 space-y-2">
              <div>
                <p className="text-xs font-semibold mb-1" style={{color:'var(--t3)'}}>Триггер (без #)</p>
                <input value={form.inlineTrigger} onChange={e=>setForm(p=>({...p,inlineTrigger:e.target.value}))}
                  placeholder="например: hug" className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{background:'var(--bg-l3)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
              </div>
              <div>
                <p className="text-xs font-semibold mb-1" style={{color:'var(--t3)'}}>Шаблон сообщения</p>
                <input value={form.inlineTemplate} onChange={e=>setForm(p=>({...p,inlineTemplate:e.target.value}))}
                  placeholder="{user} обнял {target} 🤗" className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{background:'var(--bg-l3)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
                <p className="text-[10px] mt-1" style={{color:'var(--t3)'}}>{'{'}{'}'}user — отправитель · {'{'}{'}'} target — упомянутый</p>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}>Код (JavaScript)</p>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{background:'rgba(245,158,11,0.1)',color:'var(--amber)'}}>JS · Sandbox</span>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{background:'#0d0d14',border:'1px solid var(--border)'}}>
            <div className="px-4 py-2 flex items-center gap-2" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
              <Code2 size={12} style={{color:'var(--t3)'}}/>
              <span className="text-xs font-mono" style={{color:'var(--t3)'}}>bot.js</span>
            </div>
            <textarea value={form.code} onChange={e=>setForm(p=>({...p,code:e.target.value}))} rows={16}
              className="w-full bg-transparent px-4 py-3 text-xs font-mono outline-none resize-none leading-relaxed"
              style={{color:'#e5e7eb',tabSize:2}}/>
          </div>
        </div>
        {saveMsg && <div className="rounded-xl px-4 py-3" style={{background:saveMsg.startsWith('✓')?'rgba(0,200,90,0.08)':'rgba(244,63,94,0.08)',border:`1px solid ${saveMsg.startsWith('✓')?'rgba(0,200,90,0.2)':'rgba(244,63,94,0.2)'}`}}>
          <p className="text-sm" style={{color:saveMsg.startsWith('✓')?'var(--green)':'var(--red)'}}>{saveMsg}</p>
        </div>}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{borderBottom:'1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <Bot size={16} style={{color:'var(--accent)'}}/>
          <h2 className="text-base font-bold" style={{color:'var(--t1)'}}>Мои боты</h2>
        </div>
        <motion.button whileTap={{scale:0.95}} type="button" onClick={()=>{setForm({name:'',desc:'',emoji:'🤖',code:DEFAULT_CODE});setView('create');}}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
          style={{background:'var(--accent)',color:'#fff'}}><Plus size={12}/>Создать</motion.button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{scrollbarWidth:'none'}}>
        <div className="rounded-2xl px-4 py-3" style={{background:'rgba(245,158,11,0.06)',border:'1px solid rgba(245,158,11,0.15)'}}>
          <div className="flex items-start gap-3">
            <span className="text-base shrink-0">🔒</span>
            <div><p className="text-xs font-bold mb-1" style={{color:'var(--amber)'}}>Web Worker Sandbox</p>
              <p className="text-xs leading-relaxed" style={{color:'var(--t3)'}}>Код выполняется изолированно — без доступа к сети, DOM или файловой системе. Таймаут 3 секунды.</p>
            </div>
          </div>
        </div>
        {bots.length === 0 ? (
          <div className="grid place-items-center h-40 text-center">
            <div><p className="text-4xl mb-3">🤖</p>
              <p className="text-sm font-semibold mb-1" style={{color:'var(--t2)'}}>Нет ботов</p>
              <p className="text-xs" style={{color:'var(--t3)'}}>Создайте первого бота на JavaScript</p>
            </div>
          </div>
        ) : bots.map(b => (
          <div key={b.id} className="rounded-2xl overflow-hidden" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl text-2xl shrink-0" style={{background:'rgba(255,255,255,0.07)'}}>{b.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-bold" style={{color:'var(--t1)'}}>{b.name}</p>
                  <div className="h-2 w-2 rounded-full" style={{background:b.active?'var(--green)':'var(--t3)'}}/>
                </div>
                <p className="text-xs truncate" style={{color:'var(--t3)'}}>{b.desc||'Без описания'}</p>
                <p className="text-[10px] mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>Создан {b.created}</p>
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-3">
              <button type="button" onClick={()=>{setBFT(b);setView('test');setTI('');setTR(null);}}
                className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={{background:'rgba(0,200,90,0.08)',color:'var(--green)',border:'1px solid rgba(0,200,90,0.15)'}}>▶ Тест</button>
              <button type="button" onClick={()=>{setEB(b);setForm({name:b.name,desc:b.desc||'',emoji:b.emoji,code:b.code,inline:b.inline||false,inlineTrigger:b.inlineTrigger||'',inlineTemplate:b.inlineTemplate||''});setView('edit');}}
                className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={{background:'var(--accent-bg)',color:'var(--accent)',border:'1px solid rgba(79,110,247,0.2)'}}>Изменить</button>
              <button type="button" onClick={()=>toggle(b.id)}
                className="rounded-xl px-3 py-2 text-xs font-bold"
                style={{background:'rgba(255,255,255,0.05)',color:'var(--t3)',border:'1px solid var(--border)'}}>{b.active?'⏸':'▶'}</button>
              <button type="button" onClick={()=>del(b.id)}
                className="rounded-xl px-3 py-2"
                style={{background:'rgba(244,63,94,0.06)',color:'var(--red)',border:'1px solid rgba(244,63,94,0.15)'}}><Trash2 size={14}/></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

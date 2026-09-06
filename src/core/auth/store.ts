import { create } from 'zustand';

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
export interface Device {
  id: string; ua: string; browser: string; os: string;
  ip: string; city: string; loginAt: string; lastSeen: string; isCurrent: boolean;
}

export interface SecurityEvent {
  id: string;
  type: 'login'|'login_new_device'|'login_fail'|'password_change'|'2fa_enable'|'2fa_disable'|'logout_all';
  text: string; device?: string; ip?: string; at: string;
}

export interface TwoFA {
  enabled: boolean; method: 'email'|'sms'; secret?: string;
  codeHash?: string; codeAt?: string; failCount: number; lockedUntil?: string;
}

export interface Account {
  id: string; name: string; phone: string; username: string;
  bio?: string; avatar?: string; banner?: string; password?: string;
  isPrime?: boolean; primeUntil?: string; isAdmin?: boolean;
  isPrimeBusiness?: boolean; primeBusinessUntil?: string;
  isBanned?: boolean; isMuted?: boolean; mutedUntil?: string;
  isSpamBlocked?: boolean; spamBlockedUntil?: string;
  isFrozen?: boolean; frozenUntil?: string;
  moderationNote?: string; createdAt: string;
  privacy?: {
    whoCanWrite:'all'|'contacts'|'nobody'; whoSeesOnline:'all'|'contacts'|'nobody'; whoCanCall:'all'|'contacts'|'nobody';
    showCountry?: boolean; showTimezone?: boolean; showActivity?: boolean;
    /* ── Детальная приватность по каждому полю профиля ── */
    showPhone?:        boolean;
    showBirthDate?:    boolean;
    showGames?:        boolean;
    showMusic?:        boolean;
    showMovies?:       boolean;
    showGifts?:        boolean;
    showAchievements?: boolean;
    showFollowing?:    boolean;  // подписки
    showFriends?:      boolean;
    showPhotos?:       boolean;
    showStories?:      boolean;
    showPosts?:        boolean;
  };
  gameProfile?: { nickname:string; rank:string; game:string; wins:number; };
  nameSticker?: string; nameColor?: string;
  /* ── Полный профиль (просмотр из любой точки платформы) ── */
  customStatus?:   string;    // короткий пользовательский статус
  statusEmoji?:    string;    // эмодзи статуса
  birthDate?:      string;    // дата рождения (ISO), опционально
  links?:          string[];  // внешние ссылки в профиле
  country?:        string;
  language?:       string;
  timezone?:       string;
  equippedFrame?:  string;    // id рамки аватара, см. profile/viewer/cosmetics.ts
  /* ── Musician profile ── */
  isMusician?:    boolean;
  artistName?:    string;
  artistBio?:     string;
  artistBanner?:  string;   // data-url
  artistAvatar?:  string;   // data-url
  artistGenres?:  string[];
  artistFollowers?: string[]; // userIds
  skyId?: string; twoFA?: TwoFA; devices?: Device[]; securityLog?: SecurityEvent[];
}

type Step = 'phone'|'register'|'code'|'authenticated'|'twofa';

interface AuthState {
  step: Step; phoneInput: string; pendingPhone: string;
  pendingUsername: string; pendingName: string;
  isAuthenticated: boolean; currentUserId: string|null; accounts: Account[];
  pending2faUserId: string|null; twoFaError: string|null;
  setPhoneInput:(v:string)=>void;
  setPendingProfile:(p:{username:string;name:string})=>void;
  requestCode:()=>{ok:boolean;reason?:string};
  registerAndRequestCode:()=>{ok:boolean;reason?:string};
  verifyCode:(code:string)=>{ok:boolean;reason?:string};
  login:(username:string,password:string)=>Promise<{ok:boolean;reason?:string}>;
  register:(name:string,username:string,password:string)=>Promise<{ok:boolean;reason?:string}>;
  /** Восстанавливает сессию по HttpOnly-куке. Вызывается при старте приложения. */
  restoreSession:()=>Promise<void>;
  logout:()=>void;
  logoutAll:(userId:string)=>void;
  findUsersByUsername:(q:string)=>Account[];
  findBySkyId:(skyId:string)=>Account|undefined;
  updateProfile:(p:Partial<Pick<Account,'name'|'bio'|'avatar'|'banner'|'privacy'|'gameProfile'|'nameSticker'|'nameColor'|'customStatus'|'statusEmoji'|'birthDate'|'links'|'country'|'language'|'timezone'|'equippedFrame'>>)=>void;
  changePassword:(userId:string,oldPw:string,newPw:string)=>Promise<{ok:boolean;reason?:string}>;
  enable2FA:(userId:string,method:'email'|'sms',secret:string)=>void;
  disable2FA:(userId:string)=>void;
  send2FACode:(userId:string)=>string;
  verify2FA:(userId:string,code:string)=>{ok:boolean;reason?:string};
  terminateDevice:(userId:string,deviceId:string)=>void;
  updateMusicianProfile:(userId:string,p:Partial<Pick<Account,'isMusician'|'artistName'|'artistBio'|'artistBanner'|'artistAvatar'|'artistGenres'>>)=>void;
  followArtist:(followerId:string,artistId:string)=>void;
  unfollowArtist:(followerId:string,artistId:string)=>void;
  grantPrime:(userId:string,days:number)=>void;
  revokePrime:(userId:string)=>void;
  grantPrimeBusiness:(userId:string,days:number)=>void;
  revokePrimeBusiness:(userId:string)=>void;
  setAdmin:(userId:string,value:boolean)=>void;
  banUser:(userId:string,ban:boolean)=>void;
  muteUser:(userId:string,minutes:number)=>void;
  spamBlock:(userId:string,minutes:number)=>void;
  freezeUser:(userId:string,hours:number)=>void;
  setModerationNote:(userId:string,note:string)=>void;
}

import { apiLogin, apiRegister, apiLogout, apiRefresh, apiChangePassword, type ServerUser } from './api';

/* helpers */
export const DEMO_SMS_CODE='0000';
const CODE=DEMO_SMS_CODE; const W=typeof window!=='undefined';
const nm=(v:string)=>v.replace(/[^\d+]/g,'');
const nu=(v:string)=>v.trim().toLowerCase().replace(/^@/,'');
const vp=(v:string)=>/^\+?\d{10,15}$/.test(v);
const vu=(v:string)=>/^[a-z0-9_]{3,24}$/.test(v);
const genSkyId=()=>{const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='SKY-';for(let i=0;i<6;i++)s+=c[Math.floor(Math.random()*c.length)];return s;};
const simpleHash=(s:string)=>{let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(31,h)+s.charCodeAt(i))|0;return Math.abs(h).toString(36);};
const genOtp=()=>String(Math.floor(100000+Math.random()*900000));
const curDev=()=>{
  const ua=W?navigator.userAgent:'Server';
  const pb=(ua:string)=>ua.includes('Edg')?'Edge':ua.includes('Chrome')?'Chrome':ua.includes('Firefox')?'Firefox':ua.includes('Safari')?'Safari':'Browser';
  const po=(ua:string)=>ua.includes('Windows')?'Windows':ua.includes('Mac')?'macOS':ua.includes('Linux')?'Linux':ua.includes('Android')?'Android':ua.includes('iPhone')||ua.includes('iPad')?'iOS':'Unknown';
  return {ua,browser:pb(ua),os:po(ua),ip:'192.168.x.x',city:'Местоположение скрыто'};
};
const addDevice=(acc:Account,isCurrent=true):Account=>{
  const d:Device={id:`dev-${Date.now()}`,...curDev(),loginAt:new Date().toISOString(),lastSeen:new Date().toISOString(),isCurrent};
  return{...acc,devices:[(acc.devices??[]).map(x=>({...x,isCurrent:false})),d].flat().slice(-10)};
};
const addSec=(acc:Account,ev:Omit<SecurityEvent,'id'|'at'>):Account=>{
  const e:SecurityEvent={...ev,id:`ev-${Date.now()}`,at:new Date().toISOString()};
  return{...acc,securityLog:[e,...(acc.securityLog??[])].slice(0,50)};
};
const DP={whoCanWrite:'all' as const,whoSeesOnline:'all' as const,whoCanCall:'all' as const};
const SEED:Account[]=[
  {id:'acc-kutuzov',name:'Kutuzov',phone:'+79000000000',username:'kutuzov',bio:'Sky Admin',createdAt:new Date().toISOString(),privacy:DP,skyId:'SKY-ADMIN1'},
  {id:'acc-luna',name:'Luna Nova',phone:'+79005550101',username:'luna_nova',bio:'Raid support',createdAt:new Date().toISOString(),privacy:DP,skyId:'SKY-LUNA01'},
  {id:'acc-neo',name:'Neo Driver',phone:'+79005550102',username:'neon_driver',bio:'FPS captain ⚡',createdAt:new Date().toISOString(),privacy:DP,skyId:'SKY-NEO001'},
];
const AK='sky:auth:v4:accounts',SK='sky:auth:v4:session',PK='sky:auth:v4:pending';
const rA=():Account[]=>{if(!W)return SEED;try{const p=JSON.parse(localStorage.getItem(AK)||'');if(Array.isArray(p)&&p.length)return p;}catch{}return SEED;};
const wA=(a:Account[])=>{if(W)localStorage.setItem(AK,JSON.stringify(a));};
const rS=():string|null=>{if(!W)return null;try{return JSON.parse(localStorage.getItem(SK)||'').id||null;}catch{return null;}};
const wS=(id:string|null)=>{if(!W)return;id?localStorage.setItem(SK,JSON.stringify({id})):localStorage.removeItem(SK);};
const rP=():string=>{if(!W)return'';try{return JSON.parse(localStorage.getItem(PK)||'').phone||'';}catch{return'';}};
const wP=(p:string)=>{if(!W)return;p?localStorage.setItem(PK,JSON.stringify({phone:p})):localStorage.removeItem(PK);};
const DI=new Set(['acc-kutuzov','acc-luna','acc-neo']);
const initAccounts=():Account[]=>{
  const stored=rA();
  // Локальный список — только для экрана выбора аккаунта. Ни пароля,
  // ни прав он не несёт: и то и другое приходит с сервера при входе.
  const patch=(a:Account):Account=>{
    const s=SEED.find(x=>x.phone===a.phone);
    const base={...a,password:undefined,skyId:a.skyId??genSkyId()};
    if(!DI.has(a.id)||!s)return base;
    return{...base,username:s.username,skyId:a.skyId??s.skyId??genSkyId()};
  };
  const m=stored.map(patch);
  const final=m.find(a=>a.phone==='+79000000000')?m:[SEED[0],...m];
  wA(final);return final;
};
const accs=initAccounts(),sess=rS(),pend=rP();

/**
 * Записывает в стор данные сессии, пришедшие с сервера.
 *
 * Личность и права (isAdmin, isPrime) берутся ТОЛЬКО отсюда: локальная
 * запись аккаунта перезаписывается серверной. Поэтому правка
 * localStorage вручную ничего не даёт — при следующей загрузке
 * значения вернутся к тем, что в базе.
 *
 * Пароль в локальную запись не пишется никогда.
 */
const applyServerSession=(
  set:(p:Partial<AuthState>)=>void,
  get:()=>AuthState,
  user:ServerUser,
)=>{
  const{accounts}=get();
  const existing=accounts.find(a=>a.id===user.id);
  const merged:Account=existing
    ?{...existing,username:user.username,name:user.name,phone:user.phone,
      isAdmin:user.isAdmin,isPrime:user.isPrime,password:undefined}
    :addDevice({id:user.id,phone:user.phone,username:user.username,name:user.name,
      isAdmin:user.isAdmin,isPrime:user.isPrime,createdAt:new Date().toISOString(),
      bio:'',privacy:DP,skyId:genSkyId()} as Account);
  const updated=existing
    ?accounts.map(a=>a.id===user.id?addDevice(merged):a)
    :[...accounts,merged];
  wA(updated);wS(user.id);
  set({accounts:updated,isAuthenticated:true,currentUserId:user.id,step:'authenticated'});
};

export const useAuthStore=create<AuthState>((set,get)=>({
  // Стартуем как невошедшие независимо от того, что лежит в localStorage:
  // факт входа подтверждает только сервер (restoreSession по HttpOnly-куке).
  // Иначе достаточно было бы дописать себе запись сессии в браузере.
  step:pend?'code':'phone',
  phoneInput:pend||'+7',pendingPhone:pend,pendingUsername:'',pendingName:'',
  isAuthenticated:false,currentUserId:null,accounts:accs,
  pending2faUserId:null,twoFaError:null,

  restoreSession:async()=>{
    const res=await apiRefresh();
    if(res.ok&&res.user){applyServerSession(set,get,res.user);return;}
    // Куки нет или сессия отозвана — считаем, что вход не выполнен.
    wS(null);
    set({isAuthenticated:false,currentUserId:null,step:'phone'});
  },

  setPhoneInput:v=>set({phoneInput:v}),
  setPendingProfile:({username,name})=>set({pendingUsername:username,pendingName:name}),

  requestCode:()=>{
    const{phoneInput,accounts}=get();const phone=nm(phoneInput);
    if(!vp(phone))return{ok:false,reason:'Введите корректный номер'};
    const ex=accounts.find(a=>a.phone===phone);
    if(!ex){set({pendingPhone:phone,phoneInput:phone,step:'register'});return{ok:false,reason:'ACCOUNT_NOT_FOUND'};}
    wP(phone);set({pendingPhone:phone,step:'code',phoneInput:phone});return{ok:true};
  },

  registerAndRequestCode:()=>{
    const{phoneInput,pendingUsername,pendingName,accounts}=get();
    const phone=nm(phoneInput),username=nu(pendingUsername),name=pendingName.trim();
    if(!vp(phone))return{ok:false,reason:'Неверный номер'};
    if(name.length<2)return{ok:false,reason:'Имя минимум 2 символа'};
    if(!vu(username))return{ok:false,reason:'Username: 3-24 символа, a-z 0-9 _'};
    if(accounts.some(a=>a.phone===phone))return{ok:false,reason:'Номер уже зарегистрирован'};
    if(accounts.some(a=>a.username===username))return{ok:false,reason:'Username занят'};
    const acc:Account={id:`acc-${crypto.randomUUID()}`,phone,username,name,createdAt:new Date().toISOString(),bio:'',privacy:DP,skyId:genSkyId()};
    const updated=[...accounts,acc];wA(updated);wP(phone);
    set({accounts:updated,pendingPhone:phone,step:'code',phoneInput:phone,pendingUsername:'',pendingName:''});
    return{ok:true};
  },

  verifyCode:code=>{
    const{pendingPhone,accounts}=get();
    if(code.trim()!==CODE)return{ok:false,reason:'Неверный код. Демо: 0000'};
    const acc=accounts.find(a=>a.phone===pendingPhone);
    if(!acc)return{ok:false,reason:'Аккаунт не найден'};
    if(acc.twoFA?.enabled){set({pending2faUserId:acc.id,step:'twofa'});wP('');return{ok:false,reason:'2FA_REQUIRED'};}
    const cd=curDev();
    const updated=accounts.map(a=>a.id===acc.id?addDevice(addSec(a,{type:'login',text:`Вход с ${cd.browser} · ${cd.os}`})):a);
    wP('');wS(acc.id);wA(updated);
    set({isAuthenticated:true,currentUserId:acc.id,step:'authenticated',accounts:updated});
    return{ok:true};
  },

  // Пароль проверяет сервер. Локальный список аккаунтов — только для
  // экрана выбора: решение о входе принимается не здесь.
  login:async(username,password)=>{
    const res=await apiLogin(nu(username),password);
    if(!res.ok||!res.user){
      const{accounts}=get();const u=nu(username);
      const acc=accounts.find(a=>a.username===u);
      if(acc){
        const updated=accounts.map(a=>a.id===acc.id?addSec(a,{type:'login_fail',text:`Неудачная попытка · ${curDev().browser}`}):a);
        wA(updated);set({accounts:updated});
      }
      return{ok:false,reason:res.reason};
    }
    applyServerSession(set,get,res.user);
    return{ok:true};
  },

  register:async(name,username,password)=>{
    const u=nu(username);
    if(!u||name.trim().length<2||!password)return{ok:false,reason:'Заполните все поля'};
    const{phoneInput,pendingPhone}=get();
    const res=await apiRegister({phone:nm(pendingPhone||phoneInput),username:u,name:name.trim(),password});
    if(!res.ok||!res.user)return{ok:false,reason:res.reason};
    applyServerSession(set,get,res.user);
    return{ok:true};
  },

  logout:()=>{
    // Серверную сессию отзываем не дожидаясь ответа: локальный выход
    // не должен зависеть от доступности сети.
    void apiLogout();
    const{currentUserId,accounts}=get();
    const updated=accounts.map(a=>a.id===currentUserId?{...a,devices:(a.devices??[]).map(d=>({...d,isCurrent:false}))}:a);
    wA(updated);wS(null);wP('');
    set({isAuthenticated:false,currentUserId:null,pendingPhone:'',step:'phone',phoneInput:'+7',accounts:updated});
  },

  logoutAll:(userId)=>{
    const updated=get().accounts.map(a=>a.id===userId?addSec({...a,devices:[]},{type:'logout_all',text:'Завершены все сессии'}):a);
    wA(updated);wS(null);wP('');
    set({isAuthenticated:false,currentUserId:null,step:'phone',phoneInput:'+7',accounts:updated});
  },

  findUsersByUsername:q=>{
    const raw=q.trim();if(!raw)return[];
    const s=raw.replace(/^@/,'').toLowerCase();
    return get().accounts.filter(a=>a.username.toLowerCase().includes(s)||a.name.toLowerCase().includes(s)||a.phone.includes(s)).slice(0,15);
  },

  findBySkyId:skyId=>{
    const s=skyId.trim().toUpperCase();
    return get().accounts.find(a=>a.skyId?.toUpperCase()===s);
  },

  updateProfile:payload=>{
    const{currentUserId,accounts}=get();
    const updated=accounts.map(a=>a.id===currentUserId?{...a,...payload}:a);
    wA(updated);set({accounts:updated});
  },

  // Пароль меняет сервер: он же проверяет старый и разлогинивает
  // остальные устройства. В браузере пароль не хранится вообще.
  changePassword:async(userId,oldPw,newPw)=>{
    const res=await apiChangePassword(oldPw,newPw);
    if(!res.ok)return{ok:false,reason:res.reason};
    const{accounts}=get();
    const updated=accounts.map(a=>a.id===userId?addSec(a,{type:'password_change',text:'Пароль изменён'}):a);
    wA(updated);set({accounts:updated});
    return{ok:true};
  },

  enable2FA:(userId,method,secret)=>{
    const updated=get().accounts.map(a=>a.id===userId?addSec({...a,twoFA:{enabled:true,method,secret,failCount:0}},{type:'2fa_enable',text:`2FA включена (${method==='email'?'Email':'SMS'})`}):a);
    wA(updated);set({accounts:updated});
  },

  disable2FA:(userId)=>{
    const updated=get().accounts.map(a=>a.id===userId?addSec({...a,twoFA:{enabled:false,method:'sms',failCount:0}},{type:'2fa_disable',text:'2FA отключена'}):a);
    wA(updated);set({accounts:updated});
  },

  send2FACode:(userId)=>{
    const otp=genOtp();const hash=simpleHash(otp);
    const updated=get().accounts.map(a=>a.id===userId?{...a,twoFA:{...(a.twoFA??{enabled:true,method:'sms' as const,failCount:0}),codeHash:hash,codeAt:new Date().toISOString()}}:a);
    wA(updated);set({accounts:updated});return otp;
  },

  verify2FA:(userId,code)=>{
    const{accounts}=get();const acc=accounts.find(a=>a.id===userId);
    if(!acc?.twoFA)return{ok:false,reason:'2FA не настроена'};
    if(acc.twoFA.lockedUntil&&new Date(acc.twoFA.lockedUntil)>new Date()){
      const secs=Math.ceil((new Date(acc.twoFA.lockedUntil).getTime()-Date.now())/1000);
      return{ok:false,reason:`Слишком много попыток. Подождите ${secs} с.`};
    }
    if(acc.twoFA.codeAt){const age=Date.now()-new Date(acc.twoFA.codeAt).getTime();if(age>5*60*1000)return{ok:false,reason:'Код устарел. Запросите новый.'};}
    const ok=acc.twoFA.secret?code.trim()===acc.twoFA.secret:simpleHash(code.trim())===acc.twoFA.codeHash;
    if(!ok){
      const fail=(acc.twoFA.failCount??0)+1;
      const locked=fail>=5?new Date(Date.now()+30_000).toISOString():undefined;
      const updated=accounts.map(a=>a.id===userId?{...a,twoFA:{...a.twoFA!,failCount:fail,lockedUntil:locked}}:a);
      wA(updated);set({accounts:updated});
      if(locked)return{ok:false,reason:'Слишком много попыток. Заблокировано на 30 с.'};
      return{ok:false,reason:`Неверный код (${5-fail} попыток)`};
    }
    const cd=curDev();
    const updated=accounts.map(a=>a.id===userId?addDevice(addSec({...a,twoFA:{...a.twoFA!,failCount:0,codeHash:undefined,lockedUntil:undefined}},{type:'login',text:`Вход через 2FA · ${cd.browser}`})):a);
    wA(updated);wS(userId);
    set({isAuthenticated:true,currentUserId:userId,step:'authenticated',accounts:updated,pending2faUserId:null,twoFaError:null});
    return{ok:true};
  },

  terminateDevice:(userId,deviceId)=>{
    const updated=get().accounts.map(a=>a.id===userId?{...a,devices:(a.devices??[]).filter(d=>d.id!==deviceId)}:a);
    wA(updated);set({accounts:updated});
  },
  updateMusicianProfile:(userId,p)=>{
    const updated=get().accounts.map(a=>a.id===userId?{...a,...p}:a);
    wA(updated);set({accounts:updated});
  },
  followArtist:(followerId,artistId)=>{
    const updated=get().accounts.map(a=>a.id===artistId?{...a,artistFollowers:[...new Set([...(a.artistFollowers??[]),followerId])]}:a);
    wA(updated);set({accounts:updated});
  },
  unfollowArtist:(followerId,artistId)=>{
    const updated=get().accounts.map(a=>a.id===artistId?{...a,artistFollowers:(a.artistFollowers??[]).filter(f=>f!==followerId)}:a);
    wA(updated);set({accounts:updated});
  },

  grantPrime:(userId,days)=>{const until=new Date(Date.now()+days*86400000).toISOString();const updated=get().accounts.map(a=>a.id===userId?{...a,isPrime:true,primeUntil:until}:a);wA(updated);set({accounts:updated});},
  revokePrime:(userId)=>{const updated=get().accounts.map(a=>a.id===userId?{...a,isPrime:false,primeUntil:undefined}:a);wA(updated);set({accounts:updated});},
  grantPrimeBusiness:(userId,days)=>{const until=new Date(Date.now()+days*86400000).toISOString();const updated=get().accounts.map(a=>a.id===userId?{...a,isPrimeBusiness:true,primeBusinessUntil:until}:a);wA(updated);set({accounts:updated});},
  revokePrimeBusiness:(userId)=>{const updated=get().accounts.map(a=>a.id===userId?{...a,isPrimeBusiness:false,primeBusinessUntil:undefined}:a);wA(updated);set({accounts:updated});},
  setAdmin:(userId,value)=>{const updated=get().accounts.map(a=>a.id===userId?{...a,isAdmin:value}:a);wA(updated);set({accounts:updated});},
  banUser:(userId,ban)=>{const updated=get().accounts.map(a=>a.id===userId?{...a,isBanned:ban}:a);wA(updated);set({accounts:updated});},
  muteUser:(userId,minutes)=>{const until=minutes>0?new Date(Date.now()+minutes*60000).toISOString():undefined;const updated=get().accounts.map(a=>a.id===userId?{...a,isMuted:minutes>0,mutedUntil:until}:a);wA(updated);set({accounts:updated});},
  spamBlock:(userId,minutes)=>{const until=minutes>0?new Date(Date.now()+minutes*60000).toISOString():undefined;const updated=get().accounts.map(a=>a.id===userId?{...a,isSpamBlocked:minutes>0,spamBlockedUntil:until}:a);wA(updated);set({accounts:updated});},
  freezeUser:(userId,hours)=>{const until=hours>0?new Date(Date.now()+hours*3600000).toISOString():undefined;const updated=get().accounts.map(a=>a.id===userId?{...a,isFrozen:hours>0,frozenUntil:until}:a);wA(updated);set({accounts:updated});},
  setModerationNote:(userId,note)=>{const updated=get().accounts.map(a=>a.id===userId?{...a,moderationNote:note}:a);wA(updated);set({accounts:updated});},
}));

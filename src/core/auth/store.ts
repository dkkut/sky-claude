import { create } from 'zustand';
import { flash } from '../../shared/flash';

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
    /* ── Косметика профиля (см. server/privacy.mjs::VISIBILITY_KEYS) ── */
    showBio?:               boolean;
    showBanner?:            boolean;
    showNameCustomization?: boolean;
    showLinks?:             boolean;
    showCustomStatus?:      boolean;
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
  /** Регион уже существующей системы смены региона (src/region), как
      сохранён на сервере — см. server/regions.mjs. */
  regionCode?:     string;
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

/**
 * Шаги входа:
 *   login    — вводим почту (или номер, если выбран запасной путь)
 *   code     — вводим код, который пришёл
 *   twofa    — вводим код второй проверки
 *   profiles — Sky ID открыт, выбираем профиль (или заводим второй)
 *   authenticated — профиль выбран, работаем
 */
export type Step = 'login' | 'code' | 'twofa' | 'profiles' | 'authenticated';

/** Чем входим. Почта — основной путь: письма ничего не стоят.
    'password' — запасной вход почтой и паролем, без кода на каждый
    раз; слабее основного, и экран обязан показать это рядом с ним. */
export type LoginChannel = 'email' | 'phone' | 'password';

export interface CodeInfo { retryAfter: number; expiresIn: number }

interface AuthState {
  step: Step;

  /* ── Sky ID ── */
  sky: SkyIdInfo | null;
  profiles: ServerProfile[];
  activeProfileId: string | null;
  maxProfiles: number;

  /* ── ход входа ── */
  loginChannel: LoginChannel;
  emailInput: string;
  phoneInput: string;
  pendingEmail: string;
  pendingPhone: string;
  challenge: string | null;
  codeInfo: CodeInfo | null;

  /** Чем подтверждать вход: кодом из приложения или письмом. */
  twoFactorMethod: TwoFactorMethod;
  /** Замаскированный адрес или номер, куда ушёл код второго фактора. */
  twoFactorEmail: string | null;
  twoFactorPhone: string | null;

  isAuthenticated: boolean; currentUserId: string|null; accounts: Account[];

  setPhoneInput:(v:string)=>void;
  setEmailInput:(v:string)=>void;
  /** Переключение между входом по почте и по номеру. */
  setLoginChannel:(c:LoginChannel)=>void;

  /** Шаг 1: просим код — на почту или на телефон, смотря чем входим. */
  requestCode:(value?:string)=>Promise<{ok:boolean;reason?:string;error?:string;retryAfter?:number}>;
  /** Шаг 2: проверяем пришедший код. */
  verifyCode:(code:string)=>Promise<{ok:boolean;reason?:string}>;

  /** Вход почтой и паролем, без кода. */
  passwordInput:string;
  setPasswordInput:(v:string)=>void;
  loginWithPassword:()=>Promise<{ok:boolean;reason?:string}>;
  /** Вход, подтверждённый с телефона: сервер прислал готовую сессию. */
  loginWithLinkedSession:(session:any)=>void;
  /** Задать пароль на своём аккаунте: сперва код на почту. */
  startPasswordSetup:()=>Promise<{ok:boolean;reason?:string;email?:string;retryAfter?:number}>;
  finishPasswordSetup:(password:string,code:string)=>Promise<{ok:boolean;reason?:string}>;
  changePassword:(currentPassword:string,newPassword:string)=>Promise<{ok:boolean;reason?:string}>;
  removePassword:()=>Promise<{ok:boolean;reason?:string}>;
  /** Забыли пароль: код на почту, затем новый пароль. */
  forgotPassword:(email:string)=>Promise<{ok:boolean;reason?:string;retryAfter?:number}>;
  resetPassword:(email:string,code:string,password:string)=>Promise<{ok:boolean;reason?:string}>;
  /** Шаг 3: код приложения или из письма, если защита включена. */
  verifySkyTwoFactor:(code:string)=>Promise<{ok:boolean;reason?:string}>;
  /** Прислать код второго фактора на почту ещё раз (экран входа). */
  resendLoginTwoFactor:()=>Promise<{ok:boolean;reason?:string;retryAfter?:number}>;

  /** Открыть профиль. Защищённому нужен код из приложения. */
  selectProfile:(profileId:string,code?:string)=>Promise<{ok:boolean;reason?:string;needsCode?:boolean}>;
  createProfile:(p:{name:string;username:string;acceptLegal?:boolean})=>Promise<{ok:boolean;reason?:string}>;
  /** Вернуться к меню профилей, не выходя из Sky ID. */
  switchProfile:()=>void;
  /** Перечитать состояние входа с сервера. Возвращает, удалось ли. */
  reloadSession:()=>Promise<boolean>;

  /* ── защита ── */
  beginProfileTwoFactor:(profileId:string,method?:TwoFactorMethod)=>Promise<{ok:boolean;method?:TwoFactorMethod;secret?:string;uri?:string;email?:string;reason?:string}>;
  sendProfileTwoFactorCode:(profileId:string)=>Promise<{ok:boolean;reason?:string;retryAfter?:number}>;
  confirmProfileTwoFactor:(profileId:string,code:string)=>Promise<{ok:boolean;reason?:string}>;
  disableProfileTwoFactor:(profileId:string,code:string)=>Promise<{ok:boolean;reason?:string}>;
  beginSkyTwoFactor:(method?:TwoFactorMethod)=>Promise<{ok:boolean;method?:TwoFactorMethod;secret?:string;uri?:string;email?:string;reason?:string}>;
  sendSkyTwoFactorCode:()=>Promise<{ok:boolean;reason?:string;retryAfter?:number}>;
  confirmSkyTwoFactor:(code:string)=>Promise<{ok:boolean;reason?:string}>;
  disableSkyTwoFactor:(code:string)=>Promise<{ok:boolean;reason?:string}>;

  /* ── почта и телефон в настройках ── */
  startEmailLink:(email:string)=>Promise<{ok:boolean;reason?:string;retryAfter?:number}>;
  confirmEmailLink:(email:string,code:string,guard?:ContactGuard)=>Promise<{ok:boolean;reason?:string}>;
  startPhoneLink:(phone:string)=>Promise<{ok:boolean;reason?:string;retryAfter?:number}>;
  confirmPhoneLink:(phone:string,code:string,guard?:ContactGuard)=>Promise<{ok:boolean;reason?:string}>;

  /* ── Prime активного профиля ── */
  purchasePrime:(plan:string,days:number)=>Promise<{ok:boolean;reason?:string}>;
  cancelPrime:()=>Promise<{ok:boolean;reason?:string}>;

  /** Восстанавливает сессию по HttpOnly-куке. Вызывается при старте приложения. */
  restoreSession:()=>Promise<void>;
  /** Полный выход из Sky ID. */
  logout:()=>void;
  logoutAll:(userId?:string)=>void;

  findUsersByUsername:(q:string)=>Account[];
  findBySkyId:(skyId:string)=>Account|undefined;
  updateProfile:(p:Partial<Pick<Account,'name'|'bio'|'avatar'|'banner'|'privacy'|'gameProfile'|'nameSticker'|'nameColor'|'customStatus'|'statusEmoji'|'birthDate'|'links'|'country'|'language'|'timezone'|'equippedFrame'>>)=>void;
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

import {
  apiRequestEmailCode, apiVerifyEmailCode,
  apiRequestPhoneCode, apiVerifyPhoneCode, apiVerifySkyTwoFactor,
  apiPhoneLinkStart, apiPhoneLinkVerify, type ContactGuard,
  apiRefreshSession, apiSession, apiLogout,
  apiListProfiles, apiCreateProfile, apiSelectProfile,
  apiProfileTwoFactorBegin, apiProfileTwoFactorConfirm, apiProfileTwoFactorDisable,
  apiSkyTwoFactorBegin, apiSkyTwoFactorConfirm, apiSkyTwoFactorDisable,
  apiEmailStart, apiEmailVerify, apiGrantPrime, apiRevokePrime,
  apiResendLoginTwoFactor, apiSkyTwoFactorSend, apiProfileTwoFactorSend,
  apiLoginWithPassword, apiStartPasswordSetup, apiFinishPasswordSetup,
  apiChangePassword, apiRemovePassword, apiForgotPassword, apiResetPassword,
  apiUpdateProfile,
  setAccessToken,
  type SkyIdInfo, type ServerProfile, type SkySession, type TwoFactorMethod, type ProfileExtraPatch,
} from './api';

/* helpers */
const W=typeof window!=='undefined';
const nm=(v:string)=>v.replace(/[^\d+]/g,'');
const genSkyId=()=>{const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='SKY-';for(let i=0;i<6;i++)s+=c[Math.floor(Math.random()*c.length)];return s;};
const curDev=()=>{
  const ua=W?navigator.userAgent:'Server';
  const pb=(ua:string)=>ua.includes('Edg')?'Edge':ua.includes('Chrome')?'Chrome':ua.includes('Firefox')?'Firefox':ua.includes('Safari')?'Safari':'Browser';
  const po=(ua:string)=>ua.includes('Windows')?'Windows':ua.includes('Mac')?'macOS':ua.includes('Linux')?'Linux':ua.includes('Android')?'Android':ua.includes('iPhone')||ua.includes('iPad')?'iOS':'Unknown';
  return {ua,browser:pb(ua),os:po(ua),ip:'скрыт',city:'Местоположение скрыто'};
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

/* Локальный справочник людей: имена и ники для поиска, упоминаний и
   подписей к сообщениям. Ни прав, ни признака Prime он не несёт —
   всё это приходит с сервера вместе с профилем. */
const SEED:Account[]=[
  {id:'acc-kutuzov',name:'Kutuzov',phone:'',username:'kutuzov',bio:'Sky Admin',createdAt:new Date().toISOString(),privacy:DP,skyId:'SKY-ADMIN1'},
  {id:'acc-luna',name:'Luna Nova',phone:'',username:'luna_nova',bio:'Raid support',createdAt:new Date().toISOString(),privacy:DP,skyId:'SKY-LUNA01'},
  {id:'acc-neo',name:'Neo Driver',phone:'',username:'neon_driver',bio:'FPS captain ⚡',createdAt:new Date().toISOString(),privacy:DP,skyId:'SKY-NEO001'},
];
const AK='sky:auth:v5:accounts';
const rA=():Account[]=>{if(!W)return SEED;try{const p=JSON.parse(localStorage.getItem(AK)||'');if(Array.isArray(p)&&p.length)return p;}catch{}return SEED;};
const wA=(a:Account[])=>{if(W){try{localStorage.setItem(AK,JSON.stringify(a));}catch{}}};
const initAccounts=():Account[]=>{
  // Пароли в браузере не хранятся вообще: вход идёт по коду из SMS.
  //
  // Права и Prime стираем при каждом запуске: в справочнике они не
  // источник истины, а лишь отражение ответа сервера. Своим профилям
  // их вернёт applySession, чужим — неоткуда, поэтому дописать себе
  // корону или админку правкой localStorage не выйдет.
  const cleaned=rA().map(a=>({
    ...a,password:undefined,skyId:a.skyId??genSkyId(),
    isAdmin:false,isPrime:false,primeUntil:undefined,
    isPrimeBusiness:false,primeBusinessUntil:undefined,
  }));
  wA(cleaned);return cleaned;
};
const accs=initAccounts();

/**
 * Профиль с сервера → запись локального справочника.
 *
 * Личность и права (isAdmin, isPrime) берутся ТОЛЬКО отсюда: что бы ни
 * лежало в localStorage, при следующей загрузке значения вернутся к тем,
 * что в базе. Поэтому правка браузерного хранилища ничего не даёт.
 */
const toAccount=(p:ServerProfile,phone:string,prev?:Account):Account=>({
  ...(prev??{createdAt:p.createdAt??new Date().toISOString(),bio:'',privacy:DP} as Account),
  id:p.id, skyId:p.skyId, username:p.username, name:p.name,
  phone,
  avatar:p.avatar??prev?.avatar,
  bio:p.bio??prev?.bio??'',
  banner:p.banner??prev?.banner,
  customStatus:p.customStatus??prev?.customStatus,
  statusEmoji:p.statusEmoji??prev?.statusEmoji,
  links:p.links??prev?.links,
  country:p.country??prev?.country,
  language:p.language??prev?.language,
  timezone:p.timezone??prev?.timezone,
  nameSticker:p.nameSticker??prev?.nameSticker,
  nameColor:p.nameColor??prev?.nameColor,
  birthDate:p.birthDate??prev?.birthDate,
  isAdmin:p.isAdmin, isPrime:p.isPrime,
  primeUntil:p.primeExpiresAt??undefined,
  twoFA:{enabled:p.twoFactorEnabled,method:'sms',failCount:0},
  password:undefined,
  regionCode:p.regionCode??prev?.regionCode,
});

/** Кладёт в стор состояние входа, каким его прислал сервер. */
const applySession=(
  set:(p:Partial<AuthState>)=>void,
  get:()=>AuthState,
  session:SkySession,
  markDevice=false,
)=>{
  const {accounts}=get();
  const phone=session.skyId.phone ?? '';
  let updated=[...accounts];
  for(const p of session.profiles){
    const i=updated.findIndex(a=>a.id===p.id);
    const merged=toAccount(p,phone,i>=0?updated[i]:undefined);
    const withDev=markDevice&&p.id===session.activeProfileId?addDevice(merged):merged;
    if(i>=0)updated[i]=withDev; else updated.push(withDev);
  }
  wA(updated);
  set({
    accounts:updated,
    sky:session.skyId,
    profiles:session.profiles,
    activeProfileId:session.activeProfileId,
    maxProfiles:session.maxProfiles??2,
    currentUserId:session.activeProfileId,
    isAuthenticated:Boolean(session.activeProfileId),
    step:session.activeProfileId?'authenticated':'profiles',
    challenge:null,
  });
};

/** Состояние «никто не вошёл». */
const emptyAuth={
  sky:null,profiles:[],activeProfileId:null,
  isAuthenticated:false,currentUserId:null,
  step:'login' as const,
  loginChannel:'email' as LoginChannel,
  emailInput:'',phoneInput:'+7',pendingEmail:'',pendingPhone:'',passwordInput:'',
  challenge:null,codeInfo:null,
  twoFactorMethod:'app' as TwoFactorMethod,twoFactorEmail:null,twoFactorPhone:null,
};

export const useAuthStore=create<AuthState>((set,get)=>({
  // Стартуем как невошедшие независимо от того, что лежит в localStorage:
  // факт входа подтверждает только сервер (restoreSession по HttpOnly-куке).
  ...emptyAuth,
  maxProfiles:2,
  accounts:accs,

  setPhoneInput:v=>set({phoneInput:v}),
  setPasswordInput:v=>set({passwordInput:v}),
  setEmailInput:v=>set({emailInput:v}),
  setLoginChannel:c=>set({loginChannel:c}),

  /* ══ Вход ═════════════════════════════════════════════════ */

  requestCode:async(value)=>{
    const{loginChannel,emailInput,phoneInput}=get();

    if(loginChannel==='email'){
      const email=(value??emailInput).trim().toLowerCase();
      const res=await apiRequestEmailCode(email);
      if(!res.ok){
        const retryAfter=(res.data as any)?.retryAfter;
        // Пауза между письмами — не ошибка ввода: код уже отправлен.
        if(res.error==='too_soon'){
          set({pendingEmail:email,emailInput:email,step:'code'});
          return{ok:true,retryAfter};
        }
        return{ok:false,reason:res.reason,error:res.error,retryAfter};
      }
      set({
        pendingEmail:email,emailInput:email,step:'code',
        codeInfo:{retryAfter:res.data?.retryAfter??60,expiresIn:res.data?.expiresIn??300},
      });
      return{ok:true,retryAfter:res.data?.retryAfter};
    }

    const phone=nm(value??phoneInput);
    const res=await apiRequestPhoneCode(phone);
    if(!res.ok){
      const retryAfter=(res.data as any)?.retryAfter;
      if(res.error==='too_soon'){
        set({pendingPhone:phone,phoneInput:phone,step:'code'});
        return{ok:true,retryAfter};
      }
      return{ok:false,reason:res.reason,error:res.error,retryAfter};
    }
    set({
      pendingPhone:phone,phoneInput:phone,step:'code',
      codeInfo:{retryAfter:res.data?.retryAfter??60,expiresIn:res.data?.expiresIn??300},
    });
    return{ok:true,retryAfter:res.data?.retryAfter};
  },

  verifyCode:async(code)=>{
    const{loginChannel,pendingEmail,pendingPhone}=get();
    const res=loginChannel==='email'
      ? await apiVerifyEmailCode(pendingEmail,code.trim())
      : await apiVerifyPhoneCode(pendingPhone,code.trim());
    if(!res.ok)return{ok:false,reason:res.reason};

    const data=res.data as any;
    // Включена вторая проверка — сессии пока нет.
    if(data?.needsTwoFactor){
      set({
        challenge:data.challenge,step:'twofa',
        twoFactorMethod:data.method ?? 'app',
        twoFactorEmail:data.email ?? null,
        twoFactorPhone:data.phone ?? null,
        codeInfo:data.retryAfter ? {retryAfter:data.retryAfter,expiresIn:300} : null,
      });
      return{ok:true};
    }
    setAccessToken(data.accessToken??null);
    applySession(set,get,data,true);
    return{ok:true};
  },

  loginWithLinkedSession:(session)=>{
    setAccessToken(session?.accessToken??null);
    applySession(set,get,session,true);
  },

  /* ── Вход почтой и паролем: сразу, без промежуточного кода ── */
  loginWithPassword:async()=>{
    const{emailInput,passwordInput}=get();
    const res=await apiLoginWithPassword(emailInput.trim().toLowerCase(),passwordInput);
    if(!res.ok)return{ok:false,reason:res.reason};

    const data=res.data as any;
    if(data?.needsTwoFactor){
      set({
        challenge:data.challenge,step:'twofa',
        twoFactorMethod:data.method ?? 'app',
        twoFactorEmail:data.email ?? null,
        twoFactorPhone:data.phone ?? null,
        codeInfo:data.retryAfter ? {retryAfter:data.retryAfter,expiresIn:300} : null,
      });
      return{ok:true};
    }
    setAccessToken(data.accessToken??null);
    applySession(set,get,data,true);
    // Пароль в сторе входа держать незачем — он уже сделал своё дело.
    set({passwordInput:''});
    return{ok:true};
  },

  startPasswordSetup:async()=>{
    const res=await apiStartPasswordSetup();
    if(!res.ok)return{ok:false,reason:res.reason};
    return{ok:true,email:res.data?.email,retryAfter:res.data?.retryAfter};
  },
  finishPasswordSetup:async(password,code)=>{
    const res=await apiFinishPasswordSetup(password,code.trim());
    return res.ok?{ok:true}:{ok:false,reason:res.reason};
  },
  changePassword:async(currentPassword,newPassword)=>{
    const res=await apiChangePassword(currentPassword,newPassword);
    if(!res.ok)return{ok:false,reason:res.reason};
    // Смена пароля выдаёт новый access-токен для этого же устройства —
    // остальные она гасит на сервере, здесь просто подхватываем свой.
    setAccessToken(res.data?.accessToken??null);
    return{ok:true};
  },
  removePassword:async()=>{
    const res=await apiRemovePassword();
    return res.ok?{ok:true}:{ok:false,reason:res.reason};
  },
  forgotPassword:async(email)=>{
    const res=await apiForgotPassword(email.trim().toLowerCase());
    if(!res.ok)return{ok:false,reason:res.reason,retryAfter:(res.data as any)?.retryAfter};
    return{ok:true,retryAfter:res.data?.retryAfter};
  },
  resetPassword:async(email,code,password)=>{
    const res=await apiResetPassword(email.trim().toLowerCase(),code.trim(),password);
    return res.ok?{ok:true}:{ok:false,reason:res.reason};
  },

  verifySkyTwoFactor:async(code)=>{
    const{challenge}=get();
    if(!challenge)return{ok:false,reason:'Начните вход заново'};
    const res=await apiVerifySkyTwoFactor(challenge,code.trim());
    if(!res.ok)return{ok:false,reason:res.reason};
    setAccessToken((res.data as any)?.accessToken??null);
    applySession(set,get,res.data as any,true);
    return{ok:true};
  },

  resendLoginTwoFactor:async()=>{
    const{challenge}=get();
    if(!challenge)return{ok:false,reason:'Начните вход заново'};
    const res=await apiResendLoginTwoFactor(challenge);
    if(!res.ok)return{ok:false,reason:res.reason,retryAfter:(res.data as any)?.retryAfter};
    set({twoFactorEmail:res.data?.email ?? get().twoFactorEmail});
    return{ok:true,retryAfter:res.data?.retryAfter};
  },

  /* ══ Профили ══════════════════════════════════════════════ */

  selectProfile:async(profileId,code)=>{
    const res=await apiSelectProfile(profileId,code);
    if(!res.ok){
      // Профиль под защитой: нужен код из приложения.
      if(res.error==='profile_code_required'||res.error==='invalid_code'){
        const info=res.data as any;
        if(info?.method)set({twoFactorMethod:info.method});
        return{ok:false,needsCode:true,reason:res.error==='invalid_code'?res.reason:undefined};
      }
      return{ok:false,reason:res.reason};
    }
    if(!await get().reloadSession())
      return{ok:false,reason:'Профиль открыт, но состояние не обновилось. Обновите страницу.'};
    return{ok:true};
  },

  createProfile:async({name,username,acceptLegal})=>{
    const res=await apiCreateProfile({name:name.trim(),username:username.trim().toLowerCase().replace(/^@/,''),
      acceptLegal});
    if(!res.ok)return{ok:false,reason:res.reason};
    // Только что созданный профиль сразу открываем: защиты на нём ещё
    // нет, а лишний экран выбора после создания только мешает.
    const created=res.data?.profile;
    if(created){
      const sel=await apiSelectProfile(created.id);
      if(!sel.ok){await get().reloadSession();return{ok:true};}
    }
    await get().reloadSession();
    return{ok:true};
  },

  // Смена профиля не выходит из Sky ID: возвращаемся к меню, сессия жива.
  switchProfile:()=>set({step:'profiles',isAuthenticated:false}),

  reloadSession:async()=>{
    const res=await apiSession();
    if(res.ok&&res.data){applySession(set,get,res.data);return true;}
    // 401 — сессии больше нет; всё остальное (нет сети, лимит) не повод
    // выкидывать человека: пусть попробует ещё раз.
    if(res.status===401)get().logout();
    return false;
  },

  /* ══ Двухэтапная защита ═══════════════════════════════════ */

  beginProfileTwoFactor:async(profileId,method='app')=>{
    const res=await apiProfileTwoFactorBegin(profileId,method);
    return res.ok
      ?{ok:true,method:res.data?.method,secret:res.data?.secret,uri:res.data?.uri,email:res.data?.email}
      :{ok:false,reason:res.reason};
  },
  sendProfileTwoFactorCode:async(profileId)=>{
    const res=await apiProfileTwoFactorSend(profileId);
    return res.ok?{ok:true,retryAfter:res.data?.retryAfter}
                 :{ok:false,reason:res.reason,retryAfter:(res.data as any)?.retryAfter};
  },
  confirmProfileTwoFactor:async(profileId,code)=>{
    const res=await apiProfileTwoFactorConfirm(profileId,code.trim());
    if(!res.ok)return{ok:false,reason:res.reason};
    await get().reloadSession();
    return{ok:true};
  },
  disableProfileTwoFactor:async(profileId,code)=>{
    const res=await apiProfileTwoFactorDisable(profileId,code.trim());
    if(!res.ok)return{ok:false,reason:res.reason};
    await get().reloadSession();
    return{ok:true};
  },

  beginSkyTwoFactor:async(method='app')=>{
    const res=await apiSkyTwoFactorBegin(method);
    return res.ok
      ?{ok:true,method:res.data?.method,secret:res.data?.secret,uri:res.data?.uri,email:res.data?.email}
      :{ok:false,reason:res.reason};
  },
  sendSkyTwoFactorCode:async()=>{
    const res=await apiSkyTwoFactorSend();
    return res.ok?{ok:true,retryAfter:res.data?.retryAfter}
                 :{ok:false,reason:res.reason,retryAfter:(res.data as any)?.retryAfter};
  },
  confirmSkyTwoFactor:async(code)=>{
    const res=await apiSkyTwoFactorConfirm(code.trim());
    if(!res.ok)return{ok:false,reason:res.reason};
    set({sky:res.data?.skyId??get().sky});
    return{ok:true};
  },
  disableSkyTwoFactor:async(code)=>{
    const res=await apiSkyTwoFactorDisable(code.trim());
    if(!res.ok)return{ok:false,reason:res.reason};
    set({sky:res.data?.skyId??get().sky});
    return{ok:true};
  },

  /* ══ Почта ════════════════════════════════════════════════ */

  startEmailLink:async(email)=>{
    const res=await apiEmailStart(email.trim().toLowerCase());
    return res.ok?{ok:true,retryAfter:res.data?.retryAfter}:{ok:false,reason:res.reason};
  },
  confirmEmailLink:async(email,code,guard)=>{
    const res=await apiEmailVerify(email.trim().toLowerCase(),code.trim(),guard);
    if(!res.ok)return{ok:false,reason:res.reason};
    set({sky:res.data?.skyId??get().sky});
    return{ok:true};
  },

  /* ══ Prime ════════════════════════════════════════════════ */

  // Считает и списывает сервер: цену и срок он берёт из своей таблицы,
  // поэтому подделать сумму в запросе нельзя.
  purchasePrime:async(plan,days)=>{
    const res=await apiGrantPrime(plan,days);
    if(!res.ok)return{ok:false,reason:res.reason};
    await get().reloadSession();
    return{ok:true};
  },
  cancelPrime:async()=>{
    const res=await apiRevokePrime();
    if(!res.ok)return{ok:false,reason:res.reason};
    await get().reloadSession();
    return{ok:true};
  },

  startPhoneLink:async(phone)=>{
    const res=await apiPhoneLinkStart(nm(phone));
    return res.ok?{ok:true,retryAfter:res.data?.retryAfter}
                 :{ok:false,reason:res.reason,retryAfter:(res.data as any)?.retryAfter};
  },
  confirmPhoneLink:async(phone,code,guard)=>{
    const res=await apiPhoneLinkVerify(nm(phone),code.trim(),guard);
    if(!res.ok)return{ok:false,reason:res.reason};
    set({sky:res.data?.skyId ?? get().sky});
    return{ok:true};
  },

  /* ══ Сессия ═══════════════════════════════════════════════ */

  restoreSession:async()=>{
    const res=await apiRefreshSession();
    if(res.ok&&res.data){applySession(set,get,res.data as any);return;}
    // Куки нет или сессия отозвана — считаем, что вход не выполнен.
    set(emptyAuth);
  },

  logout:()=>{
    // Серверную сессию отзываем не дожидаясь ответа: локальный выход
    // не должен зависеть от доступности сети.
    void apiLogout();
    const{currentUserId,accounts}=get();
    const updated=accounts.map(a=>a.id===currentUserId?{...a,devices:(a.devices??[]).map(d=>({...d,isCurrent:false}))}:a);
    wA(updated);
    set({...emptyAuth,accounts:updated});
  },

  logoutAll:()=>{
    const{currentUserId,accounts}=get();
    const updated=accounts.map(a=>a.id===currentUserId?addSec({...a,devices:[]},{type:'logout_all',text:'Завершены все сессии'}):a);
    wA(updated);
    void apiLogout();
    set({...emptyAuth,accounts:updated});
  },

  /* ══ Локальный справочник и модерация ═════════════════════ */

  findUsersByUsername:q=>{
    const raw=q.trim();if(!raw)return[];
    const s=raw.replace(/^@/,'').toLowerCase();
    return get().accounts.filter(a=>a.username.toLowerCase().includes(s)||a.name.toLowerCase().includes(s)).slice(0,15);
  },

  findBySkyId:skyId=>{
    const s=skyId.trim().toUpperCase();
    return get().accounts.find(a=>a.skyId?.toUpperCase()===s);
  },

  updateProfile:payload=>{
    const{currentUserId,accounts}=get();
    const updated=accounts.map(a=>a.id===currentUserId?{...a,...payload}:a);
    wA(updated);set({accounts:updated});

    // Часть полей сервер уже знает (см. server/skyid.mjs updateProfile) —
    // отправляем ему только их. Остальное (gameProfile, equippedFrame)
    // пока живёт только в этом браузере — своего места на сервере у них
    // ещё нет. Ответ сервера — источник правды: перечитываем профиль им,
    // а не тем, что положили оптимистично.
    if (!currentUserId) return;
    const p:Parameters<typeof apiUpdateProfile>[1]={};
    if('name' in payload) p.name=payload.name;
    if('bio' in payload) p.bio=payload.bio;
    if('avatar' in payload) p.avatar=payload.avatar;
    if('banner' in payload) p.banner=payload.banner;
    const extra:ProfileExtraPatch={};
    if('nameSticker' in payload) extra.nameSticker=payload.nameSticker;
    if('nameColor' in payload) extra.nameColor=payload.nameColor;
    if('customStatus' in payload) extra.customStatus=payload.customStatus;
    if('statusEmoji' in payload) extra.statusEmoji=payload.statusEmoji;
    if('links' in payload) extra.links=payload.links;
    if('country' in payload) extra.country=payload.country;
    if('language' in payload) extra.language=payload.language;
    if('timezone' in payload) extra.timezone=payload.timezone;
    if('birthDate' in payload) extra.birthDate=payload.birthDate;
    if(Object.keys(extra).length) p.extra=extra;
    if(Object.keys(p).length===0) return;

    void apiUpdateProfile(currentUserId,p).then(res=>{
      if(!res.ok||!res.data){
        // Сервер отказал (слишком большая картинка, сеть, сессия): не
        // оставляем на экране то, чего на сервере нет, — после обновления
        // страницы оно бы «пропало». Показываем причину и перечитываем профиль.
        flash(res.reason??'Не удалось сохранить профиль');
        void get().reloadSession();
        return;
      }
      const fresh=get().accounts.map(a=>a.id===currentUserId?toAccount(res.data!.profile,a.phone,a):a);
      wA(fresh);set({accounts:fresh});
    });
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

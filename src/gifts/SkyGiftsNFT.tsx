/* ======================================================================
   SKY GIFTS NFT  —  Root shell
====================================================================== */
import { useCallback, useState } from 'react';
import { Home as HomeIcon, ShoppingBag, User, BarChart3, Shield } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { GiftsHome } from './Home';
import { Marketplace } from './Marketplace';
import { GiftDetail } from './GiftDetail';
import { TradePanel } from './Trade';
import { GiftsProfile } from './Profile';
import { Showcase } from './Showcase';
import { SearchPanel } from './SearchPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { CollectionScreen } from './CollectionScreen';
import { StatsScreen } from './StatsScreen';
import { SecurityScreen } from './Security';

type Tab = 'home' | 'market' | 'profile';

export const SkyGiftsNFT = () => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const [tab, setTab] = useState<Tab>('home');
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [openGiftId, setOpenGiftId] = useState<string | null>(null);
  const [trade, setTrade] = useState<{ mode: 'buy'|'sell'|'gift'; giftId: string } | null>(null);
  const [showcaseUserId, setShowcaseUserId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key:'home', label:'Главная', icon:HomeIcon },
    { key:'market', label:'Маркет', icon:ShoppingBag },
    { key:'profile', label:'Профиль', icon:User },
  ];

  const openProfile = (userId: string) => { setProfileUserId(userId); setTab('profile'); };
  const handleOpenSearch = useCallback(() => setSearchOpen(true), []);
  const handleOpenNotifications = useCallback(() => setNotifsOpen(true), []);
  const handleOpenOwnProfile = useCallback(() => { if (account) openProfile(account.id); }, [account]);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 min-h-0">
        {tab==='home' && (
          <GiftsHome
            onOpenGift={setOpenGiftId}
            onOpenCollection={setCollectionId}
            onOpenSearch={handleOpenSearch}
            onOpenNotifications={handleOpenNotifications}
            onOpenProfile={handleOpenOwnProfile}
          />
        )}
        {tab==='market' && <Marketplace onOpenGift={setOpenGiftId}/>}
        {tab==='profile' && account && (
          <GiftsProfile
            userId={profileUserId ?? account.id}
            onOpenGift={setOpenGiftId}
            onOpenShowcase={() => setShowcaseUserId(profileUserId ?? account.id)}
            onBack={profileUserId && profileUserId !== account.id ? () => setProfileUserId(null) : undefined}
          />
        )}
      </div>

      <div className="flex shrink-0" style={{ background: C.l1, borderTop:`1px solid ${C.brd}` }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); if (t.key==='profile') setProfileUserId(null); }}
            className="flex-1 flex flex-col items-center gap-1 py-2.5" style={{ color: tab===t.key ? C.acc : C.t3 }}>
            <t.icon size={18}/>
            <span className="text-[10px] font-semibold">{t.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => setStatsOpen(true)} className="flex-1 flex flex-col items-center gap-1 py-2.5" style={{ color: C.t3 }}>
          <BarChart3 size={18}/><span className="text-[10px] font-semibold">Статистика</span>
        </button>
        <button type="button" onClick={() => setSecurityOpen(true)} className="flex-1 flex flex-col items-center gap-1 py-2.5" style={{ color: C.t3 }}>
          <Shield size={18}/><span className="text-[10px] font-semibold">Защита</span>
        </button>
      </div>

      {openGiftId && (
        <GiftDetail giftId={openGiftId} onClose={() => setOpenGiftId(null)}
          onTrade={(mode, giftId) => { setTrade({ mode, giftId }); }}
          onOpenProfile={(uid) => { setOpenGiftId(null); openProfile(uid); }}/>
      )}
      {trade && <TradePanel mode={trade.mode} giftId={trade.giftId} onClose={() => setTrade(null)}/>}
      {showcaseUserId && <Showcase userId={showcaseUserId} onClose={() => setShowcaseUserId(null)} onOpenGift={(id) => { setShowcaseUserId(null); setOpenGiftId(id); }}/>}
      {collectionId && <CollectionScreen collectionId={collectionId} onClose={() => setCollectionId(null)} onOpenGift={(id) => { setCollectionId(null); setOpenGiftId(id); }}/>}
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} onOpenGift={(id) => { setSearchOpen(false); setOpenGiftId(id); }}/>
      <NotificationsPanel open={notifsOpen} onClose={() => setNotifsOpen(false)} onOpenGift={(id) => { setNotifsOpen(false); setOpenGiftId(id); }}/>
      <StatsScreen open={statsOpen} onClose={() => setStatsOpen(false)}/>
      <SecurityScreen open={securityOpen} onClose={() => setSecurityOpen(false)}/>
    </div>
  );
};

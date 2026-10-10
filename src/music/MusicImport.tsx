/* ===============================================================
   SKY MUSIC IMPORT  —  перенос подборок с других площадок
=============================================================== */
import { Download, Headphones, Music2, Apple, Hexagon, Music4, Cloud } from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

/* -- Площадки ------------------------------------------------- */
export interface MusicPlatform {
  id:      string;
  name:    string;
  Icon:    IconComponent;
  color:   string;
  urlHint: string;
  urlPattern: RegExp;
}

export const MUSIC_PLATFORMS: MusicPlatform[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    Icon: Headphones,
    color: '#1DB954',
    urlHint: 'https://open.spotify.com/playlist/...',
    urlPattern: /spotify\.com\/playlist\//,
  },
  {
    id: 'yandex',
    name: 'Яндекс Музыка',
    Icon: Music2,
    color: '#FFCC00',
    urlHint: 'https://music.yandex.ru/users/.../playlists/...',
    urlPattern: /music\.yandex\.(ru|com)/,
  },
  {
    id: 'apple',
    name: 'Apple Music',
    Icon: Apple,
    color: '#FC3C44',
    urlHint: 'https://music.apple.com/playlist/...',
    urlPattern: /music\.apple\.com/,
  },
  {
    id: 'vk',
    name: 'VK Музыка',
    Icon: Hexagon,
    color: '#0077FF',
    urlHint: 'https://vk.com/music/playlist/...',
    urlPattern: /vk\.com\/(music|audio)/,
  },
  {
    id: 'deezer',
    name: 'Deezer',
    Icon: Music4,
    color: '#EF5466',
    urlHint: 'https://www.deezer.com/playlist/...',
    urlPattern: /deezer\.com\/playlist\//,
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    Icon: Cloud,
    color: '#FF5500',
    urlHint: 'https://soundcloud.com/user/sets/...',
    urlPattern: /soundcloud\.com/,
  },
];

/* === Экран переноса ========================================= */
/**
 * Раньше этот экран делал вид, что переносит: выдумывал десяток треков
 * со случайными названиями и складывал их в коллекцию. Ни одного
 * настоящего файла при этом не появлялось, а в каталоге оказывались
 * записи, которым нечего играть.
 *
 * Так делать нельзя, поэтому выдумывание убрано. Настоящий перенос
 * требует доступа к чужим каталогам и прав на них — пока их нет, экран
 * честно об этом говорит и показывает то, что работает уже сейчас:
 * загрузку своих файлов.
 */
export const MusicImport = () => (
  <div className="flex h-full flex-col items-center justify-center px-8 text-center"
    style={{ background: 'var(--bg)' }}>
    <div className="grid h-16 w-16 place-items-center rounded-3xl"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <Download size={26} style={{ color: '#7d818c' }} />
    </div>
    <p className="mt-5 text-[16px] font-bold" style={{ color: '#fafafb' }}>
      Перенос пока не работает
    </p>
    <p className="mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: '#7d818c' }}>
      Чтобы перенести подборки из другого сервиса, нужен доступ к его каталогу —
      его ещё нет. Показывать вместо этого выдуманные треки мы не будем.
    </p>
    <p className="mt-4 max-w-sm text-[12.5px] leading-relaxed" style={{ color: '#5c626e' }}>
      Свои файлы уже можно загрузить: вкладка «Загрузить» рядом. Они лягут на
      сервер и будут слышны с любого вашего устройства.
    </p>

    <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
      {MUSIC_PLATFORMS.map((pl) => (
        <span key={pl.id}
          className="rounded-xl px-3 py-1.5 text-[11.5px]"
          style={{ background: 'rgba(255,255,255,0.04)', color: '#5c626e' }}>
          <pl.Icon size={12} className="inline-block -mt-0.5 mr-1"/>{pl.name}
        </span>
      ))}
    </div>
  </div>
);

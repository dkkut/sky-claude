import { useState } from 'react';
import { Gamepad2, Heart, Play, Users } from 'lucide-react';
import { C, Stars } from '@/marketplace/ui';
import { bloxImageUrl, CATEGORY_LABEL, STATUS_LABEL, type Game, type Status } from './bloxApi';

export { C };
export { Field, inputStyle, Alert, Empty } from '@/marketplace/ui';

export const glass = {
  background: 'color-mix(in srgb, var(--bg-l2) 70%, transparent)',
  border: '1px solid var(--border)',
  backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
} as const;

export const BloxImage = ({ id, alt = '', className, style }: { id?: string | null; alt?: string; className?: string; style?: React.CSSProperties }) => {
  const [bad, setBad] = useState(false);
  if (!id || bad) {
    return (
      <div className={className} style={{ ...style, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, color-mix(in srgb, var(--purple) 30%, var(--bg-l2)), color-mix(in srgb, var(--accent) 24%, var(--bg-l2)))' }}>
        <Gamepad2 size={26} style={{ color: 'var(--t3)' }} />
      </div>
    );
  }
  return <img src={bloxImageUrl(id)} alt={alt} className={className} style={style} loading="lazy" onError={() => setBad(true)} />;
};

export const StatusBadge = ({ status }: { status?: Status }) => {
  if (!status) return null;
  const tint = status === 'published' || status === 'approved' ? 'var(--green)' : status === 'blocked' ? 'var(--red)' : status === 'pending' ? 'var(--accent)' : status === 'draft' || status === 'archived' ? 'var(--t3)' : 'var(--amber)';
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}>
      {STATUS_LABEL[status]}
    </span>
  );
};

export const fmtN = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
export const fmtDt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const pts = (n: number) => `${n.toLocaleString('ru-RU')} баллов`;

export const GameCard = ({ game, onOpen, onFavorite }: { game: Game; onOpen: () => void; onFavorite?: () => void }) => (
  <div className="relative overflow-hidden rounded-2xl text-left transition-transform hover:-translate-y-0.5" style={glass}>
    <button type="button" onClick={onOpen} className="block w-full text-left">
      <div className="relative">
        <BloxImage id={game.coverId} alt={game.title} className="h-32 w-full object-cover" style={{ display: 'block' }} />
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: 'rgba(0,0,0,.55)' }}>
          <Users size={10} /> {fmtN(game.visitors)}
        </span>
        <span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--accent)' }}><Play size={12} color="#fff" fill="#fff" /></span>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-1 text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{game.title}</p>
        <p className="mt-0.5 truncate text-[10px]" style={{ color: C.t3 }}>{CATEGORY_LABEL[game.category] ?? game.category} · <span translate="no">{game.developerName}</span></p>
        <div className="mt-1 flex items-center gap-1">
          <Stars rating={game.rating} size={10} />
          <span className="text-[9px]" style={{ color: C.t3 }}>{game.ratingCount > 0 ? game.ratingCount : 'нет оценок'}</span>
        </div>
      </div>
    </button>
    {onFavorite && (
      <button type="button" aria-label="В избранное" onClick={onFavorite} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'rgba(0,0,0,.45)' }}>
        <Heart size={13} style={{ color: game.favorite ? C.red : '#fff' }} fill={game.favorite ? C.red : 'none'} />
      </button>
    )}
  </div>
);

export const Spinner = () => <div className="grid place-items-center p-8"><div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} /></div>;

/** Сообщения об ошибках сервера для людей. */
export const ERRORS: Record<string, string> = {
  not_found: 'Не найдено.', not_allowed: 'Недостаточно прав.', own_project: 'Нельзя решать вопросы по собственному проекту.',
  own_target: 'Это ваш собственный объект.', own_game: 'Это ваша игра.', locked: 'Сейчас это изменить нельзя.',
  not_a_developer: 'Сначала зарегистрируйтесь как разработчик.', developer_suspended: 'Ваш аккаунт разработчика приостановлен.',
  wrong_state: 'Состояние уже изменилось — обновите страницу.', not_approved: 'Публиковать можно только после одобрения модератором.',
  connection_failed: 'Проверка соединения не пройдена.', too_many_projects: 'Достигнут лимит проектов.', too_many_servers: 'Достигнут лимит подключённых серверов.',
  too_many_places: 'Достигнут лимит плейсов.', too_many_products: 'Достигнут лимит товаров.', too_many_images: 'Слишком много картинок.',
  too_many_reports: 'Слишком много жалоб за сутки.', too_many_reviews: 'Слишком много отзывов за сутки.', too_many_launches: 'Слишком частые запуски — подождите минуту.',
  already_reported: 'Вы уже жаловались на это — жалоба рассматривается.', already_appealed: 'Апелляция уже подана.', not_appealable: 'Это решение нельзя обжаловать.',
  play_first: 'Сначала запустите игру.', play_longer: 'Поиграйте немного дольше, чтобы оставить отзыв.', cooldown: 'Слишком частые проверки — подождите немного.',
  busy: 'Сервер сейчас сильно загружен — повторите позже.', insufficient_points: 'Недостаточно Prime Points.', price_changed: 'Цена изменилась — обновите и подтвердите заново.',
  already_owned: 'Этот предмет у вас уже есть.', already_paid: 'Покупка уже оплачена.', expired: 'Срок запроса истёк.', shop_unavailable: 'Покупки в этой игре сейчас недоступны.',
  game_unavailable: 'Игра сейчас недоступна.', payouts_disabled: 'Приём заявок на выплату сейчас выключен администрацией.', insufficient_available: 'Сумма больше доступной к выплате.',
  below_minimum: 'Сумма меньше минимальной заявки.', terms_required: 'Нужно принять условия.', reason_required: 'Укажите причину.', step_up_required: 'Нужно подтвердить личность кодом.',
  step_up_invalid: 'Неверный код подтверждения.', too_many_requests: 'Слишком часто. Подождите минуту.', bad_url: 'Адрес не принят.', rate_limited: 'Слишком часто.',
  not_ready: 'Проект не готов к отправке.', bad_name: 'Укажите имя (от 2 символов).', bad_title: 'Название — от 2 символов.', bad_sku: 'SKU: строчные латинские буквы, цифры, «_» и «-».',
  bad_price: 'Цена — целое число от 1.', sku_taken: 'Такой SKU уже есть.', too_large: 'Файл слишком большой.', unsupported_image: 'Поддерживаются JPEG, PNG и WebP.',
  different_moderator_required: 'Апелляцию должен рассмотреть другой модератор.', insufficient_earnings: 'Подтверждённых начислений недостаточно.',
  paid_ref_required: 'Укажите идентификатор платёжной операции.', would_go_negative: 'Корректировка увела бы доступную сумму в минус.', own_payout: 'Нельзя обрабатывать собственную заявку.',
};
export const errText = (r: { error?: string; reason?: string; data?: any }) => r.data?.message ?? ERRORS[r.error ?? ''] ?? r.reason ?? 'Не получилось. Попробуйте ещё раз.';

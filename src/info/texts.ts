/**
 * Тексты документов одним модулем.
 *
 * Документы лежат в docs/ единственным экземпляром — копий в src нет
 * намеренно. Этот файл только собирает их вместе, и вот зачем: имена
 * файлов кириллические, а имя собранного куска берётся от имени
 * модуля. Кириллица в адресе статики работает не везде одинаково, и
 * проверять это на живом сервере — плохая идея. Здесь имя латинское, а
 * загружается всё одним куском и только когда человек открыл
 * «Информацию».
 */
import rules      from '../../docs/ПРАВИЛА.md?raw';
import sellers    from '../../docs/ПРАВИЛА_ПРОДАВЦОВ.md?raw';
import offer      from '../../docs/ОФЕРТА.md?raw';
import prices     from '../../docs/УСЛУГИ_И_СТОИМОСТЬ.md?raw';
import consent    from '../../docs/СОГЛАСИЕ_НА_ОБРАБОТКУ_ПД.md?raw';
import privacy    from '../../docs/ПОЛИТИКА_КОНФИДЕНЦИАЛЬНОСТИ.md?raw';
import contacts   from '../../docs/КОНТАКТЫ.md?raw';

export const DOC_TEXTS = {
  rules, sellers, offer, prices, consent, privacy, contacts,
} as const;

export type DocKey = keyof typeof DOC_TEXTS;

# Sky OS — концепция и итог первой пачки (ноябрь-2026)

## Единый визуальный язык
Тёмный космос, фиолетовый акцент (`#8b5cf6`, `#a78bfa`), Liquid Glass (полупрозрачные панели с размытием, тонкая светлая кромка, большие скругления 22–32 px),
спокойные дрейфующие пятна света на фоне, облачко Sky как «лицо» состояний. Анимации — только transform/opacity, выключаются при «Анимации выкл» и `prefers-reduced-motion`.
Общие кирпичи: `.glass-pill/.glass-lens/.glass-btn` (styles.css), `.spp-*` (фон и диск плеера), `SkyCloud` (`src/os/SkyCloud.tsx`).

## Что где лежит
| Система | Файлы |
|---|---|
| Sky Music: Коллекция | `src/extras/SkyMusicLibrary.tsx`, `GET /api/music/top-artists` |
| Sky Music: ПК-плеер (3 режима) | `src/music/PcPlayer.tsx`, `lyrics_mode` (миграция 237), задание `trackqa` (`server/aichat.mjs`) |
| Sky TV (главная, плеер) | `src/interface/tv/TVHome.tsx`, `TVHero.tsx`, `TVCard.tsx`, `TVPlayer.tsx` |
| Экран блокировки | `src/os/LockScreen.tsx`, `lockStore.ts`, `LockSettings.tsx`; встроен в `AppLockGate` |
| Sky Island (Windows) | `electron/island.cjs`, `src/interface/island/`, `src/os/IslandBridge.tsx`, `IslandSettings.tsx` |
| Виджеты и Sky Cloud | `src/os/widgets/`, `src/os/SkyCloud.tsx` |

## Различия по платформам
- **Веб / Android:** Коллекция, плеер, ТВ-оболочка, экран блокировки (внутри приложения), виджеты, облачко. Капсулы поверх экрана нет (браузер и Android так не умеют без нативного оверлея); остаётся прежний Sky Island внутри окна.
- **Windows (Electron):** всё выше + капсула Sky Island отдельным окном, таймер «5 минут после сворачивания», окно экрана блокировки на весь экран поверх остальных (`lock:set`), сведения о системе (CPU/RAM/GPU при nvidia-smi, Wi-Fi, процессы).
- **iOS:** настоящий экран блокировки заменить нельзя; нужны виджеты и Live Activities (Xcode) — не сделано.
- Экран блокировки Sky — НЕ системная блокировка: пароль Windows/Android/iOS он не заменяет (так и написано на экране и в настройках).

## Не сделано / ждёт решения
- Режим «Микс» плеера (трек, текст, бит, переход) — в референсе, но неясно назначение.
- Мобильные варианты нового плеера (референсы MainM/LyricsM/AiM есть) — пока старый `SkyFullPlayer`.
- Кнопка «Поделиться» плеера: нет ссылок на трек.
- «Рабочие пространства» острова: у Windows нет API виртуальных столов.
- Android: показ экрана блокировки поверх системного (нужен нативный плагин), Live Activities iOS.
- Проверено только в браузере (Playwright) и сборками `tsc`, `vite build` (web и native); Electron, Android и ТВ на настоящих устройствах не запускались.

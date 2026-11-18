# AGENTS.md — ИИ-администратор для учебных центров

Этот файл описывает проект для ИИ-агентов (Codex, Claude Code, Cursor и других) и для людей, которые подключаются к работе. Прочитайте его целиком до того, как менять код.

## 1. Что это за продукт

Это SaaS для учебных центров Казахстана (старт — Астана): курсы английского, IELTS/SAT, ЕНТ, детские центры.

- **Чат для родителей.** Работает 24/7 на сайте центра (виджет) или по прямой ссылке — из Instagram, рекламы, QR-кода. Отвечает на вопросы о курсах и ценах строго по данным центра. Записывает на бесплатный пробный урок в свободный слот. Сложные вопросы (скидки, жалобы) передаёт администратору и просит телефон для обратного звонка.
- **Кабинет центра.** Все заявки со статусами и комментариями, воронка «заявка → пробный → пришёл → купил», счётчик заявок вне рабочего времени (главный аргумент продажи), ближайшие пробные уроки, вопросы без ответа, настройки (курсы, цены, расписание пробных, FAQ), выгрузка CSV для Excel.
- **WhatsApp.** Тот же администратор отвечает клиентам в WhatsApp центра (WhatsApp Cloud API от Meta): меню кнопками, курсы и цены, запись на пробный списками, свободные вопросы через ИИ, передача вопроса администратору. Напоминания клиенту за 24 и за 2 часа до урока с кнопками «Приду / Перенести / Отменить».
- **Уведомления администратору в Telegram.** Один бот сервиса (@ai_administrator_kz_bot). Центр подключает свой чат кнопкой в кабинете. Каждая заявка приходит сразу с кнопками статусов, вопросы без ответа — тоже, каждое утро в 9:00 — сводка, команда /today — пробные на сегодня и завтра.
- **Приложение кабинета (PWA) с push-уведомлениями.** Кабинет ставится на главный экран телефона или компьютера, открывается как приложение, работает без интернета на уровне оболочки. На каждом устройстве администратор сам включает уведомления и выбирает события: заявки, вопросы без ответа, утренняя сводка. На iPhone — только в установленном приложении, iOS 16.4+.
- **QR-код и плакат.** В кабинете QR на чат и готовый плакат А4 для ресепшена.
- **Админка сервиса.** Владелец сервиса заводит центры, сбрасывает пароли, подключает WhatsApp центра и вебхук Telegram.
- **Сайт сервиса и демо.** Лендинг для продажи владельцам центров. Демо-сайт вымышленной школы Bright English (код `brightway`) с виджетом, в её фирменном стиле.

Бизнес-модель: «Запись 24/7» стоит 100 000 ₸ за запуск и 30 000 ₸ в месяц, «Набор под ключ» — 180 000 ₸ и 50 000 ₸ в месяц. Входной продукт — бесплатный разбор: отчёт по рекламе конкурентов и проверка скорости ответа центра. Контакт владельца сервиса — WhatsApp +7 903 327 44 96, он прописан в кнопках лендинга.

## 2. Где что живёт

| Что | Где |
| --- | --- |
| Живой сайт | https://ai-admin-astana.netlify.app |
| Хостинг | Netlify, проект `ai-admin-astana` (site id `fefbdfbf-3e20-477e-90f1-febb11524e36`), команда `amietkhan`, тариф Free (кредитный) |
| Код | GitHub `Amethan2/ai-admin`, ветка `main` |
| Деплой | Каждый push в `main` автоматически собирается и публикуется на Netlify |
| Демо-кабинет | `/cabinet/?demo=1`, код `brightway`, пароль `demo2026` (публичные демо-данные) |
| Админка | `/admin/`, ключ в переменной окружения `SUPERADMIN_KEY` в Netlify (значение в репозитории не хранится) |

**Бюджет Netlify — важно.** На тарифе Free 300 кредитов в месяц. Каждый production-деплой стоит 15 кредитов, ИИ-ответ — около 0,07, трафик — копейки. Когда кредиты кончаются, сайт целиком встаёт на паузу до следующего месяца.

- Объединяйте правки в один push.
- Если меняете только документацию, добавьте в сообщение коммита `[skip netlify]` — деплой не запустится.
- Не делайте пробных деплоев ради проверки. Проверяйте локально (раздел 9).

## 3. Стек и архитектура

- **Фронтенд.** Обычные HTML, CSS и JS в `public/`, без сборки и фреймворков. Шрифты с Google Fonts: Montserrat 800 для заголовков, Manrope для текста. Интерфейс на русском.
- **Единый стиль** (лендинг, кабинет, админка, политика, плакат, демо-школа): пастельный фон с плавающими пятнами, тёмно-синие заголовки, жёлтый маркер `.mark`, коралловые кнопки, белые карточки с мягкой тенью, анимации появления. Основа — `public/assets/base.css` (токены, кнопки, поля, `.blobs`, `.reveal`, общие keyframes). Все анимации отключаются при `prefers-reduced-motion`. Маскот — робот в синей толстовке (`assets/robot.webp`, `robot-700.webp`).
- **Бэкенд.** Netlify Functions (`netlify/functions/*.mts`, TypeScript, ES-модули, Node 22). Пять HTTP-функций с маршрутизацией через `config.path` и две плановые (`config.schedule`, время в UTC).
- **Telegram.** Bot API напрямую через `fetch`, вебхук с секретом в заголовке `X-Telegram-Bot-Api-Secret-Token`.
- **Push.** Web Push (VAPID). Пакет `web-push` только шифрует и подписывает, запрос уходит обычным `fetch`.
- **WhatsApp.** Meta WhatsApp Cloud API (Graph `v23.0`) напрямую через `fetch`. Подпись входящих запросов `X-Hub-Signature-256` проверяется секретом приложения Meta.
- **Хранилище.** Netlify Blobs (`@netlify/blobs`), сторы открываются с `consistency: "strong"`.
- **ИИ.** `@anthropic-ai/sdk` через Netlify AI Gateway: шлюз сам подставляет `ANTHROPIC_API_KEY` и `ANTHROPIC_BASE_URL`, а расход списывается кредитами Netlify. Модель по умолчанию — `claude-haiku-5-5`. Если она недоступна, пробуется `claude-sonnet-5-5`. Если ИИ не отвечает совсем, срабатывает запасной режим: правила и поиск по FAQ. Свой ключ Anthropic в env имеет приоритет над шлюзом.

```
Родитель ──> /chat/?c=<центр>  (полноэкранная страница чата: ссылка в Instagram, QR-код)
Родитель ──> сайт центра + /widget.js → тот же чат прямо на странице (shadow DOM, без iframe), API через CORS
               │  GET  /api/public/:center   данные центра + свободные слоты
               │  POST /api/chat             ИИ-ответ  ──> AI Gateway ──> Claude
               │  POST /api/book             заявка (пробный / перезвонить)
               ▼
         Netlify Blobs: centers · leads · slot-index · questions · system
               ▲
Центр  ──> /cabinet/   POST /api/login → токен; /api/cabinet/* (Bearer)
Сервис ──> /admin/     /api/admin/*  (заголовок X-Admin-Key)

Клиент в WhatsApp ──> Meta ──> POST /api/whatsapp/webhook ──> тот же createLead / chatAnswer
                                ответы: Graph API /{phone_number_id}/messages
Новая заявка / вопрос без ответа ──> lib/notify.mts ──> Telegram-бот (чаты администраторов)
                                                    └──> Web Push ──> sw.js в приложении кабинета ──> уведомление
Кнопка статуса в Telegram ──> POST /api/telegram/webhook ──> applyStatus
Cron: digest (09:00 Астаны) — сводка в Telegram; reminders (каждые 30 мин) — напоминания в WhatsApp
```

## 4. Карта файлов

```
netlify.toml                    сборка (publish=public, без build-команды), заголовки безопасности
package.json                    зависимости: @anthropic-ai/sdk, @netlify/blobs
netlify/functions/public.mts    /api/public/:center, /api/chat, /api/book, /api/login (+ rateLimit 60/мин на IP)
netlify/functions/cabinet.mts   /api/cabinet/*  — заявки, вопросы, настройки, экспорт CSV
netlify/functions/admin.mts     /api/admin/*    — центры, пароли, настройки WhatsApp центра, вебхук Telegram
netlify/functions/telegram.mts  /api/telegram/webhook — /start <код>, /stop, /today, кнопки статусов
netlify/functions/whatsapp.mts  /api/whatsapp/webhook — проверка Meta (GET) и входящие сообщения (POST)
netlify/functions/digest.mts    плановая, 0 4 * * * UTC = 09:00 Астаны: утренняя сводка + самопроверка вебхука
netlify/functions/reminders.mts плановая, каждые 30 мин: напоминания о пробном в WhatsApp
netlify/lib/core.mts            сторы Blobs, типы, пароли (PBKDF2), токены (HMAC), слоты, время, createLead/applyStatus/moveLead
netlify/lib/ai.mts              промпт, вызов Claude, разбор меток [ADMIN]/[BOOK], FAQ-фолбэк
netlify/lib/telegram.mts        Bot API, привязка чатов по коду, тексты и кнопки заявок, сводки, setWebhook
netlify/lib/notify.mts          единая точка уведомлений: Telegram + push (ошибка одного канала не мешает другому)
netlify/lib/push.mts            подписки push-subs, VAPID, отправка, тексты уведомлений; 404/410 от push-сервиса — удалить подписку
netlify/lib/whatsapp.mts        Graph API (текст, кнопки, списки, шаблоны), подпись, диалог записи по шагам
netlify/lib/seed.mts            тип Settings и Brand (оформление), данные демо-центра Bright English, шаблон нового центра
public/index.html               лендинг сервиса (стили внутри файла): робот на первом экране, переписка в телефоне проигрывается по кругу, цифры в примере кабинета «набегают»
public/demo/index.html          демо-сайт школы с виджетом
public/chat/app.js              чат одним модулем: AiAdminChat.mount(container, {center, origin, embed, source, start, onClose, onLead})
public/chat/app.css             стили чата, всё внутри .aa (работает и в shadow DOM)
public/chat/index.html          полноэкранный чат по ссылке; ?embed=1 — старый режим во фрейме (postMessage ai-admin:close / ai-admin:lead)
public/widget.js                виджет для сайта центра: кнопка, приветствие, окно с чатом в shadow DOM; window.AIAdmin.open("booking"|"courses")
public/assets/bright-english-mark.svg  логотип демо-школы (коралловое облачко с лучами); bright-english-logo.svg — прежний, не используется
public/demo/{index.html,demo.css,student.webp}  демо-сайт школы: пастельный фон, коралловые кнопки, анимации (появление при прокрутке, плавающие пятна, наклон фото за курсором); уважает prefers-reduced-motion. Фото сгенерировано
public/cabinet/{index.html,cabinet.js,cabinet.css}   кабинет центра: на компьютере меню слева карточкой, на телефоне — вкладки-пилюли сверху; при открытии раздела `animateView()` ставит класс `.enter` (карточки появляются по очереди, растут полоски воронки, считаются цифры)
public/cabinet/manifest.webmanifest  манифест приложения (scope /cabinet/)
public/cabinet/sw.js            service worker: офлайн-оболочка, push → уведомление и значок, клик → открыть кабинет
public/cabinet/icons/           иконки приложения (any, maskable, apple-touch, монохромный badge)
public/cabinet/poster/index.html  плакат А4 с QR-кодом (?c=<центр>)
public/admin/index.html         админка сервиса (JS внутри файла)
public/privacy/index.html       политика обработки персональных данных (ссылка из чата и WhatsApp)
public/assets/nl-badge.js       пока на странице виден значок «Powered by Netlify» (бесплатный план), ставит <html class="nl-badge">, стили освобождают ему место (поле ввода чата, «Сохранить» в кабинете). widget.js делает то же сам (класс aiadm-nl). После перехода на платный план и выключения значка всё возвращается само
public/assets/qrcode.js         qrcode-generator 1.4.4 (MIT), генерация QR в браузере
public/assets/base.css          общая основа стиля: токены цветов, фон, кнопки, поля, [hidden], общие анимации
public/assets/logo-mark.svg      знак сервиса: коралловый квадрат с академической шапочкой (из него же собраны иконки приложения в cabinet/icons/)
scripts/local-dev.mjs           локальный запуск без Netlify CLI (см. раздел 9)
scripts/test-e2e.mjs            сквозной тест с поддельными Telegram, Meta и push-сервисом (push реально расшифровывается): npm test
scripts/test-sw.cjs             обработчики push/notificationclick из sw.js в подставном окружении
```

## 5. API

Все ответы — JSON, кроме экспорта. Ошибка возвращается как `{ "error": "текст для пользователя на русском" }` с HTTP-кодом.

| Метод и путь | Доступ | Тело запроса → ответ |
| --- | --- | --- |
| `GET /api/public/:center` | публично | → `{slug, name, brand:{color, header, pattern, logo}, faq:[{q,a}], city, address, hours, phone, trial, studentTypes, courses, slots:[{iso,label}]}`. Если центра нет — 404 |
| `POST /api/chat` | публично | `{center, history:[{role,content}], session}` → `{answer, escalate, book}`. Каждый вопрос пишется в `questions` |
| `POST /api/book` | публично | `{center, type:"trial"\|"callback", student, course, slot\|null, wish, name, phone, question, consent:true, source}` → `{ok, id, slotLabel, address}`. Без `consent:true` — 400. Слот занят — 409 |
| `POST /api/login` | публично | `{center, password}` → `{token, center, name}`. Ошибка — 401 с задержкой 600 мс |
| `GET /api/cabinet/me` | Bearer | → `{slug, settings, statuses, integrations:{telegram, whatsapp, push}, token?}`. Если до конца входа меньше 20 дней — приходит новый `token` (вход продлевается сам) |
| `POST /api/cabinet/telegram` | Bearer | → `{url}` — ссылка `t.me/<бот>?start=<код>`, код живёт 30 минут и одноразовый. Бот не настроен — 503 |
| `GET /api/cabinet/telegram` | Bearer | → `integrations` (кабинет опрашивает после нажатия «Подключить») |
| `DELETE /api/cabinet/telegram/:chatId` | Bearer | → `integrations` без этого чата |
| `GET /api/cabinet/push` | Bearer | → `{configured, publicKey, devices:[{id, device, events, createdAt}]}` |
| `POST /api/cabinet/push` | Bearer | `{subscription, device, events}` → `{id, devices}`. Адрес подписки — только push-сервисы браузеров (FCM, Mozilla, Apple, Windows), до 20 устройств |
| `PATCH /api/cabinet/push/:id` | Bearer | `{events:{leads, questions, digest}}` → `{devices}` |
| `DELETE /api/cabinet/push/:id` | Bearer | → `{devices}` |
| `POST /api/cabinet/logo` | Bearer | `{data: "data:image/png;base64,…"}` (png/jpeg/webp, до 400 КБ) → `{brand, logoUrl}` |
| `DELETE /api/cabinet/logo` | Bearer | → `{brand, logoUrl: ""}` |
| `GET /api/public/:center/logo` | — | картинка логотипа, кэш сутки (адрес с `?v=<версия>`) |
| `POST /api/cabinet/push/:id/test` | Bearer | проверочное уведомление на это устройство |
| `DELETE /api/cabinet/leads/:id` | Bearer | удалить заявку по просьбе клиента, слот освобождается → `{ok}` |
| `DELETE /api/cabinet/questions/:id` | Bearer | → `{ok}` |
| `GET /api/cabinet/leads` | Bearer | → `{leads:[Lead]}`, новые сверху |
| `PATCH /api/cabinet/leads/:id` | Bearer | `{status?, comment?}` → `{lead}` |
| `GET /api/cabinet/questions` | Bearer | → `{questions:[Question]}`, последние 200 |
| `PATCH /api/cabinet/questions/:id` | Bearer | `{resolved}` → `{question}` |
| `PUT /api/cabinet/settings` | Bearer | `{settings, newPassword?}` → `{settings}`. Настройки проходят санитизацию на сервере |
| `GET /api/cabinet/export` | Bearer | → CSV (UTF-8 с BOM, разделитель `;`, открывается в Excel) |
| `GET /api/admin/centers` | `X-Admin-Key` | → `{centers:[{slug,name,createdAt,leads}]}` |
| `POST /api/admin/centers` | `X-Admin-Key` | `{slug, name, password}` → `{ok, slug}`. Код уже занят — 409 |
| `POST /api/admin/centers/:slug/password` | `X-Admin-Key` | `{password}` → `{ok}` |
| `GET /api/admin/config` | `X-Admin-Key` | → адрес вебхука WhatsApp, verify token, состояние бота и вебхука Telegram |
| `POST /api/admin/telegram/setup` | `X-Admin-Key` | поставить вебхук Telegram и команды бота |
| `GET /api/admin/centers/:slug` | `X-Admin-Key` | → настройки WhatsApp (секреты замаскированы) и чаты Telegram |
| `POST /api/admin/centers/:slug/whatsapp` | `X-Admin-Key` | `{enabled, phoneNumberId, displayPhone, accessToken?, appSecret?, reminderTemplate?, templateLang?, clearToken?, clearSecret?}` — форма шлёт все поля, пустой токен/секрет оставляет прежний. Номер у другого центра — 409 |
| `POST /api/admin/centers/:slug/whatsapp/test` | `X-Admin-Key` | `{to}` — отправить шаблон `hello_world` |
| `GET/POST /api/whatsapp/webhook` | Meta | GET: `hub.verify_token` = env `WA_VERIFY_TOKEN` → `hub.challenge`. POST: всегда 200, обработка после ответа |
| `POST /api/telegram/webhook` | Telegram | заголовок секрета = env `TELEGRAM_WEBHOOK_SECRET`, иначе 403 |

## 6. Данные (Netlify Blobs)

| Стор | Ключ | Значение |
| --- | --- | --- |
| `centers` | `<slug>` | `Center { slug, createdAt, passwordHash, settings: Settings }` |
| `leads` | `<slug>/<leadId>` | `Lead` |
| `slot-index` | `<slug>/<slotIso>/<leadId>` | `"1"` — одно занятое место на пробном уроке |
| `questions` | `<slug>/<questionId>` | `Question { id, createdAt, text, answer, escalated, resolved, session? }` |
| `system` | `session-secret`, `tg-bot` | Секрет токенов (если нет env `SESSION_SECRET`); кэш имени бота |
| `logos` | `<slug>` | картинка логотипа, `metadata: {type, v}` |
| `push-subs` | `<slug>/<id>` | `PushSub {id, endpoint, keys, device, events, createdAt, lastOkAt?}`; id — первые 16 символов sha256(endpoint) в base64url, его же считает кабинет, чтобы узнать «это устройство» |
| `tg-chats` | `<chatId>` | slug центра, к которому привязан чат Telegram (один чат — один центр) |
| `tg-links` | `<код>` | `{center, exp}` — одноразовый код привязки, 30 минут |
| `wa-numbers` | `<phone_number_id>` | slug центра — по нему вебхук находит центр |
| `wa-seen` | `<wamid>` | `"1"` — Meta повторяет доставку, повтор отбрасывается через `onlyIfNew` |
| `wa-sessions` | `<slug>/<waId>` | `WaSession {step, draft, history, slots?, lastQuestion?, profileName?, lastUserAt}` — шаг диалога и время последнего сообщения клиента (окно 24 ч) |

- `Center` дополнительно: `telegram?: {chats:[{id, name, linkedAt}]}`, `whatsapp?: {enabled, phoneNumberId, displayPhone, accessToken?, appSecret?, reminderTemplate?, templateLang?}`.
- `Settings`: `name, city, address, hours, phone, utcOffset (Астана = 5), trial{durationMin, price, capacityPerSlot, whatHappens}, slots{mon..sun: ["16:00",…]}, studentTypes[], courses[{name, for, format, price}], faq[{q, a}]`.
- `Lead`: `id, center, type ("trial"|"callback"), createdAt (UTC ISO), source, student?, course?, slot? (ISO с offset, например "2026-11-05T16:00+05:00"), wish?, question?, name, phone (нормализован "+7 701 123 45 67"), status, comment?, consentAt, history[{at, status}], channel? ("web"|"whatsapp"), waId?, reminded24?, reminded2?`.
- `Question` дополнительно: `via ("ai"|"faq"), model?, channel?`.
- Статусы: `новая, записан, подтвердил, пришёл, купил, не пришёл, отказ`.
- Id сортируются по времени: время в base36 (9 символов) плюс 6 hex.
- Демо-центр `brightway` создаётся автоматически при первом обращении (`getCenter`). Пароль берётся из env `DEMO_PASSWORD` или будет `demo2026`.

**Правила слотов**

- Слоты строятся из `settings.slots` на 21 день вперёд, но не раньше чем через 3 часа от текущего момента. Время местное, по `utcOffset`.
- Слот свободен, пока число ключей в `slot-index` для него меньше `capacityPerSlot`.
- Место держат статусы `записан` и `подтвердил`.
- Перевод заявки в `отказ` освобождает место. Возврат в `записан` или `подтвердил` занимает его снова.
- Счётчики через read-modify-write не используются, только ключи-маркеры. Не меняйте это: в Blobs нет транзакций.

## 7. Безопасность и данные

- Пароли центров хешируются через PBKDF2-SHA256, 120 000 итераций, с солью. Токен кабинета — `base64url(payload).HMAC`, живёт 30 дней, хранится в `localStorage` браузера, передаётся как `Authorization: Bearer`.
- Центр видит только свои данные: slug берётся из токена, а не из запроса.
- Админка работает, только если `SUPERADMIN_KEY` не короче 12 символов. Ключ сравнивается через `timingSafeEqual`.
- Без явного согласия клиента (`consent:true`) запись не создаётся. Время согласия сохраняется в `consentAt`, текст согласия показывается в чате перед кнопкой «Подтвердить».
- Весь пользовательский текст на фронте выводится через `textContent` или `esc()`. Никакого `innerHTML` с данными клиента.
- Публичный API (`/api/public/*`, `/api/chat`, `/api/book`) отвечает с `Access-Control-Allow-Origin: *` — виджет работает прямо на сайте центра. `/api/login` — без CORS.
- Логотип: браузер уменьшает картинку до 256×256 и шлёт PNG/WebP data:URL; сервер проверяет сигнатуру файла, SVG не принимает (в SVG бывают скрипты), отдаёт с `nosniff`.
- `/chat/*` разрешено встраивать в iframe (`frame-ancestors *`) — для старых установок виджета. Кабинет и админка запрещены к встраиванию и закрыты от индексации.
- Вебхуки: Telegram проверяется секретом в заголовке, Meta — HMAC-SHA256 тела секретом приложения. Без верной подписи сообщение игнорируется. Чужой чат Telegram не может менять статусы (проверка по `tg-chats`).
- Токен и App secret WhatsApp центра хранятся в `centers` и наружу отдаются только замаскированными.
- **Локализация данных.** Закон РК 94-V (ст. 12, ред. от 25.08.2026) требует хранить персональные данные граждан РК на территории РК. Netlify, Anthropic, Meta и Telegram — за рубежом. В политике (`/privacy/`) и в тексте согласия это раскрыто как трансграничная передача, но с первым крупным клиентом нужна консультация юриста и, вероятно, перенос хранилища в казахстанское облако. Весь доступ к данным идёт через функции в `core.mts` — их и переписывать.
- Секреты не храните в коде и в `netlify.toml`, только в env проекта Netlify. На тарифе Free переменные создаются без ограничения scopes: запрос со scopes возвращает 403.

## 8. Логика чата (`public/chat/app.js`)

- Первый экран: приветствие, карточка «Пробный урок» с ближайшим свободным временем, плитки «Курсы и цены» и «Адрес и график», до 3 частых вопросов (ответ берётся из FAQ сразу, без ИИ). Плюс свободное поле ввода.
- Курсы показываются карточками; нажатие на курс сразу начинает запись на него.
- Запись — до 4 шагов, полоска шагов в шапке: кто учится → курс (или «подскажут на уроке») → день и время (дни кнопками, «сегодня/завтра» по часовому поясу из слота; «Нет подходящего времени» → пожелание текстом) → одна форма «имя + телефон» со сводкой и текстом согласия → «Записаться» → карточка «Вы записаны!» с адресом и ссылкой на 2ГИС. Если ответ сервера 409, слоты перезагружаются и время предлагается выбрать заново.
- Оформление из кабинета (`settings.brand`): цвет центра (кнопки, акценты), шапка светлая или в цвет центра, узор британского флага, логотип. В полноэкранном чате с цветной шапкой первый экран — крупная обложка с логотипом, после первого действия она сжимается.
- Свободный вопрос во время записи отправляется в ИИ, затем появляется кнопка «Продолжить запись».
- ИИ ставит в конце ответа метки `[ADMIN]` (нужен человек → кнопка «Оставить телефон» → заявка `callback`) и `[BOOK]` (предложить запись). Сервер вырезает метки и возвращает флаги `escalate` и `book`.
- После успешной записи имя и телефон запоминаются в рамках сессии, повторно их не спрашивают.
- Параметры URL страницы `/chat/`: `c` — код центра, `src` — источник заявки (`qr`, `ig`, `wa`, `ad` или свой текст; по умолчанию «ссылка на чат»), `embed=1` — старый режим во фрейме.
- Виджет: `<script src="https://ai-admin-astana.netlify.app/widget.js" data-center="код" async></script>`. Необязательные атрибуты: `data-label`, `data-color` (перебивает цвет из кабинета), `data-greeting="off"`. Открыть программно: `AIAdmin.open()`, `AIAdmin.open("booking")`, `AIAdmin.open("courses")`. Событие для аналитики сайта: `window` получает `ai-admin:lead` с `detail = {center, kind}`. Чат подгружается заранее, когда браузер свободен. Источник заявок — «виджет на сайте».

## 8б. Дожим после пробного

- Кого дожимать решает `followUpDue(lead)` в `lib/core.mts` (копия в `cabinet.js`, меняйте вместе): `mark` — пробный прошёл больше 2 ч назад, а статус всё ещё «записан/подтвердил»; `came` — «пришёл», но не купил, через 20 ч после отметки; `noshow` — «не пришёл», через 2 ч. Старше 14 дней не предлагается.
- После дожима в заявке `followUp: {at, by: "auto"|"manual", status}`; повторно при том же статусе не предлагается. Сменился статус (например, перенос → «записан» → снова «пришёл») — цикл начинается заново.
- Кабинет: карточка «Дожать после пробного» на сводке. «Написать в WhatsApp» открывает wa.me с готовым текстом и отмечает `followUp` (PATCH `{followUp: true}`), есть быстрые статусы. Счётчик «После дожима купили: X из Y». В заявке метка «дожали».
- WhatsApp-клиентам бот пишет сам в кроне `reminders`: только если клиент писал за последние 24 ч (без шаблона Meta) и днём — env `FOLLOWUP_HOURS`, по умолчанию `10-20` по времени центра. Кнопки: `fu_buy_<id>` («Хочу в группу» → комментарий в заявке + уведомление администратору), `fu_q`, для «не пришёл» — `rem_move_<id>` (перенос) и `fu_no_<id>` (отказ). Вне окна — остаётся администратору.
- Тексты и автоотправка — `settings.followUp {auto, came, noshow}` (вкладка «Настройки»), подстановки `{имя}`, `{центр}`, `{курс}`; пустой текст = стандартный (`DEFAULT_FOLLOWUP` в `seed.mts`).
- Утренняя сводка (Telegram и push) показывает «Дожать после пробного: N».

## 8а. WhatsApp и Telegram

**Push:** env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, необязательный `VAPID_SUBJECT` (по умолчанию адрес сайта). Сменить ключи = все устройства должны включить уведомления заново. Для тестов `PUSH_ALLOW_HOSTS` разрешает локальный адрес подписки. Service worker обслуживает только `/cabinet/`, данные `/api/*` не кэширует. При изменении списка файлов оболочки поднимите `VERSION` в `sw.js`.

**Переменные окружения Netlify:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (≥16 символов), `WA_VERIFY_TOKEN` (≥12), необязательные `WA_APP_SECRET` и `WA_TOKEN` (общие для всех центров, если у центра не заданы свои), `WA_GRAPH_VERSION`. Для тестов: `TELEGRAM_API_BASE`, `WA_GRAPH_BASE`.

**Подключение WhatsApp центра (делает владелец сервиса):**
1. developers.facebook.com → приложение «Business» → продукт WhatsApp. Номер центра должен быть отдельным: номер, который уже работает в обычном приложении WhatsApp или WhatsApp Business, сначала нужно оттуда удалить.
2. В Business Settings создать системного пользователя, выдать права `whatsapp_business_messaging` и `whatsapp_business_management`, сгенерировать постоянный токен.
3. В админке сервиса у центра: Phone number ID, номер для показа, токен, App secret (Settings → Basic). Галочка «Бот отвечает в WhatsApp».
4. В приложении Meta → WhatsApp → Configuration: Callback URL `https://ai-admin-astana.netlify.app/api/whatsapp/webhook`, Verify token из админки, подписка на поле `messages`.
5. Для напоминаний вне окна 24 ч — шаблон категории Utility с тремя параметрами (время, центр, адрес), его имя — в настройках центра.

**Правила Meta:** свободные сообщения можно слать только в течение 24 часов после последнего сообщения клиента, позже — только одобренные шаблоны. Кнопок в сообщении до 3 (заголовок ≤20 символов), строк в списке до 10 (заголовок ≤24, описание ≤72). С 01.10.2026 сервисные ответы бесплатны до 1000 в месяц на номер, дальше платно; платит владелец аккаунта Meta (центр).

**Диалог WhatsApp** (`lib/whatsapp.mts`): шаги `idle → student → course → slot → (wish) → confirm`, имя берётся из профиля WhatsApp (кнопка «Другое имя» → `name_text`), телефон — из номера. Id ответов: `book/courses/address`, `st_i`, `co_i`/`co_none`, `sl_i`/`sl_none`, `cf_yes/cf_name/cf_no`, `esc_yes/esc_no`, `rem_(ok|move|cancel)_<leadId>`, `menu`. Любое слово «меню»/«start» возвращает в начало.

**Telegram:** один бот на весь сервис. Привязка: кабинет → «Подключить Telegram» → `t.me/<бот>?start=<код>` → `/start <код>`. Для рабочей группы — ссылка `t.me/<бот>?startgroup=<код>` (в группе придёт `/start@<бот> <код>`, это обрабатывается). Если бот заблокирован (403), чат отвязывается автоматически. Вебхук ставится кнопкой в админке или сам при первом запуске сводки.

## 9. Как работать с кодом

- Локально без Netlify CLI: `npm install`, затем `npm run dev:local` (Node 22+), сайт откроется на http://localhost:8888. ИИ локально не работает, чат отвечает по FAQ. Ключ админки задаётся так: `SUPERADMIN_KEY=... npm run dev:local`.
- С Netlify CLI: `npm run dev` (`netlify dev`). Для ИИ-шлюза нужен вход в Netlify и прилинкованный проект.
- `npm test` — сквозной тест без интернета: поднимает локальный сервер и поддельные Telegram и Meta, проходит привязку Telegram, запись с сайта и из WhatsApp, кнопки статусов, подпись Meta, повторы, передачу вопроса, напоминания и шаблон вне окна, сводку, удаление. Запускайте перед каждым push.
- Перед push пройдите руками или тестом: запись на слот, переполнение слота (409), обратный звонок, вход в кабинет, смену статуса, сохранение настроек, экспорт. Проверьте мобильную ширину 390 px без горизонтальной прокрутки.
- Стиль кода: без фреймворков и сборщиков на фронте. Тексты для пользователя на русском, в коде — английские идентификаторы. Цвета берутся из токенов в `base.css`; новые страницы подключают `base.css` и шрифты Montserrat + Manrope. Атрибут `[hidden]` должен реально скрывать элемент (правило уже есть в `base.css`).
- Коммиты на русском, коротко, что и зачем. Секреты в коммиты не попадают никогда.

## 10. Известные ограничения и что дальше (по приоритету)

1. **Первое подключение WhatsApp на реальном номере** — код проверен только на поддельном API Meta. Первый центр подключать вместе, смотреть логи функций.
2. **Встроенная регистрация (Embedded Signup)**, чтобы центр подключал WhatsApp сам без ручной работы в Meta. Требует статуса Tech Provider в Meta.
3. **Хранение данных в Казахстане** (раздел 7).
4. **Оплата подписки** (Kaspi / счёт) и автоматическое отключение при неоплате — сейчас вручную.
5. **Качество казахского у Haiku** — встречаются ошибки. Нужна проверка, возможно отдельный промпт или более сильная модель для казахского (в 20–30 раз дороже).
6. **Свой ключ Anthropic** (`ANTHROPIC_API_KEY` в env) с первым платящим клиентом — чтобы ИИ не расходовал кредиты Netlify.
7. **Значок «Powered by Netlify»** (тариф Free). Скрыть его можно только на платном плане (Personal, $9/мес): Project configuration → General → Powered by Netlify badge. Пока он есть, `nl-badge.js` и `widget.js` поднимают кнопки и поле ввода над ним.
8. **Тесты только сквозные** (`npm test`), юнит-тестов нет.
9. **Отчёт по рекламе конкурентов** (Meta Ad Library) для пакета «Набор под ключ» — отдельный модуль, ещё не сделан.

## 11. Чего не делать

- Не выдумывать в ответах ИИ цены, скидки и обещания. Промпт жёстко ограничивает модель данными центра, сохраните это.
- Не убирать требование согласия на обработку данных.
- Не делать много деплоев подряд (кредиты, раздел 2).
- Не хранить ключи и токены в репозитории.
- Не ломать формат ключей в Blobs без миграции существующих данных.

# Timezone Guard

*[Read in English](../README.md)*

Расширение для Firefox, которое подменяет часовой пояс и (опционально) User-Agent, которые браузер сообщает сайтам — во всех контекстах: главной странице, iframe (любой глубины вложенности), Dedicated Worker, Shared Worker и Service Worker.

## Зачем

Сайты вычисляют примерное местоположение и характеристики браузера через `Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, `navigator.userAgent` и похожие API — причём делают это не только в основном окне, но и внутри воркеров, куда обычные расширения для подмены таймзоны обычно не добираются. Это расширение патчит все эти точки согласованно, так что во всех контекстах отдаётся один и тот же результат.

## Возможности

- Подмена часового пояса (`Intl.DateTimeFormat`, `Date.prototype.getTimezoneOffset`, `toString`/`toDateString`/`toTimeString`/`toLocaleString`/`toLocaleDateString`/`toLocaleTimeString`)
- Опциональная подмена User-Agent (`navigator.userAgent`, `appVersion`, `platform`, `vendor`, `language(s)`, `userAgentData` для Chrome-подобных UA)
- Работает согласованно в: главном окне, iframe (включая вложенные iframe-в-iframe), Dedicated Worker, Shared Worker, Service Worker
- Реальные системные часы и `Date.now()` не трогаются — меняется только то, как дата *интерпретируется и отображается* в выбранной таймзоне
- Кэшированные `Intl.DateTimeFormat`-форматтеры — подмена не создаёт заметной задержки по сравнению с нативным поведением (важно против timing-детекторов вроде CreepJS)
- Работает на сайтах со строгим Content-Security-Policy (Spotify Web Player и подобные) — патч инжектится декларативно через `world: "MAIN"`, а не через `<script>` в DOM
- Ни одного нового свойства на `window` — всё общее состояние живёт в замыкании одного файла, снаружи не enumerable

## Как это устроено

### Основная страница и iframe — `spoof/main.js`

Единый content script, инжектируемый браузером напрямую в main world страницы (`world: "MAIN"` в манифесте, а не через `document.createElement('script')` — это единственный способ обойти CSP страницы, поскольку такая инжекция не считается кодом, добавленным самой страницей).

- `Intl.DateTimeFormat` и методы `Date.prototype` патчатся один раз на окно, с кэшированными форматтерами (без пересоздания `Intl.DateTimeFormat` на каждый вызов — иначе детекторы палят подмену по времени выполнения).
- `navigator.userAgent` и связанные свойства патчатся через `Object.defineProperty` на `Navigator.prototype`.
- Все патченные функции маскируются под `[native code]` через кастомный `toString`.
- **iframe**: вместо `MutationObserver` (который всегда асинхронный и не успевает сработать раньше синхронного кода, читающего `iframe.contentWindow` в том же тике) патчится сам геттер `contentWindow`/`contentDocument` на `HTMLIFrameElement.prototype` — подмена применяется в момент обращения, а не в момент вставки элемента в DOM. Патч рекурсивно применяется и к `HTMLIFrameElement.prototype` внутри каждого пропатченного окна — так что iframe-в-iframe тоже работает.
- **Dedicated/Shared Worker**: конструкторы `Worker`/`SharedWorker` оборачиваются так, чтобы перед оригинальным скриптом воркера выполнялся наш патч, а сам оригинальный файл подгружается изнутри воркера через `importScripts()` — без блокирующего синхронного XHR на главном потоке (который иначе даёт заметный timing-сигнал).
- **Service Worker**: `navigator.serviceWorker.register()` перехватывается, чтобы узнать точный URL скрипта воркера — эта информация уходит в background через `bridge.js`.

### `bridge.js` (isolated world)

Читает сохранённые `tz`/`ua` из `browser.storage.local` и передаёт их в `main.js` через временный DOM-атрибут на `<html>` (сразу стирается после чтения) — это единственный CSP-безопасный способ передать данные между isolated и main world без инжекции `<script>`.

### `background/background.js` + `background/build_worker.js`

Service Worker нельзя пропатчить тем же способом, что Dedicated/Shared Worker — спецификация требует, чтобы URL регистрации SW был обычным `http(s)`, `blob:` для него запрещён на уровне браузера. Поэтому здесь используется перехват сетевого ответа:

- `webRequest.onBeforeRequest` + `webRequest.filterResponseData` (требует permission `webRequestFilterResponse.serviceWorkerScript`) вклинивают патч-код в начало тела ответа на скрипт service worker'а, до того как браузер его распарсит.
- Фильтр обязательно ставится в `onBeforeRequest`, а не позже (`onHeadersReceived`) — иначе можно опоздать и наткнуться на внутренний оптимизированный байт-кэш скриптов Firefox (`Invalid request ID`).
- URL регистрируемого SW-скрипта определяется по сообщению от `main.js`/`bridge.js` (перехват `register()`), а не по заголовку `Service-Worker: script` — заголовок не всегда виден расширениям на всех сборках браузера.

## Установка (разработка / временное расширение)

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → выбрать `manifest.json`.
2. Открыть попап, выбрать часовой пояс (и опционально User-Agent), **Save & Apply**.
3. Полностью закрыть и заново открыть вкладку (не просто F5 — временные расширения в Firefox получают новый `moz-extension://` UUID при каждой перезагрузке, старые вкладки могут ссылаться на уже недействующий адрес).

## Структура проекта

```
manifest.json
bridge.js                     — isolated world: читает storage, передаёт tz/ua через DOM-атрибут
spoof/
  main.js                     — весь патч (Intl/Date/UA/iframe/Worker/SharedWorker), один файл, один IIFE
background/
  background.js                — перехват и патч сетевого ответа Service Worker
  build_worker.js               — генератор патч-кода для воркеров (модуль, используется background.js)
frontend/
  popup.html
  popup.js
icons/
```

## Permissions

- `storage` — сохранение выбранных tz/ua локально
- `<all_urls>` (host permission) — подмена должна применяться на любом сайте, до выполнения его собственных скриптов
- `webRequest`, `webRequestBlocking`, `webRequestFilterResponse`, `webRequestFilterResponse.serviceWorkerScript` — нужны исключительно для патчинга Service Worker через перехват сетевого ответа

## Известные ограничения

- **Индексный доступ `window[n]` / `window.frames[n]`** — обращение к дочернему browsing context по числовому индексу является exotic internal-поведением `WindowProxy` на уровне движка браузера, а не обычным JS-свойством. `Object.defineProperty` не может это перехватить (в отличие от `contentWindow`, который является обычным accessor-свойством прототипа). Первое такое обращение отдаёт реальные данные; последующие через `.contentWindow` уже патчены.
- **"Мёртвые" (detached) iframe** — ссылка на `window` удалённого из DOM iframe, полученная через нестандартный путь доступа, может остаться непропатченной.
- После смены tz/ua в попапе открытые вкладки нужно перезагружать — подмена применяется при загрузке страницы, а не в реальном времени задним числом (хотя уже открытая вкладка подхватит новое значение "живьём" для будущих вызовов API, если попап был открыт до перезагрузки страницы).
- Расширение меняет только то, что *сообщается* через JS API — часы и часовой пояс операционной системы не трогаются.

## Сравнение (до / после)

| До (оригинал) | После (подмена) |
| :---: | :---: |
| ![До](../img/befory.png) | ![После](../img/after.png) |

## Лицензия

MIT
# Профильный README — как выложить

Репозиторий-визитка должен называться **ровно как твой ник** — `Oneyann` — и быть **публичным**.
Только тогда GitHub показывает его README на странице профиля.

## 1. Создать репозиторий

На GitHub: **New repository** → имя `Oneyann` → Public → **Create repository**.
Галочку «Add a README file» можно не ставить: файл уже готов.

## 2. Запушить эти файлы

```powershell
cd C:\Users\User\Desktop\profile-readme
git init
git add .
git commit -m "profile readme"
git branch -M main
git remote add origin https://github.com/Oneyann/Oneyann.git
git push -u origin main
```

Открыть `https://github.com/Oneyann` — README уже на месте.

## 3. Включить змейку

1. В репозитории → вкладка **Actions** → «I understand my workflows, go ahead and enable them».
2. Слева выбрать **Snake** → **Run workflow** → **Run workflow**.
3. Через 1–2 минуты появится ветка **`output`** с файлами `snake.svg` и `snake-dark.svg`.
4. GitHub кеширует картинки примерно на 5 минут. Если змейка всё ещё битая — добавь в конце URL `?v=2`.

Дальше workflow сам обновляет змейку раз в сутки и при каждом пуше в `main`.

## 4. Контакты

В `README.md` есть закомментированный блок с Telegram и e-mail — раскомментируй и подставь свои ссылки.
Почту в открытый профиль лучше ставить только если готов к спаму.

## Если что-то не отрисовалось

| Симптом | Причина | Что делать |
| :--- | :--- | :--- |
| В `preview.html` часть картинок пустая, а на GitHub они видны | твой провайдер/DPI режет домен сервиса, а на GitHub картинки идут через прокси GitHub (camo) | ничего не делать, проверить уже на github.com |
| Карточка статистики пустая или «Maximum retries» | сервис `github-readme-stats` перегружен | заменить `github-readme-stats-fast.vercel.app` на `github-readme-stats.vercel.app` (и наоборот) |
| Змейка не появилась | workflow не запускался или упал | Actions → Snake → смотреть лог; проверить, что появилась ветка `output` |
| README не виден в профиле | репозиторий назван иначе или приватный | переименовать в `Oneyann`, сделать public |
| Бейджи без иконок | shields.io не нашёл логотип | заменить `logo=` на существующий slug с simpleicons.org |

## Про `preview.html`

Это локальный предпросмотр в оформлении GitHub: открой файл в браузере.
Внутри лежит копия README, поэтому после правок в `README.md` обнови и её.

Для самого профиля нужны только `README.md` и папка `.github`. Если не хочешь держать
служебные файлы в публичном репозитории — удали `SETUP.md` и `preview.html` перед пушем.

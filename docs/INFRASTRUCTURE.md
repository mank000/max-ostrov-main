# Production infrastructure

Актуально на 29.09.2026. Этот файл — каноническая карта текущего runtime.
Исторические записи в `docs/ai/JOURNAL.md`, migration-документы и snapshot
`vps/` могут описывать прежнюю топологию и не имеют приоритета над live runtime.

## Production: 135.106.196.216

На `135.106.196.216` находятся:

- MAX mini-app/API: `kutezh.service`, `127.0.0.1:8080`;
- Nginx для `kutezh-social.ru` и `moderation.kutezh-social.ru`;
- PostgreSQL production: база `kutezh_live`;
- пользовательские media: `/var/lib/kutezh/media`;
- autodeploy: `kutezh-autodeploy.timer`;
- backup/healthcheck production;
- shared production AI inference.

### Production AI

| Назначение | systemd service | Loopback endpoint |
| --- | --- | --- |
| Face / age / avatar match | `kutezh-tg-face-ai.service` | `127.0.0.1:18291` |
| Image moderation | `kutezh-tg-image-ai.service` | `127.0.0.1:18293` |
| Anatomy detector | `kutezh-tg-anatomy-ai.service` | `127.0.0.1:18296` |
| Context text moderation | `kutezh-tg-context-text.service` | `127.0.0.1:18394` |

Префикс `kutezh-tg-` — историческое имя unit-ов. Эти AI-сервисы обслуживают
MAX и не относятся к отдельному Telegram-приложению; отключать их при выводе
старого приложения нельзя.

Старый `kutezh-ai-tunnel.service` и файл `ops/kutezh-ai-tunnel-135.service`
относятся к предыдущей схеме, когда 135-й ходил за inference на 147-й. Они не
входят в текущий production request path и не должны включаться автоматически.

## VPS 147.45.70.18

На этом сервере расположены стенды веток и часть внутренних инструментов.
Наличие локальных legacy/staging endpoint-ов не делает их production source of truth.

- branch sites: `maxevent*.147-45-70-18.sslip.io`;
- moderation preview bot может оставаться на этом VPS.

Любой процесс на 147-м, которому нужен production AI, должен быть явно
настроен на действующие shared endpoints. Нельзя выводить адрес модели из имени
unit-а или из старой записи JOURNAL.

## Как проверять фактическое состояние

На production host:

```bash
systemctl is-active kutezh.service
for service in \
  kutezh-tg-face-ai.service \
  kutezh-tg-image-ai.service \
  kutezh-tg-anatomy-ai.service \
  kutezh-tg-context-text.service
do
  printf '%-40s ' "$service"
  systemctl is-active "$service"
done

ss -ltnp | grep -E ':(8080|18291|18293|18296|18394)\b'
curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsS http://127.0.0.1:18291/health
```

Для production MAX также проверять:

```bash
curl -fsS https://kutezh-social.ru/revision.txt
systemctl status kutezh-autodeploy.timer --no-pager
```

## Синяя и жёлтая верификация

Go backend перебирает все актуальные фотографии профиля и crop-варианты до
первого совпадения. Основная аватарка не обязана совпасть: достаточно любого
актуального фото.

Автоматическая синяя галочка возможна только если реальный Face AI worker
загрузил SFace и его `/health` возвращает:

```json
{"auto_avatar_match":true}
```

Если `auto_avatar_match=false`, возрастная проверка может завершиться успешно,
но автоматический tier останется `age` — жёлтая галочка. Ручная сверка через
support остаётся отдельным путём после успешной проверки возраста.

## Источники правды

Для инфраструктурного решения использовать приоритет:

1. live `systemctl`, listening ports, root-owned env и локальные `/health`;
2. этот документ и `docs/ai/STATE.md`;
3. текущий код/unit templates;
4. JOURNAL, migration notes и snapshots — только как история.

Если live runtime расходится с этим документом, сначала зафиксировать фактическую
схему, затем обновить `INFRASTRUCTURE.md`, `STATE.md` и затронутые runbooks в
том же изменении.

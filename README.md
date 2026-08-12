# Vision Guard

Production-ready веб-сервис для поиска объектов на изображениях. Пользователь может загрузить и обрезать фотографию, после чего сервис покажет найденные объекты и их расположение.

## Быстрый локальный запуск

```powershell
Copy-Item .env.example .env
docker compose up --build
```



Интерфейс: <http://localhost:8011>. Документация API в development-режиме: <http://localhost:8011/docs>.

## Production-развёртывание

Требования: Linux-сервер с Docker Compose, домен с A/AAAA-записью на сервер и открытые порты 80/443.

```bash
cp .env.production.example .env.production
openssl rand -hex 32
# Запишите результат в METRICS_TOKEN и укажите настоящий DOMAIN.
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

Reverse proxy автоматически получает и обновляет TLS-сертификат. Сам API доступен только внутри Docker-сети. Пути `/docs`, `/openapi.json` и `/metrics` снаружи закрыты.

Проверка после деплоя:

```bash
curl -fsS https://your-domain.example/health/live
curl -fsS https://your-domain.example/health/ready
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100
```

Обновление без изменения конфигурации:

```bash
docker compose --env-file .env.production -f compose.production.yaml build --pull
docker compose --env-file .env.production -f compose.production.yaml up -d
```

## Production-гарантии

- HTTPS и автоматическое обновление сертификатов;
- API не публикуется напрямую в интернет;
- trusted-host validation и безопасные HTTP-заголовки;
- скрытые внутренние сведения и унифицированные сообщения об ошибках;
- request ID и эксплуатационные логи;
- ограничение размера загрузок и параллельной обработки;
- непривилегированный пользователь, read-only root filesystem и удалённые Linux capabilities;
- health checks, graceful shutdown, restart policy и ротация логов;
- лимиты памяти, CPU и количества процессов;
- тестирование, lint и проверка production Compose в CI.

## Конфигурация

Основные переменные находятся в `.env.production.example`:

- `DOMAIN` — публичный домен;
- `METRICS_TOKEN` — длинный случайный секрет для внутреннего сбора метрик;
- `MAX_IMAGE_MB` — максимальный размер файла;
- `CONFIDENCE_THRESHOLD` — порог уверенности;
- `MAX_CONCURRENT_INFERENCE` — число параллельных задач обработки;
- `API_MEMORY_LIMIT` и `API_CPU_LIMIT` — лимиты контейнера.

Файл `.env.production` содержит секреты и не должен попадать в Git. Данные TLS хранятся в Docker volumes `caddy_data` и `caddy_config`; включите их в резервное копирование инфраструктуры.

## Разработка и тесты

```powershell
uv sync --extra dev
uv run pytest -q
uv run ruff check app tests
```

Для изолированных тестов используется специальный детерминированный backend. Production-конфигурация запрещает его запуск.

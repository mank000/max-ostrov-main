INSERT INTO users
 (id, first_name, display_name, username, city, bio, gender, birth_date, onboarding_version)
VALUES
 (1001, 'Алексей', 'Алексей · демо', 'demo_alex', 'Москва', 'Тестовый профиль администратора. Все данные в этой базе вымышлены.', 'man', DATE '2001-03-12', 1),
 (1002, 'Мира', 'Мира · демо', 'demo_mira', 'Москва', 'Тестовый профиль. Люблю прогулки, настолки и небольшие концерты.', 'woman', DATE '2002-07-16', 1),
 (1003, 'Никита', 'Никита · демо', 'demo_nikita', 'Москва', 'Тестовый профиль для проверки дружбы, ленты и сообщений.', 'man', DATE '2000-11-05', 1);

SELECT setval('users_internal_id_seq', (SELECT max(id) FROM users));

INSERT INTO user_identities (provider, provider_user_id, user_id)
VALUES ('max', 900000001, 1001), ('max', 900000002, 1002), ('max', 900000003, 1003);
INSERT INTO user_roles (user_id, role) VALUES (1001, 'administrator');
INSERT INTO friendships (user_low_id, user_high_id) VALUES (1001, 1002);
INSERT INTO user_interests (user_id, interest, position)
VALUES (1001, 'Прогулки', 0), (1001, 'Музыка', 1),
 (1002, 'Прогулки', 0), (1002, 'Настольные игры', 1), (1003, 'Музыка', 0);

INSERT INTO coin_transactions (user_id, amount, kind, description, reference_type, reference_id, idempotency_key)
SELECT id, 1000, 'adjustment', 'Тестовые монеты для знакомства с приложением', 'demo', 'initial', 'demo:initial'
FROM users;

INSERT INTO events
 (created_by_user_id, organizer_name, title, description, category, starts_at, ends_at,
  venue_name, address, city, latitude, longitude, source_name, source_updated_at)
VALUES
 (1001, 'Команда демо', 'Прогулка после работы', 'Это вымышленное мероприятие для проверки записи, приглашений и карты.',
  'Прогулки', now() + interval '1 day', now() + interval '1 day 2 hours', 'У входа в парк', 'Москва, парк Горького', 'Москва',
  55.7298, 37.6010, 'Демо', now()),
 (1002, 'Команда демо', 'Вечер настольных игр', 'Тестовая встреча. Можно вступить в группу и пригласить друга.',
  'Игры', now() + interval '2 days', now() + interval '2 days 3 hours', 'Игровой клуб', 'Москва, Покровка, 8', 'Москва',
  55.7595, 37.6430, 'Демо', now()),
 (1003, 'Команда демо', 'Небольшой концерт', 'Тестовая карточка события, не настоящий анонс.',
  'Музыка', now() + interval '3 days', now() + interval '3 days 2 hours', 'Камерная сцена', 'Москва, Тверская, 12', 'Москва',
  55.7635, 37.6088, 'Демо', now());

-- Анкеты вымышленные; признак проверки лица не подделываем.
INSERT INTO dating_profiles (user_id, settings)
SELECT id, '{"goal":"date","show_gender":"all","min_age":18,"max_age":35,"same_city_only":false,"verified_only":false,"is_paused":false,"adult_confirmed":true,"interests":[]}'::jsonb
FROM users;

INSERT INTO posts (author_user_id, caption, visibility, adult_only, age_classified)
VALUES
 (1001, 'Здесь можно проверить ленту: написать свой пост, поставить лайк, оставить комментарий. Это отдельная демонстрационная база.', 'city', false, true),
 (1002, 'Собираемся на настолки. В демо уже есть мероприятие — попробуйте открыть карточку и записаться.', 'city', false, true),
 (1003, 'Ищу компанию на прогулку. Все профили и встречи здесь вымышлены, так что можно спокойно проверять кнопки.', 'city', false, true);

INSERT INTO post_comments (post_id, author_user_id, body, adult_only, age_classified)
SELECT id, 1002, 'Проверяю комментарии — всё сохранится после перезапуска.', false, true
FROM posts WHERE author_user_id = 1001;
INSERT INTO post_likes (post_id, user_id) SELECT id, 1001 FROM posts WHERE author_user_id = 1002;

CREATE TABLE demo_installation (version integer PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO demo_installation (version) VALUES (1);

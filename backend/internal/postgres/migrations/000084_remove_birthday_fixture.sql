DELETE FROM users u
USING user_identities identity
WHERE identity.user_id = u.id
  AND identity.provider = 'max'
  AND identity.provider_user_id = 8999999999999999
  AND lower(u.username) = 'birthday_qa';

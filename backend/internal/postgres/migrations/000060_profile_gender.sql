ALTER TABLE users
ADD COLUMN gender text CHECK (gender IN ('man', 'woman'));

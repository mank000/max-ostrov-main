ALTER TABLE users
ADD COLUMN birth_date date,
ADD COLUMN face_verified_at timestamptz;

ALTER TABLE users
ADD CONSTRAINT users_birth_date_minimum
CHECK (birth_date IS NULL OR birth_date >= DATE '1900-01-01');

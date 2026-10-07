CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  display TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX users_username_lower ON users (LOWER(username));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX files_user ON files (user_id);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);

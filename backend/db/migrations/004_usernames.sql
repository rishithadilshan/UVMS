ALTER TABLE users ADD COLUMN IF NOT EXISTS username varchar(80);

DO $$
DECLARE
  u record;
  base_name text;
  candidate text;
  suffix text;
  attempt integer;
BEGIN
  FOR u IN
    SELECT id, lower(split_part(email, '@', 1)) AS email_prefix
    FROM users
    WHERE username IS NULL
    ORDER BY created_at, id
  LOOP
    base_name := left(u.email_prefix, 80);
    candidate := base_name;
    attempt := 0;
    WHILE EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(candidate) AND id <> u.id) LOOP
      attempt := attempt + 1;
      suffix := '-' || left(replace(u.id::text, '-', ''), 32) || '-' || attempt;
      candidate := left(base_name, 80 - length(suffix)) || suffix;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = u.id;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (lower(username));

CREATE OR REPLACE FUNCTION users_normalize_username() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  base_name text;
  candidate text;
BEGIN
  IF NEW.username IS NULL OR btrim(NEW.username) = '' THEN
    base_name := lower(split_part(NEW.email, '@', 1));
    PERFORM pg_advisory_xact_lock(hashtext(base_name)::bigint);
    candidate := base_name;
    IF EXISTS (SELECT 1 FROM users WHERE lower(username) = candidate) THEN
      candidate := left(base_name, 47) || '-' || left(replace(NEW.id::text, '-', ''), 32);
    END IF;
    NEW.username := candidate;
  ELSE
    NEW.username := lower(btrim(NEW.username));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_normalize_username_trg
BEFORE INSERT OR UPDATE OF username ON users
FOR EACH ROW EXECUTE FUNCTION users_normalize_username();

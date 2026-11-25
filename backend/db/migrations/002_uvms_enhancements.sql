-- 002: UVMS enhancement (flexible bookings, approval workflow, maintenance, priorities,
-- venue-change requests, reminders, waitlist, check-in, settings).
-- All times are stored as naive local wall-clock timestamps in Asia/Colombo (the university time zone).

-- ---------- USERS ----------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','LECTURER','INSTRUCTOR','STUDENT','LAB_ASSISTANT'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'APPROVED';
UPDATE users SET status = CASE WHEN approved THEN 'APPROVED' ELSE 'PENDING' END;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_number varchar(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_notice_pending boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_registration_number_uq ON users (lower(registration_number)) WHERE registration_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_status_idx ON users(status, role);
-- `approved` (legacy boolean) is now derived from `status`, which is the single source of truth.
CREATE OR REPLACE FUNCTION users_sync_approved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.approved := (NEW.status = 'APPROVED'); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS users_sync_approved_trg ON users;
CREATE TRIGGER users_sync_approved_trg BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_sync_approved();

-- ---------- FACILITIES CATALOG ----------
CREATE TABLE IF NOT EXISTS facilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS facilities_name_uq ON facilities (lower(name));
INSERT INTO facilities(name) VALUES ('Projector'),('Multimedia System'),('Whiteboard'),('Smart Board'),('Sound System'),('Microphone'),
 ('Air Conditioning'),('Wi-Fi'),('Computers'),('Laboratory Equipment'),('Video Conferencing Facilities'),('Power Outlets')
ON CONFLICT DO NOTHING;
-- keep any facility already used on a venue available in the catalog
INSERT INTO facilities(name) SELECT DISTINCT trim(f) FROM venues, unnest(facilities) f WHERE trim(f) <> '' ON CONFLICT DO NOTHING;

-- ---------- VENUES ----------
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_status_check;
UPDATE venues SET status = CASE status WHEN 'available' THEN 'AVAILABLE' WHEN 'maintenance' THEN 'UNDER_MAINTENANCE' WHEN 'disabled' THEN 'UNAVAILABLE' ELSE upper(status) END;
ALTER TABLE venues ALTER COLUMN status SET DEFAULT 'AVAILABLE';
ALTER TABLE venues ADD CONSTRAINT venues_status_check CHECK (status IN ('AVAILABLE','UNDER_MAINTENANCE','TEMPORARILY_CLOSED','UNAVAILABLE'));
ALTER TABLE venues ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;   -- soft delete flag
ALTER TABLE venues ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS venues_search_idx ON venues(active, capacity);

-- ---------- BOOKING CATEGORIES / PRIORITIES ----------
CREATE TABLE IF NOT EXISTS booking_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL, description text NOT NULL DEFAULT '',
 priority_level integer NOT NULL CHECK (priority_level BETWEEN 1 AND 10),   -- 1 = highest priority
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_categories_name_uq ON booking_categories (lower(name));
INSERT INTO booking_categories(name,description,priority_level) VALUES
 ('Exam Activities','Examinations, invigilated tests and exam preparation sessions (highest priority).',1),
 ('Academic Activities','Lectures, tutorials, seminars and other teaching activities (high priority).',2),
 ('Laboratory Activities','Practical sessions and laboratory work (medium priority).',3),
 ('Other Events','Meetings, society events and other activities (normal priority).',4)
ON CONFLICT DO NOTHING;

-- ---------- BOOKINGS ----------
ALTER TABLE bookings ALTER COLUMN time_slot_id DROP NOT NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
UPDATE bookings SET status='CONFIRMED' WHERE status='ACTIVE';
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'CONFIRMED';
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','EXPIRED'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE bookings SET owner_id = COALESCE(lecturer_id, created_by) WHERE owner_id IS NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES booking_categories(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS justification text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS required_facilities text[] NOT NULL DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejection_reason text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_token varchar(40) NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','');
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by_role varchar(30);
UPDATE bookings SET purpose = title WHERE purpose = '';
CREATE UNIQUE INDEX IF NOT EXISTS bookings_checkin_token_uq ON bookings(checkin_token);
CREATE INDEX IF NOT EXISTS bookings_owner_idx ON bookings(owner_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status, starts_at);
CREATE INDEX IF NOT EXISTS bookings_venue_time_idx ON bookings(venue_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS bookings_pending_expiry_idx ON bookings(expires_at) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS bookings_series_idx ON bookings(series_id) WHERE series_id IS NOT NULL;

-- Interval trigger: legacy slot-based bookings still derive their interval from the slot;
-- flexible bookings (time_slot_id IS NULL) carry explicit starts_at/ends_at.
CREATE OR REPLACE FUNCTION set_booking_interval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot_start time; slot_end time;
BEGIN
 IF NEW.time_slot_id IS NOT NULL THEN
   SELECT start_time,end_time INTO slot_start,slot_end FROM time_slots WHERE id=NEW.time_slot_id;
   IF slot_start IS NULL OR slot_end IS NULL THEN RAISE EXCEPTION 'Time slot not found'; END IF;
   NEW.starts_at := NEW.booking_date + slot_start;
   NEW.ends_at := NEW.booking_date + slot_end;
 ELSE
   IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL THEN RAISE EXCEPTION 'starts_at and ends_at are required'; END IF;
   NEW.booking_date := NEW.starts_at::date;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS bookings_set_interval ON bookings;
CREATE TRIGGER bookings_set_interval BEFORE INSERT OR UPDATE OF booking_date,time_slot_id,starts_at,ends_at ON bookings FOR EACH ROW EXECUTE FUNCTION set_booking_interval();

-- Confirmed AND pending bookings reserve a venue; the DB rejects any overlap (newStart < existingEnd AND newEnd > existingStart).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_venue_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_venue_overlap EXCLUDE USING gist (venue_id WITH =, tsrange(starts_at,ends_at,'[)') WITH &&)
 WHERE (status IN ('PENDING','CONFIRMED')) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_lecturer_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_lecturer_overlap EXCLUDE USING gist (lecturer_id WITH =, tsrange(starts_at,ends_at,'[)') WITH &&)
 WHERE (status IN ('PENDING','CONFIRMED') AND lecturer_id IS NOT NULL) DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE IF NOT EXISTS booking_series (
 id uuid PRIMARY KEY, owner_id uuid REFERENCES users(id) ON DELETE SET NULL, venue_id uuid REFERENCES venues(id),
 rule jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_history (
 id bigserial PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, action varchar(40) NOT NULL,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, from_status varchar(20), to_status varchar(20),
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_history_booking_idx ON booking_history(booking_id, created_at);

CREATE TABLE IF NOT EXISTS booking_approvals (
 id bigserial PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 decision varchar(20) NOT NULL CHECK (decision IN ('APPROVED','REJECTED','EXPIRED')), decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- MAINTENANCE ----------
CREATE TABLE IF NOT EXISTS venue_maintenance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
 status varchar(30) NOT NULL CHECK (status IN ('UNDER_MAINTENANCE','TEMPORARILY_CLOSED','UNAVAILABLE')),
 reason varchar(300) NOT NULL, description text NOT NULL DEFAULT '',
 starts_at timestamp NOT NULL, ends_at timestamp,                  -- ends_at = expected reopening (NULL = open ended)
 restored_at timestamptz, restored_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS venue_maintenance_venue_idx ON venue_maintenance(venue_id, starts_at);
CREATE TABLE IF NOT EXISTS maintenance_affected_bookings (
 maintenance_id uuid NOT NULL REFERENCES venue_maintenance(id) ON DELETE CASCADE, booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 notified_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (maintenance_id, booking_id)
);

-- ---------- VENUE CHANGE REQUESTS ----------
CREATE TABLE IF NOT EXISTS venue_change_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 requester_id uuid NOT NULL REFERENCES users(id), target_booking_id uuid NOT NULL REFERENCES bookings(id),
 owner_id uuid REFERENCES users(id) ON DELETE SET NULL,           -- owner of the existing booking
 handled_by_admin boolean NOT NULL DEFAULT false,                  -- true when the owner is a student (students cannot decide)
 venue_id uuid NOT NULL REFERENCES venues(id),                     -- requested venue
 requested_starts_at timestamp NOT NULL, requested_ends_at timestamp NOT NULL,
 participants integer NOT NULL CHECK (participants > 0), category_id uuid REFERENCES booking_categories(id) ON DELETE SET NULL,
 purpose text NOT NULL DEFAULT '', required_facilities text[] NOT NULL DEFAULT '{}',
 reason text NOT NULL, message text NOT NULL DEFAULT '',
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 decided_by uuid REFERENCES users(id) ON DELETE SET NULL, decision_message text NOT NULL DEFAULT '', decided_at timestamptz,
 alternative_venue_id uuid REFERENCES venues(id) ON DELETE SET NULL, alternative_starts_at timestamp, alternative_ends_at timestamp,
 resulting_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
 admin_ruling varchar(30), admin_note text NOT NULL DEFAULT '', admin_ruled_by uuid REFERENCES users(id) ON DELETE SET NULL, admin_ruled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (requested_starts_at < requested_ends_at)
);
CREATE INDEX IF NOT EXISTS vcr_owner_idx ON venue_change_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS vcr_requester_idx ON venue_change_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS vcr_target_idx ON venue_change_requests(target_booking_id, status);

-- ---------- MODIFICATION / CANCELLATION REQUESTS ----------
CREATE TABLE IF NOT EXISTS booking_modification_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 requester_id uuid NOT NULL REFERENCES users(id), kind varchar(10) NOT NULL CHECK (kind IN ('MODIFY','CANCEL')),
 changes jsonb NOT NULL DEFAULT '{}', reason text NOT NULL DEFAULT '',
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 decided_by uuid REFERENCES users(id) ON DELETE SET NULL, decision_note text NOT NULL DEFAULT '', decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bmr_status_idx ON booking_modification_requests(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS bmr_one_pending_per_booking ON booking_modification_requests(booking_id, kind) WHERE status='PENDING';

-- ---------- NOTIFICATIONS ----------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type varchar(40);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key varchar(200);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uq ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read, created_at DESC);

-- ---------- REMINDERS ----------
CREATE TABLE IF NOT EXISTS booking_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE CASCADE, remind_at timestamptz NOT NULL, for_starts_at timestamp NOT NULL,
 short_notice boolean NOT NULL DEFAULT false,
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','CANCELLED','SKIPPED')),
 sent_at timestamptz, notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_reminders_due_idx ON booking_reminders(remind_at) WHERE status='PENDING';

-- ---------- CHECK-IN ----------
CREATE TABLE IF NOT EXISTS check_ins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL, method varchar(20) NOT NULL DEFAULT 'MANUAL', checked_in_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- WAITLIST ----------
CREATE TABLE IF NOT EXISTS waitlist_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
 requested_starts_at timestamp NOT NULL, requested_ends_at timestamp NOT NULL, required_facilities text[] NOT NULL DEFAULT '{}',
 expected_participants integer NOT NULL CHECK (expected_participants > 0),
 status varchar(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','NOTIFIED','CANCELLED','EXPIRED')),
 notified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK (requested_starts_at < requested_ends_at)
);
CREATE INDEX IF NOT EXISTS waitlist_venue_idx ON waitlist_entries(venue_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_unique_active ON waitlist_entries(user_id, venue_id, requested_starts_at, requested_ends_at) WHERE status='WAITING';

-- ---------- SETTINGS, EMAIL LOG, AUDIT ----------
CREATE TABLE IF NOT EXISTS app_settings (key varchar(60) PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id) ON DELETE SET NULL);
INSERT INTO app_settings(key,value) VALUES ('pending_expiry_hours','24'),('reminder_lead_hours','24'),('operating_hours','{"start":"08:00","end":"18:00"}'),('max_booking_hours','12')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS email_log (
 id bigserial PRIMARY KEY, to_address varchar(254) NOT NULL, subject varchar(200) NOT NULL, body text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'QUEUED', error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);

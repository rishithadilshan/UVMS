CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL UNIQUE, code varchar(30) UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL, email varchar(254) NOT NULL UNIQUE,
 password_hash text NOT NULL, role varchar(30) NOT NULL CHECK(role IN ('ADMIN','LECTURER','STUDENT','LAB_ASSISTANT')),
 department_id uuid REFERENCES departments(id) ON DELETE SET NULL, active boolean NOT NULL DEFAULT true,
 approved boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL UNIQUE, capacity integer NOT NULL CHECK(capacity > 0),
 type varchar(50) NOT NULL, building varchar(120) NOT NULL DEFAULT '', facilities text[] NOT NULL DEFAULT '{}',
 status varchar(30) NOT NULL DEFAULT 'available' CHECK(status IN ('available','maintenance','disabled')),
 maintenance_note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venue_managers (venue_id uuid REFERENCES venues(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(venue_id,user_id));
CREATE TABLE IF NOT EXISTS time_slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
 active boolean NOT NULL DEFAULT true, CHECK(start_time < end_time), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS courses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(180) NOT NULL, code varchar(40), department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
 default_lecturer_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES venues(id), time_slot_id uuid NOT NULL REFERENCES time_slots(id),
 booking_date date NOT NULL, title varchar(240) NOT NULL, course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
 lecturer_id uuid REFERENCES users(id) ON DELETE SET NULL, expected_students integer NOT NULL CHECK(expected_students >= 0),
 type varchar(20) NOT NULL DEFAULT 'REGULAR' CHECK(type IN ('REGULAR','SPECIAL')), series_id uuid,
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CANCELLED')), created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 notes text NOT NULL DEFAULT '', starts_at timestamp NOT NULL, ends_at timestamp NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(starts_at < ends_at)
);
-- Derive concrete interval from the editable time-slot record; no slot times are hardcoded.
CREATE OR REPLACE FUNCTION set_booking_interval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot_start time; slot_end time;
BEGIN
 SELECT start_time,end_time INTO slot_start,slot_end FROM time_slots WHERE id=NEW.time_slot_id;
 IF slot_start IS NULL OR slot_end IS NULL THEN RAISE EXCEPTION 'Time slot not found'; END IF;
 NEW.starts_at := NEW.booking_date + slot_start;
 NEW.ends_at := NEW.booking_date + slot_end;
 NEW.updated_at := now();
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS bookings_set_interval ON bookings;
CREATE TRIGGER bookings_set_interval BEFORE INSERT OR UPDATE OF booking_date,time_slot_id ON bookings FOR EACH ROW EXECUTE FUNCTION set_booking_interval();
-- Prevent overlapping intervals for the same venue, including simultaneous concurrent requests.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_venue_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_venue_overlap EXCLUDE USING gist (venue_id WITH =, tsrange(starts_at,ends_at,'[)') WITH &&) WHERE (status='ACTIVE') DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_lecturer_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_lecturer_overlap EXCLUDE USING gist (lecturer_id WITH =, tsrange(starts_at,ends_at,'[)') WITH &&) WHERE (status='ACTIVE' AND lecturer_id IS NOT NULL) DEFERRABLE INITIALLY IMMEDIATE;
CREATE OR REPLACE FUNCTION refresh_bookings_for_time_slot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN UPDATE bookings SET time_slot_id=NEW.id WHERE time_slot_id=NEW.id; END IF; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS time_slots_refresh_bookings ON time_slots;
CREATE TRIGGER time_slots_refresh_bookings AFTER UPDATE OF start_time,end_time ON time_slots FOR EACH ROW EXECUTE FUNCTION refresh_bookings_for_time_slot();
CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS bookings_lecturer_idx ON bookings(lecturer_id,booking_date);
CREATE TABLE IF NOT EXISTS booking_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES users(id), request_type varchar(40) NOT NULL,
 related_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL, proposed_venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
 proposed_time_slot_id uuid REFERENCES time_slots(id) ON DELETE SET NULL, proposed_date date, event_title varchar(240) NOT NULL DEFAULT '',
 expected_students integer CHECK(expected_students IS NULL OR expected_students >= 0), required_facilities text[] NOT NULL DEFAULT '{}',
 reason text NOT NULL, status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL, review_note text NOT NULL DEFAULT '', resulting_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exchange_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_lecturer_id uuid NOT NULL REFERENCES users(id), from_booking_id uuid NOT NULL REFERENCES bookings(id),
 to_lecturer_id uuid NOT NULL REFERENCES users(id), to_booking_id uuid NOT NULL REFERENCES bookings(id), reason text NOT NULL DEFAULT '',
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED','CANCELLED')),
 responded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title varchar(200) NOT NULL, message text NOT NULL, type varchar(40) NOT NULL DEFAULT 'GENERAL', read boolean NOT NULL DEFAULT false,
 link varchar(300) NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action varchar(100) NOT NULL,
 entity_type varchar(80) NOT NULL, entity_id text, metadata jsonb NOT NULL DEFAULT '{}', ip inet, created_at timestamptz NOT NULL DEFAULT now()
);

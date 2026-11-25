# MongoDB → PostgreSQL rebuild notes

The uploaded archive contained only test/demo records, so this rebuild intentionally starts with a clean PostgreSQL schema. No MongoDB data import was performed and no original MongoDB credentials or Git history are included.

## Collection-to-table mapping

| Original Mongoose model | PostgreSQL table | Main relationship |
|---|---|---|
| User | `users` | Optional department; role is constrained |
| Department | `departments` | Has users and courses |
| Venue | `venues` | Assigned lab assistants via `venue_managers` |
| TimeSlot | `time_slots` | Referenced by bookings |
| Course | `courses` | Optional department and default lecturer |
| Booking | `bookings` | Venue, time slot, lecturer, course and creator |
| BookingRequest | `booking_requests` | Requester, related booking, optional proposed venue/slot |
| ExchangeRequest | `exchange_requests` | Two lecturers and their two bookings |
| Notification | `notifications` | Owned by one user |

## Important differences

- Mongo ObjectIds become PostgreSQL UUIDs.
- Mongoose `password` becomes `password_hash`; no plaintext password is stored.
- `createdAt` / `updatedAt` become `created_at` / `updated_at` in PostgreSQL. API responses preserve the camelCase fields needed by the current frontend where applicable.
- Venue-to-lab-assistant assignments are stored in a join table (`venue_managers`).
- Booking `date` and `timeSlot` become `booking_date` and `time_slot_id`.
- The database derives `starts_at` and `ends_at` from the selected editable time slot. GiST exclusion constraints reject overlaps by venue and lecturer, not merely identical slot IDs.
- Repeating bookings are still expanded into one row per date and grouped by `series_id`.

## Data migration decision

Because the supplied database contents were test/demo data, the rebuild does not attempt to preserve or import MongoDB records. Create real departments, venues, time slots, users and courses through the application/admin APIs after applying the schema. Development fixtures are opt-in and kept separate from production.

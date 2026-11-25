# UVMS Role-Permission Matrix

This matrix describes server-enforced behavior discovered from source. It excludes the existing extra LAB_ASSISTANT implementation from the requested four-role scope.

| Capability | Administrator | Lecturer | Instructor | Student |
|---|---:|---:|---:|---:|
| Public registration | No | Yes | Yes | Yes |
| Sign in only when approved/active | Yes | Yes | Yes | Yes |
| Dashboard | Admin overview | Own summary | Own summary | Own summary |
| View own bookings | Full admin booking access | Yes | Yes | Yes |
| View another user's booking details | Yes | No | No | No |
| Direct confirmed booking | Yes, for selected approved non-admin owner | Yes | Yes | No |
| Submit pending student booking | No | No | No | Yes |
| Search venues | Yes | Yes | Yes | Yes |
| Approve/reject student booking | Yes | No | No | No |
| Cancel own booking | Yes | Yes | Yes | Confirmed requires approval; pending direct |
| Modify own booking | Yes | Yes | Yes | Confirmed material changes require approval |
| Venue CRUD | Yes | No | No | No |
| Maintenance management | Yes | No | No | No |
| Registration/user management | Yes | No | No | No |
| Venue-change request | N/A as owner | Yes | Yes | Yes |
| Lecturer interchange | No | Yes | No | No |
| Notifications | Admin and own notifications | Own | Own | Own |
| Reports | Yes | No | No | No |

## Booking status behavior confirmed in source

| Status | Venue reserve | Availability | Supported transition |
|---|---|---|---|
| PENDING | Yes | Blocks PENDING and CONFIRMED conflicts | Approved or rejected; expires |
| CONFIRMED | Yes | Blocks PENDING and CONFIRMED conflicts | Cancelled or modified |
| REJECTED | No | Releases slot | Terminal |
| CANCELLED | No | Releases slot | Terminal |
| EXPIRED | No | Releases slot | Terminal |

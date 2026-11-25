# UVMS Feature Inventory

This inventory is based on source inspection. It does not indicate test pass status.

| Feature | Relevant roles | Frontend | Backend | Database | Status |
|---|---|---|---|---|---|
| Public registration | Lecturer, Instructor, Student | Implemented | Implemented | Implemented | Ready for live test |
| Registration approval/rejection | Administrator | Implemented | Implemented | Implemented | Partially automated |
| Login, logout, session restore | All | Implemented | Implemented | Implemented | Ready for live test |
| Role dashboards | All | Implemented | Implemented | Implemented | Ready for live test |
| Venue search and filtering | Lecturer, Instructor, Student, Administrator | Implemented | Implemented | Implemented | Automated / needs execution |
| Venue availability | All authorized roles | Implemented | Implemented | Implemented | Critical live test |
| Venue CRUD and soft deletion | Administrator | Implemented | Implemented | Implemented | Partially automated |
| Venue maintenance | Administrator | Implemented | Implemented | Implemented | Needs live test |
| Flexible booking creation | Lecturer, Instructor, Student, Administrator | Implemented | Implemented | Implemented | Critical live test |
| Lecturer/Instructor direct confirmation | Lecturer, Instructor | Implemented | Implemented | Implemented | Automated / needs execution |
| Student pending booking workflow | Student, Administrator | Implemented | Implemented | Implemented | Automated / needs execution |
| Booking approval/rejection | Administrator | Implemented | Implemented | Implemented | Automated / needs execution |
| Booking cancellation | Owner, Administrator | Implemented | Implemented | Implemented | Automated / needs execution |
| Booking modification | Owner, Administrator | Implemented | Implemented | Implemented | Needs live test |
| Recurring bookings | Booking roles, Administrator | Implemented | Implemented | Implemented | Automated / needs execution |
| Booking reminders | All booking owners | Limited UI | Implemented | Implemented | Needs live test |
| Waitlist | Booking roles | Implemented | Implemented | Implemented | Needs live test |
| Venue-change requests | Lecturer, Instructor, Student, Administrator | Implemented | Implemented | Implemented | Needs live test |
| Lecturer exchanges | Lecturer | Legacy UI/API retained | Implemented | Implemented | UI coverage incomplete |
| Timetable/calendar | All authorized roles | Implemented | Implemented | Implemented | Privacy needs live test |
| Check-in | Booking owner, Administrator | Implemented | Implemented | Implemented | Needs live test |
| Notifications | All | Implemented | Implemented | Implemented | Needs live test |
| Reports and analytics | Administrator | Implemented | Implemented | Implemented | Needs live test |
| Administrative settings | Administrator | Implemented | Implemented | Implemented | Needs live test |
| Priority/category management | Administrator | Implemented | Implemented | Implemented | Needs live test |
| User management/deactivation | Administrator | Implemented | Implemented | Implemented | Needs live test |
| Audit log | Administrator | Implemented | Implemented | Implemented | Needs live test |

## Advanced/legacy implementation notes

- The source contains a legacy slot/request/exchange API, while the redesigned frontend primarily uses the flexible booking API.
- The database migration includes `LAB_ASSISTANT`, an existing application role outside the user's requested official four-role scope.

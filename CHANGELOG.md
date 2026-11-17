# Changelog

## 1.1.0

- Add round-robin leagues for 2–32 entrants with rotating schedules and rest rounds for odd fields.
- Record draws and calculate standings using points, score difference and score for. Preserve shared ranks and shared first place.
- Add the authenticated standings endpoint and expose format, standings and leaders in tournament details.
- Add format selection, fixture filters, a ready-match picker, live standings and CSV downloads to the dashboard.
- Escape spreadsheet-formula prefixes in exported names. Render HTML-like names as text.
- Migrate existing databases transactionally; existing tournaments retain their IDs, scores and single-elimination format.
- Add schedule, scoring, migration, CSV, API and Chromium browser regression tests, including mobile coverage.

### Upgrade

Stop and back up the service before upgrading. The schema migration runs automatically on startup. Restore the pre-upgrade backup to roll back; older releases do not understand round-robin leagues. Existing API callers that omit format still create single-elimination tournaments.

## 1.0.1

- Reject coercible tournament, entrant and match IDs such as booleans and arrays.
- Require the application/json media type while accepting case-insensitive names and charset parameters.
- Add regression tests for ID validation and JSON media types.
- Expand `npm run check` to syntax-check source, browser code, tests and scripts.

### Upgrade

Restart the service after updating. Existing SQLite data is preserved. Clients must send canonical IDs and use Content-Type: application/json.

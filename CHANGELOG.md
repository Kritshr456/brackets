# Changelog

## 1.0.1

- Reject coercible tournament, entrant and match IDs such as booleans and arrays.
- Require the application/json media type while accepting case-insensitive names and charset parameters.
- Add regression tests for ID validation and JSON media types.
- Expand `npm run check` to syntax-check source, browser code, tests and scripts.

### Upgrade

Restart the service after updating. Existing SQLite data is preserved. Clients must send canonical IDs and use Content-Type: application/json.

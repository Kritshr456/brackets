# brackets

An organizer's tournament desk for single-elimination cups and round-robin leagues.
Register entrants, set seeds, report scores and follow the bracket or standings.
Everything is stored in SQLite; there is no hosted database to configure.

## Run

Use Node.js 22.13+; Node 24 is recommended.

```sh
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Set API_TOKEN in .env to the generated value
node --env-file=.env src/index.js
```

Open `http://127.0.0.1:3000`, enter the token and choose a tournament format.
Register at least two entrants, check their seeds, and start the tournament.
Select a ready match to report a result; the page labels both sides with their
names. Round and status filters help narrow down a large fixture list.

Registration and seeds lock at start. Results are final. Cancellation keeps the
saved fixtures and scores but prevents further results and awards no champion.
The token grants full organizer access, so keep it private. Individual player
accounts, public spectator links and self-service registration are not provided.

## Single elimination

Supports 2–128 entrants. Bracket size rounds up to the next power of two. Winners
and byes advance automatically; downstream matches wait for both feeders.
Tied scores are rejected because every played match needs a winner.

Registration assigns the lowest free seed unless one is specified. Seeds must be
unique and within capacity. Entrants are placed by relative seed rank; for eight
slots the placement is 1, 8, 4, 5, 2, 7, 3, 6. Higher seeds receive available
first-round byes. Gaps in seed numbers do not reserve empty slots. A bye is not a
played match. To exchange occupied seeds, use a free seed temporarily or withdraw
and re-register before starting.

## Round robin

Supports 2–32 entrants, up to 496 fixtures. Everyone plays everyone else exactly
once. The rotating schedule has n−1 rounds for even fields and n rounds for odd
fields. An odd field gives each entrant one rest round; rests are not stored as
played matches. No entrant appears twice within the same round.

Fixtures are grouped into rounds for organization, but may be reported in any
order. All fixtures are ready once the league starts. There is no clock-based
scheduling or automatic booking. Seeds determine schedule order, not points.

The standings update after every saved score:

- Win: 3 points. Draw: 1 point each. Loss: 0 points.
- Sort by points, then score difference, then total score for.
- If all three are equal, entrants share a rank (for example 1, 1, 3).
- Seed and ID only stabilize the display order of tied rows; they do not break
  competitive ties. No head-to-head tie-break or playoff is applied.

The league completes after every fixture has a result. A unique first-place
entrant becomes `champion`. If first place is shared, `champion` is null and
`leaders` contains the tied entrants' IDs. The dashboard explicitly shows shared
first place. Before completion, `leaders` is just the current leading group.

**Download CSV** exports the current standings, including played games, wins,
draws, losses, scores and points. Names are quoted and spreadsheet-formula prefixes
are escaped. Export does not expose the organizer token. The page is refreshed
after its own changes; use **Connect / refresh** to load another organizer's changes.

## JSON API

All `/api` calls require `Authorization: Bearer <API_TOKEN>`. POST bodies must use
`Content-Type: application/json`. IDs must be positive safe integers or canonical
decimal strings, for example `1` or `"1"`. Booleans, arrays, whitespace and
exponent-form strings are rejected. Scores must be integer numbers from 0 to 100000.

| Method | Path | Body / response |
| --- | --- | --- |
| GET | /api/tournaments | Latest 100 tournaments, including their format |
| POST | /api/tournaments | `{ "name": "League", "capacity": 16, "format": "round_robin" }` |
| GET | /api/tournaments/:id | Tournament, entrants, matches, standings and leaders |
| GET | /api/tournaments/:id/standings | Current round-robin standings; empty array for single elimination |
| POST | /api/tournaments/:id/register | `{ "name": "Entrant", "seed": 1 }`; seed optional |
| POST | /api/tournaments/:id/seed | `{ "entrantId": 1, "seed": 2 }` |
| POST | /api/tournaments/:id/withdraw | `{ "entrantId": 1 }` |
| POST | /api/tournaments/:id/start | `{}` |
| POST | /api/tournaments/:id/result | `{ "matchId": 1, "scoreA": 2, "scoreB": 0 }` |
| POST | /api/tournaments/:id/cancel | `{}` |
| GET | /health | Unauthenticated health check |

`format` accepts `single_elimination` (default) or `round_robin`. Capacity defaults
to 32 and cannot exceed the selected format's limit. Omitting format preserves
the behavior of the original API. Format is immutable once the tournament exists.
All score writes, progression and tournament completion use SQLite transactions.
Invalid or duplicate results do not partially update scores or standings.

Each standings row includes `entrant_id`, `name`, `seed`, `rank`, `played`, `wins`,
`draws`, `losses`, `score_for`, `score_against`, `score_difference` and `points`.
A completed round-robin draw is a match with `status: "completed"` and
`winner: null`; a pending fixture also has a null winner but `status: "ready"`.

## Deployment

HOST defaults to `127.0.0.1`, PORT to 3000, DATABASE_PATH to `./data/app.sqlite`.
Run one process per database. Use HTTPS via a reverse proxy for remote access.
Restrict access to the database and backups. The page keeps the token only in
memory; reloading requires entering it again. Names are rendered as text.

There are no cookies or CORS grants. Requests have a 16 KB body limit, security
headers and a per-address rate limit. Behind a proxy, its address is used because
forwarded headers are not trusted. Stop before copying SQLite files, or use
SQLite backup tooling. Automatic archival/deletion and result correction are not
included. Double elimination, divisions and team rosters are also out of scope.

## Checks

```sh
npm test
npm run check
npm audit
npx playwright install chromium
npm run test:browser
```

The Node test suite covers complete knockout tournaments, round-robin schedules
for every size 2–32, hand-checked standings and ties, out-of-order results,
cancellation, API authorization and validation, persistence, CSV escaping and
upgrading an existing database. Syntax checks include source, browser code,
tests and scripts.

Browser tests drive the real UI through the HTTP API into an isolated temporary
SQLite database. They cover registration-to-completion for both formats,
shared leaders, filtering, CSV download, reload persistence, authentication errors,
HTML-like names and a phone viewport. The temporary server binds to loopback and
uses a public test-only token; it never opens your configured production database.
CI runs Node tests on Node 22/24 and the Chromium browser flow on Node 24.

To use an existing Chromium installation instead of downloading one:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

Browser test artifacts are ignored by Git. `BROWSER_TEST_PORT` defaults to 4179;
change it if occupied. These browser-test settings do not affect the app's PORT.

## Updating from 1.0.x

1. Stop the service and back up the database and any WAL files.
2. Run `git pull --ff-only` and `npm ci`.
3. Restart. The first database open applies a transactional schema migration.
   Existing tournaments become `single_elimination`; IDs, scores, seeds and
   registration/running/completed states are preserved.

No manual SQL or database reset is required. After creating round-robin leagues,
do not point an older release at the same database: restore the pre-upgrade backup
to roll back. See [CHANGELOG.md](CHANGELOG.md) for release changes.

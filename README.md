# brackets

An organizer's single-elimination tournament manager. Register entrants, adjust
seeds, start the bracket and report scores. Winners and byes advance automatically.
The browser shows each round and the eventual champion. SQLite stores everything.

## Run

Use Node.js 22.13+; Node 24 is recommended.

```sh
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Set API_TOKEN in .env to that generated value
node --env-file=.env src/index.js
```

Open `http://127.0.0.1:3000`, enter the token and create a tournament. Register
at least two entrants, check their seeds, and click **Start tournament**. The
bracket locks registration and seeds. Report unequal scores for a ready match;
its winner advances once the other feeder match is resolved. Results are final.
Cancel stops a tournament without awarding a champion.

## Seeding and progression

Tournaments support 2–128 entrants. Registration assigns the lowest free seed
unless you specify one. Seed values must be unique and within capacity. At start,
entrants are sorted by seed, then placed by relative rank in a standard bracket:
for eight slots the order is 1, 8, 4, 5, 2, 7, 3, 6. Gaps in seed numbers do not
reserve empty slots. To exchange two occupied seeds, use a free seed temporarily,
or withdraw and re-register before starting.

Bracket size rounds up to the next power of two. Higher seeds get the available
first-round byes. A bye is not a played match. Downstream matches wait for both
feeders; the tournament completes when the final has a winner. Progression and
score writes share a SQLite transaction. Duplicate results, ties, scores outside
0–100000, and results for a waiting match are rejected without changing the bracket.

There is no double elimination, group stage, team roster or third-place match in
v1. A registered entrant can represent a player or a team by display name. This is
an organizer tool; the bearer token grants full control. Self-service registration,
public spectator links and result disputes are not included.

## JSON API

All `/api` calls need `Authorization: Bearer <API_TOKEN>`. POST bodies must use
`Content-Type: application/json`. IDs must be positive safe integers or canonical decimal strings (for example `1` or `"1"`). Booleans, arrays, whitespace and exponent-form strings are rejected.

| Method | Path | Body / response |
| --- | --- | --- |
| GET | /api/tournaments | Latest 100 tournaments |
| POST | /api/tournaments | `{ "name": "Cup", "capacity": 32 }` |
| GET | /api/tournaments/:id | Tournament, entrants, all matches |
| POST | /api/tournaments/:id/register | `{ "name": "Entrant", "seed": 1 }`; seed optional |
| POST | /api/tournaments/:id/seed | `{ "entrantId": 1, "seed": 2 }` |
| POST | /api/tournaments/:id/withdraw | `{ "entrantId": 1 }` |
| POST | /api/tournaments/:id/start | `{}` |
| POST | /api/tournaments/:id/result | `{ "matchId": 1, "scoreA": 2, "scoreB": 0 }` |
| POST | /api/tournaments/:id/cancel | `{}` |
| GET | /health | Unauthenticated health check |

## Deployment and tests

HOST defaults to `127.0.0.1`, PORT to 3000, DATABASE_PATH to `./data/app.sqlite`.
Run one process per database. Use HTTPS via a reverse proxy for remote access,
keep the token private and restrict access to the database and backups. The page
keeps the token only in memory. There are no cookies or CORS grants. Requests
have a 16 KB body limit and per-address rate limiting; behind a proxy, its address
is used because forwarded headers are not trusted. Stop before copying SQLite
files, or use SQLite backup tooling. Automatic archival/deletion is not included.

```sh
npm test
npm run check
npm audit --omit=dev
```

Tests simulate complete tournaments for every size 2–33 and for 128 entrants,
checking the champion and exactly n−1 played matches. They also cover seed
validation, capacity, withdrawals, duplicate and premature results, cancellation,
restart persistence and the HTTP create-to-champion flow.

HTTP security tests also exercise bearer authentication, JSON and content-type
validation, oversized request rejection, security headers and rate limits.

## Updating

Run `git pull --ff-only` and `npm ci`, then restart the service.
See [CHANGELOG.md](CHANGELOG.md) for the latest behavior changes. This update
does not require a database migration.

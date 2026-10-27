# Audit: Pi -> visor data flow (2026-10-27, Rev553)

Trigger: Carlos, remote over Tailscale + boat 4G, saw "Red intermitente"
constantly and Freeboard would not load. Cause of that episode: Signal K
caps WebSockets at 30 per client IP (`DEFAULT_MAX_WS_CONNECTIONS_PER_IP`,
env `MAX_WS_CONNECTIONS_PER_IP`); the laptop held 32, every new WS got
HTTP 429. Follow-up question: can we shrink what the Pi sends to the UI?

## Measurement

Method: on the Pi, a Node WS client replays the visor's two
subscriptions (`subscribeAll()` in `public/app.js`) for 60 s, after
skipping the 5 s initial snapshot. Boat moored, pilot standby.

| Group | KB/min | Share |
|---|---:|---:|
| `steering.autopilot.pypilot.*` (34 paths) | 397 | 57 % |
| wind (5 paths) | 125 | 18 % |
| nav/other (position, SOG, COG, heading, attitude) | 91 | 13 % |
| performance.* | 51 | 7 % |
| depth (3 paths) | 46 | 7 % |
| **Total** | **693** | **11.5 KB/s = ~41 MB/h per open visor tab** |

- 3,051 of 3,605 values received (85 %) were identical to the previous
  value of the same path.
- Signal K splits a multi-value update into one delta per path for a
  subscriber, each ~200 B (context, `$source`, timestamp). Per-path
  rate, not payload, is what costs.
- HTTP polling (`/status`, `/values`, `*/status`, ~12 endpoints, 1-15 s)
  is small next to the WS stream; not measured in bytes (needs auth).

## Findings

**F1 - plugin republishes 34 KPI paths every second, changed or not.**
`kpiPublishTimer` (src/index.ts, 1000 ms) calls `publishKpiPaths`,
`publishServoHealthPaths`, `publishRollFfPaths`,
`publishTackCatchupPaths`. Moored, nearly all of them are constant.
This also loads the SK server and every other client (KIP, Freeboard,
mareas, history writers), not only our visor.

**F2 - wind / depth / attitude arrive at ~2 Hz.** The subscription asks
`period: 1000` but with `policy: "instant", minPeriod: 500`, so a 2 Hz
source comes through at 2 Hz. The tiles redraw at 1 Hz anyway.

**F3 - hidden tabs keep their WS open.** A visor tab in the background
keeps streaming 41 MB/h and holds one of the 30 per-IP slots.

## Proposal (one commit each)

1. **F1 - publish on change + 30 s heartbeat** (backend, one helper
   used by the four publishers). Numbers compared with a small
   tolerance. Expected: pypilot.* from 397 to ~15 KB/min moored; at sea
   less saving (session counters tick every second while engaged).
   Total ~693 -> ~310 KB/min moored.
2. **F2 - `minPeriod: 1000`** on the non-critical subscription.
   Wind/depth/attitude halved: another ~-130 KB/min. The critical
   pilot subscription (`policy: "instant"`, no minPeriod) is untouched.
3. **F3 - close the WS after 2 min hidden, reopen on visible** (resync
   via the normal snapshot on subscribe). Not while the pilot is
   engaged, so voice alarms in a background tab keep working while
   steering. Hidden tabs then cost 0 and free their 30-slot place.

With 1 + 2: ~693 -> ~180 KB/min moored (about -75 %), ~11 MB/h per tab.

## Result (deployed Rev554-556, same method, moored)

| Group | Before KB/min | After KB/min |
|---|---:|---:|
| `steering.autopilot.pypilot.*` | 397 | 27 |
| wind | 125 | 67 |
| nav/other | 91 | 67 |
| performance.* | 51 | 50 |
| depth | 46 | 31 |
| **Total** | **693 (41 MB/h)** | **237 (14 MB/h)** |

-66 % per visible tab; a tab hidden for 2 min (pilot not engaged)
now costs 0. Remaining largest item: `performance.*` from the polar
plugin (~13 paths at its own rate) - left as is.

## Not proposed

- Dropping the `steering.autopilot.pypilot.*` wildcard for an explicit
  list: larger change, the wildcard feeds the raw-path picker, and after
  F1 the subtree is cheap.
- Raising `MAX_WS_CONNECTIONS_PER_IP`: separate operational choice on
  the Pi, pending Carlos.
- mareas visor: not measured in this audit.

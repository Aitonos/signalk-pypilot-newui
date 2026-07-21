# signalk-pypilot-newui

**PyPilot New-UI + SK Paths** — modern, touch-first control panel for the
pypilot open-source autopilot, plus every pypilot value exposed as a first-class
Signal K path so tools like [KIP](https://kip.signalk.org) can build custom
gauges out of the box.

## Why a new plugin

The official `pypilot-autopilot-provider` (Panaaj) exposes only the
Autopilot API core (state / mode / target / engaged / tack). Everything else
that pypilot publishes — **gains, servo voltage, motor temperature, rudder
calibration, tack detail, warnings, runtime, version** — is not on Signal K.

This plugin fills that gap:

- Opens its own WebSocket to `pypilot_web` (default port 80 on TinyPilot,
  8000 on classic pypilot).
- Publishes every discovered value under `steering.autopilot.pypilot.*`
  with proper units and metadata.
- Ships a mobile-first webapp for daily use on phone / tablet /
  chart-plotter, dark theme, big touch targets.
- Coexists with the official provider — WilhelmSK and other Autopilot API
  clients keep working unchanged.

## Installation

1. Signal K Server → App Store → search **PyPilot New-UI**.
2. Server → Plugin Config → **PyPilot New-UI + SK Paths**.
3. Enter the pypilot_web host (IP or hostname) and port. On TinyPilot the
   default is port `80`. On a classic pypilot install it is `8000`.
4. **Scan LAN** button auto-detects hosts running pypilot_web on port 80 /
   8000 of your subnet if you don't know the IP.
5. Enable the plugin.

## Companion plugin

Install [`pypilot-autopilot-provider`](https://www.npmjs.com/package/pypilot-autopilot-provider)
too if you want WilhelmSK / freeboard / any Autopilot API client to talk to
the pilot with the canonical `steering.autopilot.state / mode / target`
paths. Both plugins run together without conflict.

## Webapp URL

`http://<sk-host>:3000/signalk-pypilot-newui/`

## Published paths (defaults, all switchable)

| Signal K path | Units | Source pypilot key |
|---|---|---|
| `steering.autopilot.pypilot.gains.<pilot>.P` | dimensionless | `ap.pilots.<pilot>.P` |
| `steering.autopilot.pypilot.gains.<pilot>.I` | dimensionless | `ap.pilots.<pilot>.I` |
| `steering.autopilot.pypilot.gains.<pilot>.D` | dimensionless | `ap.pilots.<pilot>.D` |
| `steering.autopilot.pypilot.gains.<pilot>.DD` | dimensionless | `ap.pilots.<pilot>.DD` |
| `steering.autopilot.pypilot.gains.<pilot>.PR` | dimensionless | `ap.pilots.<pilot>.PR` |
| `steering.autopilot.pypilot.gains.<pilot>.FF` | dimensionless | `ap.pilots.<pilot>.FF` |
| `steering.autopilot.pypilot.pilot` | string | `ap.pilot` |
| `steering.autopilot.pypilot.profile` | string | `profile` |
| `steering.autopilot.pypilot.profiles` | list | `profiles` |
| `steering.autopilot.pypilot.servo.voltage` | V | `servo.voltage` |
| `steering.autopilot.pypilot.servo.current` | A | `servo.current` |
| `steering.autopilot.pypilot.servo.controllerTemperature` | K | `servo.controller_temp` |
| `steering.autopilot.pypilot.servo.motorTemperature` | K | `servo.motor_temp` |
| `steering.autopilot.pypilot.servo.flags` | string | `servo.flags` |
| `steering.autopilot.pypilot.servo.ampHours` | Ah | `servo.amp_hours` |
| `steering.autopilot.pypilot.servo.engaged` | bool | `servo.engaged` |
| `steering.autopilot.pypilot.calibration.imuHeadingOffset` | rad | `imu.heading_offset` |
| `steering.autopilot.pypilot.calibration.rudderRange` | rad | `rudder.range` |
| `steering.autopilot.pypilot.calibration.rudderOffset` | dimensionless | `rudder.offset` |
| `steering.autopilot.pypilot.calibration.rudderScale` | dimensionless | `rudder.scale` |
| `steering.autopilot.pypilot.calibration.rudderNonlinearity` | dimensionless | `rudder.nonlinearity` |
| `steering.autopilot.pypilot.tack.state` | string | `ap.tack.state` |
| `steering.autopilot.pypilot.tack.timeout` | s | `ap.tack.timeout` |
| `steering.autopilot.pypilot.tack.direction` | string | `ap.tack.direction` |
| `steering.autopilot.pypilot.errors.imu` | string | `imu.error` |
| `steering.autopilot.pypilot.warnings.imu` | string | `imu.warning` |
| `steering.autopilot.pypilot.errors.controller` | string | `servo.controller` |
| `steering.autopilot.pypilot.runtime` | s | `ap.runtime` |
| `steering.autopilot.pypilot.version` | string | `ap.version` |

Every additional pypilot value discovered at runtime is auto-mapped under
`steering.autopilot.pypilot.<sanitized_name>` if the config option
`publishUnmapped` is on.

## HTTP endpoints (plugin router)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/plugins/signalk-pypilot-newui/scan` | Scan LAN for pypilot_web hosts |
| `GET` | `/plugins/signalk-pypilot-newui/status` | Connection + last-seen catalog summary |
| `GET` | `/plugins/signalk-pypilot-newui/paths` | Live list of published SK paths with GET / PUT URLs and units |
| `PUT` | `/plugins/signalk-pypilot-newui/raw` | Send raw `name=value` to pypilot (protected by `allowWrites`) |

## Safety

- `allowDirectServo` default **off** — the direct `servo.command` back-door
  used by pypilot's UI for manual steering is not exposed until you turn it
  on in the plugin config.
- All PUT handlers validate ranges from the pypilot catalog before sending.
- On plugin stop, the socket closes cleanly.

## Development

```
git clone https://github.com/Aitonos/signalk-pypilot-newui
cd signalk-pypilot-newui
npm install
npm run build
```

Windows laptop → Raspberry Pi deploy: `.\deploy.ps1 -Restart`.

## License

Apache-2.0, Aitonos.

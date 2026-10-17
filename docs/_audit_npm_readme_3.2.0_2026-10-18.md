# Audit — página NPM de signalk-pypilot-newui 3.2.0 (2026-10-18)

Fuente auditada: lo PUBLICADO (`npm view readme`, `npm pack` 3.2.0,
`package.json` publicado), contrastado con el código (Rev497), con NPM
y con los README de los plugins citados.

## Graves (falso o peligroso)

| # | Dónde | Error | Evidencia |
|---|---|---|---|
| G1 | README § License | Dice **Apache-2.0**; el paquete es **AGPL-3.0-or-later** | `LICENSE` = GNU AGPL v3; `package.json` "license": "AGPL-3.0-or-later" |
| G2 | README § Remote restart | "refuses any command not in the whitelist, so a leaked JWT cannot be used to run arbitrary shell" | `POST /ssh-exec` ejecuta **cualquier** comando (solo exige `allowWrites`); está en la propia tabla de endpoints |
| G3 | README § Chart provider | Enlaza **`signalk-chart-tiler`**, que **no existe** en NPM | `npm view signalk-chart-tiler` → E404 |
| G4 | Screenshots 05/06 | Capturas de móvil con barra de estado (VPN, WhatsApp) y la **IP Tailscale privada** de la Pi en la URL | `public/screenshots/05-race-timer.jpg`, `06-info.jpg` |
| G5 | Repo GitHub | IP Tailscale privada en `deploy.ps1`, `docs/QA_SEA_TRIAL.md`, `docs/_bootstrap_next_chat.md` (y mi audit GPU, aún sin push) | `git grep <IP>` — resuelto: host movido a `deploy.local.ps1` (gitignored)\| xargs grep 100.127.222.27` |

## Incorrecto / desactualizado

| # | Dónde | Dice | Realidad |
|---|---|---|---|
| E1 | package.json `screenshots` | `05-race-timer.jpg` → "Chart - history window"; `06-info.jpg` → "Tack history" | Nombres de fichero no corresponden al contenido (05 = gráfica, 06 = historial de viradas) |
| E2 | README #18 | "Alarm engine — **9 rules**" y lista **10** | `src/alarms.ts` tiene **14** reglas (faltan servo-current-trim, rudder-range-trim, attitude-heel-extreme, attitude-pitch-extreme) |
| E3 | README #29 vs "What it does" vs "Working alongside" | "**~110** Signal K paths" / "**~60** Signal K paths" / "~60 additional" | Tres cifras distintas en el mismo README |
| E4 | README #3 | Racha fantasma "for **10 s**", siempre `A` | `GUST_GHOST_FADE_MS = 15_000` (Rev177); `T` en modo viento real |
| E5 | README #2 / What it does | "**cyan** target diamond" | Desde Rev185 se tiñe por modo (rojo compás, ámbar aparente, teal real) |
| E6 | README What it does | "**Paths & API** tab" | Quitado de la barra en Rev96; ahora es un bloque dentro de Setup/Info |
| E7 | README Chart provider | `@signalk/charts-plugin` sirve "local MBTiles / **S57** / XYZ … **OpenCPN-style**" | Su README: local **MBTiles + TMS**; S-57 solo como metadatos de fuentes externas. Nada "OpenCPN-style" |
| E8 | README | `See docs/_feature_ais_overlay.md` (×2) | `docs/` no va en el tarball → enlace muerto en NPM |
| E9 | README tabla endpoints | 34 endpoints documentados | El router tiene **87** rutas (trips, ais, watch, supervisor, log-capture, maneuver-trace, session-recorder, … sin documentar) |
| E10 | README arriba del todo | "Upgrading from 1.0.0 to 2.0.0" | Sección de hace 2 majors, en posición destacada en 3.2.0 |
| E11 | README Development | "Deploy … `.\deploy.ps1 -Restart`" | Script privado con IP/host de Tunatunes; no sirve a nadie más |
| E12 | README Acknowledgements | "Jean-Marc at Navitop" + enlace | Referencia comercial (regla dura `feedback_no_commercial_refs`) |
| E13 | Tarball | Incluye `dist/test/*.test.js` (17 ficheros) | Sobran en producción; no hay campo `files` en package.json |

## Correcto (verificado)

- Autores citados: signalk-collision-alerts y signalk-charts-provider-simple = dirkwa; pypilot-autopilot-provider = panaaj. Freeboard-SK OK.
- displayName mareas "AnchorWatch Pro: Smart Anchoring, AIS & Tides" OK.
- Auto-disengage 30° RMS / 90 % duty / 10 s OK (`src/index.ts:335-337`).
- Smart gust: D +20 % 20 s, Heavy 30 s OK.
- ACK AIS vía `/signalk/v2/api/notifications/<id>/acknowledge` OK.
- `absorbProvider` default false OK. Idiomas EN/ES/DE/FR OK.
- Todos los endpoints de la tabla existen en el router.

## Cambios locales pendientes de documentar en el próximo README

- Rev494: blancos AIS sobre el anillo (el README 3.2.0 describe la escala log de Rev472, correcta para 3.2.0 pero no para la próxima).
- Rev490-492: modo pi-browser.

## Propuesta

1. Corregir README (G1-G3, E2-E12) y `package.json` (E1, `files` sin tests).
2. Rehacer capturas 05/06 sin barra de estado ni IP (localhost).
3. Quitar la IP de los ficheros del repo (variable de entorno / parámetro en deploy.ps1).
4. Publicar solo con OK explícito de Carlos y SemVer confirmado.

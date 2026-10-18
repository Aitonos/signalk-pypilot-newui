# Bootstrap para el próximo chat — signalk-pypilot-newui

Última actualización: 2026-10-15 post 3.2.0.

## Qué pasa en este repo ahora mismo

- **Publicado en NPM**: `3.2.0` (Rev482). **Desplegado en el Pi5: Rev504**,
  pendiente de publicar como **3.3.0** (CHANGELOG ya escrito).
- **3.3.0 trae** (Rev483 → Rev503): ajustes del visor compartidos en
  backend (`src/visor-prefs.ts`, `/visor-prefs`: modo AIS, voz, puerto
  automático, racha fantasma, silenciados por MMSI); modo ligero en la
  pantalla de la Pi (`body.pi-browser`) + write-if-changed en el render;
  arreglo Firefox Pi (`src/firefox-fix.ts`, botón "Aplicar ahora" en
  Info); blancos AIS sobre el anillo; barcos amarrados con SOG efectiva
  0 (nav status o posición quieta 2 min / 30 m); velocidad de
  acercamiento corregida; banner de alarmas del piloto por encima de
  todo; curva de marea interactiva.
- Docs vivos de este ciclo: `docs/_audit_pi5_gpu_slow_2026-10-15.md`,
  `docs/_audit_per_device_prefs_2026-10-17.md`,
  `docs/_audit_npm_readme_3.2.0_2026-10-18.md`.
- `deploy.ps1` lee el host de `deploy.local.ps1` (gitignored).

## Pendiente inmediato

- **Publicar 3.3.0**: faltan capturas `public/screenshots/05-chart-history.jpg`
  y `06-tack-history.jpg` (Carlos), borrar las viejas `05-race-timer.jpg`
  / `06-info.jpg` (llevan IP), bump `package.json` 3.3.0 con OK explícito.
- **QA en barco Rev499**: tablet + móvil + portátil a la vez (modo AIS,
  silenciar un blanco, racha fantasma) — deben coincidir en ~5 s.
- **QA en barco Rev503**: barcos amarrados sin estela ni alarma; uno que
  se mueve de verdad sigue con estela.
- **Registro RSS de SK** en `/home/pi/sk-rss.log` hasta 2026-10-20 01:35
  (tras eso, leer tendencia y borrar `/home/pi/sk-rss-log.sh`).
- **Pulsación larga en la rosa → selector de webapps SK**
  (`/skServer/webapps`), diseño en `_feature_mareas_ihm_integration.md`.
- Issue #5 iOS: seguimos esperando a @eric-fitzsimon.

## Infra operativa

- **Pi5 (OpenPlotter V4, SK server)** — Tailscale (host en `deploy.local.ps1`, gitignored),
  user `pi`. Accesible por SSH sin password (clave `id_ed25519`).
- **Pi Zero (TinyPilot, pypilot core)** — `192.168.1.115`. **NO acepta
  SSH**. Caja negra. Datos solo via el stream SK o via la cache del
  plugin en el Pi5.
- **Base del barco**: Puerto Deportivo de **Moaña, Ría de Vigo** (NO
  Combarro, NO Ría de Pontevedra — error mío que me corrigió Carlos).
- **URL del visor**: `http://localhost:3000/signalk-pypilot-newui/`.
- **Admin SK**: `http://localhost:3000/admin`.
- **Dev laptop**: Windows 11 + PowerShell + Git Bash. Deploy via
  `.\deploy.ps1 -Restart` (default).

## Reglas duras (NO negociables)

Leer PRIMERO cuando arranques el chat nuevo:

1. **REGLA Nº1 — Audit before fix**. Todo análisis que vaya a terminar
   en código vive primero como `docs/_audit_*.md` o `docs/_feature_*.md`
   en el repo. El chat se pierde, los MD quedan. Esto nos ha salvado
   del "palos de ciego" varias veces (ej. Rev452 → Rev463 fix bearing
   AIS). Memoria: [[feedback_always_use_md_files]],
   [[feedback_audit_before_fix]].
2. **NO publish NPM sin OK explícito**, no se hereda de la sesión
   anterior. Cada publish requiere "ok, publica" del usuario. Memoria:
   [[feedback_never_publish_without_explicit_ok]].
3. **NO añadir `Co-Authored-By: Claude`** en commits. El flujo CI
   OIDC es Trusted Publishing (tag push → CI publica). Memoria:
   [[feedback_no_coauthor_attribution]].
4. **Siempre `.\deploy.ps1 -Restart`** por defecto. Deploy automático
   tras batch de ediciones. Memoria: [[feedback_always_restart_deploy]].
5. **ASCII only en PowerShell scripts**. Check `$LASTEXITCODE`.
6. **Español al chatear con Carlos; inglés en código; ES/EN en UI**.
7. **Base = Moaña, no Combarro** (ya lo tenemos en memoria dedicada:
   [[tunatunes-home-port]]).
8. **Pi Zero es caja negra** — nada de SSH, nada de "veamos qué dice
   pypilot". Todo via el stream SK o via la cache del plugin.
9. **Verificar fecha reales** si Carlos dice "último día": a veces es
   un día antes de lo que dice. Mirar `trips/` y `nav-sessions/` para
   atribuir correctamente.
10. **No tocar config de otros plugins en el Pi5 sin OK** (el
    classifier bloquea algunas acciones; respetarlo).

## Qué está desplegado en 3.1.4 (Rev469)

### Safety (del sea trial 2026-10-12 que Carlos describió como "pasé miedo")

- **Rev465**: banner rojo bloqueante cuando `state.pypilotHealthy===false`
  + `pointer-events:none` sobre controles write-side + gate JS en
  `pluginRaw()`, `apEngage()`, `apDisengage()`, `apSetMode()`,
  `apSetTargetRad()`, `apTack()`. Cero stale commands si el pilot está
  inalcanzable.
- **Rev466**: `ws.addEventListener('close')` activa pypilot-offline
  inmediato (banner + gate) sin esperar al próximo `/status` poll.
  Gate también chequea `ws.readyState !== OPEN`.
- **Rev467**: audit backend documentado en
  [`docs/_audit_backend_reconnect_handler.md`](docs/_audit_backend_reconnect_handler.md).
  Conclusión: el backend es defensivo (gen counters + guards en `set()`
  antes de emit). El bug del 12 oct estaba 100% en el visor.
- **Rev468**: batch `/maneuver-trace/events` cada 2 s en vez de uno a
  uno. ~10× menos POSTs en navegación activa.

### AIS

- **Rev463**: fix root cause URN duplicado en MMSI. Ya no se duplica
  el prefijo `urn:mrn:imo:mmsi:` → cache REST funciona → hulls pintan
  en posición real con COG real + línea proyectada.
- **Rev464**: toggle "Auto-OFF al estar amarrado (SOG=0 durante 2 min)"
  en la overlay-card AIS → sailor puede desactivarlo para probar.

### iOS PWA (issue #5)

- **Rev469 (3.1.4)**: metas `apple-mobile-web-app-capable`, status-bar,
  title, touch-icon, theme-color, mobile-web-app-capable +
  `Cache-Control: no-cache` http-equiv para forzar re-fetch del shell
  en WebView standalone.

## Issues GH abiertos

- **#5** (nuestro) — iOS Add to Home Screen (Eric FitzSimon). Rev469
  shipped. Esperando feedback. Si no basta, Rev-B/C/D planeados en
  [`docs/_audit_ios_pwa_issue_5.md`](docs/_audit_ios_pwa_issue_5.md).

### Upstream

- `hkapanen/ais-forwarder#14` (nuestro) — DNS crash-loop. Respondido
  hoy con impacto real + fix mínimo + oferta PR. Esperando reacción.
- `dirkwa/signalk-collision-alerts#17` cerrado por maintainer.
- `dirkwa/signalk-collision-alerts#24` (nuestro) — moving-target
  filter proposal. Esperando reacción de @dirkwa.

## Trabajo pendiente

### Alta prioridad si pasa en el próximo sea trial

- **QA Rev469 en iOS real** cuando Eric responda al issue #5.
- **QA Rev465-Rev468 safety en agua** — probar que el banner aparece
  al perder red + que no se cuelan writes stale al reconectar.
- **QA Rev463 AIS en agua** con target real moviéndose.

### Baja prioridad / backlog

- **D (fuera de pypilot-newui)**: pausar plugins cloud
  (opentide/postgsail/windy/IHM-AISSTREAM) cuando net-health detecta
  slow. Requiere coordinación con `signalk-mareas-ihm`.
- **Rev-B iOS**: `visibilitychange` listener que al volver fuerza
  reconnect WS + refresh values.
- **Rev-C iOS**: detectar `navigator.standalone` + mostrar botón
  "Reset app data" en Info tab.
- **Rev-D iOS**: Service Worker proper.
- **PNG icon set** para `apple-touch-icon` (hoy es SVG, iOS puede
  fallback a screenshot).
- **README update** si dirkwa confirma preferencia de
  `signalk-charts-provider-simple` para chart provider.
- **Fix TypeError meta 'FG8274'** cosmético — sigue saliendo cada
  restart SK en journalctl. No afecta funcionalmente. B-A1 vigente.
- **Mitigación DNS crash upstream ais-forwarder** — hemos propuesto PR.

## Herramientas disponibles en el Pi5

- **Maneuver trace** — persistentemente activo. Carlos tiene memoria
  [[carlos_capture_tools_always_on]] que me recuerda que puedo bajar
  los traces sin preguntarle. Ruta:
  `~/.signalk/plugin-config-data/signalk-pypilot-newui/maneuver-trace/`.
- **Log capture** — activo también. Pizero logs en
  `~/.signalk/plugin-config-data/signalk-pypilot-newui/pizero-logs/`.
- **Nav sessions** — recorder activo en
  `~/.signalk/plugin-config-data/signalk-pypilot-newui/nav-sessions/`.
- **Trip summaries** —
  `~/.signalk/plugin-config-data/signalk-pypilot-newui/trips/`.
- **journalctl -u signalk** — con sudo. Rango por fechas.
- **REST `/signalk/v1/api/...`** y **plugin endpoints**
  `/plugins/signalk-pypilot-newui/...` — accesibles por curl desde el
  Pi5 (localhost).

## Comandos de uso frecuente

```bash
# Deploy local a Pi5
.\deploy.ps1 -Restart

# Ver estado reciente de un target AIS específico
ssh $piHost "curl -s 'http://localhost:3000/signalk/v1/api/vessels/urn:mrn:imo:mmsi:<MMSI>/navigation/position/value'"

# Ver notificaciones AIS activas
ssh $piHost "curl -s 'http://localhost:3000/signalk/v1/api/vessels/self/notifications/navigation/closestApproach'"

# Journal SK por rango
ssh $piHost "sudo journalctl -u signalk --since '2026-10-12 16:00' --until '2026-10-12 17:00' --no-pager | grep -iE 'pattern'"

# Count kind distribution de un trace
ssh $piHost "awk -F'\"' '{for(i=1;i<=NF;i++) if (\$i == \"kind\") seen[\$(i+2)]++} END {for (k in seen) print seen[k], k}' <path> | sort -rn"
```

## Prompt para pegar en el próximo chat

```
Vamos a seguir trabajando signalk-pypilot-newui (Carlos / Tunatunes).

Lee PRIMERO docs/_bootstrap_next_chat.md en el repo — ahí tienes
el estado actual, la infra, las reglas duras, los issues abiertos
y el trabajo pendiente.

En particular NO olvides:
- Audit before fix (regla Nº1). Todo análisis va a `docs/_audit_*.md`
  o `docs/_feature_*.md` ANTES de tocar código.
- Español al chatear, inglés en código, ES/EN en UI.
- Base del barco = Moaña, Ría de Vigo. NO Combarro.
- Pi Zero (192.168.1.115) es caja negra. Pi5 (Tailscale) sí
  acepta SSH.
- Deploy por defecto: `.\deploy.ps1 -Restart`.
- NO publish NPM sin OK explícito en ESTE chat (no se hereda del
  anterior).
- NO añadir `Co-Authored-By: Claude` en commits.

Si Carlos reporta un bug: audit en MD + diagnóstico claro + propuesta
de fix. Preguntar antes de tocar código. Si Carlos da "ok", proceder
y bump Rev + deploy + QA.

Si falta contexto, lee las memorias relevantes (MEMORY.md tiene el
índice completo).

Estamos esperando feedback de @eric-fitzsimon en issue #5 (iOS PWA);
hemos shippeado 3.1.4 = Rev469 con PWA basics como primer intento.
```

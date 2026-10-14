# Audit — Sea trial 2026-10-12 (safety: red inestable + "pypilot se vuelve loco")

Autor: Claude Opus 4.7
Fecha: 2026-10-14 (audit post-navegación)
Rev desplegada el día de la navegación: Rev463.

## Contexto Carlos

> "El último día falló muchísimo, slow network, network down, pypilot
> operativo todo el rato, y creo que es problema de nuestro plugin.
> Hay que ver cómo hacemos para que si se cuelga la webapp por
> conectividad web, el pypilot no se vuelva loco, porque el otro día
> llegué a pasar miedo."

El "último día" es el **12 de octubre** (no 13 como yo asumí en primera
vuelta — el trace de 13-14 corresponde al barco amarrado sin nav real).

Rutas de evidencia en el Pi5:
- `~/.signalk/plugin-config-data/signalk-pypilot-newui/maneuver-trace/trace-20261012-164309.jsonl` (9.9 MB, 16:43 → 21:13).
- `~/.signalk/plugin-config-data/signalk-pypilot-newui/trips/trip-20261012-164316-96765.summary.json`.
- `~/.signalk/plugin-config-data/signalk-pypilot-newui/pizero-logs/pizero-20261012.log` (16.8 MB, enorme).
- `journalctl -u signalk --since '2026-10-12 00:00' --until '2026-10-13 00:00'`.

## Datos del trip

| Campo | Valor |
|---|---|
| Duración | 2h 24min |
| Distancia | 9.9 NM |
| Heel máx | 21.8° (bastante escora) |
| Volt mín | 10.21 V (sag notable) |
| Tacks | 8 |
| Modo wind | 50% / true-wind 28% / compass 21% |
| AP engaged | 94.8% del tiempo |
| Rev plugin | Rev463 |

Trip "normal" por los números — no es que el barco se portase mal, es
que el usuario pasó miedo por falta de visibilidad.

## Lo que REALMENTE pasó

### 1. Red del Pi5 inestable todo el día

Múltiples `UND_ERR_CONNECT_TIMEOUT` a openplotter.cloud, sealink.cloud,
Internet en general. `[IHM-AISSTREAM]` ciclos continuos de "zombie WS"
→ reconnect backoff 50-67s.

### 2. 604 eventos reconnect/disconnect en pizero_web

El socket.io del plugin backend contra pypilot_web (Pi Zero) perdió y
recuperó conexión muchas veces el día 12. Mucho más que un día normal.

### 3. pypilot core reportado offline (16:24:29)

```
oct 12 16:24:29 signalk-pypilot-newui:[pypilot-newui] pypilot core reported offline
```

Nuestro plugin backend emite ese estado cuando lleva N segundos sin
heartbeat de pypilot_web. El autopilot físico seguía operativo (motor
girando con último target), pero el VISOR no veía nada.

### 4. Carlos reinició SK 3 veces manualmente

```
16:38:32  PUT /skServer/restart 200   (desde la UI de SK admin)
16:43:01  PUT /skServer/restart 200
21:13:56  PUT /skServer/restart 200
```

Más un `restart-pypilot` por el visor a las 16:27:54 (que tardó 9.9 s
en responder — anormal, red saturada). Cada restart deja al plugin
backend fuera 30-60 s, durante los cuales:
- Pypilot (Pi Zero) sigue girando el motor con el último target
  cacheado — está diseñado para eso. **Autónomo**.
- El visor pierde el stream SK → "slow network" / "network down".
- Al volver SK: nuevo plugin arranca, el visor del user se reconecta.

### 5. Lo que probablemente llenó la copa del miedo

Durante los gaps de 30-60 s el usuario no sabe en qué modo ni qué
target tiene pypilot, y pulsa botones del visor sin feedback. Al
reconectar:
- El plugin backend reconstruye su catálogo + lee valores actuales de
  pypilot_web — correcto.
- El visor **re-primea** sus caches de `state.values`, `state.mode`,
  `state.target`, etc. desde el stream SK — correcto.
- PERO: el visor pudo haber encolado writes (nudges, target changes,
  mode switches) durante el gap. Si esos writes **se encolaron** o si
  el usuario los disparó sin feedback, al volver la conexión se
  envían de golpe → pypilot recibe comandos antiguos o duplicados.

Carlos lo describe como "se vuelve loco": no es que pypilot core
fallase, sino que **recibe una ráfaga de órdenes stale** al volver la
red.

## Hallazgos técnicos a mitigar (NO tocados aún)

### A — Visor: no retransmitir cache stale al reconectar

Hoy en `connectSK()` cuando el WS se reabre, el visor vuelve a
suscribirse y recibe el estado actual, pero sus propios caches
(`state.pypilotValues`, `state.target`, `state.mode`) pueden tener
valores previos al gap. Riesgo: si el user pulsó un botón que
ejecuta `pluginRaw(path, cachedValue)`, se envía el valor viejo. No
hay evidencia directa en el trace pero el patrón es plausible.

Fix propuesto (sin implementar hasta tener OK):
- En `pluginRaw()`, antes de hacer el POST, comprobar si el WebSocket
  está en estado `OPEN`. Si no, encolar hasta reconnect; al reconectar
  **descartar la cola** y pedir al user confirmar.
- Alternativa menos agresiva: timestamp cada comando emitido; si
  el POST tarda > 5 s en recibir respuesta, abortar en vez de
  reintentar.

### B — Visor: watchdog ya existente (Rev452) pero cuenta solo tacks

El `PYPILOT_TACK_SILENCE_MS = 40 s` solo gatea el tack-countdown. No
hay un watchdog análogo para "pypilot catalog silencioso" > N s que
congele globalmente los writes del visor. Si durante un gap de red el
usuario pulsa nudges, el visor los acepta y los envía al volver.

### C — Plugin backend: NO retransmitir el último target al pypilot al reconectar

Audit del `pypilot-client.ts`: cuando socket.io reconecta tras un gap,
el plugin re-registra suscripciones + solicita el estado. ¿Reenvía
algún comando write que estuviera pendiente? Hay que leer el código
del reconnect handler para confirmar.

### D — Infra: por qué la red se cayó tanto

Fuera del scope del plugin pero crítico:
- 4G del Pi5 saturado.
- IHM-AISSTREAM (del otro plugin `signalk-mareas-ihm`) está haciendo
  reconnect loops → chupando ancho de banda que necesita pypilot_web.
- `signalk-opentide`, `signalk-postgsail`, `signalk-windy-apiv2` todos
  intentando outbound. Puede ser bueno **pausar los plugins "cloud"
  cuando la red va mal** en vez de dejarlos chupando CPU + ancho de
  banda intentando outbound.

### E — Visor: reducir ancho de banda interno

En el log del día veo centenares de POST /maneuver-trace/event por
minuto. En red mala, esto satura. Dos opciones:
- Encolar + batch cada 2 s en vez de enviar uno a uno.
- Desactivar maneuver-trace cuando la red detecta slow (banner "Slow
  network" ya existe).

## Qué NO voy a hacer sin OK

Nada. Este MD recoge el audit limpio. Carlos elige por dónde:

1. **A + B** (visor safe-reconnect) — fix más directo del síntoma
   "pypilot se vuelve loco al volver la red". Scope mediano.
2. **C** (audit backend reconnect handler) — asegura que el plugin
   no sea el que reenvía comandos stale. Scope pequeño.
3. **D** (infra: pausar plugins cloud en slow network) — fuera de
   nuestro plugin, podríamos añadir un auto-pause coordinated.
4. **E** (reducir maneuver-trace network traffic) — mitigación
   parcial pero útil en red mala.

Propuesta mía (sin implementar aún): atacar en el orden **B → A → C**
porque:
- B introduce un watchdog global del tipo "pypilot_catalog_silent >
  60 s → bloquea pluginRaw writes y muestra banner rojo bloqueante en
  el visor". El user ve claramente "no puedo mandar nada", no pasa
  miedo pulsando botones sin feedback.
- A limpia la cola de writes pendientes al reconectar.
- C audita el backend reconnect sin tocar código, solo verificar.

Pendiente de confirmación con Carlos.

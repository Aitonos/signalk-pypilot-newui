# Audit — backend reconnect handler (Rev467 / Carlos safety plan)

Autor: Claude Opus 4.7
Fecha: 2026-10-14
Scope: `src/pypilot-client.ts` + `src/autopilot-provider.ts` — ¿reenviamos
comandos stale al pypilot cuando reconectamos tras un gap de red?

## Veredicto

**NO**. El backend es defensivo en varias capas. El bug del 2026-10-12
estaba en el visor (ya cerrado por Rev465/466). El backend no re-emite
ningún write encolado durante la desconexión.

## Capas de defensa en `pypilotClient.set()`

Archivo: `src/pypilot-client.ts:335-375`.

Un write al pypilot (`client.set(name, value)`) debe pasar **4 gates**
antes de llegar al socket:

1. `!this.allowWrites` → skip con log warn. El plugin config puede
   deshabilitar writes globalmente (Rev271 audit R05).
2. `this.coreOffline` → skip con log warn. Sticky: solo se limpia
   cuando llega un catalog o un `pypilot` dict por la vía normal
   (Rev271 R03). Un `pong` del socket NO basta para considerar al core
   online.
3. `!this.socket || !this.socket.connected` → skip con log warn.
4. `Date.now() - this.lastPongMs > 5000` → skip con log warn (zombie
   socket, Rev257). socket.io puede mantener `.connected === true`
   durante ~5-10 s tras muerte del peer; el last-pong es un criterio
   más estricto.

**Zero writes se encolan en el buffer socket.io**: `set()` rechaza
antes del `emit()`. Esto es importante: por defecto socket.io encola
`emit()` lanzados durante disconnect y los **envía al reconnect**, lo
que SÍ causaría ráfaga stale. Al rechazar antes, no hay nada en la
cola.

## Reconnect handler de `pypilotClient`

Archivo: `src/pypilot-client.ts:171-193`.

Al recibir evento `connect` tras reconectar:
- Setea `lastPongMs = Date.now()` para dar grace de 5 s al zombie-check.
- Emite el evento `connect` propio (consumido por `index.ts` para
  limpiar flags internos del plugin).
- Lanza un ping inmediato en vez de esperar al interval tick (Rev277).
- **Re-aplica los watches** (nuestros `subscribe` al pypilot_web)
  para que la suscripción sobreviva al drop.
- Arranca el `startPing` interval.

**NO reenvía writes**. No hay cola de pending writes. Las re-suscripciones
sí se repiten, pero son `subscribe` idempotentes al estado del core, no
mutations.

## Generation counters en `autopilot-provider.ts`

Archivo: `src/autopilot-provider.ts:111-130`.

Para proteger contra **retries con intent stale**:
- `engageGen`, `targetGen`, `modeGen` → se incrementan en cada
  `setEnabled` / `setTarget` / `setMode` / `adjustTarget` nueva.
- Los retry loops asíncronos consultan el gen que capturaron al
  arrancar. Si al reintentar ven un gen mayor → **abort silencioso**
  (Rev279 audit follow-up A / B).

Esto cubre la clase de bug "un retry de un write antiguo pisa un
intent más nuevo". Dos escritores concurrentes (p. ej. KIP y visor)
pueden emitir setTarget back-to-back; el counter garantiza que el
último gana aunque el primero reintente.

## Cola async de adjustTarget

Archivo: `src/autopilot-provider.ts:130`.

`_adjustChain: Promise<unknown>` — cadena serial para `adjustTarget`.
Dos llamadas concurrentes `+Δ` leen la misma base y perderían uno de
los incrementos sin esto (Rev272 audit R06). Las encadena por un
single promise.

Esto no es stale, es correctness. Sin impacto en el escenario de
reconnect.

## Qué NO cubre el backend (riesgo residual, teórico)

El backend se protege contra **sus propios** retries internos. No se
protege contra **ráfagas externas**: si el visor (o KIP, o cualquier
cliente SK) manda 10 writes seguidos vía la API SK v2 Autopilot, el
provider los procesa en orden. En red mala el visor puede acumular
clicks que al reconectar se envían.

**Esto es exactamente lo que Rev465/466 arreglaron en el visor**:
- Rev465: banner bloqueante + `pointer-events:none` + gate JS en
  todos los apXxx + pluginRaw.
- Rev466: WS close event marca pypilotHealthy=false al instante +
  gate ampliado para considerar el estado del WS.

Combinado: visor + backend forman defensa en profundidad.

## Capa aún no cubierta — otros clientes SK (p. ej. KIP)

Si KIP (o cualquier otro cliente) manda writes vía SK v2 durante un
gap, el provider los acepta y los pasa a pypilot (si pypilot está
accesible desde el plugin). Esto es correcto por diseño — SK está
diseñado para ser consumido por múltiples clientes, no bloqueamos
externos. Un cliente mal implementado puede saturar al pypilot
igualmente.

Si en el futuro vemos evidencia de que un cliente externo satura el
link, considerar un rate-limiter de writes a nivel provider (p. ej.
máx 5 writes/s a cualquier endpoint autopilot). No necesario hoy.

## Pendientes del plan safety (plan post-2026-10-12)

- [x] **B — Rev465** — banner + gate visor.
- [x] **A — Rev466** — WS close → offline inmediato.
- [x] **C — Rev467** — audit backend (este MD). Resultado: limpio.
- [ ] **E — Rev468** — batch `maneuver-trace/event` para reducir
      network overhead (opcional, no safety-crítico).
- [ ] **D — fuera del scope de pypilot-newui** — pausar plugins cloud
      (opentide, postgsail, windy, aisstream) cuando net-health
      detecta slow. Requiere coordinación con signalk-mareas-ihm.

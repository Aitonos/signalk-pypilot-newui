# Audit feature #9 — AIS alarm overlay en la rosa

Fecha: 2026-10-08
Autor: Claude Opus 4.7
Contexto: último punto grande del backlog sea trial 2026-10-04.
Carlos QA Rev430 OK, pide seguir.

Audit before fix / "regla #1 usa siempre MDs".

---

## Lo que Carlos pidió (del sea trial 2026-10-04)

> Recuerda que también tenemos pendiente a hacer que en la Rosa
> aparezca como un barquito diciéndonos la dirección de la que nos
> viene el peligro la velocidad y el tiempo CPA — es decir, alarmas
> AIS. Para el indicador de la alerta AIS en la Rosa utilizamos el
> SVG del barco de la Rosa; el color blanco lo cambiamos por rojo y
> lo ponemos en pequeño, de la altura aproximadamente de la flecha
> de viento real, apuntando hacia el centro y que parpadee. Encima
> de nuestro barco aparece un cuadro pequeñito con la velocidad a la
> que se acerca el barco hacia nosotros y el CPA / tiempo CPA.
>
> Cuando salte esa alarma, en la ventana de información que saldría
> pequeñita encima de nuestro propio barco, tiene que haber la
> opción de **ACK**. Este ACK significa que para ese blanco AIS
> dejamos de escuchar alarmas suyas; no vuelven a sonar en los
> próximos 10 minutos.

---

## Estado actual del plugin pypilot-newui

Grep `ais|AIS|cpa|aisTargets` en `public/app.js` y `src/`:

- **Visor**: cero infraestructura AIS. No hay subscribe a `vessels.*`,
  no hay cálculo CPA/TCPA, no hay render de targets.
- **Backend**: cero. Las referencias a "AIS" en `src/` son casuales
  (comments), no código. Memoria
  `project_ais_engine_resolved.md` confirma que el AIS engine
  **vive en el otro plugin (signalk-mareas-ihm)**, no aquí.

→ Feature #9 significa **añadir un subsistema AIS entero** a
pypilot-newui.

---

## Hallazgos de la spec oficial SignalK (2026-10-08 web fetch)

### Paths estándar para targets AIS
Fuente: `signalk.org/specification/1.7.0/doc/vesselsBranch.html`.

- `vessels.<ctx>.navigation.position` → `{longitude, latitude, altitude}` en grados / m.
- `vessels.<ctx>.navigation.courseOverGroundTrue` → **radianes**.
- `vessels.<ctx>.navigation.courseOverGroundMagnetic` → radianes.
- `vessels.<ctx>.navigation.speedOverGround` → **m/s** (convertir a kn
  para presentación: ×1.94384).
- `vessels.<ctx>.mmsi` → identificador estable (string).
- `vessels.<ctx>.name` → nombre, string top-level (NO publicar como
  delta `path:"name"` — bug Rev861 de mareas-ihm, revienta
  fullsignalk.js).
- `vessels.<ctx>.communication.callsignVhf` → callsign VHF (idem,
  solo lectura, nunca re-publicar).
- `vessels.<ctx>.design.aisShipType` → `{id, name}` (idem, no
  re-publicar, bug Rev880/881).
- `vessels.<ctx>.navigation.maneuver` → "Special maneuver" (opcional).

El `<ctx>` para AIS típicamente es `urn:mrn:imo:mmsi:<mmsi>`.

### CPA/TCPA — convención propia necesaria
Fuente: `signalk.org/specification/1.7.0/doc/notifications.html`.

- **SK no define paths estándar para CPA ni TCPA**.
- SÍ reconoce `notifications.collision.*` como *well-known alarm
  category*. Decisión propuesta:
  - Publicar alarmas en `notifications.navigation.closestApproach.<mmsi>`
    con el schema oficial de SK notification:
    ```json
    {
      "state": "alarm",
      "method": ["visual", "sound"],
      "message": "AIS NAME approaching, CPA 0.42nm in 3.2min",
      "mmsi": "244..."
    }
    ```
  - Internamente guardamos CPA/TCPA numéricos para render + ACK.
  - Esto nos abre la puerta a que KIP y otros clientes también
    enciendan algo si quieren.

### Patrón de subscribe server-side (de mareas-ihm, confirmado en
producción)
```ts
app.subscriptionmanager.subscribe(
  { context: "vessels.*" as Context,
    subscribe: [
      { path: "navigation.position" as Path, period: 2000, policy: "fixed" },
      { path: "navigation.courseOverGroundTrue" as Path, period: 2000, policy: "fixed" },
      { path: "navigation.speedOverGround" as Path, period: 2000, policy: "fixed" },
    ]},
  unsubscribes,
  (err) => app.error("ais subscribe: " + err),
  (delta) => {
    if (delta.context === "vessels." + app.selfId) return;   // skip self
    // mmsi está en el contexto: urn:mrn:imo:mmsi:244000000
    const mmsi = String(delta.context).replace(/^vessels\.urn:mrn:imo:mmsi:/, "");
    // ... update per-mmsi record + CPA/TCPA recalc + emit notification
  }
);
```

Para lecturas puntuales en vez de subscribe:
`app.getPath("vessels.urn:mrn:imo:mmsi:XXX.navigation.position.value")`
(análogo a `getSelfPath` pero con context explícito).

---

## Lo que haría falta implementar

### Backend (nuevo módulo, p. ej. `src/ais-collision.ts`)

1. **Subscribe SK con `app.subscriptionmanager.subscribe`** usando
   `context: "vessels.*"` + skip `vessels.<self>`:
   - `navigation.position` (lat/lon de cada target).
   - `navigation.courseOverGroundTrue` (COG rad).
   - `navigation.speedOverGround` (SOG m/s).
   - Lectura puntual del `name` + `mmsi` del vessel que ya pre-planta
     el AIS built-in parser de SK (NO re-publicarlo).

2. **Cálculo CPA/TCPA** por target cada N segundos:
   - CPA = closest point of approach (distancia mínima proyectada).
   - TCPA = tiempo hasta CPA.
   - Fórmula estándar (dos barcos moviéndose en línea recta):
     ```
     dx  = x_target - x_self
     dy  = y_target - y_self
     dvx = vx_target - vx_self
     dvy = vy_target - vy_self
     TCPA = -(dx*dvx + dy*dvy) / (dvx² + dvy²)
     CPA  = sqrt((dx + dvx*TCPA)² + (dy + dvy*TCPA)²)
     ```

3. **Umbrales de alarma** (configurable, defaults estándar):
   - CPA ≤ `cpaThresholdNm` (ej. 0.5 nm).
   - TCPA > 0 y ≤ `tcpaThresholdMin` (ej. 10 min).

4. **Publicación** de los targets en alarma como delta SK propio
   (p. ej. `steering.autopilot.pypilot.aisAlarms`) o endpoint
   REST `/plugins/signalk-pypilot-newui/ais-alarms`.

5. **ACK store** en memoria (o `plugin-config-data/ais-ack.json`):
   `{ mmsi: expiresAtMs }`. Al cumplirse 10 min, el ACK expira.

### Visor (público)

1. **Subscribe/poll** al endpoint o delta de alarmas AIS.
2. **Render SVG** dentro de `#wind-rose` (viewBox fijo):
   - Reutilizar el path del `#rose-boat`, pintar rojo, escalar a ~la
     altura de la flecha de viento real.
   - Rotar hacia la bearing del target desde el self.
   - Position en el borde del compass circle (r≈95).
   - CSS keyframes `@keyframes ais-blink` → opacidad 0.3 ↔ 1.
3. **Infobox** encima del `#rose-boat`:
   - Posición: justo encima de nuestro barco (y=−r_boat−10).
   - Contenido:
     - Nombre o MMSI del target.
     - Velocidad de aproximación (closing speed) en kn.
     - CPA en nm.
     - TCPA en min.
     - Botón **ACK**.
4. **ACK handler**: POST a `/ais-alarms/ack` con el MMSI → el backend
   setea el expire + el delta del snapshot deja de incluir ese
   target hasta la expiración.
5. **Múltiples targets simultáneos**: priorizar por menor TCPA; el
   infobox muestra el más urgente. Los barquitos rojos se pintan
   todos.

---

## Scope: MVP vs completo

### Opción A — MVP (rev único, ~1 commit grande)
- Backend: subscribe vessels, CPA/TCPA, umbrales fijos, delta de un
  SOLO target más urgente, ACK en memoria 10 min.
- Visor: 1 barquito rojo + 1 infobox + ACK. Un target a la vez.
- SIN config UI (umbrales hardcoded, cambiables en el futuro).

### Opción B — Completo
- Multi-target render.
- Config UI en Setup (cpaThresholdNm, tcpaThresholdMin, ACK duration).
- ACK persistente en disco (sobrevive restart).
- Sonido/voz al disparar alarma.

### Mi recomendación
**A primero** → desplegar + validar en agua con tráfico real → B si
Carlos quiere más. Es la ruta de menos tokens y riesgo:
- Infraestructura nueva validada antes de añadir features.
- El agua decide si los umbrales por default son razonables antes de
  gastar en UI de config.

---

## Preguntas para Carlos antes de codear

1. **Scope A o B** inicialmente? (yo voto A).
2. **Umbrales por default**: ¿CPA 0.5 nm / TCPA 10 min son razonables
   para Tunatunes, o quieres otros valores?
3. **Sonido al disparar**: ¿reusamos `_alSpeak` (voz) con el nombre
   del target? ¿Pitido? ¿Nada por ahora?
4. **Fuentes AIS**: pypilot-newui se suscribe al bus SK local. Esto
   recoge targets de VHF (MAIANA) + los que ya publique mareas-ihm
   (aisstream/aishub/aisfriends). ¿Confirmas que ésa es la fuente
   deseada, o quieres filtrar sólo por `$source` concreto?
5. **Mínimo distance filter**: ¿ignoramos targets a > N millas aunque
   su CPA proyecte en banda? (ej. "si está a 15 nm no me importa
   todavía"). Mi default sería 5 nm — más allá es ruido.

---

## Decisiones de Carlos (2026-10-09)

### 1. Scope: A ahora, dejar preparado para B
MVP para la 3.0.0 renderiza **1 target** (el más urgente), pero la
arquitectura interna soporta multi-target desde el inicio
(estructura `Map<mmsi, ThreatRecord>`, cálculo CPA/TCPA para todos
los targets dentro del distance filter). Lo que diferiría B es la
UI de config + render simultáneo de varios diamantes rojos.

### 2. Umbrales ajustables por usuario con 3 presets de aguas

Carlos: *"en aguas protegidas hay más densidad y los cruces son
siempre más afilados, hay que dar más tolerancia a saltar menos
avisos... offshore más al contrario, hay que avisar antes para
permitir comunicaciones"*.

| Preset        | CPA         | TCPA     | Distance filter | Rationale |
|---------------|-------------|----------|-----------------|-----------|
| `protegidas`  | **0.25 nm** | **3 min** | **2 nm**        | Densidad alta, cruces afilados, menos avisos |
| `costera`     | 0.5 nm      | 10 min    | 5 nm            | Default intermedio |
| `offshore`    | 1.0 nm      | 15 min    | 10 nm           | Avisar antes, tiempo para VHF/CPA call |

Trigger: `CPA_proj ≤ cpaThreshold **O** TCPA ≤ tcpaThreshold` ("lo
que sea antes"). Values son `props.aisPreset: "protegidas" |
"costera" | "offshore"` + opcional
`props.aisThresholds: { cpaNm, tcpaMin, maxDistNm }` que anulan
el preset si se setean.

### 3. Aviso por voz al disparar
Usar `_alSpeak(...)` (ya en uso para empopado lost / pypilot silent
/ VT failed). Texto propuesto (ES):

> "Blanco AIS {name}, CPA {CPA_nm} millas en {TCPA_min} minutos"

Con fallback a MMSI si el `name` del target no está en el bus. Un
pitido NO (Carlos no lo pidió; voz basta).

### 4. Fuente AIS: deny-list de internet, no allow-list de Maiana
Carlos (2026-10-09 aclaración): *"Maiana es MI AIS, pero la fuente
AIS puede ser de diversa índole; lo que hay que excluir son las
fuentes de internet"*. El filtro no debe acoplar al hardware actual
(hoy Maiana, mañana podría ser otro VHF/N2K físico). Lo que hay que
descartar son los targets que vienen por internet y no reflejan una
colisión real en el entorno del barco.

Implementación: el plugin expone `props.aisSourceDeny` como regex,
**default confirmado tras inspección del bus SK Tunatunes
(2026-10-09)**:
```
^mareas-ihm$
```
(case-insensitive). Datos reales encontrados en el bus:

| `$source`     | count | descripción |
|---------------|-------|-------------|
| `maiana.AI`   | 80    | VHF Maiana (AIS físico, queremos) |
| `maiana.GN`   | 1     | GPS del Maiana = self (se filtra por `context`) |
| `mareas-ihm`  | 19    | Mareas-ihm republish online — **se descarta** |
| `(none)`      | 2     | Sin `$source` — defensivamente **se descarta** también |

Mareas-ihm consolida los 3 motores online (aisstream, aishub,
aisfriends) bajo un único `$source="mareas-ihm"` (no bajo nombres
individuales), así que el regex deny-list correcto es sólo
`^mareas-ihm$`. Un target sin `$source` también se descarta
defensivamente (no sabemos de dónde viene, no lo confirmamos como
colisión fiable). Carlos puede extender el regex si en el futuro
añade otro republicador.

### 5. Distance filter por preset (ya en la tabla punto 2)
`protegidas: 2 nm`, `costera: 5 nm`, `offshore: 10 nm`. Reduce coste
del cálculo (no procesamos targets a 15 nm cuando estás en puerto).

### 6. Doble tap en rose → Freeboard SK embebido
Feature independiente ligada al mismo sprint:
- Doble tap sobre el `#wind-rose` SVG lanza
  `window.location.href = "/@signalk/freeboard-sk/"` (ruta estándar
  de la webapp Freeboard que ya está instalada en el SK server).
- Freeboard muestra la carta con la posición propia + targets AIS
  en vivo.
- No es iframe permanente — es navegación on-demand.
- Volver al visor pypilot-newui con el botón "back" del browser.

Mecanismo: `dblclick` listener sobre `#wind-rose` + confirmación
visual breve (flash + voz "abriendo carta").

---

## Plan de implementación propuesto

### Rev431 — Backend AIS collision scaffold
- Nuevo módulo `src/ais-collision.ts`:
  - `AisCollisionConfig { preset, overrides, sourceAllow }`.
  - `ThreatRecord { mmsi, name, pos, cog, sog, lastUpdateMs, cpaNm, tcpaMin, bearingDeg, rangeNm }`.
  - `recalcAllThreats(selfPos, selfCog, selfSog, map)` → actualiza
    cada record + decide si están en alarma.
  - Pure functions, unit-testables.
- Integración en `src/index.ts`:
  - `app.subscriptionmanager.subscribe({ context: "vessels.*", ... })`.
  - Filtro `$source` + skip self.
  - Tick 1 Hz re-cálculo + emit delta
    `steering.autopilot.pypilot.aisCollision` (snapshot del threat
    más urgente) + notification oficial SK
    `notifications.navigation.closestApproach.<mmsi>`.
- Props expuestos en `defaults`: `aisPreset`, `aisThresholds`,
  `aisSourceAllow`.

### Rev432 — Visor render + voz + Freeboard dblclick
- Suscripción al delta nuevo en `handleDelta`.
- SVG del barquito rojo (reusar `#rose-boat` path, color accent-rojo,
  escala a altura de la flecha de viento real).
- Infobox encima de `#rose-boat` con nombre + closing-kn + CPA/TCPA
  + botón ACK.
- CSS `@keyframes ais-blink`.
- `_alSpeak` al disparar alarma + al primer ACK.
- ACK store en memoria del backend (`Map<mmsi, expireAtMs>`), 10 min.
- `#wind-rose` dblclick → navigate Freeboard.

### Rev433 — Config UI (fase B)
- Setup card "AIS Alarmas" con:
  - Selector preset (`protegidas / costera / offshore`).
  - Sliders avanzados para `cpaNm`, `tcpaMin`, `maxDistNm`.
  - Toggle `aisSourceAllow` + preview del source actual del bus.
- Multi-target render en la rosa (hasta N barquitos).

Rev431+Rev432 = MVP visible 3.0.0-alpha. Rev433 completa 3.0.0.

### Pre-requisito: confirmar `$source` del AIS Maiana en Tunatunes
Antes de arrancar Rev431 hago una consulta SSH al Pi:
```
curl /signalk/v1/api/vessels/<mmsi-del-primer-target>
```
y veo el `$source` que SK le pone a `navigation.position` de un
target AIS llegado por VHF. Eso define el default regex de
`aisSourceAllow`.

---

## Datos reales del bus SK con collision-alerts activo (2026-10-09)

Carlos instaló `signalk-collision-alerts`. Verificado en Pi:

### Path: `notifications.navigation.closestApproach.<mmsi>`
Schema confirmado (ejemplo real de PIRATA DE ONS):
```json
{
  "value": {
    "state": "normal",            // "normal" | "warn" | "alarm"
    "method": ["visual", "sound"],
    "message": "Collision risk: PIRATA DE ONS, CPA 0.04 NM in 0 min",
    "status": {
      "silenced": false,
      "acknowledged": false,
      "canSilence": true,
      "canAcknowledge": true,
      "canClear": true
    },
    "createdAt": "2026-10-09T12:38:26.342Z",
    "data": {
      "targetRef": "vessels.urn:mrn:imo:mmsi:224182590",
      "source": "ais",             // string literal del plugin, NO $source del delta
      "cpa":   74.47,              // metros
      "tcpa":  -4.57,              // segundos (negativo = pasada)
      "range": 74.65,              // metros
      "cpaPositions": {
        "self":   { "latitude": ..., "longitude": ... },
        "target": { "latitude": ..., "longitude": ... }
      }
    },
    "id": "506cc929-..."           // UUID para ACK
  },
  "$source": "notificationsApi",
  "timestamp": "..."
}
```

### Per-vessel path (opcional, controlado por toggle del plugin):
`vessels.<mmsi>.navigation.closestApproach` con `{distance, timeTo}` —
NO lo consumimos en pypilot-newui (nos basta con las notifications).

### Observaciones de diseño

- **state transitions**: el visor solo pinta cuando `state ∈ {"warn", "alarm"}`;
  "normal" se ignora (TCPA pasado o fuera de umbral).
- **ACK**: endpoint SK v2 `/signalk/v2/api/notifications/<id>/{acknowledge}`
  usando el `id` UUID del notification. SK propaga el estado a Freeboard,
  pypilot-newui, cualquier otro consumer.
- **Filtro de fuentes online**: `source` del data es literal `"ais"` (del
  plugin), NO el `$source` del delta. Para excluir mareas-ihm hay que leer
  `vessels.<mmsi>.navigation.position.$source` del bus y descartar si
  matchea `mareas-ihm`. Alternativa simpler: no filtrar aquí porque el
  plugin collision-alerts ya debería filtrar por su propio distance
  threshold y el ACK local nos cubre si hay falsos positivos.
- **Bearing from self to target**: calcular desde `cpaPositions.self` y
  `cpaPositions.target`, O leer `vessels.<mmsi>.navigation.position` +
  `vessels.self.navigation.position` del bus y calcular la bearing
  rhumb-line. Lo primero es más directo (vienen en el payload).

### Scope final Rev431 (único rev visor consumer)

- `handleDelta` nueva case `notifications.navigation.closestApproach.*`.
- `state.aisAlarms = Map<mmsi, Alarm>` con snapshot de cada activa.
- Al transicionar a `warn`/`alarm`: `_alSpeak(message)` + render.
- Al transicionar fuera: hide render.
- Render: SVG barquito rojo (reusar `#rose-boat` path, filtra color accent-red,
  pequeño como la flecha de wind true), posicionado en bearing + range
  escalado al compass (clamp a borde si está más allá del compass).
  CSS keyframes blink.
- Infobox encima de `#rose-boat`: name + CPA (×0.000539957 to NM) + TCPA
  (/60 to min) + ACK button.
- ACK: `fetch("/signalk/v2/api/notifications/" + id + "/acknowledge", {method:"POST"})`.
- Double-tap `#wind-rose` → `window.location.href = "/@signalk/freeboard-sk/"`.

## Decisiones de scope (2026-10-09)

- **Preset default**: `costera` (confirmado Carlos).
- **Sin publish durante este sprint**. Rev431...N iteramos y
  deployamos al Pi para QA interactivo. El publish 3.0.0 llega al
  final del sprint cuando Carlos dé OK explícito tras pre-publish
  checklist completo. Memorias aplicables:
  `feedback_never_publish_without_explicit_ok`,
  `feedback_batch_trivial_npm_publishes` (no acumular micro-releases),
  `feedback_prepublish_checklist`.
- Primer deploy al Pi: tras Rev431 (backend solo — no cambia la UI
  del visor todavía, pero expone el delta nuevo + notification SK
  → ya es verificable por `curl` desde Carlos / inspección Freeboard).

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

## Decisión abierta a confirmar

Procedo con MVP (A) y preguntas 2–5 con mis defaults (CPA 0.5 nm /
TCPA 10 min / sin sonido / fuente = bus SK sin filtro de source /
distance filter 5 nm) **salvo que digas lo contrario**.

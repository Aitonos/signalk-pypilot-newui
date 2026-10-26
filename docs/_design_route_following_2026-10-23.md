# Diseño — seguir rutas de Freeboard con pypilot (modo NAV), sin plugins extra

Estado: **implementado en Rev545** (2026-10-23) con las decisiones de Carlos; pendiente de prueba con una ruta real (puerto, luego agua).

## 1. Lo que hay hoy (comprobado en el barco, 2026-10-23)

- Signal K **2.34**, Course API v2 (el que usa Freeboard). `@signalk/course-provider` instalado.
- La TinyPilot es **cliente TCP del servidor NMEA de Signal K**:
  `nmea.client = 192.168.1.104:10110`. Por ahí recibe ya GPS (RMC de la
  Maiana) y viento: `gps.source = tcp`, `wind.source = tcp`,
  `truewind.source = gps+wind`.
- `ap.modes = [compass, gps, wind, true wind]`. Falta **APB**
  (`apb.source = none`), por eso no hay modo **nav**.
- `apb.xte.gain = 300` (defecto), `ap.gps_and_nav_modes = true`.
- Nuestro plugin: `courseCurrentPoint` pone pypilot en `nav` (hoy nunca
  disponible); `courseNextPoint` = "Not implemented"; `/nav/apb-preview`
  calcula el rumbo pero no lo envía.

## 2. Cómo usa pypilot el APB (código fuente, `nmea.py`, `sensors.py`, `autopilot.py`)

- Campos que lee: `[2]` XTE (millas), `[3]` L/R, `[12]` rumbo a seguir, `[13]` M/T.
  **Solo usa APB con `T` (verdadero)**; con `M` lo descarta.
- En modo `nav` con el AP conectado: `heading_command = track + 300 × XTE`
  (300° por milla = 30° por cada 0.1 mn).
- Acepta como máximo **2 APB/s**.
- **XTE topado a 0.15 mn solo por un lado** (`min(xte, 0.15)`): con XTE grande
  hacia el otro lado la corrección no tiene tope → **lo topamos nosotros a
  ±0.15 mn** antes de enviar.
- Sin APB aceptado durante **8 s** → `apb.source = none` → desaparece `nav`.
- El modo `nav` aparece en cuanto hay fuente APB (y GPS).

## 3. Propuesta: el plugin hace de "navegador" (sin plugins extra)

```
Freeboard ──(Course API v2)──> Signal K ──getCourse()──> pypilot-newui
                                                          │  calcula rumbo/XTE/llegada
                                                          │  APB 1 Hz por el bus nmea0183out
                                                          ▼
                     Signal K :10110 ──(conexión que la TinyPilot ya tiene)──> pypilot (modo NAV)
```

1. **Lectura de la ruta**: `app.getCourse()` cada segundo (in-process, sin
   HTTP). Destino = `nextPoint`; tramo = `previousPoint` → `nextPoint`
   (en un "ir a" Signal K pone como previo la posición al activarlo).
2. **Cálculo propio** (no depender de otro plugin): rumbo del tramo
   (ortodrómico), rumbo y distancia al waypoint, XTE con signo, "círculo de
   llegada alcanzado" y "perpendicular pasada". Si `course-provider` publica
   `navigation.course.calcValues`, se usa solo para contrastar (log).
3. **Envío**: APB 1 Hz por `app.emit('nmea0183out', …)`, solo mientras haya
   destino activo y posición fresca (< 5 s). Campo `[12]` = rumbo del tramo
   (verdadero, `T`), XTE topado a ±0.15 mn: **la corrección la hace pypilot**
   (su ganancia `apb.xte.gain`), no nosotros. Sin destino o sin posición →
   no se envía → a los 8 s pypilot quita `nav` (ver 4.3).
4. **Avance de waypoint**: al entrar en el círculo de llegada **o** pasar la
   perpendicular → `app.activateRoute({ href, pointIndex: i+1, reverse })`.
   También desde el visor / KIP: `courseNextPoint` (hoy sin implementar).
5. **Visor**: modo **NAV** en el selector cuando pypilot lo ofrece; en la
   rosa: siguiente waypoint, distancia, XTE, rumbo; botón "Siguiente WP".

Ventaja: el gobierno lo sigue haciendo pypilot en la TinyPilot; el plugin
solo le da el rumbo. Si la Pi o Signal K caen, pypilot pierde el APB a los
8 s y deja `nav` por su cuenta.

## 4. Seguridad

1. **Conectar NAV con giro grande**: si el rumbo del tramo está a > 60° del
   rumbo actual, el visor pide confirmación (como la trasluchada larga).
2. **XTE grande** (> 0.25 mn, configurable): alarma "fuera de ruta" (opt-in,
   regla BASIC) y se sigue enviando XTE topado.
3. **Pérdida de datos** (posición o ruta > 5 s): dejamos de enviar APB,
   alarma "NAV sin datos" y el plugin pasa el AP a **compás con el rumbo
   actual** (mismo patrón que la salida segura de aproado), en lugar de
   esperar a ver qué hace pypilot a los 8 s.
4. **Fin de ruta** (llegada al último punto): compás con el rumbo actual +
   aviso "Destino alcanzado" (voz y banner).
5. **Viradas en ruta a vela**: NAV es familia compás; AUTO WIND se apaga al
   entrar en NAV (ya lo hace al salir de la familia viento).
6. **No escribimos `heading_command` en NAV**: el visor bloquea ±1/±10 en
   NAV (o los traduce a "cambiar de modo a compás"), para no pelear con pypilot.

## 5. Decisiones para Carlos

1. **Avance de waypoint**: ¿automático (círculo de llegada o perpendicular)
   o con confirmación en el visor? *Propuesta: automático + aviso de voz.*
2. **Fin de ruta**: ¿compás con el rumbo actual + aviso? *Propuesta: sí.*
3. **Giro en el waypoint**: ¿lo hace pypilot de golpe (estándar) o
   suavizamos con pasos intermedios como la virada virtual? *Propuesta:
   estándar primero, medir en el agua.*
4. **Confirmación al conectar NAV con giro > 60°**: *Propuesta: sí.*
5. **±1/±10 en NAV**: ¿bloqueados o "pasar a compás"? *Propuesta: pasar a
   compás con el nuevo rumbo (el patrón sabe que sale de NAV).*

## 6. Pruebas

- Puerto: ruta en Freeboard → aparece `nav` en pypilot (`apb.source = tcp`),
  el visor muestra NAV y datos del waypoint; quitar la ruta → a los 5 s el
  plugin pasa a compás y avisa.
- Simulación: tests del cálculo (rumbo del tramo, XTE con signo, llegada,
  perpendicular) con casos conocidos; test de APB (formato, checksum, tope XTE).
- Agua: ruta de 3 puntos en zona libre, mano en la caña; mirar giro y
  sobrepaso en cada waypoint (los foros reportan giro adelantado).

## Fuentes
- pypilot `nmea.py`, `sensors.py`, `autopilot.py` (github.com/pypilot/pypilot, master).
- pypilot workbook, *Signal K connections*.
- Signal K 2.34 `@signalk/server-api` `course.d.ts` (`getCourse`, `activateRoute`).
- Foro OpenMarine: hilos sobre APB/RMC al puerto 20220 y giro adelantado en waypoints.


## 7. Decisiones de Carlos (2026-10-23) e implementación Rev545

| # | Decisión | Implementación |
|---|---|---|
| 1 | Avance automático, con aviso de voz claro | Al entrar en el círculo de llegada o pasar la perpendicular: `activateRoute(pointIndex + 1)`; el visor dice "Waypoint X alcanzado. Siguiente, Y. Nuevo rumbo N grados. D millas." |
| 2 | Fin de ruta: compás con el rumbo actual + aviso | Si el AP está en NAV: compás con `ap.heading` de pypilot y "Destino X alcanzado. Piloto en compás con el rumbo actual." Deja de enviarse APB. |
| 3 | Giro en waypoint: estándar | pypilot gira solo con el nuevo tramo. |
| 4 | Confirmar NAV con giro > 60° | En el selector de modo, con el AP conectado. |
| 5 | ±1/±10 en NAV → compás con el nuevo rumbo | `adjustTarget` en NAV: compás, rumbo actual ± el ajuste (esperando el eco del modo, como la cancelación de Rev515). Virar en NAV se rechaza. |

Además: pérdida de ruta o de posición > 5 s con el AP en NAV → compás con
el rumbo actual + "Ruta perdida" / "Sin posición GPS". "Siguiente waypoint"
en la lista de modos y por el API de Signal K (`courseNextPoint`). Estado
publicado en `steering.autopilot.route`. Comprobado en la Pi: Signal K
reenvía `nmea0183out` por el puerto 10110 (`interfaces/nmea-tcp.js`), el
mismo que lee la TinyPilot.

Archivos: `src/route-nav.ts` (cálculo puro, 9 tests),
`src/index.ts` (`_routeTick`), `src/autopilot-provider.ts` (NAV),
`public/app.js` (voz, botón, confirmación).

## 8. Auditoría tras las pruebas en puerto (Rev546-550)

| Rev | Fallo | Arreglo |
|---|---|---|
| 546 | Signal K cambia `pointIndex` antes que `nextPoint`: falso "destino alcanzado" 1 s después de avanzar, se dejaba de enviar APB y NAV desaparecía. | Tras avanzar se espera al punto nuevo; destino solo si antes se estuvo fuera del círculo; aviso con el tramo real. |
| 547 | pypilot acepta `ap.mode=nav` sin ruta: el plugin pasaba a compás con "ruta perdida", en bucle. | NAV rechazado mientras pypilot no lo ofrece. |
| 548 | Engage de Freeboard con ruta: 2 pulsaciones (la acción NAV exigía el AP ya conectado). | NAV a la primera desde Freeboard/KIP; el botón AP del visor conecta en el modo actual (decisión de Carlos). |
| 549 | Ruta borrada con el AP desconectado en NAV: pypilot pasaba solo a GPS a los 8 s. | El plugin pasa a compás a los 5 s también con el AP desconectado. |
| 550 | Mismo caso al llegar al destino con el AP desconectado. Aviso de voz: el primero tras abrir el visor se perdía, y tras reiniciar Signal K los ids se repetían. NAV elegido con el AP apagado + botón AP: giraba > 60° sin confirmar. | Compás también ahí; aviso identificado por id + hora y la primera actualización es la foto inicial; confirmación de > 60° también al conectar en NAV. |

Observación (sin cambio): el 25-26/10 el AP quedó conectado en NAV ~18 h
con el barco amarrado. Propuesta pendiente de decisión: alarma opcional
"AP conectado con el barco parado más de N minutos".

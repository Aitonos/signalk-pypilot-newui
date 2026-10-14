# Feature — integración de signalk-mareas-ihm en pypilot-newui

Fecha: 2026-10-14. Petición de Carlos:

1. Embeber funciones de Mareas igual que Freeboard (doble tap en la rosa).
   Para Mareas, "por ejemplo 3 taps".
2. Tener **muy a mano la curva de mareas** que Mareas publica sola.
3. **Recomendar** a los usuarios que instalen mareas-ihm (en la SK App
   Store aparece como "AnchorWatch Pro: Smart Anchoring, AIS & Tides").
4. Usar la **base de datos de nombres AIS** de Mareas (MMSI → nombre +
   datos del buque, persistida en caché) para no mostrar MMSIs en crudo.

Principio rector: **integración opcional y desacoplada**. pypilot-newui
debe funcionar igual sin mareas-ihm instalado (degradación silenciosa) y no
puede leer ficheros internos del otro plugin. Solo usa su API HTTP y los
paths SK que ya publica.

## 0. Detección de mareas-ihm

- `GET /signalk-mareas-ihm/api/build-info` → 200 = instalado y arrancado.
- Se cachea en el visor como `state.mareasAvailable` (sondeo al cargar y
  cada 5 min con `_whenVisible`, sin polling agresivo).
- Señal secundaria gratuita: `environment.tide.*` con
  `$source: "mareas-ihm"` ya llega por el WS de SK.

## 1. Embed de Mareas (gesto)

Lo que ya existe en mareas-ihm:
- `/signalk-mareas-ihm/mareas?embed=1&lang=es|en`: página de mareas
  completa (curva, extremos, coeficiente, corrientes) en modo embebido,
  sin header. Es la misma que usa el visor de fondeo en su modal
  (`m_openMareas`, Rev182).
- `/signalk-mareas-ihm/visorfondeo`: visor completo (fondeo + AIS +
  meteo + abrigo).

Propuesta: reutilizar el contenedor `#freeboard-embed` (Rev433/461, con
botones maximizar y cerrar) en lugar de crear UI nueva. Se generaliza a
`#side-embed` con un `src` intercambiable. Regla "no improvisar UI".

### Problema del triple tap (lo rebato)

Hoy el doble tap abre Freeboard con `dblclick`. Para distinguir un doble
de un triple hay que **esperar ~300 ms después del segundo tap**. Así que
Freeboard siempre abriría con 300 ms de retraso. Además, en una rosa que
también recibe taps sobre los cascos AIS y el countdown de virada, el
triple tap con el barco moviéndose es poco fiable.

Opciones:
- **A (recomendada)**: **pulsación larga (700 ms) en la rosa** para abrir
  un mini-selector de 2-3 botones grandes: `Carta` (Freeboard),
  `Mareas`, `Fondeo`. El doble tap sigue abriendo Freeboard directo, sin
  regresión.
- B: triple tap para Mareas, aceptando el retraso de 300 ms en el doble
  tap.
- C: botón fijo en la ficha de mareas del punto 2. Al tocar la mini-curva
  se abre el embed completo. Es el gesto más descubrible.

A y C son compatibles y cubren tanto a quien usa gestos como a quien no.

## 2. Curva de mareas "muy a mano"

Datos disponibles **sin tocar mareas-ihm**:
- Paths SK (llegan por el WS que ya tenemos): `environment.tide.heightNow`,
  `tendency`, `heightNextHigh`, `heightNextLow`, `coef`, `stationName`,
  `flow.*`.
- `GET /signalk-mareas-ihm/api/extremes` → estación + extremos de ±2 días +
  coeficiente (verificado en vivo: Vigo, PM 18:49 3.27 m, BM 00:50 1.07 m,
  coef 0.59).

Render: sparkline SVG de −6 h a +12 h, con interpolación coseno entre
extremos (la misma que usa Mareas), una marca "ahora" y el texto
`Vigo · 3.15 m ↑ · PM 18:49 (3.27) · coef 59`. Fetch de `/api/extremes`
cada 15 min con `_whenVisible`. Para la Pi Zero el coste es cero: todo va
contra el Pi5.

**Pregunta para Carlos — dónde vive la curva:**
- (a) Tira fina bajo la rosa en CONTROL. Es lo más "a mano", pero roba
  altura en el móvil (portrait ya va justo, ver Rev370).
- (b) Celda opcional del bbar/overlay-card, desactivada por defecto
  (modo BASIC vs Performance).
- (c) Card en la pestaña CHART, encima del embed de carta.

Mi recomendación es **(b) + tap → embed completo (opción C del punto 1)**.

## 3. Recomendar mareas-ihm

Si `mareasAvailable === false`:
- En la overlay-card de AIS y en la nueva card de mareas aparece una línea
  discreta: "Recomendado: *AnchorWatch Pro: Smart Anchoring, AIS & Tides*
  (signalk-mareas-ihm) en la App Store de Signal K: mareas, nombres AIS,
  fondeo." (ES/EN).
- En `INFO` → sección "Plugins compañeros" con estado ✓/✗. Ahí se puede
  incluir también collision-alerts y Freeboard-SK, que ya son
  dependencias blandas.
- README: sección "Companion plugins".
- No hay banners intrusivos ni avisos repetidos. Es una línea estática.

## 4. Nombres AIS desde la DB de Mareas

Estado actual en pypilot-newui: el nombre se saca **con regex del texto
del mensaje** de collision-alerts (`/Collision risk:\s*([^,]+),/`). Si es
numérico, se muestra "objetivo". Es frágil y no aprovecha nada.

Estado de mareas-ihm (en vivo): `_aisKnownDB` con **323 entradas, 322 con
nombre** y 110 con IMO, persistido en disco con TTL. Incluye length,
beam, shipType, callsign y aisClass. Hoy solo se expone en
`/api/ais/db-debug?full=1`, que es un endpoint de diagnóstico, pesado y
no pensado para consumo.

Cadena de resolución propuesta para el nombre en el visor:
1. `vessels.<urn>.name` de SK (REST, ya lo pedimos con pos/sog/cog).
2. Lookup en mareas-ihm (si está disponible).
3. Nombre del mensaje de collision-alerts.
4. "objetivo" / "target".

Cambio necesario **en mareas-ihm** (otro repo, minor, con publish propio):
- Nuevo `GET /signalk-mareas-ihm/api/ais/lookup?mmsi=a,b,c` (máximo 20)
  que devuelva `{ mmsi: {name, callsign, length, beam, shipType,
  aisClass, imo} }`. Solo lectura, sin PIN, contra `_aisDBLookup`. Unas
  20 líneas.
- Hasta que salga, pypilot-newui puede funcionar con los pasos 1, 3 y 4
  (el paso 2 se salta si el endpoint devuelve 404).

Opción extra (D2, para valorar más adelante): que mareas **republique
`name`** al árbol SK para los targets VHF que llegan sin nombre y que la
DB sí conoce. Así se arreglarían también las etiquetas MMSI de Freeboard
(captura 2: "244060024", "SPB2346"). Con cuidado: Rev861 fue un memory
leak exactamente en el republish de `path:"name"`. Se haría con un
throttle por MMSI y solo cuando cambia. Va en otro audit dentro de
mareas-ihm.

El infobox AIS ganaría además eslora y tipo ("PELAGOS · velero 12 m").

## DECISIONES Carlos 2026-10-14

1. **Gesto = pulsación larga en la rosa → selector** (opción A). El doble
   tap sigue abriendo Freeboard directo. El selector queda como punto de
   extensión para futuras acciones.
2. **El selector lista las webapps SK instaladas** (no un trío fijo).
   Abre la webapp completa en el contenedor embebido, como Freeboard.
3. **Curva de mareas = botoncito propio que abre SOLO la curva**, para un
   vistazo rápido. NO embebe el plugin de Mareas. Lo renderiza
   pypilot-newui con los datos de mareas-ihm.

4. **El visor de fondeo YA ES Mareas**: no hay entradas separadas. En el
   selector, mareas-ihm es una webapp más (su `/signalk-mareas-ihm/` →
   visor).
5. **OK para tocar mareas-ihm** (también es de Carlos). Publish solo
   cuando veamos que funciona. **Requisito: que los nombres AIS sirvan a
   CUALQUIER app SK**, no solo a pypilot-newui. Por eso gana la opción
   **D2** (mareas republica `name` / `design.length` / `design.beam` /
   `design.aisShipType` / `communication.callsignVhf` en el árbol SK
   `vessels.*` cuando la DB los conoce y SK no los tiene). Freeboard, KIP,
   collision-alerts y nosotros lo leen sin conocer a Mareas. El endpoint
   `/api/ais/lookup` pasa a ser opcional.
   Riesgo conocido: el leak de Rev861 en el republish de `path:"name"`.
   Va con audit propio en mareas-ihm antes de codear.
6. **Umbral "barco parado" = 0.5 kn** (0.257 m/s), el mismo que el umbral
   de la línea de proyección.
7. La curva de mareas es una **ventana popup**. **Botoncitos a las 3 y a
   las 9 de la rosa**: uno abre la curva de mareas y el otro queda
   reservado (uso por decidir).

### Selector de webapps (diseño)

Fuente: `GET /skServer/webapps` (API estándar del servidor SK, sin
depender de ningún plugin). Verificado en el Pi5: 26 entradas, cada una
con `name`, `signalk.displayName` y `signalk.appIcon`.

- URL de cada webapp: `/<name>/`. Icono: `/<name>/<appIcon>`. Si no tiene
  icono, se usa la inicial.
- Se excluyen: la propia `signalk-pypilot-newui`, `@signalk/server-admin-ui*`
  y las que solo tienen la keyword `signalk-embeddable-webapp` (son
  componentes del Admin UI, no páginas: p. ej. `signalk-backup`).
- Orden: favoritos primero (Freeboard y Mareas fijados arriba si están
  instalados) y luego alfabético. La lista de favoritos se persiste en el
  backend (regla backend = fuente de verdad), no en localStorage.
- Se abre en el contenedor `#freeboard-embed` generalizado (maximizar y
  cerrar). Es same-origin, así que no hay problemas de X-Frame.
- Entrada extra fija, si mareas-ihm está instalado: "Mareas — página"
  (`/signalk-mareas-ihm/mareas?embed=1&lang=..`). Abre directamente la
  página de mareas, no el visor de fondeo.
- Pulsación larga: 600-700 ms, cancelada si el dedo se mueve más de 10 px.
  Hay que evitar el conflicto con el tap sobre un casco AIS y con el
  countdown de virada (si el countdown está visible, no hay selector).

### Botón "curva de mareas" (diseño)

- Solo aparece si mareas-ihm está instalado (detección del punto 0).
- Al pulsarlo se abre un popup ligero, propio y sin iframe:
  - Sparkline SVG de −6 h a +12 h con interpolación coseno entre
    extremos de `/api/extremes`, una marca "ahora" y las pleamares y
    bajamares etiquetadas con hora y altura.
  - Cabecera: estación · altura actual · tendencia ↑↓ · coeficiente
    (paths SK `environment.tide.*`, ya llegan por el WS).
  - Pie: enlace "Abrir Mareas completo" → selector o embed directo.
- `/api/extremes` se pide al abrir el popup, con caché de 15 min. Sin
  polling en segundo plano.
- Se reutilizan las clases de popup/card existentes (no improvisar UI).

## Plan propuesto (orden)

| Rev | Repo | Contenido |
|---|---|---|
| 470-472 | pypilot-newui | Fixes de la rosa AIS (ver `_audit_ais_rose_targets_rev470.md`) |
| 473 | pypilot-newui | Detección de mareas-ihm + nombre AIS vía SK `name` (pasos 1, 3 y 4) |
| Rev886 | mareas-ihm | `GET /api/ais/lookup` |
| 474 | pypilot-newui | Lookup de mareas (paso 2) + eslora/tipo en el infobox |
| 475 | pypilot-newui | Generalizar el embed + pulsación larga → selector de webapps SK |
| 476 | pypilot-newui | Botón "curva de mareas" → popup propio solo con la curva |
| 477 | pypilot-newui | "Plugins compañeros" en INFO + línea de recomendación + README |

## Decisiones que necesito de Carlos

1. Gesto: ¿pulsación larga con selector (A), triple tap (B) o solo el tap
   en la card de mareas (C)? Recomiendo A + C.
2. Ubicación de la curva: (a) bajo la rosa, (b) celda opcional o (c)
   pestaña CHART. Recomiendo b.
3. ¿Embeber también `visorfondeo` en el selector, o solo Mareas?
4. ¿OK para tocar mareas-ihm (endpoint `/api/ais/lookup`, Rev886 →
   2.12.1/2.13.0)?

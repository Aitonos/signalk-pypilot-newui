# Audit — salida 2026-10-18 (viento fuerte), 3.3.0 / Rev505

Fuentes (todas con hora real de la Pi): viaje `trip-20261018-171841`,
sesiones `nav-sessions/session-20261018-*`, trace
`trace-20261018-160910.jsonl`, journal SK, consulta directa a la
TinyPilot (TCP 23322, una vez). El log de la TinyPilot NO sirve para
horas: su reloj marca 2024-09 y salta en cada arranque.

## 1. Niveles de viento (tramos de 10 min)

| Tramo | TWS med/máx | AWS med/máx | SOG | Escora máx | V servo mín |
|---|---|---|---|---|---|
| 17:10 | 5.9 / 8.4 | 8.6 / 10.4 | 3.6 | 2° | 12.78 |
| 17:40 | 9.6 / 16.6 | 12.0 / 21.0 | 3.8 | 31° | 12.10 |
| **17:50** | 15.4 / 23.0 | 18.6 / 26.8 | 4.1 | **42°** | **10.25** |
| **18:00** | 15.1 / 25.1 | 17.6 / **28.8** | 3.8 | **48°** | 10.77 |
| **18:10** | 14.6 / **26.8** | 13.5 / 24.6 | 5.0 | 40° | **9.12** |
| 18:40 | 18.3 / 26.3 | 14.3 / 22.1 | 6.0 | 15° | 10.41 |
| 19:00 | 14.1 / 19.0 | 17.7 / 24.0 | 4.9 | 33° | 9.47 |
| 19:10 | 16.8 / 25.0 | 20.4 / 28.3 | 4.6 | 34° | 10.61 |
| 19:40 | 15.4 / 24.2 | 18.0 / 26.3 | 3.4 | 9° | 11.62 |

Resumen del viaje: 11.5 nm, TWS máx 26.8 kn, AWS máx 28.8 kn, escora
máx 48°, **tensión mínima 9.12 V a las 18:12:15**, 65 caídas < 11.5 V,
19 viradas, AP acoplado 76 %.

## 2. 18:00-18:21 — el piloto soltó el gobierno

### Qué pasó (trace + sesiones)

- 18:07, 18:08, 18:09, 18:12: desacople + reacople en 1-2 s con nuevo
  target → patrón de **tap AP off/on del patrón** (eco de orden propia).
- **18:15:15 y 18:20:56: pypilot se desacopla SOLO** (cambio que
  origina pypilot, no orden nuestra). 18:15 → suelto ~3 min hasta
  reacople manual 18:18:01. 18:20:56 → reacople 18:21:18.
- Justo antes, el servo **deja de empujar**: 18:20:45-18:20:52 error de
  rumbo 11° → **62°** con el piloto acoplado y **corriente 0 A / 13.6 V**
  (motor parado). A las 18:15 igual: error -23° con 0 A a ratos.
- El plugin NO lo soltó: `autoDisengageOnLostAuthority = false`, y no
  hay rastro en el journal de supervisor / smart pilot / alarmas.

### Por qué (TinyPilot, consultado en directo)

| Parámetro | Valor | Hoy |
|---|---|---|
| `servo.max_current` | **6.75 A** | el servo pidió **10.24 A** |
| `servo.faults` | **2585** | contador acumulado de fallos del controlador |
| `servo.flags` | `SYNC BAD_FUSES` | BAD_FUSES = config del microcontrolador, persistente, no explica lo de hoy |
| `rudder.angle` | sin sensor | pypilot no sabe dónde está el timón |

Diagnóstico: con 25-28 kn aparentes y 40-48° de escora el servo necesitó
más que el límite → **el controlador corta el motor por sobrecorriente**
(0 A con error creciendo) → pypilot acaba desacoplado. Agravante:
**caída de tensión de 13.6 → 9.1 V a ~10 A ≈ 0.45 Ω** en la alimentación
del servo (cableado / conexiones / magnetotérmico / batería). Con un
circuito sano la caída a 10 A debería ser < 1 V.

## 3. 19:37-19:42 — aproado

- 19:37:19 aproado **por popa** desde TWA 140° (true wind). Objetivo por
  pasos -140 → -50 → 0. El patrón lo desacopla a las 19:38:26 a mitad.
- **19:39:06-19:39:11: 4 viradas virtuales arrancadas y canceladas en
  5 s** → el modo alterna wind/compass 6 veces. La cancelación solo
  llega por `POST /virtual-tack/cancel`, que el visor manda al
  **segundo toque del botón de virada o al tocar la rosa durante la
  virada** (Rev400). En mar movida un toque involuntario en la rosa
  cancela la virada.
- 19:40:00 aproado **por proa** desde AWA 86° (wind):
  - fase en **modo viento**: llega a AWA≈0 en 16 s pero **no se
    mantiene**: oscila +5 … -33° durante 2 min (SOG 1.6-2 kn, AWS
    18-25 kn). El modo viento con objetivo 0° es inestable ahí.
  - 19:42:21 "logrado" → pasa a **compás**: error < 1° y AWA casi
    siempre en ±10° durante 5 min. Esta fase funcionó.
- `ap.tack.direction` alterna none ↔ starboard cada ~3 s (358 cambios
  en 22 min), origen externo (pypilot). Sin explicar todavía.

## 4. Fallos de diseño del plugin que salen de aquí

1. **No hay alarma cuando pypilot se desacopla solo.** El patrón se
   entera mirando. Debe ser una alarma sonora inmediata.
2. **La regla "unable-to-steer" nunca puede saltar**: exige
   `servoDuty ≥ 70 %` y `servoDuty` llega siempre `null` en esta
   TinyPilot (todas las muestras de hoy).
3. **No hay aviso de "servo cortando por sobrecorriente / tensión
   baja"** antes de que se desacople.
4. Aproado: la fase de mantenimiento en modo viento alrededor de 0° es
   inestable con viento fuerte y barco parado.
5. Cancelar una virada con un toque en la rosa es demasiado fácil en
   mar movida.

## 5. Peticiones de Carlos (2026-10-18) — opinión técnica

| Petición | Opinión |
|---|---|
| "No podemos dejar el barco sin gobierno, que siga intentándolo" | De acuerdo con la alarma inmediata. **Re-acople automático**: sí, pero con límites (p.ej. 3 intentos en 1 min, mismo modo y rumbo, alarma continua). Si la causa es sobrecorriente, re-acoplar sin más vuelve a cortar: la solución de fondo es eléctrica (0.45 Ω) y revisar `max_current` con la especificación del motor/controlador. |
| Más reactividad cuanto más ceñido o más empopado | Tiene sentido físico (cerca de 0° y 180° un rolón cambia de amura). Hoy existe parcialmente: empopado con PID "caliente" (P×1.5, D×1.7). Propuesta: escalar ganancias por \|TWA\| en ceñida y popa, no solo en el pseudo-modo. |
| Viento real en cuadrantes de popa, aparente en proa | Coincide con la práctica habitual. Propuesta: sugerencia/auto-cambio de modo al cruzar ~100-110° TWA, desactivable. |
| Virada "violenta" con mucho viento | Coherente con la idea de estrategias light/heavy por TWS (memoria `feature_tack_wind_strategies`). |
| Acuartelado → aviso + 360° automático | **Rebatir el automático**: un 360° sin tripulación preparada trasluchará con mucho viento. Propuesta: detectar acuartelado (AWA cruzado + SOG cayendo), **alarma sonora** y botón "360°" listo de un toque. |

## 6. Recomendaciones inmediatas (sin código)

1. Revisar el circuito del servo: sección de cable, terminales,
   magnetotérmico y estado de batería. Objetivo: < 1 V de caída a 10 A.
2. Revisar `servo.max_current` (6.75 A) contra la especificación del
   motor y del controlador antes de subirlo.
3. Hasta tener la alarma: con > 20 kn, vigilar el piloto en modo viento
   cerca de 0° / 180°.

## 7. Propuesta de trabajo (pendiente de OK)

Por orden de seguridad:
1. Alarma "piloto desacoplado sin orden" (sonora, todas las pantallas).
2. Aviso de servo en corte (sobrecorriente / tensión baja) + arreglar
   la regla "unable-to-steer" para que use corriente y error, no duty.
3. Re-acople automático acotado (configurable, por defecto ON con
   límites).
4. Aproado: mantener en compás siguiendo la dirección del viento real
   suavizada en vez de modo viento a 0°.
5. Cancelar virada: no con un toque suelto en la rosa (pulsación larga
   o confirmación).
6. Reactividad por ángulo al viento y cambio de modo por cuadrante
   (diseño aparte, validar en agua).

## 8. Ronda 2 (correcciones de Carlos + viradas)

Carlos: 18:07-18:12 desacoplaba porque **tablet y móvil mostraban modos
distintos**; 360° automático **descartado** (manual); el problema de
cancelar no es el toque sino que **pypilot se queda con órdenes
fantasma**; el contador de grados no muestra lo que **falta**; con mucho
viento la virada **se para a mitad** — debe ser rápida y decidida (la
pausa era solo para trasluchadas).

### 8.1 Viradas virtuales de hoy (journal)

13 arrancadas, 7 canceladas, 6 completadas. Destacan:
- **19:39:06-19:39:11**: 4 toques en 5 s → start/cancel/start/cancel/
  **start**: la 4ª queda viva. El patrón desacopla y reacopla (19:39:13)
  y **la virada sigue**; sus rumbos de 19:39:14 y 19:39:30 se
  **rechazan** ("FSM is driving") hasta que termina sola a 19:39:47.
- **18:08:45**: virada de 62 s sin converger; el rumbo -39° del patrón
  a 18:09:32 también **rechazado**.
- 18:07:25: start/cancel/start en 0.5 s (doble disparo del toque).
- **18:11:44: delta -278° (steps=2)** — casi una vuelta por el lado
  largo. Sin explicar, investigar.

### 8.2 Por qué se para a mitad (sesión 17:45)

18:08:48-18:09:12 error -160° con **servo 0 A durante 24 s** (el barco
gira por inercia ~2.5°/s); 18:09:18-18:09:42 vuelta a modo viento con
AWA atascado en -40/-50° vs objetivo -103° → **60° de error con 0 A
otros 24 s**.

Hipótesis (muy probable, falta confirmar con `servo.flags`): sin sensor
de timón, pypilot usa la **sobrecorriente como fin de carrera**: al
superar `max_current` (6.75 A) en un sentido, deja de empujar en ese
sentido hasta que se mueva al contrario. Con 25 kn y 40-48° de escora la
carga normal supera 6.75 A → "fin de carrera" falso a mitad de
recorrido → servo parado con error grande. Encaja con
`servo.faults = 2585`.

### 8.3 Modo distinto en dos pantallas (18:07-18:12)

Los dos visores registraron **los mismos cambios a la vez** (backend y
visores coherentes). Durante la virada el plugin pone pypilot en
**compás** y al terminar vuelve a **viento**; una pantalla puede mostrar
el modo real (compás) y la otra el de la maniobra. El patrón, al ver la
discrepancia, desacopla/reacopla — y **desacoplar no detiene la virada
en curso**.

### 8.4 Plan propuesto (pendiente de OK)

A. **El patrón siempre manda**: cualquier orden suya (±1/±10, rumbo,
   modo, desacoplar, cancelar) **cancela en el acto** la virada en curso
   y se aplica; nunca más "rejected (FSM is driving)". Desacoplar aborta
   la virada.
B. Botón de virada: ignorar toques repetidos < 1.5 s (doble disparo).
C. Contador: grados **que faltan** hasta el rumbo final.
D. Virada con viento fuerte: sin pasos ni pausa, objetivo final de una
   vez, mantener compás hasta el rumbo final (no volver a viento a 20°
   de llegar), PID "caliente" durante la virada como en el empopado.
E. Servo: grabar `servo.flags` en las sesiones; alarma de corte por
   sobrecorriente / fin de carrera falso; alarma "piloto desacoplado
   sin orden"; recomendación de `max_current` + revisión eléctrica.
F. Investigar el delta -278°.
G. Mostrar en todas las pantallas el modo de la maniobra mientras dura
   (p.ej. "VIRANDO → VIENTO") en vez de compás/viento a secas.

## 9. Implementado (Rev506-Rev508)

### Rev506 — el patrón siempre manda en la virada
- AP off (visor, KIP, mando, TinyPilot) anula la virada virtual; el barco
  queda donde está (objetivo = ángulo actual al viento).
- ±1/±10 durante la virada mueven el destino final (re-apunta los pasos
  que quedan y el objetivo de viento final). Límite ±60°.
- Botón de virada: ignora toques repetidos < 1.5 s (en modo viento).
- Backend publica `remainingDeg` en cada tick (falta mostrarlo en visor).

### Rev507 — Ajustes
- El candado del grupo ya no pregunta perfil; la pregunta sale al tocar
  el primer ajuste PERFIL (una vez por desbloqueo). GLOBAL nunca pregunta.
- El refresco de fondo de 10 s ya no reconstruye los grupos (se cerraban,
  se bloqueaban y pintaban el valor viejo).

### Rev508 — piloto pillado: detección, recuperación y alarmas

**Lo que dice el código de pypilot** (`/usr/local/lib/python3.11/dist-packages/pypilot/servo.py`):
- Sin sensor de timón, al saltar la sobrecorriente pypilot pone
  `PORT_OVERCURRENT_FAULT` o `STARBOARD_OVERCURRENT_FAULT` (según el
  sentido en que iba) y fija la posición estimada al tope de ese lado.
  Desde ese momento **se niega a empujar en ese sentido** ("fin de
  carrera" falso). Es exactamente el servo a 0 A con 60° de error.
- Ese fallo direccional **solo se borra** al moverse lo bastante al otro
  lado o **cuando cambia `ap.enabled`** (`servo.poll`, "if ap_enabled !=
  last_ap_enabled: clearbit(...)"). Un ciclo AP off/on lo limpia.
- Al reacoplar pypilot conserva modo y `heading_command` (solo reinicia
  el integral). No hace falta reescribir el objetivo.
- **El núcleo de pypilot nunca se desacopla solo.** `ap.enabled=false`
  sin orden nuestra viene de otro cliente: botonera/mando de la
  TinyPilot (tecla AUTO alterna), UI nativa. 18:15 y 18:20 fueron eso
  (pulsación o tecla espuria con mar). No se puede distinguir una
  pulsación intencionada de una espuria → alarma, nunca re-acople
  automático.

**Detección "pillado"** (`src/steer-watch.ts`, puro, con tests):
acoplado ≥ 5 s, |error| > 25° (error según modo: compás/viento
aparente/real), el error **no converge** (no ha bajado ≥ 3° en 4 s) y el
servo **no empuja** (fallo direccional en `servo.flags` o corriente
< 0.3 A), todo sostenido 4 s. El "no converge" evita confundirlo con
timón a tope de verdad en una virada (el barco gira y el error baja).

**Recuperación** (opción `steerRecoveryEnabled`, por defecto OFF según
la regla de alarmas/automatismos opt-in; activada en el Tunatunes):
ciclo AP off → 0.7 s → AP on, mismo modo. Máx. 3 ciclos por 60 s y
≥ 10 s entre ciclos. Si el patrón da cualquier orden de acople durante
el ciclo, se aborta y no se reacopla. La virada en curso NO se anula por
el ciclo. Sin efecto durante una virada nativa de pypilot.

**Alarmas nuevas** (reglas del motor de alarmas, banner + voz en todas
las pantallas, opt-in):
- `steer-stuck` — servo sin empujar con error creciendo.
- `steer-gave-up` — 3 ciclos sin éxito: gobierna a mano.
- `steer-dropped` — desacoplado desde fuera de la app (mando/TinyPilot)
  navegando (SOG > 1 kn). Se apaga al reacoplar o a los 60 s.
- `unable-to-steer` arreglada: `servoDuty` nunca llega en esta TinyPilot;
  ahora también salta con error RMS > 30° y servo con fallo direccional.

**Registro**: `servo.flags` vigilado a 1 Hz y `servo.faults` a 0.1 Hz;
`servoFlags` se graba en cada muestra de sesión.

## 10. Rev510 — contador, modo en pantalla, compás hasta el final

- **Contador (C)**: la pantalla que lanzaba la virada integraba el giro
  del AWA (deriva con rachas y con el barco frenando, y no veía los
  ±10). Ahora usa `remainingDeg` del backend (rumbo real contra rumbo
  final, ±10 incluidos) y el total `totalDeg` nuevo en el snapshot.
- **Modos distintos en dos pantallas (G)**: al empezar la virada el visor
  guardaba `state.mode` para restaurarlo; si el delta de "compass" de la
  propia virada llegaba antes que el snapshot, guardaba "compass" y al
  terminar se quedaba en COMPÁS (las otras en VIENTO) hasta el refresco
  de 30 s. Ahora el modo final sale del backend (`windMode`, que la FSM
  restaura al completar, cancelar o fallar) y durante la maniobra el
  botón de modo muestra "VIRANDO → <modo>" en todas las pantallas.
- **Compás hasta el rumbo final (D, parte)**: el último paso volvía a
  modo viento a 20° de llegar. Ahora sigue en compás hasta 6°; si se
  queda rondando dentro de 20° durante 5 s, entrega igualmente.
  **Pendiente de decidir**: PID "caliente" durante la virada con viento
  fuerte (cambia ganancias; no aplicado).

## 11. Rev511 — el delta -278° (F)

18:11:28 virada a babor desde AWA 6° (casi aproado), cancelada a las
18:11:41 con el barco ya en AWA +41° (viento por estribor). 18:11:44:
otro toque al MISMO botón (babor). Con el viento por estribor, "proa a
babor" es alejarse del viento y dar la vuelta por popa: trasluchada de
278° desde ceñida con 25 kn. El código hacía lo que dice el botón
(Rev383: el botón es el sentido de giro de la proa), pero nadie quiere
eso por error.

Arreglo: una trasluchada por la vía larga (|giro| > 180°, solo posible
con |AWA| < 90°) necesita confirmación. Backend devuelve 428 con
`code: confirm_long_jibe`; el visor pregunta "¿Trasluchar por popa?
… Para virar, usa el otro botón." Trasluchadas normales desde un largo y
viradas largas desde popa no preguntan.

## 12. Rev512 — aproado en compás (punto 4 del plan)

El aproado seguía en modo viento a AWA 0° también en la fase "activa"
(19:40-19:42: +5…-33° durante 2 min, barco parado); solo pasaba a
compás al pulsar SALIR, y ese compás sí aguantó 5 min. Ahora, al
lograrse (|AWA| < 10° durante 3 s), pasa a compás con rumbo = rumbo +
AWA (proa al viento). Sigue los roles despacio: reapunta si la media de
AWA de 15 s se va más de 12°, como mucho 15° por corrección y ≥ 15 s
entre correcciones. Un ±1/±10 del patrón manda: pasa a ser la base y
pausa el reapuntado 60 s. Si el visor se cierra, el compás mantiene el
último rumbo (fallo seguro). SALIR igual que antes (compás al rumbo
actual).

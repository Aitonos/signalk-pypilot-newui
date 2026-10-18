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

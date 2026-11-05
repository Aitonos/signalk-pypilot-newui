# AUTOWIND — auditorías cruzadas (Claude, GPT, Gemini) y verificación

Fecha: 2026-11-05. Versión revisada: 3.11.1 / Rev629.

**Fuentes:**
- Claude: `docs/_audit_autowind_2026-11-05.md`.
- GPT: "Auditoría independiente de Pypilot NewUI 3.11.1". Leyó el
  análisis de Claude, así que **no es ciega**, aunque reprodujo los
  fallos con código real.
- Gemini: revisión a ciegas con
  `docs/_prompt_llm_autowind_blind_2026-11-05.md`.

Cada afirmación se ha comprobado en el código de este repo. "Verificado"
significa que lo he visto en las líneas citadas; no significa que haya
pasado en el barco.

## 1. Causa del fallo: los tres coinciden

**Cerrar a mano el resumen del Empopado deja encendido el aviso de
"maniobra en curso".**

- `emExitHandler` (`public/app.js` ~14018-14024), en la rama
  `summary`, cancela el temporizador del resumen y borra
  `state.empopado`, pero no llama a `_setManeuverPseudo(false)`.
- El visor sigue renovando `active:true` cada 20 s.
- El backend mantiene `_pseudoActive()` en `true`, y `_autowindTick`
  sale con `blocked`.
- Aproado no tiene el fallo: `aproadoFinish` apaga el aviso él mismo
  (~13248). `empopadoFinish` no lo hace.

Datos:
- Las 142 renovaciones entre 17:49:28 y 18:37:11 salen del journal
  completo de la Pi. El extracto que vieron GPT y Gemini acaba a las 18:06.
- Repasando los datos, la lógica de decisión pedía aparente a las
  17:52:02 (Claude y GPT; Gemini lo dedujo de los datos).

Gemini añade un segundo intento fallido, que encaja con la misma causa:
de 17:54:51 a 17:55:03, en `wind`, |TWA| estuvo entre 161 y 177° durante
12 s y no pasó a `true wind`.

**Consecuencia de seguridad (los tres coinciden).** Ese aviso apaga
también tres alarmas en `src/alarms.ts` (~174, 206, 226):
- desvío de rumbo (`heading-deviation`);
- deriva sostenida (`cruise-drift`);
- no puede gobernar (`unable-to-steer`).

GPT señala, con razón, que la duración exacta del silencio (≈48 min) se
deduce de las renovaciones, no se ha medido directamente.

## 2. Hallazgos nuevos de GPT y Gemini, verificados

| # | Hallazgo | Quién | Verificación | Gravedad |
|---|---|---|---|---|
| N1 | Elegir AUTOWIND no termina Aproado/Empopado: el `return` del selector (~13856) va antes del bloque de cierre (~13886-13897). Además, ese bloque no cubre la fase `summary` | GPT, Gemini, Claude | Verificado | Alta |
| N2 | `setMode` del proveedor **rechaza con `return` normal** durante una virada virtual (`autopilot-provider.ts` ~619-627). `_autowindApply` lo toma como éxito y **cambia el perfil igualmente** | GPT | Verificado | Alta |
| N3 | `_autowindApply` no comprueba después del `await` si AUTOWIND sigue activo: un cambio lento de modo puede escribir el perfil de AUTOWIND **después** de que el patrón lo apagara y eligiera otro | GPT | Verificado (por el código; no pasó en el barco) | Alta |
| N4 | `empopadoTearDown` lanza la restauración de ganancias y perfil sin esperarla (~13212-13215) y borra el estado. Una restauración tardía puede pisar el perfil que eligió el patrón después | GPT | Verificado | Alta |
| N5 | `_verifyReAnchor` **ignora** el resultado de `_waitValue("ap.mode")` (~701): si el modo no se confirma, puede escribir igualmente una consigna del otro espacio | GPT | Verificado. Hoy no se activa porque faltan los datos (ver 3.2) | Alta si se reactiva |
| N6 | AUTOWIND usa TWA/TWS sin mirar su antigüedad. Dos muestras separadas 60 s cuentan como "10 s sostenidos" | GPT (Claude solo lo primero) | Verificado | Media-alta |
| N7 | El fallo de `setMode` solo va a `app.debug`. `lastSwitchMs` se gasta antes de saber si funcionó. El cambio de perfil ignora `client.set() === false` | GPT, Claude | Verificado | Media |
| N8 | `/maneuver-state` es un booleano global: un visor puede apagar la maniobra de otro, o una petición vieja reactivarla | GPT | Verificado | Media |
| N9 | Si el patrón pasa a compás desde fuera (mando, KIP) mientras AUTOWIND está bloqueado, AUTOWIND no se apaga, porque la detección está dentro del `!blocked` | Gemini | Verificado | Media |
| N10 | Un solo segundo dentro de la banda de histéresis (115-125°) reinicia los 10 s de espera | Gemini | Verificado. Es una decisión de diseño; con mar puede retrasar mucho el cambio | Baja-media |
| N11 | `apSetModeAndWait` da por confirmado el modo con `state.mode` (optimista) si aún no ha llegado ningún eco (`_confirmedMode` undefined) | Gemini | Verificado, pero solo justo después de cargar la página, antes del primer eco de modo | Baja |
| N12 | Racha: si falla guardar el estado en disco, el aumento de D se envía igual (`_gustSave` traga el error, ~5355) | GPT | Verificado. Fuera de AUTOWIND | Media |
| N13 | Racha: tras 3 s se toma una D de la caché, que puede ser del perfil anterior, como "edición manual" y se anula la restauración | GPT | Verificado por el código; no visto en el barco. Fuera de AUTOWIND | Media |

## 3. Afirmaciones corregidas o descartadas

**3.1 Claude se equivocó con `_tackStatePrev`.** `tackCatchup` se crea
siempre al arrancar (`index.ts` ~1211). Con `tackCatchupDeg = 0` el
objeto existe, solo que no corrige nada. `_tackStatePrev` sí se
actualiza. La virada nativa se descarta por los datos (`tack_state =
none` en la ventana), no por esa razón. (GPT)

**3.2 El "re-anchor sin datos" (punto F4 del informe de la salida) es
menos grave de lo que dije.**
- Los datos muestran que pypilot reancla él solo al cambiar de modo:
  - 17:51:24-27, compás → viento real: consigna 176 con TWA 179;
  - 17:53:33-37, compás → aparente: consigna -24 con AWA -22.
- El backend no escribió nada en ninguno de los dos casos.
- La muestra de 17:55:21 (consigna 174, error 114) es casi seguro un
  valor de caché atrasado de un segundo, no una consigna real.
- **Propuesta retirada:** no suscribir `ap.heading` /
  `wind.direction` / `wind.true_direction` para "arreglar" el re-anchor.
  Activaría el camino de N5, que tiene su propio fallo (GPT, sección
  F05). Queda decidir si se quita el re-anchor del backend o se arregla
  N5 primero.

**3.3 Gemini 2.2 descartado.** Dice que al pasar de `wind` a `true wind`
pypilot lleva el ángulo aparente al número del real. Los datos de 3.2
indican que pypilot recalcula la consigna al cambiar de modo. Falta
comprobar en el código fuente de pypilot el caso concreto `wind` ↔
`true wind` (los dos ejemplos son cambios desde compás). Pendiente de
verificar, sin cambio de código por ahora.

**3.4 Gemini 2.3 descartado.** `apSetModeAndWait` sí lanza un error al
agotar el tiempo (`app.js` ~12304, Rev541).

**3.5 Gemini 2.6 descartado.** `trueWindAvailable` no es una lista fija:
`pypilotModes` se actualiza con cada `ap.modes` de pypilot
(`autopilot-provider.ts` ~377). Si pypilot pierde el viento real, lo
quita de la lista y AUTOWIND no se apaga.

**3.6 Gemini 2.7 descartado.** Mismo motivo que 3.1.

**3.7 Críticas de GPT a las propuestas de Claude.** Las acepto:
- **6 kn:** es una propuesta operativa sin validar, no arregla nada de lo
  anterior.
- **Bloquear el cruce de ±180°:** evita la orden de cambiar de costado,
  pero no que el barco cruce la popa persiguiendo una consigna aparente
  inalcanzable (la de -133,7°).
- **Sobrecorriente y router:** atribuirlos al hardware o al router
  necesita mediciones; no hay que subir la corriente ni tocar la virada
  solo por esos síntomas.

## 4. Plan de arreglo propuesto (en orden)

**Fase 1 — ciclo de vida de las maniobras** (causa del fallo y alarmas
apagadas). Arregla el fallo y N1, N4 y N8.

1. Separar "cerrar la maniobra" (apagar el aviso, temporizadores, HUD)
   de "restaurar parámetros" (ganancias, perfil, modo). El cierre es
   idempotente y lo usan todas las salidas: fin, resumen cerrado a mano,
   cancelar, cambio de modo y elegir AUTOWIND. Siguiendo a GPT, no
   llamar sin más a `empopadoTearDown` desde el resumen, porque relanza
   restauraciones.
2. `empopadoFinish` apaga el aviso al terminar, igual que
   `aproadoFinish`.
3. La renovación cada 20 s solo envía `true` si su propia maniobra sigue
   en `transit`/`active`. Si no, envía `false` y se para. Así, cualquier
   olvido futuro se corrige solo en ≤ 20 s.
4. Elegir AUTOWIND (o cualquier modo) cierra antes la maniobra en curso,
   también en `summary`.
5. Restauraciones con identificador de maniobra: si el patrón ya eligió
   otro perfil, no se pisa.
6. `/maneuver-state` con identificador de maniobra en vez de un
   booleano global.

**Fase 2 — órdenes de AUTOWIND** (N2, N3, N7, N9).

7. `setMode` rechazado durante una virada virtual = fallo explícito. Sin
   modo confirmado no se cambia el perfil.
8. Un identificador de operación en `_autowindApply`: tras cada `await`,
   si AUTOWIND se apagó o hay una orden más nueva, no se escribe nada
   más.
9. `lastSwitchMs` solo tras un cambio confirmado. Los fallos llevan su
   propio tiempo de reintento.
10. `_autowindState` publica `blockedReason` y `lastError`. El visor los
    muestra junto a "AUTO" (ES/EN/DE/FR). Bloqueos y fallos van al log
    normal, con límite de frecuencia.
11. La detección de "el patrón pasó a compás desde fuera" funciona
    también estando bloqueado.

**Fase 3 — datos** (N6, N10).

12. TWA/TWS con su antigüedad: datos viejos = bloqueado, con motivo. Un
    hueco en las muestras reinicia los 10 s.
13. Banda de histéresis: Carlos decidió (2026-11-05) que un segundo
    dentro de la banda **sí** reinicia la espera. Se queda como está.

**Estado:**
- Fase 1 hecha en Rev630 (commit `770f78e`). QA en puerto de Carlos
  2026-11-05 23:00 correcta: 4 de 4 pruebas, verificadas en el journal y
  la traza.
- Fase 2 hecha en Rev631 (commit `be41c6e`).
- Fase 2: QA en puerto de Carlos 23:18-23:24 correcta (3 de 3).
- Fase 3 hecha en Rev632: datos de viento con más de 10 s no cuentan,
  con salto a la segunda fuente; un hueco de más de 3 s entre muestras
  reinicia la espera de 10 s; test con los datos reales del 5/11.
- Rev632 corrige además el botón de modo durante Aproado/Empopado (decía
  REAL/APARENTE en vez del nombre de la maniobra; venía de Rev425).
- Las tres fases están desplegadas en la Pi y sin publicar.

**Aparte** (no son AUTOWIND; a decidir):
- N5 / re-anchor del backend (ver 3.2);
- N12 y N13 de la racha;
- el ±1/±10 que cruza los 180° y el viento mínimo, como ajustes
  operativos para hablar con Carlos.

**Pruebas de aceptación** (inversas a las reproducciones de GPT):
- cerrar el resumen del Empopado → ninguna renovación `true` más;
- elegir AUTOWIND con Empopado activo → Empopado cerrado antes;
- rechazo de `setMode` → sin cambio de perfil;
- apagar AUTOWIND con `setMode` en vuelo → sin escritura de perfil;
- restauración tardía → no pisa el perfil nuevo;
- repetir los datos del 2026-11-05 → cambia a las 17:52:02 sin maniobra
  y no cambia con una maniobra viva de verdad.

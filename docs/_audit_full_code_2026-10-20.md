# Auditoría de código completa — signalk-pypilot-newui Rev530 (2026-10-20)

Método: revisión de las rutas que escriben en el piloto, de los automatismos
activos en la configuración real del barco y repetición de los detectores
sobre los datos grabados (sesiones del 10 al 19/10 y traza de maniobras del
18/10, 16:09-21:16).

Automatismos activos en la Pi hoy: `gustStrategy = freeze-target`,
`steerRecoveryEnabled = true`, `profileAdvisorEnabled = true`,
`leewayAdjustment = 10` (solo publica un dato). Desactivados:
`autoDisengageOnLostAuthority`, `autoProfileEnabled`, `autowindEnabled`
(apagado en este momento), `rollFfGain = 0`, `tackCatchupDeg = 0`.

---

## C1 — CRÍTICO: "congelar objetivo en racha" deshace las órdenes del patrón

Archivo: `src/index.ts`, `_applyGustStrategy` (rama `freeze-target`) y
`_releaseGustStrategiesIfExpired`.

Qué hace: cuando detecta una racha (AWS sube >= 5 kn en 5 s y la escora
cambia >= 2°) con el AP en `wind` / `true wind`, guarda el objetivo actual y
durante 12 s lo **reescribe cada segundo** en `ap.heading_command`.

Fallos:

1. **Pisa cualquier cambio de objetivo durante esos 12 s**: ±1 / ±10 del
   visor, del mando a distancia, de KIP o de pypilot. **Demostrado en la
   traza del 18/10:**
   - 18:13:29 el objetivo pasa de -165 a -175; a las 18:13:30 vuelve a -165.
   - 18:33:15 el objetivo pasa de 168.5 a 158 (un -10); a las 18:33:16
     vuelve a 168.5.
2. **No se libera al cambiar de modo**: si en esos 12 s se pasa a compás
   (el patrón, o una virada virtual, que gira en compás), escribe el ángulo
   de viento (p. ej. 40) como rumbo de compás: el barco iría a 040°. Lo
   mismo con AUTO WIND aparente -> real (escribe el AWA como TWA).
3. **No se libera con una virada**: ni con la virada nativa de pypilot
   (`ap.tack.state`), ni con la virtual, ni con aproado / empopado. Al pasar
   proa al viento el AWS sube de golpe y la escora cambia de banda, que es
   justo lo que detecta como racha. Si salta al principio de la virada, el
   objetivo de antes se reescribe encima del nuevo.
   **Probable causa de "la virada se para a la mitad"** (no demostrado:
   la traza del 17/10 a las 20:14, donde saltó 6 s antes de una virada, ya
   se ha borrado).
4. **Salta muy a menudo**: repitiendo el detector sobre las sesiones
   grabadas salen **49 congelados en 7 navegaciones**, uno cada 1-3 minutos
   con viento de 15-25 kn. Algunos los disparan cortes del anemómetro
   (AWS 0.0 -> 6 kn). La escora de 2° confirma casi cualquier cosa.
   La traza del 18/10 coincide segundo a segundo con el replay: 12 escrituras
   seguidas del mismo objetivo en cada congelado.
5. **No aporta nada**: en `wind` / `true wind` pypilot no mueve el objetivo
   por su cuenta (es un ángulo de viento fijo). "Congelarlo" solo tiene
   efecto cuando alguien lo cambia, y entonces lo deshace.

Arreglo propuesto (a elegir):

- **A (recomendado, "menos es más")**: `freeze-target` deja de reescribir.
  Queda como aviso, igual que `warn`. Mientras tanto, mitigación inmediata
  sin tocar código: poner `gustStrategy = warn` en la configuración.
- **B**: mantenerlo, pero que se libere en cuanto: cambia el modo, se
  desconecta el AP, empieza una virada (nativa, virtual, aproado /
  empopado) o el objetivo cambia por otra vía. Que no empiece durante una
  virada ni en los 20 s siguientes. Que descarte las lecturas de AWS a 0.

---

## M1 — MEDIO: "Auto-desconexión por pérdida de control" cuenta las viradas

`src/index.ts`, bloque `autoDisengageOnLostAuthority` en `_supervisorTick`.

Usa el RMS del error en 1 minuto (> 30°) con el servo trabajando > 90 % del
tiempo durante 10 s. Una virada de 90-100° mete 10-20 s de error grande en
la ventana: el RMS supera 30° fácilmente, y con viento fuerte el servo
trabaja casi todo el tiempo. Podría **desconectar el AP justo después de
virar**. No excluye ni la virada nativa, ni la virtual, ni aproado.

Hoy está **desactivado** en el barco. Arreglo: no evaluar durante una
maniobra ni en los 30 s siguientes.

Además, cuando el propio plugin desconecta por este motivo, salta también la
alarma "AP quitado desde fuera de la app" y se abre un incidente en la caja
negra. Es un mensaje equivocado, aunque la alarma de emergencia propia ya
avisa.

## M2 — MEDIO: detector de rachas del backend sin filtro de cortes del anemómetro

Mismo detector que C1. Con la estrategia `warn` solo produce avisos falsos,
pero los produce: AWS 0.0 -> 6 kn al volver la lectura cuenta como racha de
6 kn. Arreglo: ignorar muestras con AWS = 0 o sin actualizar.

## B1 — BAJO: `/config/import` puede reactivar `allowWrites`

`src/index.ts` `POST /config/import`: guarda `bundle.pluginOptions` sobre la
configuración sin mirar `allowWrites`. Las escrituras a pypilot sí están
protegidas (se filtran en `PypilotClient.set`), pero un backup importado
puede volver a poner `allowWrites = true`. Requiere sesión de Signal K, así
que el riesgo es bajo. Arreglo: no tocar `allowWrites` desde el import, o
exigir `allowWrites` para importar.

## B2 — BAJO: textos del servidor en `innerHTML` sin escapar

`public/app.js:5916` (`restore.failed` + `detail`) y `public/app.js:14756`
(`j.error || j.detail`). Vienen de nuestro propio backend, así que no es
explotable desde fuera, pero un mensaje de error con `<` rompe el HTML.
Arreglo: `textContent` o escapar.

---

## Revisado sin fallos

- Escrituras a pypilot: todas pasan por `PypilotClient.set`, que respeta
  `allowWrites` y no escribe con el núcleo de pypilot caído.
- AUTO WIND: bloqueado durante viradas y aproado; desactiva el perfil
  automático por viento; se apaga si el patrón elige compás / GPS.
- Ciclo de recuperación del servo: el patrón gana si da una orden durante
  el hueco; no dispara la alarma de AP quitado.
- Perfiles: el perfil temporal por racha respeta un cambio manual hecho
  durante la ventana.
- Timers del backend: todos se limpian al parar el plugin.
- Caja negra: ids validados contra path traversal; borrar exige
  `allowWrites`; máximo 50 archivos.

## Pendiente de comprobar (necesita pypilot real)

- Al reconectar el AP tras el ciclo de recuperación, ¿pypilot mantiene
  `ap.heading_command` o lo cambia por el rumbo actual? Si lo cambia, se
  pierde el objetivo de antes del atasco.

---

## Estado tras la revisión (Rev531-532)

- **C1 arreglado en Rev531** (opción A): "Congelar objetivo" eliminado.
  Una configuración guardada con `freeze-target` se lee como `warn`.

## Revisión externa GPT — bloque 1 (núcleo del piloto)

Los 5 hallazgos, verificados contra el código y arreglados en Rev532, con
un test cada uno en `src/test/virtual-tack-sailor.test.ts`:

| # | Gravedad | Fallo | Arreglo Rev532 |
|---|---|---|---|
| 1 | Crítico (ventana estrecha) | Reintento de `setTarget` / `adjustTarget` (hasta 1 s) solo miraba `targetGen`: un rumbo de compás 120 reintentado tras pasar a viento llegaba como AWA 120. | El reintento se anula también si cambió el modo (`modeGen`). |
| 2 | Crítico | `adjustTarget` (±1/±10 de KIP, API SK, acciones PUT) escribía el objetivo directamente durante una virada virtual, peleando con la maniobra. | Durante la virada va a `adjustVirtualTack` (re-apunta el destino, como el visor). |
| 3 | Crítico | Relevo de la virada a modo viento: escribía el objetivo final justo tras el eco del modo; pypilot podía machacarlo (misma carrera que la cancelación de Rev515). | Espera 0.4 s, escribe, comprueba a 1.2 s y reescribe. Test: sin el arreglo el objetivo se queda en el valor de pypilot (4), con el arreglo en -45. |
| 4 | Crítico | `tack()` (KIP, API SK, acciones PUT, intercepción `/raw`) llamaba directo al motor: una segunda orden reiniciaba la virada a mitad de giro y se saltaba la confirmación de trasluchada larga. | `tack()` pasa por `startVirtualTack`: una virada a la vez y misma confirmación (sin diálogo => se rechaza). |
| 5 | Alto | Un "off" real (mando) dentro de la ventana de eco del engage se descartaba como eco viejo; pypilot solo lo envía al cambiar, así que el visor podía quedarse en AP ON. | Se guarda el último valor real de pypilot y al cerrar la ventana se reconcilia. |

## Revisión externa Gemini — bloque 1 (núcleo del piloto)

13 hallazgos verificados contra el código (los números de línea de Gemini
no coinciden con el archivo; se localizaron por función). 7 aceptados y
arreglados en Rev533, 6 descartados con motivo.

| # | Veredicto | Detalle |
|---|---|---|
| 1 | **Aceptado** | Virada en compás normalizaba a ±180: de 120 a estribor salía -140. Que pypilot lo trunque a 0 NO está demostrado (las trazas muestran objetivos negativos en viento), pero el valor correcto en compás es 0..360. Arreglo: `setTarget` envía compás en 0..360 y viento en -180..180. Test: 220. |
| 2 | **Aceptado** | Cambio de modo con AP conectado: el re-anclaje se escribía justo tras el modo y pypilot podía machacarlo (misma carrera de Rev515). Arreglo: espera eco + 0.4 s, comprueba, reescribe una vez si pypilot lo movió > 5°; cualquier orden nueva lo anula. |
| 3 | Ya arreglado | Igual que GPT #3 (Rev532). |
| 4 | **Aceptado** | Un sobrepaso leve del rumbo final (o un -10 del patrón que deja el final detrás de la proa) forzaba un giro de 360. Arreglo: en el último tramo, hasta 30° de sobrepaso = llegado. Antes del último tramo se mantiene la vuelta larga pedida (trasluchada de 340°, test existente). |
| 5 | **Aceptado** | Un eco tardío del objetivo ANTERIOR dentro de la ventana se tomaba como orden externa: el objetivo rebotaba y un segundo +1 contaba desde el valor viejo. Arreglo: se guarda el valor previo y ese eco se descarta. Test: +1 +1 = 42 aunque llegue el eco viejo 40. |
| 6 | **Aceptado** | `adjustTarget` sin normalizar: -10 en 005 salía -5. Mismo arreglo que #1. Test: 355. |
| 7 | **Aceptado** | La virada virtual leía primero `navigation.headingTrue` y escribía esos rumbos a pypilot en su marco magnético. En Vigo la diferencia es 0.9°, con 15° de declinación serían 15°. Arreglo: primero `ap.heading` de pypilot. |
| 8 | Descartado | `tack-catchup`: `direction` es el sentido del giro, no la amura final; el signo es correcto. Además solo publica un dato y está a 0 en el barco. |
| 9 | Descartado | `setNavMode`: si el engage diferido falla, `setState` ya revierte el estado y el visor muestra OFF; no hay "falso enganchado". |
| 10 | Descartado | Confirmar trasluchada larga solo tras cancelar: decisión de Carlos en Rev515 (7 confirmaciones en una tarde de trasluchadas deliberadas). |
| 11 | **Aceptado (bajo)** | AUTO WIND con TWA 0..360: 330 se leía como popa. Signal K lo da firmado, pero normalizar no cuesta. Test. |
| 12 | Descartado | Latencia del ping: solo es un dato mostrado; la vida del enlace usa la hora del último pong. |
| 13 | Descartado | Tipos de `TackDirection`: compila y el uso es coherente. |

## Revisión externa GPT — bloque 2 (`src/index.ts`)

Los 8 hallazgos verificados en el código y arreglados en Rev534.

| # | Gravedad | Fallo | Arreglo Rev534 |
|---|---|---|---|
| 1 | Crítico | `/maneuver-state` (aproado / empopado del visor) era un booleano sin caducidad: un navegador cerrado a mitad dejaba silenciadas las alarmas de desvío / deriva / sin gobierno y bloqueado AUTO WIND para siempre. | Caduca a los 60 s; el visor lo renueva cada 20 s mientras dura la maniobra. |
| 2 | Crítico | "Cancelar virada" desde KIP (`actions.tack=cancel`, `tackInt=0`, interruptor) solo escribía `ap.tack.state=none`: la virada virtual seguía. | `_cancelAnyTack` cancela también la virada virtual. Lo mismo un `none` por `/raw`. |
| 3 | Crítico | Engage / disengage por PUT (KIP, interruptor) respondía 200 antes de saber el resultado; el interruptor publicaba el estado PEDIDO. | PUT asíncrono de Signal K: `PENDING` y el resultado real por callback (502 si falla). El interruptor refleja el estado confirmado. |
| 4 | Alto | `/config/import` sin `allowWrites`, y podía reactivarlo. (Era mi B1.) | Exige `allowWrites`; el backup nunca cambia `allowWrites`. |
| 5 | Alto | Racha "D +20 %": al acabar restauraba el D viejo aunque el patrón lo hubiera cambiado. | Solo restaura si D sigue siendo el valor subido y el mismo piloto. |
| 6 | Alto | AUTO WIND solo leía `speedTrue` / `angleTrueWater`. | Mismo orden de fuentes que el muestreador (`speedOverGround`, `angleTrueGround`). |
| 7 | Alto | ACK de alarma no se publicaba si el mensaje no cambiaba: el resto de apps (OpenPlotter, KIP) seguían con "sound". | El ACK fuerza la publicación en el siguiente tick. Test. |
| 8 | Medio | `/virtual-tack/status` daba `active:true` en `completed/cancelled/failed`. | Fases terminales reales. |

Pendiente menor (no tocado): otras acciones PUT (nudge, tack) también
responden 200 sin esperar el resultado, y `/ap/tack/:direction` sin
proveedor responde ok aunque las escrituras fallen (en el barco el
proveedor siempre está activo).

## Revisión externa GPT — bloque 3 (seguridad / alarmas / diagnóstico)

Los 10 hallazgos verificados en el código y arreglados en Rev535 (tests en
`src/test/review3-fixes.test.ts`).

| # | Fallo | Arreglo Rev535 |
|---|---|---|
| 1 | Salud del servo: la referencia se adaptaba con alfa 0.02 por muestra a 1 Hz (~50 s): una sobrecarga sostenida pasaba a "normal" en ~26 s y la alarma de 60 s nunca saltaba. | Las muestras > 1.3 x referencia no mueven la referencia. Test: 1 A aprendido, 3 A tres minutos = "high". |
| 2 | Doctor: no comprobaba si pypilot aceptó crear el perfil nuevo, y escribía la ganancia sin esperar el cambio de perfil: podía tocar el perfil ORIGINAL diciendo "en perfil nuevo". | Espera (hasta 3 s) a que pypilot confirme el perfil nuevo; si no, no aplica nada. Comprueba el resultado de cada escritura. |
| 3 | Doctor: una segunda sugerencia se aplicaba aunque el patrón hubiera cambiado de perfil / piloto. | Rechaza si el perfil activo ya no es el del Doctor o si cambió el piloto medido. |
| 4 | Doctor: "un cambio por diagnóstico" solo se imponía en "aplicar todo". | También en "aplicar una". |
| 5 | Doctor: nombre de perfil al minuto (`doctor-AAAAMMDD-HHMM`), dos diagnósticos en el mismo minuto compartían perfil. | Segundos + sufijo si ya existe. |
| 6 | Calidad de sensores: un valor con timestamp de hace una hora contaba como recién llegado ("good"). | Timestamp de origen > 60 s = no es llegada nueva. Test. |
| 7 | Calidad de sensores: `value: null` contaba como lectura. | null = sin dato. Test. |
| 8 | Silenciar una alarma que suena no retiraba el "sound" publicado. | Silenciar = ACK + publicación inmediata. Test. |
| 9 | Cambiar la gravedad de una alarma activa no se publicaba. | Se publica en el siguiente tick. Test. |
| 10 | Registro de fallos del servo: error en modo viento = objetivo de viento - rumbo de compás (135° en vez de 0°). | Usa el error según el modo (mismo que los KPI). |

Gemini — bloque 2: rechazado por el modelo ("políticas de seguridad").
Variante del prompt sin el apartado HTTP en
`docs/_prompt_llm_full_audit_2026-10-20.md`.

## Revisión externa Gemini — bloque 3 (seguridad / alarmas / diagnóstico)

Revisó una copia Rev530 (sin los arreglos de Rev534-535). 13 hallazgos:
5 aceptados y arreglados en Rev536, 8 descartados.

| # | Veredicto | Detalle |
|---|---|---|
| 1 | Ya arreglado | ACK no publicado: Rev534. |
| 2 | **Aceptado** | Una alarma silenciada no se resolvía nunca durante el silencio (seguía roja con la condición ya desaparecida). Arreglo: silenciada = no vuelve a saltar, pero se resuelve si la condición desaparece. Test. |
| 3 | **Aceptado** | "AP quitado desde fuera" exige velocidad conocida >= 1 kn (Rev522); sin GPS no avisaba nunca. Arreglo: si no hay SOG usa la corredera (STW). Sin ninguna de las dos sigue sin avisar (en puerto daba falsos). |
| 4 | **Aceptado (bajo)** | `unable-to-steer` con RMS NaN: ahora exige número finito. |
| 5 | Descartado | `minHz > 1` a 1 Hz: ningún umbral por defecto usa `minHz` (quitado a propósito en Rev98). |
| 6 | **Aceptado** | Doctor no respetaba el rango de pypilot para la ganancia: ahora la limita al min/max del catálogo; si ya está en el límite, no aplica. (allowWrites y el resultado de la escritura ya se comprueban desde Rev535.) |
| 7 | Descartado | Con I = 0 el Doctor no propone nada (condición `I > 0`), no propone 0 -> 0. |
| 8 | Descartado | `appendFileSync` solo al registrar un fallo de servo (una línea, muy de vez en cuando). |
| 9 | Descartado | `failsafe-bsp` ya convierte nudos a m/s. |
| 10 | **Aceptado (bajo)** | Duración negativa en "pypilot desconectado" tras un salto atrás del reloj: `max(0, …)`. |
| 11 | Descartado | Alarmas de atasco desactivadas por defecto: regla de producto (opt-in); activadas en el Tunatunes. |
| 12 | Descartado | El JSONL ya ignora líneas rotas (`try/catch` por línea). |
| 13 | Descartado | `unable-to-steer` silenciada en maniobra aunque haya fallo de sobrecorriente: decisión de Rev508 (test que lo exige); el atasco en virada lo vigila steer-watch tras su espera de 20 s. |

## Revisión externa Gemini — bloque 4 (grabación / almacenamiento)

Llegó en dos partes (faltó el #1). 4 aceptados y arreglados en Rev537,
el resto descartados.

| # | Veredicto | Detalle |
|---|---|---|
| 2 | Descartado | `appendFileSync` cada 30 s (unos KB, a la caché de página, sin fsync): no bloquea cientos de ms. El gobierno lo hace pypilot en la TinyPilot, no este proceso. |
| 3 | **Aceptado en parte** | Ids de viaje de la URL sin validar al construir rutas (`trip-${id}`). Arreglo: solo el formato que crea el grabador (`YYYYMMDD-HHMMSS-NNNNN`); los 28 viajes de la Pi lo cumplen. **Retención descartada**: la bitácora es dato del patrón y ocupa ~2 MB por salida (94 MB en total, disco con 136 GB libres). |
| 4 | **Aceptado en parte** | `visor-prefs` ya escribía con tmp + rename. `display-presets` no: ahora sí. |
| 5 | Descartado | `list()` de la caja negra: solo al cambiar algo; hoy 152 KB en total. |
| 6 | **Aceptado** | Ah / millas / tiempo de los KPI integraban con dt fijo de 1 s: ahora tiempo real entre muestras (máx. 5 s). |
| 7 | **Aceptado** | Contador de viradas / trasluchadas de los KPI contaba cada ola en popa redonda (AWA ±175). Ahora el lado solo cuenta en 15-70° y 110-165°, como la bitácora (Rev453). Test. |
| 8 | Descartado | Los episodios ya están acotados (`historyCapacity`). |
| 9 | Descartado | Sesión sin línea final tras un corte: la lista ya la maneja (`endTs` null). |
| 10 | Descartado | El registro de cambios de perfil no lee un archivo completo al arrancar. |
| 11 | Descartado | La traza serializa cada evento al registrarlo (`JSON.stringify`): no puede cambiar después. |
| 12 | Descartado | Los presets ya pasan por `sanitizeData`. |

## Revisión externa GPT — bloque 4 (grabación / almacenamiento)

Los 12 hallazgos verificados y arreglados en Rev538 (tests en
`src/test/review4-fixes.test.ts`).

| # | Gravedad | Fallo | Arreglo Rev538 |
|---|---|---|---|
| 1 | Crítico | Restaurar un backup podía enviar `ap.enabled`, `ap.heading_command`, `ap.tack.state`, `ap.mode` o mandos del servo. | Lista de claves que un restore nunca escribe (órdenes, no ajustes). Test. |
| 2 | Alto | Las ganancias se escribían en el perfil activo si `profile` venía después en el JSON. | Se selecciona primero el perfil del backup y se espera la confirmación de pypilot; si no llega, no se restaura nada (409). |
| 3 | Alto | La copia buscaba `info.persistent`; pypilot da `persistent` / `profiled` arriba: las ganancias no se copiaban. | Se leen los dos formatos y los flags de ganancia. Test. |
| 4 | Alto | "Aplicado" aunque pypilot rechazara la escritura. | Escritura rechazada = error en el informe. Test. |
| 5 | Alto | Sesiones, viajes y trazas vaciaban el búfer antes de escribir: un fallo (disco lleno) perdía esas muestras. | Si la escritura falla se conservan para el siguiente volcado (máx. 5000 líneas). |
| 6 | Alto | Se podía borrar la sesión que se está grabando (luego se recreaba sin cabecera). | Rechazado, como en la bitácora. |
| 7 | Alto | La limpieza borraba sesiones de 30 muestras que `stop()` había conservado (contaba 29 s). | Misma regla: N muestras = N segundos. |
| 8 | Alto | Cambiar de modo creaba un "episodio" comparando compás con viento (-135°). | El cambio de modo reinicia la referencia. Test. |
| 9 | Alto | Un hueco de datos no cortaba la estabilización ni el tiempo máximo del episodio. | Hueco = rompe la continuidad y se comprueba el tiempo máximo. |
| 10 | Alto | En viento real sin TWA el error se calculaba con AWA (error inventado que alimentaba alarmas). | Sin TWA el error es desconocido. Test. |
| 11 | Alto | Modo puerto: una lectura 0, diez minutos sin datos y otra 0 bastaban. | Sin lectura se reinicia la cuenta; los 2 min tienen que ser seguidos. Test. |
| 12 | Medio | Un incidente de la caja negra podía crecer sin límite si los eventos no paraban. | Se escribe a los 15 min / 100 eventos; lo que siga abre otro. Test. |

## Revisión externa GPT — bloque 5 (visor: `app.js`)

Los 11 hallazgos verificados y arreglados en Rev539.

| # | Gravedad | Fallo | Arreglo Rev539 |
|---|---|---|---|
| 1 | Crítico | Al terminar aproado no se paraba la renovación de "maniobra activa" (Rev534): alarmas de desvío silenciadas mientras la página siguiera abierta. | `aproadoFinish` lo apaga. |
| 2 | Crítico | Cancelar aproado / empopado mientras esperaba el cambio de modo no impedía enviar luego objetivo y conectar el AP. | Tras cada espera se comprueba que sigue siendo la misma maniobra en tránsito. |
| 3 | Crítico | `apSetModeAndWait` seguía si el modo no se confirmaba: aproado podía enviar 0 en compás (= rumbo norte). | Rechazo o sin confirmar = error; no se envía el objetivo. |
| 4 | Crítico | Selector de modo: modo y objetivo en paralelo (`Promise.all`); el ángulo de viento podía llegar antes y valer como rumbo de compás. | Primero el modo confirmado, luego su objetivo. |
| 5 | Crítico | Un ±1/±10 pendiente (debounce) calculado en compás se enviaba aunque el modo hubiera cambiado. | Se descarta si cambió el modo. |
| 6 | Crítico | Tras un cambio de objetivo desde fuera (mando, KIP) la ráfaga de ±10 seguía desde el valor local viejo (100 + 10 = 110 en vez de 120 + 10). | Un objetivo que no envió este visor reinicia el acumulador. |
| 7 | Crítico | Fondeo: un AIS con velocidad desconocida quedaba silenciado y nunca se consultaba su velocidad. | Se consulta y se vuelve a decidir. |
| 8 | Crítico | El descarte del banner era por regla: una alarma que se apaga y vuelve a saltar entre dos consultas quedaba oculta. | Descarte por activación (regla + hora de inicio). |
| 9 | Alto | Empopado: el cambio de perfil final no esperaba a la restauración de ganancias. | Ganancias primero, perfil después. |
| 10 | Alto | Importar perfil: seguía aunque no se creara / activara el perfil nuevo y contaba escrituras fallidas como aplicadas. | Espera a que pypilot confirme el perfil nuevo; solo cuenta escrituras aceptadas. |
| 11 | Alto | TWS alternativa (`speedOverGround`) se quedaba congelada en su primer valor. | Se actualiza mientras no llegue `speedTrue` (10 s). |

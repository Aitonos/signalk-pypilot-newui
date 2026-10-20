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

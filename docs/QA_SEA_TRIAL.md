# QA agua — Rev299 → Rev314 (signalk-pypilot-newui)

Fecha ficha: 2026-09-25. Barco: Tunatunes.

Este documento se lleva impreso o abierto en el móvil (Tailscale + Chrome
apuntando al Pi). Marca cada punto **OK / NO / NC** (no comprobado) y
manda screenshots de lo que salga raro por el canal habitual.

**URLs útiles desde el móvil (Tailscale conectado):**
- Visor: `http://100.127.222.27:3000/signalk-pypilot-newui/`
- Data Browser SK: `http://100.127.222.27:3000/admin/#/dataBrowser`

---

## Fase 0 — Antes de zarpar (muelle en calma)

Con la webapp abierta en Setup del visor, verifica que sale:

1. **Comprobación del piloto** (arriba a la izquierda): la caja verde
   pone `11√ 0! 0X` o similar. Si sale rojo, mira detalle antes de
   salir.
2. **Piloto Inteligente** → sub-sección **Ayudas de sensores**:
   - Slider "Ajuste del abatimiento" a 0 (default) o al valor que
     usarás en agua (típico 9-12).
   - Slider "Velocidad de reserva" a 0 o 6 kn.
   - Línea `Fuente de velocidad:` → debe decir **sonda** (o **GPS**
     si no tienes speedómetro).
3. **Alarmas** (card 2, la buena con el resumen "0 sonando · X
   vigilando · Y off"):
   - Banner naranja "Modo legacy" si nunca guardaste selección.
   - Marca **attitude-heel-extreme** con umbral bajo (25° para poder
     comprobar en la primera escora sostenida).

**No zarpes sin:**
- Móvil con Tailscale conectado (probar `100.127.222.27` responde).
- Portátil en casa encendido con NordVPN **apagado** (memoria
  `feedback_nordvpn_breaks_tailscale`).
- Esta sesión de Claude Code abierta en el portátil por si necesitas
  cambios remotos vía claude.ai.

---

## Fase 1 — Saliendo del puerto (motor, calma, sin escora)

4. **Failsafe BSP** (H2): con la sonda funcionando, la fuente sigue
   siendo **sonda**. Si en algún momento el pill cambia a **GPS
   (proxy)** o **valor de reserva** sin motivo, screenshot.
5. **Leeway** (H4): con heel ≈ 0, `steering.autopilot.pypilot.derived.leewayRad`
   sale 0 o casi. Correcto físicamente. Comprueba en Data Browser.
6. **Attitude alarms** (I1): en calma no debe disparar nada. Si
   dispara `attitude-heel-extreme` sin escora, screenshot.

---

## Fase 2 — Navegando en ceñida (escora sostenida)

7. **Leeway** con escora ≥ 10°: `derived.leewayRad` debe salir positivo
   (deriva a babor) con escora estribor. Ejemplo esperado con `adj=10`,
   heel=15°, bsp=6kn → ~4.17° = 0.073 rad. Coherente con lo que hace
   el barco por ojo.
   - Si el valor es negativo o extremo (>15°), coeficiente mal.
     Prueba `adj=8` o `adj=12` desde el visor.
8. **Attitude heel extreme**: al pasar de 25° sostenido 5 s debe
   dispararse `notifications.autopilot.attitude-heel-extreme` y sonar
   la alarma en la webapp. Al volver a heel < 25° debe hacer clear.

---

## Fase 3 — Al virar (TackCatchup)

Activar SI Y SOLO SI vas a hacer viradas deliberadas:

9. En Setup, aunque no haya UI (feature en incubación), pídeme por
   claude.ai que active `tackCatchupDeg=5` y `tackCatchupTauSec=6`.
   - Alternativa: POST directo desde una terminal:
     ```
     curl -X POST http://100.127.222.27:3000/plugins/signalk-pypilot-newui/supervisor/config \
       -H "Content-Type: application/json" \
       -d '{"tackCatchupDeg":5,"tackCatchupTauSec":6}'
     ```
10. Haz un tack completo desde el visor.
11. Al terminar (`ap.tack.state` → "none"):
    - `steering.autopilot.pypilot.tuning.tackCatchup.deltaRad` debe
      subir de golpe a ~0.087 rad (5°) e ir bajando.
    - `.active` = true durante el decay, false cuando baje de 0.1°.
    - `.appliedToAp` = false (aún no aplica; solo lo publica).
12. Compara la sensación de virada con y sin catchup activo.

---

## Fase 4 — Casos especiales (probar solo si hay margen)

13. **Failsafe BSP en fallo simulado**: si te atreves, desactiva el
    plugin de la sonda durante 30 s.
    - Pill del visor pasa a **GPS (proxy)**.
    - `environment.wind.speedTrue` NO se cae (sigue calculando con
      SOG).
    - `derived.leewayRad` sigue publicándose (con SOG como
      denominador).
14. **Alarmas más agresivas**: prueba a activar `attitude-pitch-extreme`
    con umbral bajo (15°). Al zambullir la proa en ola debe disparar
    puntualmente y hacer clear.

---

## Cómo pedir cambios en el mar

**Con la app de Claude en el móvil (canal principal):**
- Es Claude "chat" — puedes pegar screenshot y describir.
- Yo te contesto qué está pasando y qué toggle mover en el visor.
- **NO puede desplegar código** en el Pi ni ver el filesystem del
  portátil; para eso hace falta la opción de VS Code Tunnel del turno
  anterior o volver al portátil.

**Trucos para tocar la config del plugin desde el móvil sin código,
solo con una terminal (Termius / JuiceSSH):**

```
# Encender TackCatchup con peak 5° y τ 6s
curl -X POST http://100.127.222.27:3000/plugins/signalk-pypilot-newui/supervisor/config \
  -H "Content-Type: application/json" \
  -d '{"tackCatchupDeg":5,"tackCatchupTauSec":6}'

# Bajar umbral heel al 25° para provocar la alarma
curl -X POST http://100.127.222.27:3000/plugins/signalk-pypilot-newui/supervisor/config \
  -H "Content-Type: application/json" \
  -d '{"alarmAttitudeHeelDeg":25}'

# Activar solo attitude-heel-extreme (silencia el resto)
curl -X POST http://100.127.222.27:3000/plugins/signalk-pypilot-newui/supervisor/config \
  -H "Content-Type: application/json" \
  -d '{"alarmsEnabled":["attitude-heel-extreme"]}'

# Volver a "modo legacy" (todas las alarmas activas) — mándalo si te
# arrepientes de la selección anterior:
curl -X POST http://100.127.222.27:3000/plugins/signalk-pypilot-newui/supervisor/config \
  -H "Content-Type: application/json" \
  -d '{"alarmsEnabled":null}'
```

Requiere solo Tailscale conectado. Ninguna auth adicional (la config
va por el propio pypilot-newui, no por el admin de SK).

**Fallback si nada de lo anterior funciona:** email/Signal con
screenshots y la Rev del visor (INFO tab). Cuando llegues al portátil
las procesamos y te contesto.

---

## Al volver a puerto — reset a valores conservadores

Si activaste **tackCatchupDeg > 0**, **attitude alarms** o **leeway**:
- Vuelve al Setup y ponlos a 0 (o desmarca) para dejar el barco en
  la configuración default hasta la próxima sesión de QA.
- El persist automático los guardará.

---

## Rev bajo prueba

Rev en vivo cuando escribes esto: `Rev314`. Comprueba en el visor
tab INFO que el número coincide. Si no, alguien ha desplegado por
detrás — dímelo.

---

## Fase 5 — Fixes post sea trial 2026-09-25 (Rev309 → Rev314)

Estos puntos son los cambios nuevos desde la última navegación. Marca
OK / NO / NC como el resto.

### 15. Botones de tack en modo WIND (Rev309) — CRÍTICO

En modo `wind` (no compass), con AWA cerca del través (±60°..±120°),
pulsa el botón hacia BABOR y luego hacia ESTRIBOR alternando. En
cada pulsación **la proa debe girar SIEMPRE hacia el lado del botón**,
sin importar si el camino corto sería tack o gybe.

- ✅ Bien: pulsas «hacia babor», la proa se mueve a babor (aunque
  cruce por popa).
- ❌ Mal: pulsas «hacia babor» y la proa se va a estribor primero.

Fix aplicado: en wind mode el visor delega en `ap.tack.state=begin` +
`ap.tack.direction=<lado>` de pypilot, en vez del synthetic AWA-swap
que causaba el bug.

### 16. Profile default persistente al abrir en otro dispositivo (Rev310)

Con la tablet ya conectada, abre el visor en el móvil.
- ✅ Bien: el `<select>` de profile carga el perfil real (por ejemplo
  `medium`, `heavy`, etc).
- ❌ Mal: se queda en `default` aunque el pypilot tenga otro activo.

Verifica que tras 3-5 s el select refleja el perfil real. El fix
prime el select con el snapshot HTTP en lugar de esperar sólo al
delta WebSocket.

### 17. Aproado sin countdown + latch sostenido (Rev311)

Ceñido con velas fuera. Selecciona modo `aproado` → `BY BOW`.
- ✅ Bien: la maniobra arranca YA (sin cuenta de 5s), la proa gira
  al viento. Cuando `|AWA| < 10°` durante 3 s sostenido, latch a
  fase «logrado». Si el AWA oscila brevemente por debajo del umbral
  y vuelve a subir, **NO debe latchar** en falso.
- ❌ Mal: sigue esperando 5 s antes de arrancar, o el "logrado"
  salta durante una oscilación de 1-2 s.

### 18. Alarmas silenciadas durante la virada (Rev312)

Con AP engaged en modo compass, mándale un tack (o el nuevo tack en
wind). Durante la fase `tacking` de pypilot:
- ✅ Bien: NO se dispara `heading-deviation`, `cruise-drift` ni
  `unable-to-steer`. El error es enorme por diseño, no queremos
  ruido en el banner.
- ❌ Mal: dispara `heading-deviation` con 20°+ de error nada más
  arrancar el giro.

Cuando `ap.tack.state` vuelve a `none`, las reglas se re-evalúan
normalmente. Verifica que si tras el tack hay un problema real (RMS
sigue alto), la alarma acaba disparando.

### 19. Contador virada cierra por estabilidad (Rev312)

Durante el executing del countdown de tack, si `_tackRotationDoneDeg`
no llega al plan (por overshoot / wind noise) pero el barco está
claramente asentado:
- ✅ Bien: en 2 s de rot < 3°/s el overlay se cierra solo.
- ❌ Mal: el número sigue subiendo indefinidamente hasta el timeout
  de 120 s.

### 20. Modo EMPOPADO (Rev313) — versión mínima

Con velas fuera, viento de través o largo. Abre el dropdown de modes,
selecciona `EMPOPADO` (o `HEAD DOWNWIND` en inglés).
- ✅ Bien: cambia a modo `wind`, target = 180° (viento por popa), y
  engancha el AP si estaba OFF. Cuando `|AWA| > 170°` durante 3 s
  sostenido, avisa por voz: "Empopado, listo para arriar".
- ⚠ Nota: esta es la versión MÍNIMA. No hay HUD elaborado ni fase
  choosing bow/stern. Pypilot elige el camino (por proa o popa). El
  arranque agresivo + gains nerviosos que pediste vienen en el
  sprint junto con Tack strategies.
- Al elegir otro modo desde el dropdown, `empopadoTearDown()` limpia
  sin restaurar el modo previo (queda el modo que elegiste).

### 21. Tablet — recorte vertical (Rev314) — DEFENSIVO

Abre cualquier card de Setup en fullscreen desde la tablet.
- ✅ Bien: se ve toda la card, scroll llega hasta el último bloque.
- ❌ Mal: la parte inferior sigue oculta / recortada, no puedes
  llegar a los botones del pie.

Cambios aplicados: `100vh` → `100dvh` en todos los modales, y
`.tab-panel` + `.setup-block[data-fullscreen="1"]` ahora incluyen
`-webkit-overflow-scrolling: touch` + `padding-bottom: max(20px,
env(safe-area-inset-bottom))`. Sin screenshot pude solo aplicar el
fix conservador — si sigue habiendo recorte, mándame screenshot con
modelo de tablet + orientación.

---

## Aplazado (sprint dedicado)

- **Tack strategies light/heavy por TWS** — infra grande.
- **Aproado agresivo (arranque tipo tack + gains nerviosos)** —
  entrelazado con el punto anterior.
- **Bug UX menores** — terminología sonda/corredera, umbrales
  heel-extreme, profile name trim, etc. Necesito detalle para cada
  uno.

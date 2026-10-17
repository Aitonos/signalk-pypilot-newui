# Audit Pi 5 Tunatunes — GPU al 94 % con pypilot-newui en Firefox (2026-10-15)

Síntoma (Carlos): la Pi va "lentísima de GPU", incluso recién reiniciada
y "sin haber abierto pypilot"; YouTube a trompicones.

Método: SSH a la Pi (Tailscale), medida de ocupación de la V3D
leyendo `/sys/devices/platform/axi/1002000000.v3d/gpu_stats` (runtime de
la cola `render`) + CPU de `/proc/stat`, ventanas de 10-15 s. Firefox de
prueba con perfil temporal + Marionette para inyectar CSS/JS en vivo sin
tocar el perfil de Carlos. Todo limpiado al acabar.

## TL;DR

1. **La Pi está sana.** Sin navegador: GPU 0 %, CPU 7-8 %.
2. **"Sin abrir pypilot" = sí estaba abierto**: el perfil Firefox de
   Carlos tiene `browser.startup.page = 3` (restaurar sesión) → al abrir
   Firefox se recarga sola la pestaña pypilot-newui.
3. **pypilot-newui pone la V3D al 94 % en Firefox** (15 % en Chromium).
   No es Firefox roto: es la página. Tres causas, medidas por separado:
   - una animación CSS infinita de `box-shadow` (`nav-toggle-glow`) que
     obliga a recomponer la ventana entera a 60 fps;
   - `transition: all` en las celdas de la rosa + 121 escrituras/s al DOM
     **con el mismo valor** (reset de clases + innerHTML en cada render);
   - rotación del SVG de la rosa (737x737) por atributo `transform` a
     8.6 Hz → re-rasterizado completo del SVG en cada dato.
4. Es exactamente el problema que ya resolvimos en mareas-ihm
   (Rev188/211/331, clase `body.m-pi-browser`).

## 1. Sistema (descartado)

| Área | Resultado |
|---|---|
| Hardware | Pi 5 8 GB, NVMe, kernel 6.12.47 bookworm, EEPROM al día |
| Throttling / temp / PSU | `0x0`, 62 °C, EXT5V 4.98 V |
| RAM / disco | 4.2 GB libres, iowait 0 % |
| X11 | glamor sobre V3D OK; Xorg 0 % GPU |
| 1-Wire GPIO19 | 5 DS18B20 reales, kthread 1 %; un único glitch "64 slaves" |
| CMA | 352 kB libres / 64 MB, sin fallos `cma_alloc` — vigilar |
| HDMI | 4 WARNING `vc4_hdmi_write_infoframe` al abrir audio HDMI — cosmético |
| Ventanas | 4 popups "Notificaciones" de OpenPlotter apiladas — sin coste GPU |

Firefox pausado con SIGSTOP → GPU 91 % → 1 %. Todo el coste es Firefox.

## 2. Navegadores (tras reboot, perfiles limpios)

| Prueba | GPU | CPU |
|---|---|---|
| Sin navegador | 0 % | 8 % |
| Firefox about:blank | 0 % | 14 % |
| Firefox admin SK | 44 % | 21 % |
| **Firefox pypilot-newui** | **91-94 %** | 38 % |
| Chromium about:blank | 0 % | 8 % |
| Chromium admin SK | 28 % | 20 % |
| **Chromium pypilot-newui** | **15 %** | 25 % |

## 3. Páginas mínimas en Firefox (fresh + maximizado 1920x1016)

| Página | GPU |
|---|---|
| Texto cambiando a 8.6 Hz, sin animación | 2 % |
| Caja 29x20 con animación de `opacity` infinita | 32 % |
| Caja 29x20 con animación de `box-shadow` infinita (= nav-toggle-glow) | **72 %** |

En Firefox/X11/V3D cualquier animación continua recompone la ventana
completa a 60 fps (sin partial present): ~32 % de suelo. Si lo animado es
un blur (`box-shadow`, `filter`), WebRender re-ejecuta el blur cada frame:
72 %. Actualizaciones discretas de texto son baratas (2 %).

## 4. Bisección en vivo sobre pypilot-newui (inyección CSS)

| Estado | GPU |
|---|---|
| A) tal cual | 94 % |
| B) sin `nav-toggle-glow` | 73 % |
| C) sin ninguna animation/transition | 53 % |
| D) + sin `filter`/`backdrop-filter` | 44 % |
| E) + sin `box-shadow`/`text-shadow` | 39-49 % |
| G) E + `#rose-card` oculto | 27 % |
| H) E + `.dash-cell` ocultas | 37 % |
| I) E + `.dash-rose` entera oculta | **2 %** |
| J) solo `.dash-rose` oculta (efectos ON) | 93 % |

Las capas ocultas (5 tabs con `opacity:0` y 2 modales fijos) **no**
afectan (ocultarlas con display:none: sin cambio).

## 5. Lo que hace la página por segundo (MutationObserver 5 s)

- **291 mutaciones DOM/s**; Firefox solo consigue 13 fps de rAF.
- **121 escrituras/s con valor idéntico al anterior**, p.ej.:
  - `dash-cell corner-xx` : `classList.remove(...11 clases)` + `add(x)`
    en cada render → 2 mutaciones por celda × 4 celdas × 8.6 Hz
    (app.js:3689).
  - celdas de esquina: `el.innerHTML = ...` en cada render → nodos nuevos
    → restyle + `transition: all` arranca (app.js:~3684).
  - `rose-speed-chip` class `wind-chip -> wind-chip` 13/s (app.js:3540).
  - `rose-hdg-deg x`, `rose-piece-awa transform`, `ais-infobox hidden`
    reescritos con el mismo valor 8.6/s.
- Rosa: `card.setAttribute("transform", rotate(-hdg))` a 8.6 Hz sobre un
  SVG de 737x737 (app.js:4743) → Firefox re-rasteriza el SVG entero.
- Animación infinita activa: solo `nav-toggle-glow` (#nav-toggle 29x20,
  style.css:859 / keyframes :867).
- `filter: drop-shadow` en `.rmk-tri` / `#rudder-marker-num`
  (style.css:2215, :2230), que se mueve con cada dato de timón.

## 6. Fix propuesto (pypilot-newui), por impacto

1. **Modo Pi-browser como mareas** (`body.pi-browser`, detección igual que
   mareas mobile.html:15628 — ojo: Firefox en Pi reporta UA
   `X11; Linux x86_64`, no aarch64; usar `X11; Linux` sin Mobile/Tablet o
   `navigator.platform`/WebGL renderer "V3D"). Reglas: animation 0.001s,
   transition 0.001s, `backdrop-filter:none`, `filter:none` en los
   marcadores. Esperado: 94 % → ~45 %.
2. **Quitar el pulso infinito de `#nav-toggle`** para todos (ya está a
   opacity 0.28 desde Rev184, el glow no aporta). Esperado: −20 pts solo.
3. **Write-if-changed** en el render: helper `setText(el,v)`,
   `setAttr(el,k,v)`, `setCls(el,cls)` que no tocan el DOM si el valor
   no cambia; celdas de esquina actualizando `.value` en lugar de
   `innerHTML`. Elimina 121 mut/s y los disparos de `transition: all`.
4. **Rosa por CSS transform**: rotar un contenedor HTML/`<svg>` propio
   de la carta con `style.transform` (compositable, sin re-raster) en vez
   del atributo SVG `transform` del `<g>`. Medir antes/después.
5. Opcional Pi: `scheduleRenderControl` 50 ms → 150-200 ms en Pi-browser
   (como `_mPollFast` en mareas).

Objetivo QA: pypilot-newui en Firefox de la Pi ≤ 20 % GPU, sin pérdida
de respuesta del AP.

## 7. Operativo (sin código)

- Mientras no haya fix: Chromium en la pantalla de la Pi, o cerrar la
  pestaña pypilot antes de cerrar Firefox (o desactivar restaurar sesión).
- El admin SK también pesa en Firefox (44 %): no dejarlo abierto.

## 8. Implementado Rev490-492 (2026-10-15) — resultados

Cambios (public/ + Rev bump):
- `nav-toggle`: glow estático, fuera la animación infinita (todos los
  dispositivos).
- Helpers `_setText` / `_setAttr` / `_setHidden` / `_setDisplay` / `_rot`
  (write-if-changed, rotaciones redondeadas a 0.1°) aplicados a:
  HDG + precisión, esquinas de la rosa (innerHTML y clases solo si
  cambian), chip inferior, rosa/AWA/TWA/diamante, capa AIS, servo health,
  barra de timón/escora.
- Modo `body.pi-browser` (script inline antes del primer paint en
  index.html). Detección: UA aarch64/armv o WebGL vendor/renderer
  `V3D|VideoCore|Broadcom` (Firefox en Pi dice "x86_64" y enmascara el
  renderer como "Generic Renderer", pero deja `UNMASKED_VENDOR=Broadcom`).
  CSS: animaciones/transiciones a 1 ms, sin backdrop-filter, sin
  drop-shadow en el marcador de timón, fondos HUD más opacos.

Medidas (Pi 5, ventana maximizada, perfiles limpios, ventanas 25 s):

| | Antes | Rev492 |
|---|---|---|
| Firefox pypilot GPU | 91-94 % | ~30 % (31-39, ruido ±8) |
| Firefox mutaciones DOM/s | 291 | ~9 |
| Firefox rAF fps | 13 | 56 |
| Chromium pypilot GPU | 15 % | 3 % |

Pendiente (no implementado, ruido de medida no permite decidir):
el ~30 % restante en Firefox es el coste por repintado del SVG de la
rosa (ocultar `#rose-card` → ~11 %). Opciones si hace falta más: capa
propia para la carta (SVG separado rotado por CSS transform) o, en
pi-browser, redondear rumbo a 1° para la rotación. Validar primero en
navegación real (en puerto el rumbo apenas cambia; en mar sube la
frecuencia de actualización).

## 9. Ronda 3 (2026-10-16) — Carlos sigue viendo 75-80 % (panel `monitors`)

Con Rev492 activa en el perfil real (pi-browser ON, 0 animaciones,
~11 mut/s) la V3D sigue en 40-50 % (render+bin+tfu). La página ya no
puede adelgazar mucho más: el coste es **el compositor GPU de Firefox
(WebRender HW) sobre la V3D**, que redibuja la ventana entera por cada
cambio.

Prefs probadas sobre una COPIA del perfil de Carlos (copia limpia por
prueba, 20 s GPU + 15 s CPU):

| Pref | GPU | CPU |
|---|---|---|
| defaults (WebRender GPU) | 36-46 % | 19 % |
| **`gfx.webrender.software = true`** | **2 %** | **20 %** |
| `layout.frame_rate = 30` | 27-32 % | 27 % |
| `gfx.webrender.max-partial-present-rects = 4` | 34-40 % | 18 % |

Vídeo 1080p VP9 (formato YouTube) a pantalla completa, 15 s, perfil
limpio, `getVideoPlaybackQuality()`:

| Modo | Frames perdidos | GPU | CPU |
|---|---|---|---|
| WebRender GPU (default) | **286/450 (64 %)** | 84 % | 88 % |
| WebRender software | **100/451 (22 %)** | 6 % | 90 % |

Conclusión: en la Pi 5, el WebRender por GPU de Firefox es peor en todo
(más GPU, igual CPU, más saltos de vídeo). Software WebRender lo arregla
para el visor y mejora el vídeo; 1080p VP9 sigue limitado por la CPU
(Pi 5 sin decoder HW VP9/AV1) → YouTube a 720p.

Incidencias durante la prueba: dos caídas largas de la conexión
Tailscale/4G (~4 h y ~2.5 h, la Pi no se reinició) y un script de
prueba propio (`/tmp/nav.py`) que se quedó en bucle al 100 % de un
núcleo + el Firefox de prueba reproduciendo el vídeo en bucle durante la
caída. Ambos matados y limpiados (reposo GPU 0 % / CPU 8 %).

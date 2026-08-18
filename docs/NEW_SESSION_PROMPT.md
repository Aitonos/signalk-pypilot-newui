# Prompt para nueva sesión — signalk-pypilot-newui / KIP buttons

Pega esto entero en la nueva sesión.

---

## Quién soy y qué quiero

Soy Carlos (armador Tunatunes). Tengo un TinyPilot (Pi Zero W) corriendo
pypilot y un Raspberry Pi 5 con OpenPlotter V4 + Signal K Server 2.11+.
Uso KIP `@mxtommy/kip` v4.8.5 como dashboard.

**Objetivo concreto que sigue SIN resolver**: quiero botones individuales
en KIP para controlar mi autopiloto pypilot desde cualquier tablet:

- Botón AP engage/disengage (toggle)
- Botones nudge -10, -1, +1, +10 grados (fijo por botón)
- Botones Tack Port / Tack Starboard / Cancel

Cada botón un widget en KIP, valor fijo por botón, click = PUT al plugin
del autopiloto.

## Qué tengo instalado / hecho

- **Plugin propio funcionando**: `signalk-pypilot-newui` en
  https://github.com/Aitonos/signalk-pypilot-newui — plugin Signal K que
  habla socket.io a `pypilot_web` del TinyPilot, publica en el modelo
  SK y sirve su propia webapp mobile-first (que SÍ funciona).
- **Absorb del provider oficial**: nuestro plugin registra
  `app.registerAutopilotProvider(iface, ['pypilot-newui'])` y expone la
  Autopilot API v2 (endpoints `/signalk/v2/api/vessels/self/autopilots/pypilot-newui/{engage|disengage|mode|target|tack/{port|starboard}}`).
  El plugin oficial `pypilot-autopilot-provider` (Panaaj) está instalado
  pero **deshabilitado** — solo debe haber un cliente socket.io al Pi
  Zero W del TinyPilot (o se cuelga).
- **Paths publicados** (todos con `$source: pypilot-newui`, `supportsPut: true`, valores iniciales válidos, `type` en meta):

  Canonicals SK Autopilot API v2:
  - `steering.autopilot.state` (string)
  - `steering.autopilot.mode` (string)
  - `steering.autopilot.target` (number rad)
  - `steering.autopilot.engaged` (bool)
  - `steering.autopilot.availableActions` (array)

  Action paths (con PUT handlers permisivos que aceptan bool/1/0/"on"/"off"/"true"/"false"):
  - `steering.autopilot.pypilot.actions.engage` (bool)
  - `steering.autopilot.pypilot.actions.engageInt` (number 1/0)
  - `steering.autopilot.pypilot.actions.nudge` (number deg, add relative)
  - `steering.autopilot.pypilot.actions.tack` (string port/star/cancel)
  - `steering.autopilot.pypilot.actions.tackInt` (number 1/2/0)
  - `electrical.switches.pypilot.ap.state` (int 1/0 — alias para Simple Switch widget)

  Todos verificados en Data Browser SK con `curl`.

## El bloqueo real

Después de ~30 revisiones, el problema es de **KIP 4.8.5** no de mi plugin.

1. **Widget "Autopilot Head" de KIP** tiene HARDCODED en su bundle main-*.js el string `pypilot-autopilot-provider`. Solo reconoce ese plugin id por nombre. Nuestro `signalk-pypilot-newui` no aparece aunque publique correctamente la Autopilot API v2.

   Warning textual:
   > Cannot add "Autopilot Head" yet. Any-of plugin is installed (pypilot-autopilot-provider) but none is active. Please manually activate and configure one or all in Signal K Plugin Config.

2. **Widgets de PUT genéricos de KIP** que sí existen (verificados por grep del bundle):
   - `widget-boolean-switch` — Boolean Switch, path bool + supportsPut
   - `widget-multi-state-switch` — Multi-state Switch, para valores discretos
   - `widget-slider` — Slider, PUT number en rango
   - `widget-button` (= WidgetStateComponent, es un toggle de estado, NO un botón click-para-PUT-valor-fijo)

   NO existe en KIP 4.8.5 un widget "Numeric Put" ni "Button-fires-fixed-value". Se lo dije al usuario por error hace varias revs.

3. **Restricción del widget picker**: cuando pongo un path como `steering.autopilot.pypilot.actions.engage` en un widget "Numeric Data" (solo display), KIP dice "Path not recognized" porque su cache local no ha refresh Y porque ese widget requiere `units` en meta. Añadí units a todos los paths (`bool`, `deg`, `enum`) pero el fundamental es que Numeric Data no hace PUT — es solo display.

## Restricciones fuertes

- **NO tocar el bundle de KIP** (se pierde al actualizar).
- **NO renombrar mi paquete a `pypilot-autopilot-provider`** (colisión NPM).
- **NO reactivar el plugin oficial + el mío en paralelo por defecto** — dos clientes socket.io saturan el Pi Zero W (comprobado). Aunque con la dieta de tráfico de Rev11 el usuario ya lo tolera si es necesario.
- Signal K Server 2.11+ (registerAutopilotProvider API disponible).
- Sesiones y token JWT ya resueltos: el usuario mete su password una vez en la webapp propia del plugin, se guarda en localStorage.

## Lo que quiero de la nueva sesión

En orden de prioridad:

**A. Si conoces el AutopilotProvider API de Signal K por dentro**: ¿es posible registrar múltiples pilot ids como aliases del mismo provider? Ej. `app.registerAutopilotProvider(iface, ['pypilot-newui', 'pypilot-autopilot-provider'])` sin colisión si el oficial está disabled. ¿SK server soporta que un plugin reclame el id de otro plugin instalado pero disabled?

**B. ¿Hay algún widget alternativo en KIP 4.8.5 que consuma la Autopilot API v2 sin whitelist por plugin id?** Un widget genérico que enumere providers dinámicamente. Nombre exacto si existe.

**C. Ideas creativas para "engañar" a KIP** para que reconozca `signalk-pypilot-newui` como si fuera `pypilot-autopilot-provider` (por ejemplo un campo del package.json, un endpoint SK que redirija, un proxy interno...).

**D. Si nada de A/B/C funciona**: la salida pragmática es reactivar el plugin oficial + desactivar el `absorbProvider` de mi plugin. Confirma si es esa la única vía o hay algo mejor.

Muéstrame código concreto o cita literal de docs SK/KIP oficiales si respondes. Sin adivinar.

## Recursos disponibles

- Repo del plugin: https://github.com/Aitonos/signalk-pypilot-newui
- Repo KIP: https://github.com/mxtommy/Kip
- Repo provider oficial: https://github.com/panaaj/pypilot-autopilot-provider
- Verificación viva de paths: `curl http://100.127.222.27:3000/signalk/v1/api/vessels/self/steering/autopilot | jq`
- Verificación del provider registrado: `curl http://100.127.222.27:3000/signalk/v2/api/vessels/self/autopilots`
- Docs Signal K Autopilot API: https://signalk.org/specification/1.7.0/doc/otherBranches.html#steeringautopilot

## Notas de la sesión anterior

Se probaron ~10 iteraciones intentando publicar paths en formatos distintos (bool, int, string, con units, con enum, con keep-alive). Todas técnicamente OK pero **ninguna resuelve el bloqueo del widget hardcoded de KIP**. Es un límite de diseño de KIP upstream, no un bug de mi plugin.

Si la respuesta correcta es "reactiva el oficial y usa Autopilot Head", dilo directo. No hace falta seguir puliendo mi plugin — el plugin ya está bien.

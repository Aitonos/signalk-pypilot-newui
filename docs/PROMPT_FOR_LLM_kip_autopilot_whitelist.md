# Prompt para LLM externo — KIP Autopilot Head widget hardcoded whitelist

## Contexto

Estoy desarrollando `signalk-pypilot-newui`, un plugin Signal K para OpenPlotter que:

1. Se conecta vía socket.io a `pypilot_web` (proceso pypilot que corre en un TinyPilot / Pi Zero, hardware autopiloto).
2. Publica todos los valores útiles bajo `steering.autopilot.pypilot.*` en el modelo Signal K.
3. Registra un **AutopilotProvider** en Signal K Server 2.x vía `app.registerAutopilotProvider({...}, ['pypilot-newui'])` — expone la Autopilot API v2 (`/signalk/v2/api/vessels/self/autopilots/pypilot-newui/{engage,disengage,mode,target,tack/{port|starboard}}`).

Esto sustituye funcionalmente al plugin oficial upstream **`pypilot-autopilot-provider`** de Panaaj (mantenido por él, Apache-2.0). El usuario tiene ese plugin oficial **instalado pero deshabilitado** (para que solo un plugin abra socket al pypilot_web y para tener toda la funcionalidad extra que el mio publica).

## El problema

En KIP `@mxtommy/kip` v4.8.5 (dashboard SPA para Signal K), el widget nativo "**Autopilot Head**" muestra:

> Warning
> Cannot add "Autopilot Head" yet. Any-of plugin is installed (pypilot-autopilot-provider) but none is active. Please manually activate and configure one or all in Signal K Plugin Config, then come back and add the widget.

**Investigación** del bundle KIP:

```
grep -a "pypilot" ~/.signalk/node_modules/@mxtommy/kip/public/main-*.js
main-F7NMHHV4.js:pypilot-autopilot-provider
```

El string `pypilot-autopilot-provider` está **hardcoded** en el bundle de KIP. El widget Autopilot Head tiene una whitelist de plugin IDs y solo reconoce ese nombre concreto. Cuando le contesta el `GET /signalk/v2/api/vessels/self/autopilots`:

```json
{"pypilot-newui":{"provider":"signalk-pypilot-newui","isDefault":true}}
```

KIP ve `provider: signalk-pypilot-newui`, no está en su whitelist → warning.

## Restricciones / no puedo tocar

- No puedo modificar el bundle de KIP (es un paquete NPM instalado por el usuario, y una modificación local sería sobreescrita al actualizar).
- No puedo renombrar mi paquete a `pypilot-autopilot-provider` (conflicto directo con el paquete oficial en el registro NPM — impide instalación).
- No quiero forzar al usuario a activar el provider oficial + el mío en paralelo (el TinyPilot es un Pi Zero W: dos clientes socket.io saturan el pypilot_web y cascadean colgando SK. Rev11 puso dieta de tráfico y una sola conexión es la solución sostenible).
- Signal K Server 2.11+; el AutopilotProvider API v2 está registrada correctamente y publico todos los canonicals (`steering.autopilot.state/mode/target/engaged/availableActions`) con `$source: pypilot-newui` y `supportsPut:true`.

## Lo que ya tenemos publicado y funcionando

- `steering.autopilot.state, .mode, .target, .engaged, .availableActions` (canonicals, siempre updates cada 30 s)
- `steering.autopilot.pypilot.actions.engage` (bool, PUT-able)
- `steering.autopilot.pypilot.actions.nudge` (number deg, PUT-able)
- `steering.autopilot.pypilot.actions.tack` (string port/starboard/cancel, PUT-able)
- `steering.autopilot.pypilot.actions.engageInt` (number 1/0, PUT-able)
- `steering.autopilot.pypilot.actions.tackInt` (number 1/2/0, PUT-able)
- `electrical.switches.pypilot.ap.state` (int 1/0, PUT-able — alias por convención OpenPlotter switch)
- `/signalk/v2/api/vessels/self/autopilots/pypilot-newui/{engage,disengage,mode,target,tack/{port|starboard}}` funcional

## Peticiones

Prioridad alta:

**A. ¿Existe algún mecanismo estándar en el AutopilotProvider API de Signal K para que un plugin "reclame" o "sea alias de" otro `providerId` como `pypilot-autopilot-provider`?** Por ejemplo, ¿se pueden registrar múltiples pilot ids como aliases del mismo provider? Ya llamamos `app.registerAutopilotProvider(interface, ['pypilot-newui'])`, ¿podríamos poner `['pypilot-newui', 'pypilot-autopilot-provider']` sin que la propia SK server rechace o el plugin oficial se pise?

**B. Si (A) es viable pero conflictivo cuando el plugin oficial también está enabled: ¿hay forma programática de detectar "official provider está installed pero disabled" y en ese caso registrar como alias `pypilot-autopilot-provider` para satisfacer whitelists downstream (KIP y otros)?**

**C. En KIP `@mxtommy/kip` v4.x concretamente: ¿alguien conoce un widget alternativo que consuma la Autopilot API v2 SIN whitelist por plugin ID?** Botón / control / display genérico que llame a los endpoints v2 `/autopilots/*/{engage|disengage|mode|target|tack}` con solo saber el `id` del provider (aquí `pypilot-newui`, no `pypilot-autopilot-provider`). Necesito nombres exactos de widget si existen.

**D. Alternativa "convencer a KIP upstream"**: escribir PR al repo `mxtommy/kip` GitHub para que el widget Autopilot Head enumere providers de la Autopilot API v2 dinámicamente en vez de hardcode. ¿Alguien tiene contacto directo con el mantenedor Tommy o David Godin? ¿Hay issue abierto con esta demanda?

Prioridad media:

**E.** Si nada de A/B/C/D funciona a corto plazo, ¿la única salida real es rendirse y reactivar el provider oficial + turn off mi `absorbProvider`? Los pros/cons de esa alternativa (2 sockets a Pi Zero vs KIP widget nativo) están claros. Solo quiero validación de un tercero de que no hay una tercera vía que se me esté escapando.

## Notas de implementación

- Repo público: https://github.com/Aitonos/signalk-pypilot-newui
- KIP src: https://github.com/mxtommy/Kip
- Autopilot API SK spec: https://signalk.org/specification/1.7.0/doc/otherBranches.html (steering.autopilot)
- pypilot-autopilot-provider oficial: https://github.com/panaaj/pypilot-autopilot-provider

Muéstrame código concreto o cita literal de docs oficiales SK si respondes A o B — no adivinéis.

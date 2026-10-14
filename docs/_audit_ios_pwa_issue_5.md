# Audit — iOS PWA (Add to Home Screen) issue #5

Autor: Claude Opus 4.7
Fecha: 2026-10-14
Reporter: @eric-fitzsimon (`iOS Add to Home Screen - Open as WebApp Does
Not Function Properly`).
Síntoma: funciona bien en Safari. Al añadir a pantalla de inicio, el
primer launch va bien; subsequent launches cargan la página pero
muchas features (Tune gain sliders, Chart) no se pueblan.

## Lo que SÍ tenemos en el shell

`public/index.html` solo lleva charset + viewport. **Cero infra PWA**:

- ❌ `<meta name="apple-mobile-web-app-capable">` no existe.
- ❌ `<meta name="apple-mobile-web-app-status-bar-style">` no existe.
- ❌ `<link rel="apple-touch-icon">` no existe.
- ❌ `<link rel="manifest" href="manifest.json">` no existe.
- ❌ Service Worker no registrado.
- ❌ Ningún `navigator.standalone` check ni comportamiento diferenciado.

Resultado: cuando Eric hace "Add to Home Screen", iOS crea un bookmark
que lanza una WebView en modo standalone (sin URL bar). Esa WebView
tiene su propio ciclo de vida y su propio contexto de storage distinto
del Safari normal.

## Hipótesis técnicas (del más probable al menos)

### H1 — iOS cachea app.js stale (más probable)

El shell `index.html` se sirve con `Cache-Control` default del
`static` middleware de express/signalk (no definido explícitamente por
nosotros). iOS Safari + WebView standalone pueden cachear
agresivamente los recursos del shell, ignorando el query string
`?v=RevNNN` que nuestro `deploy.ps1` actualiza en cada deploy.

Resultado tras el primer launch: la WebView tiene cacheado un app.js
antiguo. En runs posteriores (incluso después de un deploy nuestro),
iOS carga el app.js viejo pero el backend tiene un API nuevo →
mismatch → features rotas.

Si el user hace swipe-up para forzar close + relaunch, iOS
re-descarga parcialmente, pero el bug sigue hasta un hard reload (que
en PWA mode no se puede hacer sin remover + re-añadir).

### H2 — localStorage con contexto distinto entre Safari y PWA

Documentado comportamiento de iOS: la webapp standalone **puede**
tener un storage distinto del Safari del mismo dominio. Si el user
authorizó el token SK desde Safari (localStorage con `aisAlarmMode`,
`fullscreenAuto`, `aisHarborAuto`, SK token), al abrir desde el PWA
icon ese storage puede estar vacío.

En el primer run el visor arranca sin token → dispara el flujo
Access Request → el user aprueba desde el admin de SK → token
guardado en localStorage del PWA. En runs posteriores, SI el storage
persiste, los fetches funcionan.

Pero si iOS limpia storage (p.ej. tras unos días sin usar o por
"Reduce Website Data"), el visor queda sin token y los endpoints
devuelven 401 → el visor NO siempre muestra el modal de access
request en PWA mode (depende de ruta de fallback). Features no se
pueblan.

### H3 — Boot timing + WebSocket iOS standalone

iOS PWA tiene startup lento (~1-3 s). Nuestro `connectSK()` corre
inmediatamente al load. Si la red del dispositivo no está lista todavía
cuando se dispara el WebSocket upgrade, el intento falla silenciosamente.
Reintenta a los 2.5s (nuestro `setTimeout(connectSK, 2500)`), pero
alguna función del boot sequence (p.ej. `ensureAccessOnBoot`,
`refreshPypilotValues`) puede haber corrido en el gap y dejado estado
inicial inconsistente.

### H4 — iOS mata background WebSocket agresivamente

Cuando iOS pone la webapp standalone en background (switch a otra
app), WebSockets se cierran. Al volver a foreground, el visor debería
reconectar vía nuestro `ws.close` listener que programa
`setTimeout(connectSK, 2500)`. Pero si iOS congeló el timer, se puede
quedar sin reconectar hasta que haya una interacción del user.

Esto puede ser lo que Eric describe: "funciona primera vez" (fresh
launch con red lista) → fail subsecuente (relaunch con WebView
desenrollada parcialmente, timers congelados, etc.).

### H5 — Falta meta web-app-capable

Sin `apple-mobile-web-app-capable: yes` iOS NO entra en standalone
mode completo. El bookmark abre una vista semi-estándar donde algunas
cosas funcionan y otras no (navegación interna, por ejemplo, se abre
en Safari normal rompiendo la sesión).

## Qué información necesitamos de Eric antes de tocar

1. **Versión de iOS exacta** (iOS 17.x? 18.x?).
2. **Versión de pypilot-newui** instalada (Setup → Info tab muestra RevXXX).
3. **Qué URL exacta** tiene bookmarkada (incluye `/signalk-pypilot-newui/`?).
4. **DevTools remote logs** desde macOS Safari → Develop → iPhone →
   la webapp. Buscar errors en consola + Network tab (200/401/503).
5. **Comportamiento concreto**: ¿aparecen los valores a los pocos
   segundos aunque "no se cargan correctamente" al abrir? ¿O quedan
   permanentemente vacíos?

## Fix plan (sin implementar todavía)

### Rev-A: PWA basics en el shell (prevención)

Añadir al `<head>` de `index.html`:

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="PyPilot" />
<link rel="apple-touch-icon" href="icon.svg" />
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
```

El meta `Cache-Control` fuerza al WebView a re-pedir el shell cada
launch → arregla H1 (cache stale) sin tocar el servidor.

### Rev-B: Visibility handler que fuerza reconnect WS + refresh

Añadir `document.addEventListener("visibilitychange", ...)` que al
volver a `visible`:
1. Si `ws.readyState !== OPEN` → `connectSK()` inmediato (sin esperar
   los 2.5 s).
2. `refreshPypilotValues()` para repoblar sliders.
3. Marca `state.pypilotHealthy` como "unknown" hasta próximo /status
   poll.

Esto arregla H3 + H4.

### Rev-C: `navigator.standalone` detection + diagnostic banner

Si el visor está corriendo en standalone, log en consola, mostrar en
Info tab + añadir un botón "Reset app data" que borre localStorage y
force re-login — para que el user tenga una salida sin desinstalar.

### Rev-D (opcional): Service Worker

El fix cannonical para PWA cache. Pero añadir SW es trabajo mayor y
puede introducir sus propios bugs. Dejar para Rev siguiente si Rev-A
no basta.

## Respuesta a Eric

Mientras recojamos info, decir honestamente:
- "Zero PWA infra" en el shell → confirma por qué iOS trata al bookmark
  de forma rara.
- Pedir info de arriba.
- Mencionar Rev-A como fix inmediato que podemos empujar sin esperar
  su confirmación — es inocuo (no toca funcionalidad), solo cambia
  cómo el WebView trata el cache.

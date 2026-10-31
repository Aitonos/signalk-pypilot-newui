# Autoauditoría antes de publicar 3.9.0

Fecha: 2026-10-31. Alcance: todo lo cambiado desde 3.8.2 (Rev584 → Rev600),
la barra inferior de Control. Diseño y rondas en
`docs/_design_control_strip_chart_2026-10-31.md`. Lista aplicada: la de
`docs/_autoauditoria_pre_3.8.2_2026-10-31.md`.

## Qué cambia

- Backend: el historiador guarda además `performance.polarSpeed`,
  `navigation.speedThroughWater` y `performance.velocityMadeGood`
  (opcionales); `/history` acepta `twa`, `polarSpeed`, `stw` y `vmg`.
- Visor: la barra de abajo crece al hueco libre y tiene tres vistas
  (escora / timón, gráfica, Freeboard); el dibujo de gráficas se comparte
  con la pestaña Gráfica (bandas por tipo, escala, leyenda con medias,
  lectura con el dedo); alturas por orientación y pantalla completa;
  selector de modo en dos columnas en apaisado; barra de pestañas más
  baja en vertical.

## Lista

| Pregunta | Resultado |
|---|---|
| ¿Qué cambia durante cada `await` / temporizador? | `chartFetchAndDraw`: si la ventana cambió mientras esperaba, descarta la respuesta. Si cambian las series, el siguiente sondeo (2 s) lo corrige. Temporizadores: sondeo de la gráfica solo cuando se ve; seguimiento de Freeboard (0,5 s) solo mientras está en la barra y se para al salir; pulsación larga cancelada al soltar, al mover > 10 px o al cancelar el puntero; lectura con el dedo: un toque nuevo cancela la liberación pendiente. |
| ¿Se comprueba cada escritura? | No hay escrituras nuevas a pypilot, NMEA ni Course API. Las de `localStorage` van en `try`. |
| ¿Dato ausente / no finito / antiguo? | Todo valor pasa por `isNum` antes de escalar, promediar o dibujar; una serie sin datos sale "--" en la leyenda. Escala plana: velocidades 0..1, resto ±1. Los tres valores nuevos del historiador se leen igual que los demás (`skNum`): si el plugin de polares deja de publicar, el último valor sigue en el árbol de Signal K como en el resto de rutas (patrón existente, sin cambio). |
| ¿Sobrevive a un reinicio? | Las preferencias de vista, series y ventana están en el navegador (como la elección escora / timón) y en los presets de pantalla. El historial es la memoria del plugin, como antes. |
| ¿Puede una operación vieja pisar una nueva? | La respuesta de `/history` de otra ventana se descarta. Freeboard: `showInStrip` / `leaveStrip` son idempotentes; la × y el doble toque en la rosa pasan por `_helmSetView`. |
| ¿Pasa por `allowWrites`? | No hay escrituras nuevas. |
| ¿Bucles que pueden no terminar? | **Hallazgo y arreglo:** el bucle de marcas de escala avanzaba `v += step` sin tope; con un paso demasiado pequeño para la magnitud podía no avanzar. Ahora máximo 60 iteraciones. Bucle de letra de la leyenda: baja hasta 8 px y para. `_chartNiceStep`: lista fija. |
| ¿Tests nuevos? ¿Código de salida real? | `historian-speeds.test.ts` (2): el historiador devuelve polar / STW / VMG por ruta, y sin plugin de polares no hay valor (sale "sin dato"). Pasaría también con el código anterior, porque el historiador guarda el objeto entero; lo nuevo de verdad (`VALID_SAMPLE_PATHS` y la lectura en `collectSample`) está dentro del cierre de `index.ts` y no tiene test unitario. El visor (`app.js`) no tiene arnés de tests: verificado con Edge sin interfaz (capturas y medidas en 412 x 660, 412 x 800, 915 x 412, 1280 x 800; doble toque y pulsación larga simulados). `npm test`: 440 en verde, código de salida 0. |

## Anotado sin arreglar

- El test del vigilante (`gain-watchdog.test.ts`, A10) falló una vez y otra
  se quedó colgado con el portátil cargado; solo y repetido pasa. Es de
  tiempos (lanza procesos reales), no de este cambio. Revisar sus esperas.
- Freeboard en la barra se recoloca por sondeo (0,5 s): al ocultar / mostrar
  pestañas puede tardar medio segundo en encajar.
- Dentro de Freeboard el doble toque lo recibe el mapa; para salir de esa
  vista hay que usar la ×.
- No probado en el barco: lectura táctil de la gráfica, bloqueo del
  deslizar sobre la gráfica, muesca real en pantalla completa, polar max
  speed con datos reales (en puerto el plugin de polares no la publica).

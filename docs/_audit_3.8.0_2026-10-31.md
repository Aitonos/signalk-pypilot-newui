# Auditoría 3.8.0 (Rev564-572) — 2026-10-31

Revisión del código nuevo de la 3.8.0 con datos reales de la Pi
(configuración y catálogo de pypilot). Cada hallazgo verificado en el
código; gravedad pensando en el barco.

## Hallazgos

| # | Gravedad | Dónde | Qué pasa | Consecuencia |
|---|---|---|---|---|
| A | **Alta** | `src/index.ts` `_corePeriodFor` | Las ganancias (`ap.pilot.*.P/I/D/DD/PR/FF`) **solo se piden a pypilot mientras la pestaña Ajustes está en pantalla** (Rev140, para no cargar pypilot_web). El resto del tiempo el plugin guarda el último valor que vio, sin actualizar. Verificado en la Pi: `enabledPaths` no incluye ninguna ganancia | **Rachas "más D" (configurado en el Tunatunes, `gustStrategy: boost-D`)**: lee D de ese valor viejo. Si cambiaste de perfil sin mirar Ajustes, escribe 1,2 × la D del perfil anterior en el perfil nuevo, y al terminar la racha "restaura" esa D vieja: **la D del perfil activo queda cambiada**. Además: el Doctor arranca con ganancias desfasadas, el registro de cambios de la sesión no ve los cambios, y la base de datos y el modo sombra trabajan con ganancias viejas o vacías |
| B | **Alta** (calidad del modo sombra) | `src/nav-db.ts` | El error medio y el RMS del tramo incluyen los segundos en los que el barco está llegando a un rumbo nuevo (±1/±10) | Un ±10 hace que el desvío medio del tramo pase de 3° → el modo sombra propone **"desvío sostenido: PR +10 %" por un cambio de rumbo**, y también falsas oscilaciones |
| C | Media | `src/shadow-tuner.ts` | "Comparable con el anterior" y "A/B/A posible" no miran si los tramos son seguidos: tras desconectar y volver a conectar horas después, compara con el tramo de entonces | Estadísticas de viabilidad del A/B/A infladas |
| D | Media | `src/nav-db.ts` | El primer tramo tras conectar el piloto incluye el giro inicial hacia el rumbo | Igual que B: propuestas falsas en el primer tramo |
| E | Media | `src/index.ts` (alimentación de nav-db) | Un tramo se marca "racha" solo si actúa la estrategia (más D / perfil fuerte); con la estrategia "solo avisar" no | Tramos con racha contados como válidos (no afecta al Tunatunes, que usa más D) |
| F | Baja | `src/index.ts` `_sessionTick` | Al desconectar, la sesión se cierra antes de cerrar el último tramo de la base de datos | El último tramo (normalmente corto) no aparece en el resumen de la sesión |
| G | Documentación | README "Safety" | El vigilante sobrevive a un **cuelgue** de Signal K (probado), pero si Signal K **se cae y systemd lo reinicia**, systemd mata también al vigilante (mismo grupo de procesos). En ese caso la restauración la hace el plugin al arrancar (`recoverOnStart`), es decir, tras lo que tarde Signal K en arrancar | El README promete más de lo que hace en el caso "se cae" |
| H | Baja | `src/index.ts` `/gain-guard/dock-test` | Si alguien lanza la prueba y no la termina ni congela Signal K, el plugin sigue renovando y pypilot se queda en el perfil de prueba indefinidamente | Solo afecta a la prueba manual; conviene que termine sola |

## Revisado sin problemas

- Doctor: cobertura del servo, configuración mezclada, aplicar con lectura
  de vuelta y uno a uno (Rev564-566).
- Historial de perfiles: renombrar = copiar + borrar se reconstruye bien;
  el origen viaja por `/raw` validado.
- Lista de sesiones rápida (Rev567); la línea de cierre con 100 cambios y
  100 propuestas queda por debajo de los 64 KB que se leen; si los pasara,
  cae a la lectura completa (correcto, solo más lento).
- Vigilante: no crea perfiles inexistentes; comprueba que el PID es suyo;
  se cierra solo.
- Todas las escrituras nuevas a pypilot exigen `allowWrites`.

## Arreglos

1. **A**: pedir a pypilot las ganancias de todos los pilotos de forma
   permanente, 1 vez por segundo como máximo (pypilot solo las envía cuando
   cambian, así que no carga). Arregla de paso la racha "más D".
2. **B + D**: la base de datos calcula el error del tramo solo con los
   segundos "estables": fuera de un cambio de rumbo en curso y pasados 30 s
   desde que se conectó el piloto. Si quedan menos de la mitad estables, el
   tramo se marca "pasos" y no es válido para comparar.
3. **C**: comparable y A/B/A solo entre tramos seguidos (≤ 5 s de hueco).
4. **E**: marcar racha cuando el detector la ve, sea cual sea la estrategia
   (30 s).
5. **F**: cerrar el tramo de la base de datos antes que la sesión.
6. **G**: corregir el README.
7. **H**: la prueba del amarre termina sola a los 2 minutos.

## Estado (2026-10-31)

- A arreglado en **Rev573**; B, C, D, E, F, G, H en **Rev574**. 413 tests
  (6 nuevos). Desplegado en la Pi; Signal K activo y sin errores nuevos.
- **La 3.8.0 publicada en NPM lleva el fallo A** (racha "más D" con D
  desfasada). Candidato a 3.8.1 (patch) en cuanto Carlos dé el OK.

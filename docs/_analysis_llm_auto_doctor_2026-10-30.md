# Análisis de las respuestas de los LLM — Doctor automático (2026-10-30)

Prompt: `docs/_prompt_llm_auto_doctor_ai_2026-10-30.md`.
Diseño: `docs/_design_auto_doctor_2026-10-30.md`.

Estado: **Gemini y GPT recibidas.** GPT avisa de que solo recibió el
prompt, sin el diseño ni los ficheros de código: opina sobre el resumen.

## Veredicto de Gemini

Nada de redes neuronales ni aprendizaje por refuerzo en la Pi. Propone:

- **Base física:** identificar en vivo el modelo de gobierno del barco
  (Nomoto de 1.er orden: efectividad del timón K y constante de tiempo T)
  con mínimos cuadrados recursivos, y calcular P y D a partir de K y T.
- **Ajuste fino:** optimización bayesiana segura (SafeOpt), acotada a ±30 %,
  para I, DD y PR.
- **Comparación A/B/A** (base 90 s, prueba 90 s, base 90 s), descartando la
  prueba si cambian la mar (±25 %) o el viento (±2,5 kn).
- **Situación continua** (TWS, TWA como seno/coseno, velocidad, estado de
  mar) con regresión por kernels, en vez de cajones fijos.
- **Todo el cálculo en un worker thread**, fuera del hilo de Signal K.
- **Vigilante externo** que devuelve las ganancias originales a la
  TinyPilot si el plugin muere con una ganancia de prueba puesta.

## Contraste con los datos reales del barco

| Punto de Gemini | Realidad del Tunatunes | Consecuencia |
|---|---|---|
| Modelo Nomoto con ángulo de timón (supuesto 3) | **No hay sensor de timón**: `steering.rudderAngle` no existe en Signal K | El modelo K/T y la "actividad de timón" no se pueden medir así. Habría que estimar el timón con la corriente del servo o la orden de pypilot: mucho menos fiable. **Su recomendación principal pierde la base.** |
| IMU a 10–20 Hz desde pypilot | La TinyPilot es una Pi Zero W por WiFi; en Rev889-891 se redujo a una sola conexión TCP para no cargarla, y el cuelgue de 5 h vino de un búfer de tasa del IMU | Subir a 10–20 Hz es un riesgo real. Empezar con lo que ya llega y medir la carga de la TinyPilot antes de subir. |
| Rechazar si el servo trabaja > 50 % (penalización desde 35 %) | El Doctor usa 75 % (techo de hardware) y 55 % (falta de autoridad); Servo Health ya aprende el uso típico del servo de este barco | Usar el **uso típico aprendido** del barco como referencia, no cifras genéricas. |
| Coste normalizado J / (σ cabeceo · σ escora) | Con mar llana el divisor tiende a cero y el coste se dispara | Mejor tratar el estado de mar como variable del modelo (comparar a igualdad de mar), no dividir. |
| Rampa de 3 s al cambiar ganancias "para evitar la patada derivativa" | En pypilot la D actúa sobre la velocidad de giro medida, no sobre la derivada del error | Inofensiva pero probablemente innecesaria. Baja prioridad. |
| A/B/A de 3 × 90 s | Carlos pide algo dinámico | Una prueba completa son 4,5 min. Es más lento que lo que propusimos (1–2 min), pero mucho más fiable: la vuelta a la base al final detecta que cambió la mar. |
| Vigilante externo para la ganancia de prueba | El cuelgue de 5 h de Signal K (2026-10-23) dejó el plugin sin poder hacer nada durante horas | **Muy buena idea.** Si Signal K se cuelga, solo algo fuera de Signal K puede devolver la ganancia original. |
| Ajustar P y D juntos, no de uno en uno | Correcto en control: P y D están acoplados | Aceptar: probar parejas (P, D) manteniendo la relación entre ellas. |
| Consolidar lo aprendido solo tras 3 salidas con rumbos distintos | — | Sensato contra el sobreajuste a una salida. |

## Lo que tomaría de Gemini

1. Nada de redes neuronales: coincide con nuestra opinión.
2. Worker thread para todo el cálculo.
3. Protocolo A/B/A con descarte si cambian mar o viento.
4. Vigilante fuera de Signal K que restaura las ganancias originales.
5. Probar P y D en pareja.
6. Situación continua (TWA como seno/coseno) en vez de cajones duros.
7. Campos nuevos para la base de datos: índice de mar, frecuencia de
   encuentro con la ola, fase de la prueba (base / prueba / base), motivo
   de descarte.
8. Plan por fases: replay de sesiones grabadas → modo sombra → sugerencias
   con un toque → automático.

## Lo que no tomaría, o con cambios

1. **Modelo Nomoto basado en el ángulo de timón:** no tenemos sensor.
   Sustituir por optimización directa del coste (SafeOpt o similar) sin
   modelo, o instalar un sensor de timón (decisión de Carlos: hardware).
2. **IMU a 10–20 Hz:** no sin medir antes la carga de la TinyPilot.
3. **Umbrales de servo genéricos:** usar los aprendidos para este barco.
4. **Dividir el coste por el estado de mar:** comparar a igualdad de mar.

## Veredicto de GPT

Viable, pero el diseño todavía no justifica activar el autoajuste. Empezar
por un **selector fiable de perfiles ya validados** y después un optimizador
pequeño, conservador y explicable. Mayor riesgo: que una ganancia de prueba
se quede en pypilot cuando el plugin falle.

Puntos propios de GPT (no están en Gemini):

1. **Comprobar qué hace de verdad cada ganancia de pypilot** (P, I, D, DD,
   PR, FF) en la versión instalada antes de nada: no es un PID de libro.
2. **Nada de una única puntuación**: primero validez de los datos, luego
   restricciones (corriente, temperatura, saturación, oscilación) y solo
   entonces comparar error y esfuerzo.
3. **Mejora mínima absoluta**, además del porcentaje: bajar de 1,0° a 0,8°
   es un 20 % y no sirve de nada.
4. **Las muestras de 1 Hz están correlacionadas**: 120 muestras no son 120
   observaciones. No presentar falsas pruebas estadísticas; una mejora
   aislada es provisional hasta que se repita.
5. **Amura por separado** (el barco puede ir distinto a cada banda, p. ej.
   por la jarcia) y registro de **velamen y rizos**: si no, el ajustador
   puede aprender a tapar un problema mecánico.
6. **Pasos de 5–10 %**, histéresis y **permanencia mínima de 2–5 min** en un
   perfil para que el selector no oscile.
7. **"Cualquier alarma → deshacer" es demasiado simple**: la reacción debe
   depender del fallo (p. ej. durante una maniobra o si el patrón toca algo,
   ceder el control y suspender).
8. **El replay no demuestra mejoras**: una grabación con unas ganancias no
   dice cómo habría ido con otras. Sirve para validar la lógica, no el
   control.
9. **El techo de hardware (servo > 75 %, error > 5°) no está probado**:
   puede ser mal trimado, datos malos, ganancias malas o alimentación.
10. **Base de datos más completa** (versiones, ganancias propuestas /
    enviadas / leídas de vuelta, intervenciones manuales, calidad de datos,
    velamen). 200 bytes por fila es optimista: medirlo con una fila real.
11. **Supervisor independiente, preferiblemente en la TinyPilot**, con
    autorización temporal que caduca y restaura las ganancias de
    referencia.

## En qué coinciden los dos

- Nada de redes neuronales ni aprendizaje por refuerzo.
- Comparación **A/B/A** con descarte si cambian las condiciones.
- **Supervisor fuera del plugin** que restaure las ganancias si el plugin
  muere o Signal K se cuelga. Es lo primero a resolver.
- Cálculo acotado y fuera del hilo de Signal K.
- Fases: replay → modo sombra → sugerencias con un toque → automático.
- Las ganancias interactúan: P y D no se pueden ajustar como si fueran
  independientes.

## En qué difieren

| Tema | Gemini | GPT | Mi propuesta |
|---|---|---|---|
| Punto de partida | Modelo físico del barco (K, T) + optimizador bayesiano | Selector de perfiles validados; optimizador después | **GPT**: sin sensor de timón el modelo de Gemini no tiene base |
| Decidir "mejor" | Una puntuación con penalizaciones | Validez → restricciones → rendimiento | **GPT**: más explicable al patrón |
| Tamaño de paso | ±10 % | 5–10 % | 5–10 % |
| Ventanas | 3 × 90 s | 2–5 min | 3 × 90 s para empezar, revisar en modo sombra |
| Supervisor | Proceso en la Pi fuera de Signal K | En la TinyPilot | **Primero en la Pi** (servicio systemd propio, fuera de Signal K: cubre el cuelgue de SK y es código nuestro). En la TinyPilot solo si hace falta: tocar la Pi Zero de pypilot es más delicado |
| IMU | 10–20 Hz | 10 Hz si la conexión lo permite | Medir antes la carga de la TinyPilot |

## Plan conjunto propuesto

| Fase | Entregable | Toca el gobierno |
|---|---|---|
| 1 | Auditoría: qué hace cada ganancia en el pypilot instalado; qué datos y a qué ritmo llegan de la TinyPilot | No |
| 2 | Base de datos por tramos (con los campos de ambos) grabando ya en cada salida; amura, velamen y rizos | No |
| 3 | Supervisor fuera de Signal K con autorización que caduca; pruebas de caída del plugin y cuelgue de SK | No (solo restaura) |
| 4 | Selector de perfiles conocidos con histéresis y permanencia mínima (ampliación del Smart Pilot) | Sí, con perfiles validados |
| 5 | Optimizador en modo sombra con A/B/A | No |
| 6 | Sugerencias con un toque ("D +10 %: [Aplicar] [Ignorar]") | Solo si el patrón acepta |
| 7 | Automático con pasos pequeños; lo aprendido se consolida tras varias salidas | Sí |

## GPT, segunda ronda (con acceso a los ficheros)

Con el código delante cambia su valoración: hay una base aprovechable
(historial acotado, perfil copia antes de aplicar, espera a que el perfil
esté activo, un cambio por diagnóstico, rechazo si cambia el piloto, límites
del catálogo de pypilot). Señala fallos concretos. **Verificados uno a uno
en el código (2026-10-30):**

| # | Fallo que señala GPT | Dónde | Verificado | Impacto |
|---|---|---|---|---|
| 2a | El grabador guarda la **escora instantánea** en un campo llamado `rollRms`, y `pitchRms` siempre null | `src/index.ts` 4248-4249 | **Sí** | Las 50 sesiones grabadas tienen ese campo mal nombrado. Versionar el formato antes de aprender de ellas |
| 2b | El aviso de balance en empopada calcula el RMS de la escora **sin restar la media**: 10° de escora fija dan 10° de "balance" | `src/doctor.ts` 497-507 | **Sí** | Falso aviso "activa Roll FF" con el barco escorado y quieto |
| 3 | Uso del servo dividido entre **todas** las muestras, también las que no traen corriente | `src/doctor.ts` 265-267 | **Sí** | Si falta telemetría, el uso del servo sale más bajo y puede no saltar el bloqueo de "servo al límite" |
| 4 | El análisis mezcla tramos con distinto modo o perfil dentro de la misma ventana | `src/doctor.ts` 241-248 | **Sí** | Puede recomendar a partir de datos de dos configuraciones |
| 5 | Al aplicar solo se comprueba el piloto, **no el perfil**: si cambiaste de perfil, se copia el nuevo y se le aplica un valor calculado con las ganancias del anterior | `src/doctor.ts` 605-644 | **Sí** | Valor fuera de contexto (el original queda a salvo por la copia) |
| 6 | Se marca "aplicado" al enviar la ganancia, **sin leer de vuelta** el valor en pypilot | `src/doctor.ts` 636-640 | **Sí** | Para el modo automático es imprescindible: enviar → leer → verificar → medir |
| 7 | Episodios: banda de asentamiento del 5 % (±0,15° en un cambio de 3°); el sobrepaso solo cuenta si antes entró en la banda del 10 %; cierre sin motivo | `src/episodes.ts` 124-125, 268 | **Sí** | Cambios pequeños se dan por "no asentados"; sobrepasos que saltan la banda se pierden; episodios interrumpidos se mezclan con los completos |
| 8 | El listado de sesiones lee y analiza **todos los ficheros de golpe y de forma síncrona** | `src/session-recorder.ts` 345-357 (`readFileSync`) | **Sí**, y medido: **50 ficheros, 69 MB** en la Pi, el mayor de 21 MB | Bloquea el hilo de Signal K cada vez que se abre el listado. Mismo tipo de riesgo que el cuelgue de octubre |
| 9 | El diseño dice 3 min en un sitio y 1-2 min en otro; 80-100 pruebas en 4 h no salen | `docs/_design_auto_doctor_2026-10-30.md` | **Sí** | Corregido en el diseño (ver abajo) |

Conclusión de GPT, que comparto: **el obstáculo inmediato no es elegir una
IA, sino que los datos permitan afirmar con rigor que un cambio ha mejorado
el gobierno.** Los fallos 2-8 hay que arreglarlos antes de cualquier
aprendizaje.

## Plan revisado

| Fase | Entregable | Toca el gobierno |
|---|---|---|
| 1a | Arreglar métricas: uso del servo sobre muestras válidas con cobertura mínima (#3), balance sin la media (#2b), escora/balance bien nombrados y formato versionado en el grabador (#2a) | No |
| 1b | Episodios: banda mínima absoluta, detección del cruce del objetivo, motivo de cierre (#7) | No |
| 1c | Doctor: descartar ventanas con cambios de modo/perfil (#4); comprobar perfil y ganancias antes de aplicar, serializar, y leer de vuelta el valor (#5, #6) | Solo el botón "aplicar" del Doctor, más seguro |
| 1d | Grabador: resumen por sesión guardado al cerrar; el listado no vuelve a leer los ficheros (#8) | No |
| 2 | Comprobar qué hace cada ganancia en el pypilot instalado y a qué ritmo llegan los datos de la TinyPilot | No |
| 3 | Base de datos por tramos | No |
| 4 | Vigilante fuera de Signal K | No (solo restaura) |
| 5 | Comparador A/B/A en modo sombra | No |
| 6 | Sugerencias con un toque | Solo si el patrón acepta |
| 7 | Automático supervisado | Sí |

## Decisiones de Carlos (2026-10-30)

1. **Sensor de ángulo de timón: sí.** Carlos lo tiene sin conectar, y
   muchos barcos lo tendrán. El diseño debe funcionar **con y sin sensor**:
   - con sensor: modelo físico del barco (K, T) y actividad real del timón;
   - sin sensor: optimización directa, sin modelo.
   El plugin detecta si hay ángulo de timón válido y elige el camino.
2. **El vigilante corre en la Pi 5, no en la TinyPilot** (la Pi Zero es
   demasiado débil).
3. **Si es un proceso aparte de Signal K, hay que decirlo claramente y
   debe instalarse con el plugin**, sin pasos manuales.

## Vigilante de ganancias (propuesta)

- **Qué es:** un script Node pequeño que viaja dentro del paquete del
  plugin (sin dependencias nuevas). El plugin lo arranca como **proceso
  hijo independiente** (`detached`), así que sigue vivo aunque Signal K se
  cuelgue o se reinicie. No necesita root ni systemd: se instala y se
  actualiza con el plugin.
- **Cómo funciona (autorización que caduca):**
  1. Antes de cada prueba, el plugin escribe en disco: perfil original,
     perfil de prueba, ganancias de referencia y una marca de tiempo.
  2. Mientras la prueba sigue sana, el plugin renueva la marca cada pocos
     segundos.
  3. Si la marca caduca (plugin caído, Signal K colgado) con una prueba
     activa, el vigilante abre su propia conexión TCP con pypilot y
     **vuelve al perfil original**. Lo deja registrado.
- **Una sola instancia:** fichero de bloqueo con el PID; al arrancar, el
  plugin reutiliza el vigilante si ya está vivo.
- **Al arrancar el plugin:** si encuentra una prueba sin cerrar (por
  ejemplo tras un corte de luz), restaura el perfil original antes de nada.
  Importante porque pypilot guarda sus valores y podría arrancar con la
  ganancia de prueba.
- **Solo se arranca si el auto-ajuste está activado.** Con el
  auto-ajuste apagado no hay proceso extra.
- **Transparencia:** se explica en el README, en la descripción de la
  opción dentro de la configuración del plugin y en el propio visor al
  activarlo ("se arranca un proceso vigilante aparte de Signal K que
  restaura tu perfil si el plugin falla").
- **Prueba obligatoria antes de usarlo:** congelar Signal K a propósito
  (`kill -STOP`) durante una prueba en el amarre y comprobar que el
  vigilante restaura el perfil.

## Fase 1 hecha (2026-10-30, Rev564-567, desplegada en la Pi)

| Rev | Bloque | Fallos | Tests nuevos |
|---|---|---|---|
| 564 | Métricas | #3 uso del servo sobre muestras con corriente (< 50 % de cobertura: sin sugerencias), #2b balance sin la escora media, #2a grabador con `heel` / `pitch` y cabecera `format: 2` | 5 |
| 565 | Episodios | #7 banda mínima de 1°, sobrepaso aunque salte la banda, motivo de cierre; el Doctor solo usa episodios completos | 3 |
| 566 | Aplicar en el Doctor | #4 sin sugerencias si cambian modo / perfil / ganancias en la ventana; #5 rechaza si cambió el perfil o la ganancia, uno a la vez; #6 "aplicado" solo cuando pypilot devuelve el valor | 7 |
| 567 | Listado de sesiones | #8 cabecera + línea de cierre en vez de leer todo; caché | 3 |

Medido en la Pi con las 50 sesiones reales: el listado pasaba **0,8–1,0 s
bloqueando Signal K** cada vez; ahora **32 ms la primera vez** (8 sesiones
sin línea de cierre, de cortes, se leen enteras una vez) y **~1 ms** las
siguientes. Las 42 sesiones con cierre dan exactamente el mismo resumen que
la lectura completa.

379 tests en verde.

## Pendiente (decisiones de Carlos)

1. ~~Sensor de timón~~ Decidido: sí, y soportar barcos con y sin sensor.
2. ¿Arrancamos la fase 1 (arreglar los fallos 2-8)? No toca el gobierno
   salvo el botón "aplicar" del Doctor, que queda más seguro.
3. ~~Dónde va el vigilante~~ Decidido: en la Pi 5, instalado con el
   plugin y anunciado.

## Fases 2 y 3 hechas (2026-10-30)

- **Fase 2** (sin navegar): `docs/_audit_pypilot_gains_0.56_2026-10-30.md`.
  pypilot 0.56; el término I es muy lento; D/DD sobre el giróscopo; PR no
  lineal; FF solo en cambios de rumbo; aportes por término disponibles;
  coste de 12 valores a ritmo completo: -1,6 % de frecuencia del IMU.
- **Fase 3** (Rev570): base de datos `nav-db/windows-AAAAMM.jsonl`, una
  fila por tramo de 90 s con el piloto conectado. Escritura asíncrona,
  límite 20 MB. Rumbo de giro y aportes por término pedidos a 1 Hz; la
  TinyPilot sigue a 18,1 Hz tras el despliegue. Sigue la misma opción que
  el grabador de sesiones.
- Extra (Rev568-569): sesiones con resumen y cambios atribuidos; historial
  de perfiles en el gestor.

Siguiente: fase 4 (vigilante fuera de Signal K), y en paralelo dejar que la
base de datos se llene en las próximas salidas.

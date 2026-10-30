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

## Pendiente (decisiones de Carlos)

1. ¿Se instala un **sensor de ángulo de timón**? Abriría la puerta al
   modelo físico del barco (lo más sólido de Gemini) y a medir de verdad la
   actividad del timón.
2. ¿Arrancamos con las fases 1 y 2? No tocan el gobierno y la base de datos
   empieza a llenarse desde la próxima salida.
3. Supervisor: ¿en la Pi (propuesta) o en la TinyPilot?

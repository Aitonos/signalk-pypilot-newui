# Auditoría de GPT sobre 3.8.1 — verificación punto por punto

Fecha: 2026-10-31. Fuente: `Auditoria_Pypilot_NewUI_3.8.1.md` (GPT, con
pruebas de reproducción). Cada punto comprobado en el código antes de
tocar nada.

| # | GPT | Verificado | Notas | Decisión |
|---|---|---|---|---|
| A01 | La racha "más D" restaura D sin comprobar el perfil: si cambias de perfil durante la racha puede escribir la D vieja en otro perfil | **Sí** (`_releaseGustStrategiesIfExpired`) | Además la D subida se queda en el perfil A (pypilot guarda las ganancias por perfil) | Arreglar: la restauración se ata al perfil; si el perfil cambió, queda pendiente y se restaura cuando A vuelva a estar activo |
| A02 | Si pypilot rechaza la restauración, se borra igualmente y se anuncia "restaurado" | **Sí** (retorno de `client.set` ignorado; igual en la vuelta del perfil fuerte) | | Arreglar: restaurar = enviar y confirmar leyendo el valor; si falla, reintentar cada 5 s |
| A03 | Dos muestras separadas 89 s dan un tramo "válido" de 90 s | **Sí** | | Arreglar: mínimo 80 % de las muestras esperadas y ningún hueco > 10 s |
| A04 | La comparación de tramos no mira velocidad ni ángulo del viento | **Sí** | | Arreglar: SOG ±1,5 kn (o 25 %), TWA ±20°, viento ausente en uno solo = no comparable |
| A05 | "PR +10 %" con PR = 0 propone de 0 a 0 | **Sí** | | Arreglar: no proponer pasos sin efecto |
| A06 | Un sensor sin marca de tiempo cuenta siempre como fresco | **Sí** (`sensor-quality.ts` cuenta cada lectura como llegada) | Signal K pone marca de tiempo a todo lo que pasa por él; caso muy raro | Anotado, sin arreglo ahora (cambiarlo podría dar falsos "perdido" en sensores constantes) |
| A07 | La normalización de ángulos con `while` no termina con Infinity | **Sí, y peor**: con un número finito enorme (1e300) tampoco, porque restar 2π no lo cambia. 4 sitios: `kpis.ts`, `episodes.ts`, `nav-bearing.ts`, `index.ts` | Un bucle así **bloquea Signal K entero** (como el 23-oct, aunque aquella vez fue otra causa) | **Arreglar ya**: normalización con módulo, de coste fijo, y descartar valores no finitos |
| A08 | `reset` del Doctor durante "aplicar" provoca un TypeError | **Sí** (`ensureForkedProfile` escribe en `this.result` tras esperar) | | Arreglar: aplicar fija su resultado al empezar y comprueba tras cada espera; reset/start esperan o se niegan mientras se aplica |
| A09 | El seguidor de ruta emite APB aunque `allowWrites` esté desactivado | **Sí** | APB es una orden de rumbo para pypilot | Arreglar: sin `allowWrites` no se emite APB ni se avanzan waypoints |
| A10 | El vigilante abandona tras 6 fallos de conexión seguidos | **Sí** | Un corte de WiFi de 30 s lo deja sin restaurar | Arreglar: reintentar indefinidamente con espera creciente mientras la autorización siga caducada; solo "perfil inexistente" es definitivo |
| B01 | Terminar la prueba del amarre desactiva el vigilante sin confirmar que volvió el perfil | **Sí** | | Arreglar: solo se cierra tras confirmar el perfil |
| B02 | `begin` no comprueba que la protección quedó armada | **Sí** | Hoy solo lo usa la prueba del amarre | Arreglar: `begin` devuelve si la autorización se escribió y el vigilante está vivo |
| B03 | El vigilante restaura aunque el patrón haya elegido otro perfil durante la avería | **Sí** | | Arreglar: solo restaura si el perfil activo sigue siendo el de prueba |
| B04 | El Doctor no ve un cambio A→B→A dentro de la sesión | **Sí** | | Arreglar: contador de cambios de configuración (perfil o ganancia) |
| B05 | La salida SSH se acumula sin límite durante el comando | **Sí** | | Arreglar: tope de 256 KB al recibir |

Prueba que se queda abierta sin `--test-force-exit` (GPT): pendiente de
localizar; probablemente un temporizador o socket de las pruebas del
vigilante.

## Estado (2026-10-31)

| Rev | Arreglos | Tests nuevos |
|---|---|---|
| 575 | A07 normalización de ángulos de coste fijo (backend y visor) | 3 |
| 576 | A09 APB y avance de waypoint solo con `allowWrites`; A01/A02 restauraciones de racha como máquina de estados probada (`gust-restore.ts`) | 5 |
| 577 | A08 aplicar del Doctor inmune a reset; B04 contador de cambios de configuración | 3 |
| 578 | A10 vigilante reintenta sin rendirse; B03 respeta la elección del patrón; B02 `begin` confirma la protección; B01 fin de prueba con confirmación | 2 |
| 579 | A03 cobertura temporal del tramo; A04 velocidad, ángulo y presencia de viento; A05 sin propuestas que no cambian nada; B05 tope de salida SSH | 3 |

429 tests en verde, desplegado en la Pi (Rev579), Signal K activo y sin
errores. Sin arreglar a propósito: A06 (ver tabla). Pendiente: localizar la
prueba que deja abierto el proceso de tests sin `--test-force-exit`, y un
fallo intermitente visto una vez (probablemente las pruebas del vigilante
que arrancan un proceso real; no se repitió en 4 ejecuciones).
Restaurar tras rachas sigue siendo en memoria: si Signal K se reinicia en
plena racha, la D subida se queda; propuesta futura, pasarlo por el
vigilante.

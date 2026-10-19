# Audit — salida 2026-10-19 (18:40-19:23), Rev514

Fuentes: journal SK, sesión `session-20261019-184027-27347`, traza
`trace-20261019-174619`, consulta directa a la TinyPilot. Carlos: "creo
que te has cargado muchas lógicas en los últimos cambios … revisa muy
bien". Veredicto por punto: **REGRESIÓN** (lo rompí yo, Rev506-514),
**ANTIGUO** (ya estaba), **FÍSICA** (no es software).

## Resumen

| # | Síntoma (Carlos) | Hora | Veredicto | Causa |
|---|---|---|---|---|
| 1 | HUD se apaga antes de terminar la virada del mando | 18:53, 18:54 | **REGRESIÓN Rev508** | El ciclo de recuperación saltó en falso durante la virada y la reinició |
| 2 | "Servo desconectado por exceso de corriente y volvió a conectar" | 19:23:45 | **REGRESIÓN Rev508** | Mismo falso positivo tras un cambio de rumbo grande |
| 3 | Virada/trasluchada se pasa y hace S, "ajustando" | 19:13, 19:11, 19:20 | **REGRESIÓN Rev510** | Compás hasta 6° del rumbo final; el AWA real allí no es el espejo y el modo viento vuelve 40-50° |
| 4 | Aproado pasa a compás | 18:52 | **REGRESIÓN Rev512** | Decisión mía, Carlos la rechaza: aproado siempre en aparente |
| 5 | "Has creado un modo nuevo: TRASLUCHANDO → APARENTE, ajustando" | 19:06 | **REGRESIÓN Rev510** | Etiqueta del botón de modo + texto "ajustando" en el contador |
| 6 | Diálogo raro con "dlg.no / dlg.yes" en cada trasluchada | 19:05, 19:10, 19:13, 19:17, 19:19 | **REGRESIÓN Rev511** | Confirmación en 7 trasluchadas voluntarias; etiquetas sin traducir (fallo antiguo de `_pmConfirm` que salió ahora) |
| 7 | Cancelo y no hace caso, target fantasma | 19:08, 19:16 | **ANTIGUO (Rev408)** | pypilot machaca nuestro objetivo tras el cambio de modo |
| 8 | HUD con el sentido de giro al revés (mando) | 18:53-18:55 | **ANTIGUO** | La amura que publica pypilot cambia sola a mitad de la virada |
| 9 | El contador no cuadra con flecha y diamante | 19:06 | **ANTIGUO + Rev510** | Cuenta grados de rumbo; la rosa enseña viento |
| 10 | Sale el resumen de la virada anterior al empezar otra | 19:19 | **ANTIGUO** | El resumen no se cierra al empezar maniobra nueva |
| 11 | Ajustes: se pone negro al tocar un slider | — | **ANTIGUO** | CSS: la pestaña entera al 32 % y la fila activa no puede salir de ahí |
| 12 | Ajustes: se siguen borrando los cambios | — | **SIN PRUEBA** | Rev507 no basta; la traza no registraba esas escrituras |
| 13 | Aleta de babor en aparente: se pasa y hace eses | 18:47-18:49 | **FÍSICA / ANTIGUO** | Aparente en largo: AWA ±175°, oscila ±40°. En real lo aguantó |
| 14 | A motor, poco SOG, aparente se va | 19:02 | **FÍSICA** | Igual que 13 |
| 15 | `max_current` 20 A | — | **NO** | TinyPilot: `servo.max_current = 8.0` (20 es el tope del slider) |

Funcionó: ±10 durante la virada (19:06, 19:11), rachas, aviso de piloto
desacoplado, rumbo final espejo en todas las viradas (las que no lo
parecían llevaban ±10 del patrón: 19:06 −20°, 19:11 +60°).

## Detalle

### 1-2. Falso "piloto pillado" (Rev508)
18:53:15 virada desde el mando en compás. pypilot mantiene el objetivo
viejo (2°) durante la virada y lo cambia a 102° al final, así que el
"error" sube de 1° a 42° mientras el barco gira a 7°/s. Mientras tanto
`servo.flags = DRIVER_TIMEOUT` (manda sin poder medir corriente) → la
corriente se lee **0 A aunque el motor empuja**. Detector: error > 25°
que crece + 0 A durante 4 s → ciclo AP off/on a las 18:53:32 → la
virada de pypilot se reinicia (HUD fuera). Igual a las 18:54:14 y a las
19:23:45 (cambio de rumbo grande, error 92°). **Ningún ciclo tuvo el
fallo direccional de sobrecorriente**, que es lo único que el ciclo
arregla.
Arreglo: solo con `PORT/STARBOARD_OVERCURRENT_FAULT` (nunca por 0 A),
nunca en una virada de pypilot ni 20 s después, y un cambio de objetivo
> 10° reinicia la cuenta.

### 3. Compás hasta 6° (Rev510)
19:13 trasluchada: compás llega a 277° (rumbo final) con AWA 70°, pero
el objetivo de viento es 92° → el modo viento vuelve 46° (283→237°).
"final approach … handing over" 3 veces (19:11:16, 19:11:58, 19:20:01):
el compás no llegaba a 6° y las maniobras subieron a ~60 s. Revertir a
la entrega a 20° (lo que funcionaba).

### 7. Cancelación y target fantasma (antiguo, Rev408)
Al cancelar, el plugin pasa a modo viento y escribe objetivo = AWA
actual **sin esperar** a que pypilot procese el cambio de modo. pypilot,
al procesarlo, "mantiene el rumbo" recalculando el objetivo desde el
error de compás y **machaca el nuestro**:

| Hora | Nuestro objetivo | pypilot lo cambia a |
|---|---|---|
| 19:08:24 | 56° | 3.9° (proa al viento: el barco orza hasta AWA 0, SOG 3.9→2.8) |
| 19:15:44 | −57° | 4.8° |
| 19:17:10 | 29° | −30.5° |

En la entrega normal de la virada no pasa porque allí se espera el eco
del modo. Arreglo: esperar el eco del modo + 0.4 s, escribir, comprobar
a 1.2 s y reescribir si pypilot lo cambió. Probablemente también son
las "órdenes fantasma" del 18-oct.

### 8. Sentido de giro del HUD (antiguo)
El mando escribe la amura y `begin`; ~0.5 s después el registro de
viento de pypilot (`tacking.py poll`) la sobrescribe con el lado del
viento. El visor usaba el último valor: 18:54 marcó babor girando a
estribor (102→202°); 18:55 al revés (202→102°). Arreglo: fijar la
amura en el `begin` e ignorar cambios hasta el final. Además el HUD se
cerraba cuando pypilot da la virada por terminada (umbral 50 %), con
40° aún por girar: mantenerlo hasta llegar (< 10°) o 15 s.

### 9. Contador
Cuenta grados de rumbo hasta el rumbo final; la rosa enseña la flecha
de viento y el diamante objetivo de viento. Si el aparente cambia en la
maniobra no cuadran. Arreglo: el número = distancia de la flecha de
viento al diamante, en el sentido de giro (lo que se ve), sin
"ajustando".

### 6. Confirmación de trasluchada
Carlos hace trasluchadas por la vía larga a propósito (19:10, 19:17,
19:19, desde AWA ~30°). El accidente del 18-oct fue un segundo toque
3 s después de cancelar. Arreglo: pedir confirmación solo si hubo una
cancelación en los últimos 20 s, y botones Sí / No traducidos.

### 11-12. Ajustes
11: oscurecer solo las otras filas y quitar el oscurecido si el toque
se interrumpe (Android convierte el arrastre en scroll).
12: sin prueba en logs. Medida robusta: el visor mantiene lo que el
patrón escribió hasta que el backend confirme ese valor (o traiga uno
distinto de ambos), en vez de 5 s. Y se registran las escrituras y
cualquier valor que el refresco cambie en pantalla, para la próxima.

## Fuera de esta ronda (peticiones nuevas)
- Bitácora consultable navegando: estadísticas en curso y carta con la
  derrota.
- Resumen de virada en compás con rumbo en vez de aparente.
- Aparente en largos/popa (13-14): diseño de viento real por cuadrantes.

## Aplicado en Rev515

1-2 (detector solo con fallo direccional, sin 0 A, sin virada nativa ni
20 s después, cambio de objetivo > 10° reinicia; repetida la sesión de
hoy: 0 ciclos), 3 (revertido a 20°), 4 (revertido), 5 (botón de modo
sin prefijo; contador sin "ajustando"), 6 (confirmación solo < 20 s tras
cancelar, Sí/No traducidos), 7 (cancelación espera el modo + 0.4 s,
escribe, comprueba a 1.2 s y reescribe; test con un pypilot simulado que
machaca el objetivo: falla con el código viejo con "got 4", pasa con el
nuevo), 8 (amura fijada en el begin; HUD hasta < 10° o 15 s), 9 (flecha
→ diamante), 10 (el resumen pendiente se cancela al empezar maniobra),
11 (solo se oscurecen las otras filas; limpia en pointercancel), 12
(valor escrito hasta confirmación + registro `tune-write` /
`tune-refresh-change` en la traza).

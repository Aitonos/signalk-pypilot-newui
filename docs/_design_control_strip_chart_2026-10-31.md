# Barra inferior de Control: toda la altura + gráfica (Rev584-585)

Fecha: 2026-10-31. Petición de Carlos: "ganar toda la altura posible
siempre disponible para la barra de escora y añadir un modo de gráfica con
valores seleccionados por nosotros, y que a doble tap podamos alternar
entre los visores (escora y gráfica). SOG frente a velocidad máxima polar y
AWA/TWA". Y después: "las gráficas las tienes ya en chart" (reutilizarlas).

## Qué había

- Vertical: la rosa ocupaba todo el alto sobrante (caja más alta que el
  círculo, hueco vacío dentro) y la barra de escora medía unos 40 px.
- Apaisado: las dos filas de botones se repartían todo el alto y la barra
  quedaba en una fila de tamaño automático (~40 px), también en pantalla
  completa.

## Qué cambia

| Zona | Antes | Ahora |
|---|---|---|
| Vertical, rosa | absorbe todo el alto | caja de proporción 1 : 1,15 (como cabía en tablet) |
| Vertical, barra | ~40 px | todo lo que sobra bajo los botones (158 px en un móvil de 412 x 915) |
| Apaisado, botones | 1fr + 1fr | hasta 22 % del alto cada fila (mínimo 56 px) |
| Apaisado, barra | auto (~40 px) | el resto (370 px en 1280 x 800 con pestañas) |
| Número, marcas y etiquetas | tamaño fijo | crecen con la altura de la barra (unidades `cqh`) |

## Gráfica en la barra

- **Doble toque** sobre la barra (fuera del marcador, el triángulo y las
  flechas, que conservan su función) alterna barra / gráfica.
- **Mismo dibujo y datos que la pestaña Gráfica** (`chartDraw`,
  `/history`): el renderizador recibe ahora el estado del gráfico como
  parámetro; la pestaña Gráfica usa `_chart` y la barra `_helmChart`.
- Series a elegir en la ventana de configuración de esquinas, sección
  "Gráfica en la barra de abajo": SOG, Polar, AWA, TWA, TWS, escora, timón,
  servo A. Ventana 2 / 10 / 30 min. Por defecto SOG + Polar y AWA + TWA,
  10 min.
- **Pares en una misma banda y escala**: SOG con Polar (polar discontinua)
  y AWA con TWA. Vale también para la pestaña Gráfica, que gana las series
  Polar y TWA.
- El historiador del plugin guarda `performance.polarSpeed` (lo publica el
  plugin de polares; sin él la serie sale vacía).
- Vista, series y ventana son ajustes de pantalla de cada dispositivo (como
  la elección escora / timón): se guardan en el navegador y entran en los
  presets de pantalla.
- Solo pide datos cada 2 s cuando la gráfica se ve (pestaña Control
  activa, vista gráfica, pantalla visible).

## Verificado

- Capturas con Edge sin interfaz a 1280 x 800, 800 x 1280 y 412 x 915.
- Gráfica dibujada con datos sintéticos (el navegador de prueba no tiene
  sesión de Signal K; `/history` responde 401 sin ella, igual que en la
  pestaña Gráfica).
- Doble toque simulado: dos toques en < 400 ms cambian la vista; separados
  600 ms no. Los botones de la ventana de configuración no tocan los de la
  pestaña Gráfica.
- 438 tests en verde.

## QA en el barco (QA Rev585)

1. Vertical y apaisado, con y sin barra de pestañas: la barra ocupa todo el
   hueco y los "30" de los extremos se leen enteros.
2. Doble toque en la barra: pasa a gráfica; otro doble toque: vuelve.
3. Tocar el número amarillo o el triángulo sigue mostrando / ocultando las
   pestañas; las flechas siguen cambiando de pestaña.
4. Con el plugin de polares activo: la línea discontinua Polar sale en la
   misma banda que SOG.
5. Cambiar series y ventana en la ventana de configuración; recargar el
   visor: se conservan.
6. Pestaña Gráfica: Polar y TWA disponibles; el resto igual que antes.

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

## Segunda ronda (Rev586-587, tras la captura de Carlos en el móvil)

Carlos: "seguimos sin llenar bien la vertical y dejando mucho espacio entre
botones; hay que poner una escala bien clara de lo que es velocidades; no
es AWA, es AWS y TWS; debemos poder elegir más cosas; no veo polar max
speed; la gráfica debe ser dinámica (si pongo el dedo me dice lo que
había); tap largo abre configuración de la gráfica".

| Pedido | Hecho |
|---|---|
| Huecos entre botones | huecos de 8 px iguales; filas a `clamp(60px, 9vh, 96px)` en vertical; barra mínimo 20 % del alto |
| Escala de velocidades | todas las velocidades en una banda en nudos desde 0, con rejilla y etiquetas (2, 4, 6... kn) |
| AWS y TWS | por defecto SOG, polar, AWS, TWS |
| Más series | STW y VMG (añadidas al historiador), además de las anteriores |
| Polar max speed | sale en la leyenda; "--" mientras el plugin de polares no la publica (en puerto solo publica VMG y rumbo de virada) |
| Dedo = valores | mismo cursor que la pestaña Gráfica, ahora compartido; se queda 3 s al soltar |
| Pulsación larga | 0,7 s sin mover el dedo abre la configuración en la sección de la barra |
| Texto espaciado en Firefox | el lienzo heredaba el espaciado de letras de la barra; anulado |
| "« 10" partido en móvil | botones de nudge en una línea con letra a la medida |

## Tercera ronda (Rev588-589)

Carlos: "que los datos de arriba sean averages del periodo seleccionado, no
los actuales; que las flechas de escora sean más visibles y vayan de los
límites superior e inferior hasta el número central; el lateral de la
gráfica desperdicia sitio a la derecha"; y "que en modo gráfica no funcione
el deslizar lateral".

- Leyenda: "media 10m" + media de cada serie en la ventana (media circular
  en ángulos para que ±179° no dé 0°). Pasa a varias líneas si no cabe.
- Escala: solo números (la unidad está en la leyenda); margen derecho
  medido al ancho de "-888°". Con todo a 0, la escala de velocidad va de 0
  a 1, no de -1 a 1.
- Marcador: triángulo en el borde y línea gruesa amarilla hasta el número,
  arriba y abajo.
- El gesto de cambiar de pestaña deslizando se ignora sobre la barra en
  modo gráfica y sobre la gráfica de la pestaña Gráfica.

## Cuarta ronda (Rev590)

Carlos: leyenda en una sola línea a todo el ancho (también sobre el margen
derecho), sin "media 30m"; el margen derecho seguía siendo demasiado ancho;
arriba quedaba el hueco de la muesca sin usar; y en pantalla completa
crecían los botones, no la rosa ni la gráfica.

- Leyenda: una línea de izquierda a derecha; la letra baja hasta que cabe.
- Margen derecho: se calcula con la etiqueta de escala más ancha real
  (p. ej. "20"), no con un ancho fijo.
- Botones en vertical: alto ligado al ancho (`clamp(60px, 15vw, 96px)`); en
  pantalla completa el `vh` crecía y se lo llevaban los botones.
- Barra de pestañas oculta: se quita el margen superior de la zona segura
  (muesca), la rosa empieza arriba del todo.

## Verificado

- Capturas con Edge sin interfaz a 1280 x 800, 800 x 1280 y 412 x 915.
- Gráfica dibujada con datos sintéticos (el navegador de prueba no tiene
  sesión de Signal K; `/history` responde 401 sin ella, igual que en la
  pestaña Gráfica).
- Doble toque simulado: dos toques en < 400 ms cambian la vista; separados
  600 ms no. Los botones de la ventana de configuración no tocan los de la
  pestaña Gráfica.
- 438 tests en verde.

## QA en el barco (QA Rev590)

1. Vertical y apaisado, con y sin barra de pestañas: la barra ocupa todo el
   hueco y los "30" de los extremos se leen enteros.
2. Doble toque en la barra: pasa a gráfica; otro doble toque: vuelve.
3. Tocar el número amarillo o el triángulo sigue mostrando / ocultando las
   pestañas; las flechas siguen cambiando de pestaña.
4. Navegando con el plugin de polares activo: la línea discontinua Polar
   sale en la banda de nudos junto a SOG, AWS y TWS, con su valor en la
   leyenda.
7. Dedo sobre la gráfica y deslizar: se ven los valores de cada instante.
8. Pulsación larga en la barra: abre la configuración en su sección.
9. Leyenda: "media 10m" y valores que cambian despacio (media), no al
   segundo.
10. Deslizar el dedo de lado sobre la gráfica no cambia de pestaña.
11. Pantalla completa en el móvil: los botones no crecen; la rosa sube hasta
    la muesca y la gráfica se queda con el resto.
5. Cambiar series y ventana en la ventana de configuración; recargar el
   visor: se conservan.
6. Pestaña Gráfica: Polar y TWA disponibles; el resto igual que antes.

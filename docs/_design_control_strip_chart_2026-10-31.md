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

## Quinta ronda (Rev591-592)

Carlos: lo que sobre de alto debe ir a los botones, no a la barra; la
escora a la mitad de alto que la gráfica, con animación; sin flechas en la
escora (solo deslizar); gráfica 20 % más baja que en Rev590; y Freeboard
como tercera vista, del tamaño de la gráfica.

| Vista | Vertical (móvil 412 x 660) | Apaisado (1280 x 800) |
|---|---|---|
| Gráfica / Freeboard | 16 % del alto (106 px), botones 62 px | ~40 % de la columna (287 px) |
| Escora | la mitad (53 px), botones 86 px | la mitad (139 px), botones 297 px |

- La rosa tiene el alto limitado como si la barra estuviera en tamaño
  gráfica, así que al pasar a escora el alto liberado va a los botones.
- Freeboard: se reutiliza el marco precargado y se coloca encima de la
  barra (posición fija medida cada 0,5 s y al cambiar de tamaño), corrigiendo
  el desfase cuando un contenedor con transformación hace de referencia. No
  se recarga ni abre una segunda conexión.
- Doble toque: recorre las vistas marcadas en "El doble toque alterna
  entre" (al menos una). Dentro de Freeboard el doble toque lo recibe el
  mapa; la × vuelve a la siguiente vista. Doble toque en la rosa con
  Freeboard en la barra lo sube a la rosa.

## Sexta ronda (Rev593)

Carlos: en vertical normal, gráfica y Freeboard +40 % quitándoselo a la
rosa; en vertical a pantalla completa, escora +50 % y gráfica / Freeboard
+40 %; en apaisado a pantalla completa, gráfica / Freeboard +25 %; y en
apaisado menos separación entre la barra y los botones.

| Vista (412 x 660 / 1280 x 800) | Rev592 | Rev593 normal | Rev593 pantalla completa |
|---|---|---|---|
| Vertical, gráfica / Freeboard | 106 px | 148 px (22,4 % del alto) | 22,4 % del alto |
| Vertical, escora | 53 px | 53 px (8 %) | 79 px (12 %) |
| Apaisado, gráfica / Freeboard | 287 px | 297 px (sin margen extra) | 372 px |

"Pantalla completa" = la del botón de arriba a la derecha (API del
navegador), marcada con la clase `is-fullscreen` en el `body`.

## Séptima ronda (Rev594)

Carlos: gráfica / Freeboard en vertical un 10 % más: contra la rosa en
normal y contra los botones en pantalla completa.

- Alto 24,6 % de la pantalla (148 -> 162 px en el móvil de prueba).
- Normal: el tope de la rosa usa ese alto, la rosa baja (295 -> 280 px).
- Pantalla completa: el tope de la rosa sigue con el alto de Rev593, así
  que lo pagan los botones. Si los botones ya están en su mínimo (60 px o
  15 % del ancho), no pueden ceder y lo cede la rosa.

## Verificado

- Capturas con Edge sin interfaz a 1280 x 800, 800 x 1280 y 412 x 915.
- Gráfica dibujada con datos sintéticos (el navegador de prueba no tiene
  sesión de Signal K; `/history` responde 401 sin ella, igual que en la
  pestaña Gráfica).
- Doble toque simulado: dos toques en < 400 ms cambian la vista; separados
  600 ms no. Los botones de la ventana de configuración no tocan los de la
  pestaña Gráfica.
- 438 tests en verde.

## QA en el barco (QA Rev594)

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
11. Pantalla completa en el móvil: el alto extra va a los botones.
12. Doble toque: escora (media altura) -> gráfica -> Freeboard, con
    animación de altura; la × de Freeboard vuelve a escora.
13. Freeboard en la barra: se ve el barco y se puede mover el mapa; al
    ocultar / mostrar pestañas sigue encajado en la barra.
5. Cambiar series y ventana en la ventana de configuración; recargar el
   visor: se conservan.
6. Pestaña Gráfica: Polar y TWA disponibles; el resto igual que antes.

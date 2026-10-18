# Audit — "las rachas no salen casi nunca" (2026-10-18), Rev509

## Comprobado

1. **El detector funciona.** Reproduciendo el viento real de la salida
   de hoy (9 sesiones, 7225 muestras a 1 Hz, 2.5 h) con la misma lógica
   del visor (`_gustGhostTick`: +2 kn o +15 % sobre la media de 30 s, o
   giro ≥ 12° en 5 s, enfriamiento 8 s, un fantasma a la vez durante
   15 s): **302 rachas dibujadas, 2.5 por minuto**.
2. **La opción está activada** en las preferencias compartidas del
   backend (`visor-prefs.json`: `gustGhost: true`).
3. **El fallo está en el dibujo.** `_gustGhostRender` añade el fantasma
   con `opacity: 0.5` y una transición de 15 s, y en un único
   `requestAnimationFrame` pone `opacity: 0`. Ese callback corre antes
   de que el navegador haya calculado el estilo del nodo nuevo, así que
   no existe el punto de partida 0.5, la transición se salta y el
   fantasma queda invisible en el acto. Medido en Chrome headless
   (5 repeticiones): un rAF → opacidad 0 a 1 s; dos rAF → 0.47 a 1 s
   (desvanecido de 15 s como se diseñó).
   Explica también el comentario de Rev177 ("desaparece muy rápido").
   Solo se veía cuando algo forzaba un cálculo de estilo entre el alta
   y el rAF (por eso "casi nunca" y no "nunca").

## Arreglo (Rev509)

Doble `requestAnimationFrame` antes de poner `opacity: 0`. Sin cambios
en umbrales: con el arreglo saldrán ~2.5/min con viento como el de hoy;
si resultan demasiadas, subir umbrales después de verlo en el agua.

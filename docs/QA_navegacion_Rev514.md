# QA Rev514 — prueba en navegación (cubre Rev506 → Rev514)

Antes de soltar amarras: **Ctrl+F5 en tablet y móvil** (y en la pantalla
de la Pi). En Info debe verse **Rev514**.

Apunta la **hora** de cada prueba (aunque sea aproximada): con la hora
cruzo sesiones, trazas y journal y te digo qué pasó por dentro.

Orden pensado de menos a más exigente. Las pruebas 8-9 solo con aguas
libres y sin tráfico.

## En puerto (amarrado, AP desacoplado)

1. **Ajustes > Servo**: desbloquear el grupo no pregunta nada. Mover
   `max_current` (GLOBAL) no pregunta. Mover `servo.period` (PERFIL)
   pregunta una vez; "Cancelar" lo devuelve al valor anterior.
   Vuelve a dejarlos como estaban con ↺.
2. **Ajustes**: tras cambiar un valor espera 20 s y toca otro slider: el
   grupo sigue abierto, desbloqueado y con tu valor.
3. **Smart Pilot**: "Recuperación del piloto pillado" marcada; línea de
   estado "armed". En Setup > Alarmas aparecen activas: Piloto pillado,
   Piloto sin recuperación, Piloto desacoplado.
4. **Rachas**: tarjeta de marcas de la rosa > "Marca de ráfagas" >
   "Probar ahora": flecha A naranja con los nudos que se apaga en ~15 s.

## Navegando, viento suave o moderado

5. **Rachas reales**: con viento racheado deben ir apareciendo flechas
   fantasma (con viento como el del 18-oct, varias por minuto).
   Dime si te parecen pocas, bien o demasiadas.
6. **Virada en modo viento** (tablet y móvil a la vista):
   - Las dos pantallas muestran **"VIRANDO → APARENTE"** en el botón de
     modo durante la maniobra y **APARENTE** al terminar (las dos igual).
   - El número grande baja hasta 0 con **"de Y°"** debajo, en las dos.
   - Entra en modo viento ya casi en el rumbo final (no a 20° de llegar).
7. **±10 durante la virada**: lanza una virada y a mitad pulsa +10 una
   vez. El total "de Y°" cambia ~10° y el barco termina 10° más abierto
   (o más cerrado según el lado). Nada se rechaza.
8. **AP off durante la virada**: lanza una virada y a mitad quita el AP.
   La virada se anula, el barco queda libre y **nada más se mueve**
   (sin órdenes fantasma). Repite quitando el AP desde la TinyPilot.
9. **Trasluchada por popa con confirmación**: ciñendo, lanza una virada
   y cancélala enseguida (segundo toque). Pulsa **otra vez el mismo
   botón**: debe salir "¿Trasluchar por popa? … Para virar, usa el
   otro botón." Responde **No** → no pasa nada.
10. **Doble toque**: dos toques rápidos al botón de virada (< 1.5 s) no
    encadenan arrancar/cancelar/arrancar.

## Aproado

11. **Aproado por proa**: cuando el HUD diga logrado, el botón de modo
    pasa a **compás** y el barco aguanta proa al viento (AWA casi siempre
    dentro de ±10°). Comparado con el 18-oct, sin oscilar hasta 30°.
12. Si el viento rola, en ~15-30 s el rumbo se corrige solo (unos grados
    cada vez). Pulsa +10: deja de corregir durante 1 minuto y luego
    sigue desde tu rumbo. SALIR deja el piloto en compás al rumbo actual.

## Alarmas y recuperación (aguas libres)

13. **Desacople externo**: navegando a > 1 kn con el AP acoplado, pulsa
    AUTO en la TinyPilot. En ~5 s suena **"Piloto desacoplado"** en todas
    las pantallas. Se apaga al reacoplar (o a los 60 s).
14. **Piloto pillado (prueba controlada, mar llana)**: AP acoplado en
    compás. Sujeta la caña / rueda **firme** (que no se mueva) y pulsa
    +10 tres veces (+30°). El servo empuja contra ti hasta que pypilot
    corta por sobrecorriente. En unos segundos debe:
    - sonar **"Piloto pillado"**;
    - verse en Smart Pilot `cycles: 1` y el AP hacer off/on (0.7 s);
    - al soltar, el piloto lleva el barco al nuevo rumbo.
    Si sujetas más de ~40 s seguidos, a los 3 ciclos suena **"Piloto sin
    recuperación: gobierna a mano"**. Suelta y retoma.
    Si no salta nada, apunta la hora: miro `servo.flags` en la sesión.
15. **Con viento fuerte** (si se da): fíjate si el piloto ya no se queda
    "muerto" con error creciendo como el 18-oct 18:15-18:20. Si salta
    "Piloto pillado", apunta la hora y si el ciclo lo arregló.

## Al volver

16. Dime las horas de las pruebas y cualquier cosa rara. Con eso reviso
    sesiones (`servoFlags` ahora grabado), trazas y journal.

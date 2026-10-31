# QA Rev583 (3.8.2) — TODO lo pendiente de probar en el mar

Para Carlos. Guion único con **todo** lo que sigue sin validar en el agua,
desde la Rev299 (septiembre) hasta la 3.8.2. Sustituye a los pendientes de
`QA_SEA_TRIAL.md` (Rev299-376, Rev410-411), `QA_navegacion_Rev514.md`,
`QA_Rev526-540.md` y las notas de QA de mar de la memoria del proyecto.

Entre paréntesis, la Rev de origen de cada punto. Ordenado por dónde se
prueba y de menos a más riesgo. No hace falta hacerlo todo en una salida:
marca **OK / FALLA / NC** (no comprobado) y lo que quede NC pasa a la
siguiente.

**Si algo falla:** desconecta si hace falta, pulsa **Marcar** (pulsación
larga en el botón del timón de la rosa) y apunta la hora. La caja negra,
la sesión y la traza guardan ese minuto.

---

## 0. Red de seguridad

- **Quién gobierna es pypilot en la TinyPilot.** El plugin solo manda
  órdenes; el botón de la TinyPilot y el mando desconectan el AP aunque
  el plugin o la Pi fallen.
- **Volver a la versión anterior en 1 minuto** (PowerShell, portátil):
  `cd C:\Users\bybek\Downloads\signalk-pypilot-newui` →
  `git switch --detach v3.7.3` → `.\deploy.ps1 -Restart`.
  Volver a lo nuevo: `git switch main` → `.\deploy.ps1 -Restart`.
- **Pruebas con riesgo** (marcadas ⚠) solo con agua libre, sin tráfico y la
  mano en la caña.
- **Nada ajusta las ganancias solo** en esta versión (el modo sombra solo
  anota).

---

## A. En puerto, amarrado (AP desconectado salvo que se diga)

### A1. Versión y visor
1. Ctrl+F5 en tablet, móvil y pantalla de la Pi. Info muestra **3.8.2 / Rev583**.
2. Flechas **A** y **T** se mueven a la vez, sin que A vaya por detrás (Rev559).
3. Tablet en **vertical**: rosa y botones ocupan la pantalla, sin huecos negros; los botones crecen con la altura (Rev370).
4. Rosa: aro, marcas y marcos en gris; números en blanco (Rev529-530).

### A2. Perfiles (Rev569, 539)
5. Gestor de perfiles (⚙): aviso de los dos "Ceñida fondo medio viento". **Borra o renombra el que sobra**; el aviso desaparece.
6. "+ Nuevo" de prueba: debajo, `v2 · fecha · nuevo, copia de "<activo>"`. Renómbralo: conserva `v2` y pone "renombrado de…". Bórralo.
7. Importar un perfil: lo crea, queda activo y el resumen cuenta solo las ganancias aceptadas (Rev539).
8. Sin abrir Ajustes, cambia de perfil desde la rosa y abre Ajustes: ganancias ya del perfil nuevo (Rev573).

### A3. Ajustes y servo (Rev514)
9. Ajustes > Servo: desbloquear no pregunta; mover `max_current` (global) no pregunta; mover `servo.period` (perfil) pregunta una vez y "Cancelar" lo devuelve. Deja todo como estaba con ↺.
10. Cambia un valor, espera 20 s y toca otro slider: el grupo sigue abierto y con tu valor.

### A4. Smart Pilot y sensores
11. "Recuperación del piloto pillado" marcada, estado "armed"; en Alarmas activas: Piloto pillado, Piloto sin recuperación, Piloto desacoplado (Rev514).
12. Smart Pilot > Ayudas de sensores: "Fuente de velocidad" dice **sonda** (o GPS si no hay corredera) (Rev299).
13. Calidad de sensores: ningún sensor que funciona sale **DESCONOCIDO** (gris); un sensor que no tienes se puede **Ignorar** (Rev582).
14. Marcas de la rosa > "Marca de ráfagas" > "Probar ahora": flecha A naranja con los nudos que se apaga en ~15 s (Rev514).
15. Smart Pilot > estrategia de racha: ya no existe "Congelar objetivo"; sigue la tuya (**más D**) (Rev531).

### A5. Alarmas (Rev375-376, 534-536)
16. Cambia la severidad de una regla, espera 30 s y recarga: se mantiene; tras reiniciar Signal K también.
17. En el desplegable de severidad, la opción con ★ es la de fábrica.
18. Silencia una regla 15 min: el contador baja segundo a segundo y vuelve a "idle" solo.
19. Provoca una alarma (p. ej. tensión baja bajando el umbral). **ACK**: el banner se cierra y OpenPlotter / KIP dejan de sonar. Provócala otra vez: vuelve a salir.
20. Silenciada 15 min y quitada la causa: desaparece en segundos.
21. Cambia la gravedad de una alarma activa: KIP / OpenPlotter muestran la nueva.

### A6. KIP, backup, escrituras (Rev534, 538, 411)
22. AP desconectado, conectar desde KIP: el interruptor pasa a ON solo cuando pypilot lo confirma; desconectar → OFF.
23. Exportar configuración: el JSON trae las P/I/D de tu perfil. Cambia de perfil e importa el backup: vuelve al perfil y ganancias del backup, sin conectar el AP ni cambiar de modo.
24. Con `allowWrites` desactivado: el import se rechaza, y mover un slider de ganancia da error (503 "pypilot write refused" en la consola F12). **Vuelve a activar `allowWrites`.**

### A7. Caja negra (Rev526-529, 538, 544)
25. Card Caja negra: título y una línea; ámbar con incidentes sin abrir, verde al abrirlos (también en otro dispositivo).
26. Pulsación larga en el timón → "Momento marcado"; en ~70 s la card pasa a ámbar sola.
27. Abre el incidente: 10 series con chips; el cursor por la gráfica muestra hora, modo, valores y flags. **Ver** / **Descargar** funcionan.
28. "Marcar ahora" abre "Nota": dicta con el micrófono del teclado; la nota se ve en el incidente y en el JSON. **Borrar** pide confirmación.

### A8. Doctor (Rev535-536, 564-566, 577)
29. AP conectado en puerto (motor o amarre), diagnóstico; **durante** la sesión cambia de perfil y vuelve. Al terminar: aviso "el modo, el perfil o las ganancias cambiaron" y ninguna sugerencia.

### A9. Bitácora, sesiones, AIS (Rev537-538, 568)
30. Bitácora y sesiones se listan y descargan; la lista de sesiones abre al instante (Rev567).
31. Una sesión que se está grabando no se puede borrar.
32. Amarrado con GPS: el modo puerto AIS se activa a los 2 min con SOG < 0,6 kn.

---

## B. Saliendo del puerto (motor, calma, sin escora)

33. Fuente de velocidad sigue en **sonda**; si cambia sola a GPS o reserva, foto (Rev299).
34. Abatimiento (`steering.autopilot.pypilot.derived.leewayRad` en el Data Browser) ≈ 0 sin escora (Rev298).
35. Ninguna alarma de escora o cabeceo sin motivo (Rev299).
36. Bitácora: al ponerte en marcha se abre un viaje (Rev553).

---

## C. Compás

37. Rumbo 005, −10: objetivo **355**, el barco no va al 000 (Rev532).
38. Virada en compás desde 120 a estribor: objetivo **220** (Rev533).
39. Dos +1 rápidos: suman 2°, el rombo no rebota.
40. +10 y cambio de modo antes de 1 s: el +10 no se aplica en el modo nuevo.
41. Cambia el objetivo desde el mando / KIP y pulsa +10 en el visor enseguida: suma al objetivo nuevo.
42. **Desacople externo**: a > 1 kn con el AP conectado, AUTO en la TinyPilot: en ~5 s suena "Piloto desacoplado" en todas las pantallas; se apaga al reconectar (Rev514).
43. Sin GPS (solo corredera), quitar el AP desde el mando: salta "AP quitado desde fuera" (Rev535).

## D. Modos y viento

44. AP conectado, compás → viento: objetivo en el AWA actual, sin guiñada (Rev533, 541).
45. Viento → compás: queda en el rumbo actual.
46. **Rachas reales**: con viento racheado aparecen flechas fantasma (A/T con los nudos). ¿Pocas, bien o demasiadas? (Rev514)
47. **Rachas "más D" (tu configuración)**: al entrar una racha, aviso "D boosted…" y ~20 s después **"D restored to pre-gust value"**; en Ajustes, D es la de antes (Rev573, 576, 581).
48. Durante esos 20 s **cambia de perfil**: aviso "D of '<perfil>' will be restored when it is active again". Vuelve: "D restored" y su D vuelve al original.
49. Durante la racha cambia D a mano: "D changed during the gust window - not restoring" y se respeta tu valor.
50. **AUTO WIND**: cruzando TWA 120±5 durante 10 s cambia de aparente a real y viceversa, con el perfil de cada lado (Rev533-534).

## E. Viradas

### E1. Viradas virtuales en viento (Rev506-514, 532-534, 540)
51. Durante la virada las dos pantallas muestran **"VIRANDO → APARENTE"** y luego **APARENTE**; el número baja a 0 con "de Y°".
52. Entra en modo viento ya casi en el rumbo final, no a 20° de llegar.
53. Al acabar, el objetivo es el espejo (+45 → −45) y no se va a proa.
54. ±10 en el visor y en KIP a mitad: re-apuntan el final, no paran la virada.
55. **AP off a mitad** (visor y TinyPilot): la virada se anula y nada más se mueve.
56. Ciñendo, lanza una virada y cancélala; vuelve a pulsar el mismo botón: "¿Trasluchar por popa?…". **No** → no pasa nada.
57. Dos toques rápidos (< 1,5 s): no encadenan arrancar/cancelar/arrancar.
58. Virar dos veces seguidas desde KIP / mando: la segunda no reinicia la virada; cancelar desde KIP la para.
59. Cerca del final, −10: termina sin dar una vuelta entera.
60. Ninguna virada se queda a la mitad.

### E2. Viradas desde fuera del visor (Rev348-355)
61. Virada desde el **mando físico** (AP en compás): el visor muestra la virada como si la hubieras pulsado tú, y al terminar se abren las estadísticas.
62. Virada desde la **web de pypilot** (192.168.1.115): igual, y el rombo del objetivo se actualiza sin retraso.
63. Cancelar a mitad desde el visor: estadísticas marcadas **CANCELADO**.

### E3. Después de virar (Rev371, 537)
64. Estadísticas tras virar: salen al momento con "post —" y ~15 s después con los valores reales.
65. Tras una popa larga con olas, el contador de trasluchadas no sube solo.

### E4. Recuperación tras virar — TackCatchup (Rev299, en incubación, opcional)
66. Solo si quieres probarlo: pídeme activarlo (5°, 6 s). Tras una virada, `steering.autopilot.pypilot.tuning.tackCatchup.deltaRad` sube a ~0,087 y baja; `.active` true durante el descenso. Compara la sensación con y sin. **Al volver, se desactiva.**

## F. Aproado y empopado

67. **Aproado por proa**: al "logrado" el modo pasa a compás y el barco aguanta proa al viento (AWA casi siempre dentro de ±10°), sin oscilar hasta 30° (Rev514).
68. Si el viento rola, en 15-30 s corrige solo unos grados; +10 deja de corregir 1 min y sigue desde tu rumbo; SALIR deja compás al rumbo actual.
69. Aproado iniciado y cancelado al instante: el AP no se conecta ni se mueve (Rev534).
70. Aproado y SALIR: al minuto las alarmas de desvío vuelven a vigilar; pantalla apagada en un aproado largo (> 3 min): no saltan alarmas de desvío.
71. Con más de 10 kn de viento real, "por proa" sale marcado como **Recomendado** (Rev88-92).
72. Aproado **por popa** ⚠ (desde ceñida): gira por el lado largo en pasos y llega a proa al viento.
73. **Empopado**: el barco se pone viento en popa; al salir, el perfil y las ganancias vuelven a las tuyas (Rev313, 534, 539-540).
74. Aproado / empopado con el AP en **viento real**: pasa a real con TWA ≈ 0° / 180°; SALIR restaura modo, perfil y ganancias (Rev367).

## G. Ceñida con escora (Rev298-299)

75. Abatimiento con escora ≥ 10°: positivo con escora a estribor y de pocos grados (p. ej. ~4° con coef. 10, 15° de escora, 6 kn). Si sale negativo o > 15°, ajustamos el coeficiente.
76. Escora sostenida > 25° durante 5 s: salta la alarma de escora extrema y se quita al volver a < 25°. Una ola suelta no la dispara.
77. (Opcional) Alarma de cabeceo con umbral bajo (15°): salta al meter la proa en una ola y se quita.

## H. Piloto pillado y fallos ⚠ (Rev514, 410-411)

78. ⚠ **Piloto pillado controlado** (mar llana, compás): sujeta la caña firme y pulsa +10 tres veces. Al cortar pypilot por sobrecorriente: suena "Piloto pillado", Smart Pilot muestra `cycles: 1` y el AP hace off/on; al soltar va al nuevo rumbo. Más de ~40 s sujetando: "Piloto sin recuperación: gobierna a mano". Si no salta, apunta la hora.
79. Con viento fuerte: el piloto ya no se queda "muerto" con el error creciendo como el 18-oct.
80. Si la TinyPilot se cae a mitad de una virada (o un corte de WiFi): el visor cierra la virada solo (no se queda colgado) (Rev367, 410).
81. Virada virtual que no puede avanzar (barco sujeto o amarrado): a los 60 s toast rojo y voz "Virada fallida" (Rev410).

## I. Doctor y salud del servo navegando

82. En compás, rumbo recto 3 min sin tocar nada: diagnóstico. Si propone algo, **Aplicar**: el mensaje sale solo cuando pypilot confirma, y queda un perfil `doctor-…` (Rev566). Aplicar una segunda pide un diagnóstico nuevo.
83. Salud del servo: tras ~10 min de navegación con viento aprende su referencia; los valores típicos son razonables (1-3 A) (Sprint Q).
84. Si se corta pypilot_web un momento: rumbo / IMU pasan a degradado y luego perdido en Calidad de sensores, y vuelven a bueno (Sprint Q).

## J. Navegación larga — resumen, base de datos y modo sombra (Rev568-574)

85. Navega **20-30 min seguidos** con el AP conectado. Durante ese rato: un +10, más tarde un −10, y cambia **una** ganancia en Ajustes (apunta cuál y a qué valor).
86. Desconecta. Sesiones grabadas > **Resumen**: cifras con sentido; tu cambio atribuido a "tú · Tune" y las rachas a "racha".
87. Apartado **"Modo sombra (no se aplicó nada)"**: tramos, válidos, comparables, momentos con A/B/A posible y qué habría probado.
88. **El dato clave:** ¿lo que habría probado te parece razonable para cómo iba el barco? Apunta en una línea cómo iba (oscila, se va a un lado, bien, mar…).

## K. Ruta de Freeboard en NAV (3.7.0, Rev545-550, 576)

89. Ruta de 3 puntos en zona libre, actívala en Freeboard: el visor muestra **NAV** y el waypoint; conectar desde Freeboard/KIP entra en NAV a la primera.
90. Primer giro de más de 60°: pide confirmación.
91. En cada punto: avanza solo con aviso de voz; mira giro y sobrepaso.
92. En el destino o al borrar la ruta: a los 5 s pasa a **compás** al rumbo actual y avisa.
93. ±1 / ±10 durante la ruta pasan a compás.

## L. Red y visor en el mar (Rev556, 560-563)

94. Portátil por 4G/Tailscale: suspéndelo 5 min y despiértalo. Reconecta solo en menos de un minuto; el aviso queda naranja mientras no hay datos y solo dice "Red OK" cuando vuelven.
95. Abrir el visor con mala cobertura no vuelve a pedir la autorización de Signal K.
96. Pestaña oculta > 2 min con el AP **desconectado**: al volver reconecta. Con el AP **conectado** nunca se desconecta (la voz de alarmas sigue).

## M. Caja negra, alarmas y fondeo en navegación (Rev535-541)

97. ACK a una alarma: **no** crea un incidente en la caja negra.
98. Si se pierde pypilot unos minutos, el incidente se cierra a los ~2 min.
99. Carga alta del servo sostenida (si ocurre): salta "Carga del piloto alta".
100. Fondeado: un barco que se acerca rápido aparece aunque al principio no se conociera su velocidad.

## N. Al volver a puerto

101. Bitácora: al quedar amarrado se cierra el viaje con su resumen; una prueba de menos de 0,1 mn no se guarda (Rev553).
102. Si activaste el TackCatchup, pídeme desactivarlo.
103. Pásame las horas de salida, llegada y de cada FALLA o Marcar. Yo reviso en la Pi la base de datos de la salida, las decisiones del modo sombra frente a tu punto 88, la caja negra, las rachas (cada subida de D con su vuelta atrás) y las sesiones.

---

No hace falta probar en el mar: el vigilante de ganancias (probado en el
amarre el 2026-10-30, `RESULT: PASS`) y la base de datos (se llena sola).

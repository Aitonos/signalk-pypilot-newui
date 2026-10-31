# QA Rev583 (3.8.2) — pruebas en el mar de todo lo pendiente

Para Carlos. Reúne todo lo que no se ha probado aún en el agua, desde la
3.7.0 (rutas NAV, caja negra) hasta la 3.8.2 (rachas, modo sombra,
resumen de sesiones, historial de perfiles).

**Cómo usarlo:** marca cada punto **OK / FALLA**. Si algo falla:
desconecta el AP si hace falta, pulsa **Marcar** (pulsación larga en el
botón del timón de la rosa) y apunta la hora. La caja negra guarda ese
minuto y la sesión guarda todo lo demás.

---

## 0. Red de seguridad

- **Quién gobierna es pypilot en la TinyPilot.** El plugin solo manda
  órdenes. El botón de la TinyPilot y el mando desconectan el AP aunque el
  plugin o la Pi fallen.
- **Volver a la versión anterior en 1 minuto** (PowerShell en el portátil):

  ```
  cd C:\Users\bybek\Downloads\signalk-pypilot-newui
  git switch --detach v3.7.3
  .\deploy.ps1 -Restart
  ```

  Volver a lo nuevo: `git switch main` y `.\deploy.ps1 -Restart`.
- **Orden en el agua**, de menos a más riesgo, con la mano en la caña y
  agua libre: compás → cambios de modo → viento → viradas → AUTO WIND /
  aproado / empopado → ruta NAV.
- **Ningún ajuste de ganancias se hace solo** en esta versión. El modo
  sombra solo anota lo que haría.

---

## A. En puerto, antes de salir (15 min)

### A1. Versión y visor
1. Recarga el visor con Ctrl+F5. Info muestra **3.8.2 / Rev583**.
2. Flechas de viento: con el barco amarrado, **A** y **T** se mueven a la vez, sin que A vaya por detrás (Rev559).

### A2. Perfiles (Rev569)
3. Abre el gestor de perfiles (⚙). Arriba sale el aviso de los dos "Ceñida fondo medio viento" (uno con espacio al final). **Borra o renombra el que no uses**; el aviso desaparece.
4. "+ Nuevo" con un nombre de prueba: a los pocos segundos, debajo del nombre, `v2 · fecha · nuevo, copia de "<perfil activo>"`. Renómbralo: conserva `v2` y añade "renombrado de…". Bórralo después.

### A3. Calidad de sensores (Rev582)
5. Setup > Calidad de sensores: ningún sensor que funciona sale como **DESCONOCIDO** (gris). Si alguno sale así, foto de la tabla.

### A4. Ganancias al día (Rev573)
6. Sin abrir Ajustes, cambia de perfil desde el selector de la rosa. Abre Ajustes: las ganancias son ya las del perfil nuevo, sin esperar.

### A5. Doctor en puerto (Rev564-566, 577)
7. AP conectado en puerto (con motor o en el amarre), lanza un diagnóstico y, **durante** la sesión, cambia de perfil y vuelve al original. Al terminar: aviso "el modo, el perfil o las ganancias cambiaron durante la sesión" y **ninguna** sugerencia.

---

## B. Navegando

### B1. Compás (heredado de QA Rev544, sin probar aún)
8. Rumbo 005, pulsa −10: objetivo **355**, el barco no va al 000.
9. Dos +1 rápidos: suman 2°, el rombo no rebota.
10. Pulsa +10 y cambia de modo antes de 1 s: el +10 no se aplica en el modo nuevo.

### B2. Cambios de modo
11. AP conectado, compás → viento: el objetivo queda en el AWA actual, sin guiñada.
12. Viento → compás: queda en el rumbo actual.

### B3. Viento y viradas virtuales (heredado)
13. Virada en viento: al acabar, el objetivo es el espejo (+45 → −45) y no se va a proa.
14. Durante la virada, ±10 en el visor: re-apunta el final, no para la virada.
15. Cancelar la virada desde KIP: se para.
16. Ninguna virada se queda a la mitad.

### B4. Rachas "más D" (Rev573, 576, 581) — tu configuración
17. Con viento racheado y el AP conectado: al entrar una racha sale el aviso "D boosted …" y, unos 20 s después, **"D restored to pre-gust value"**. Abre Ajustes: D es la de antes de la racha.
18. Durante esos 20 s de racha, **cambia de perfil**. Debe salir "D of '<perfil>' will be restored when it is active again". Vuelve al perfil de antes: sale "D restored" y su D vuelve al valor original.
19. Si durante la racha cambias D tú a mano: sale "D changed during the gust window - not restoring" y tu valor se respeta.

### B5. AUTO WIND, aproado, empopado (heredado)
20. AUTO WIND: cruzando TWA 120±5 durante 10 s cambia de aparente a real y viceversa, con el perfil de cada lado.
21. Aproado y SALIR: al minuto las alarmas de desvío vuelven a vigilar.
22. Empopado y salir: el perfil vuelve al tuyo con sus ganancias.

### B6. Doctor navegando (Rev564-566, 577)
23. En compás, rumbo recto, sin tocar nada durante 3 min: lanza un diagnóstico. Si propone algo, **Aplicar**: el mensaje sale solo cuando pypilot confirma el valor, y queda activo un perfil `doctor-…`.
24. Intentar aplicar una segunda sugerencia: pide un diagnóstico nuevo.

### B7. Navegación larga con el AP (para el resumen, la base de datos y el modo sombra)
25. Navega **al menos 20-30 minutos seguidos** con el AP conectado, en viento o compás. Durante ese rato:
    - pulsa un **+10** y, más tarde, un **−10**;
    - cambia **una** ganancia en Ajustes (y apunta cuál y a qué valor).
26. Al terminar, desconecta el AP. En Sesiones grabadas > **Resumen** de esa sesión:
    - cifras con sentido (duración, modo, viento medio, velocidad, desvío medio, error RMS, servo trabajando);
    - en "Cambios durante la sesión", tu cambio de ganancia atribuido a **tú · Tune**, y los de racha (si hubo) a "racha";
    - en **"Modo sombra (no se aplicó nada)"**: cuántos tramos de 90 s, cuántos válidos, cuántos comparables, cuántos momentos con prueba A/B/A posible, y qué habría probado.
27. **Lo importante:** ¿lo que habría probado el modo sombra te parece razonable para cómo iba el barco? Apunta en una línea cómo iba (oscila, se va a un lado, va bien, mar…). Ese es el dato para decidir si avanzamos al ajuste automático.

### B8. Ruta de Freeboard en NAV (3.7.0, Rev545-550, 576)
28. En Freeboard, ruta de 3 puntos en zona libre y actívala. En el visor aparece **NAV** con el waypoint. Conecta desde Freeboard/KIP: entra en NAV a la primera.
29. Si el primer giro es de más de 60°, el visor pide confirmación antes de girar.
30. Al llegar a cada punto: avance automático al siguiente con aviso de voz; mira el giro y el sobrepaso.
31. Al llegar al destino (o si borras la ruta): a los 5 s pasa a **compás** en el rumbo actual y avisa.
32. ±1 / ±10 durante la ruta pasan a compás.

### B9. Red y visor en el mar (Rev556, 560-563)
33. Con el portátil por 4G/Tailscale: suspéndelo 5 min y despiértalo. El visor reconecta solo en menos de un minuto; el aviso de red pasa a naranja mientras no hay datos y solo dice "Red OK" cuando vuelven.
34. Abre el visor: **no** debe pedir otra vez la autorización de Signal K (Rev563), aunque haya mala cobertura.
35. Deja el visor en otra pestaña más de 2 min **con el AP desconectado**: al volver reconecta. Con el AP **conectado** no se desconecta nunca (la voz de alarmas sigue).

### B10. Caja negra y alarmas (heredado)
36. ACK a una alarma: **no** aparece un incidente nuevo en la caja negra.
37. Marcar (pulsación larga en el timón): toast "Momento marcado"; en ~70 s la card de la caja negra pasa a ámbar.

### B11. Bitácora (3.7.1)
38. Al salir del puerto se abre un viaje (navegando o a motor); al volver amarrado se cierra con su resumen. Una prueba en el amarre de menos de 0,1 mn no queda guardada.

---

## C. Después de la salida

39. Dime la hora de salida y llegada y las horas de cualquier FALLA o Marcar.
40. Yo reviso en la Pi:
    - las filas de la base de datos (`nav-db`) de la salida: que haya tramos de 90 s con datos coherentes y por qué se descartaron los no válidos;
    - las decisiones del modo sombra frente a lo que anotaste en el punto 27;
    - la caja negra de los Marcar;
    - el registro de rachas (que cada subida de D tenga su vuelta atrás).
41. Con eso decidimos el siguiente paso: sugerencias con un toque (fase 6) o ajustar las reglas del modo sombra.

---

Lo que no hace falta probar en el mar: el vigilante de ganancias (probado
en el amarre el 2026-10-30, `RESULT: PASS`) y la base de datos (se llena
sola). Detalle técnico de cada arreglo: `docs/_audit_3.8.0_2026-10-31.md`,
`docs/_audit_gpt_3.8.1_verificada_2026-10-31.md`,
`docs/_autoauditoria_pre_3.8.2_2026-10-31.md`.

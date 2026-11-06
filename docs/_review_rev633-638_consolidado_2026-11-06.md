# Revisión externa de Rev633-638: verificación y arreglos (Rev639)

Fecha: 2026-11-06.

**Fuente:** GPT, "Reauditoría Rev633–638". Usó un banco con un servidor
pypilot simulado por TCP en localhost, con el cliente y el proveedor
reales, y las funciones reales del visor.

Gemini: lo que llegó pegado no era su revisión (un texto sin relación).
Queda pendiente.

GPT recomendaba **retener la publicación**. Cada caso se ha comprobado en
el código antes de arreglarlo.

| Caso | Hallazgo | Verificación | Arreglo en Rev639 |
|---|---|---|---|
| C1 | La consigna inicial de AUTOWIND (Rev636) tomaba una orden posterior del patrón por "pypilot la ha sobrescrito" y la machacaba (30 → 60 → 30) | Cierto | La comprobación solo reescribe si pypilot ha vuelto a poner **el valor que tenía antes**. Si alguien dio otra orden de consigna (`targetGeneration()` del proveedor) o el valor es otro, se respeta |
| C2 | Con pypilot caído, el reintento de esa consigna salía después de apagar AUTOWIND | Cierto | `setTargetIfWanted(rad, stillWanted)` en el proveedor: comprueba antes de escribir y de cada reintento |
| C3 | La comprobación leía la consigna optimista del proveedor, no la que informa pypilot | Cierto | Se lee `ap.heading_command` de la caché del cliente (lo que informa pypilot). Si tras dos intentos no está, queda como error visible |
| C4 | Un cambio al perfil reactivo rechazado (HTTP 503) se daba por hecho; al cancelar se restauraba el perfil anterior encima del elegido a mano | Cierto | Solo cuenta como cambio si la respuesta es correcta. Al cancelar solo se restaura si el perfil sigue siendo el de la maniobra o el de antes |
| C5 | Una restauración de ganancia rechazada se registraba como "restored" y se perdía | Cierto | Cada ganancia solo sale de la lista pendiente si su escritura fue aceptada. Las que fallan siguen pendientes y el indicador queda en "failed" |
| C6 | El latido de 20 s cerraba la maniobra al momento si caía en un apagado breve; apagado-encendido-apagado la cerraba 3 s después del **primero** | Cierto | Una sola medida del tiempo con el piloto apagado **continuo** (`_apOffSince`), que se reinicia al volver a conectarse. El temporizador y el latido usan la misma regla |
| C7 | Si otra pantalla cambiaba la consigna sin cambiar de modo, la maniobra seguía activa (alarmas calladas) | Cierto (por diseño) | Traspaso explícito: elegir cualquier modo en otra pantalla envía `{active:false, id:"*"}` y el backend cierra todas las maniobras. El visor que la llevaba la cierra al ver `steering.autopilot.maneuver = null`, salvo en sus primeros 3 s |
| C8 | Una elección de AUTOWIND aún esperando (ajuste del ángulo) se enviaba después de haber elegido compás | Cierto | Contador de elecciones del selector: lo que sigue a un `await` solo actúa si no ha habido otra elección. Cubre también el camino de modo y luego consigna |
| C9 | Al expulsar entradas por el límite de 16 quedaban fechas en los mapas auxiliares | Cierto, menor | `forget()` limpia los tres mapas al expulsar, caducar o terminar |

GPT confirma como correctos de Rev633-638:
- la cancelación del reintento de modo;
- el perfil aplicado solo tras el eco del modo;
- el 409 con maniobra;
- los reintentos del perfil;
- los originales anotados antes de subir ganancias;
- la conciliación del backend con su margen inicial;
- los deltas que vuelven a evaluar la maniobra.

## Tests

495 en verde (`npm test`, código de salida 0). Nuevos:
- reintento de consigna cancelado (`setTargetIfWanted`);
- traspaso con `"*"` y memoria limpia en `ManeuverGate`;
- apagado-encendido-apagado con tiempo controlado;
- restauración rechazada que queda pendiente.

La consigna inicial de AUTOWIND (C1/C3) vive dentro de `index.ts` y no
tiene test unitario. Se prueba en el puerto: consigna a mano durante el
segundo después de activar AUTOWIND.

## Sigue abierto

Lo mismo que antes:
- ganancias en un perfil abandonado si se cambia de perfil a mitad de la
  restauración;
- perfil de AUTOWIND sin esperar su eco;
- sin pruebas con pypilot por TCP en nuestra batería (GPT sí lo usó);
- re-anchor del backend, aumento de D en rachas, cruce de ±180° y viento
  mínimo, fuera de la 3.12.0.

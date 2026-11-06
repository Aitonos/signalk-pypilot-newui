# Revisión externa de Rev639-640: verificación y arreglos (Rev641)

Fecha: 2026-11-06.

**Fuente:** GPT, "Reauditoría Rev639–640". Usó un banco con un pypilot
simulado por TCP, el cliente y el proveedor reales, y las funciones del
visor. GPT recomendaba **mantener la publicación en espera**.

**Lo que da por cerrado de su ronda anterior:**
- C2: no sale ninguna consigna después de apagar AUTOWIND.
- C4: un cambio de perfil rechazado ya no se toma por hecho.
- C6: el piloto apagado cuenta 3 s seguidos.
- C8: una elección antigua de AUTOWIND no actúa tras otra más nueva.
- C9: limpieza de la memoria del aviso de maniobra.
- El caso que bloqueaba (AUTOWIND 30°, el patrón 60°) ahora conserva
  los 60°.

**Lo que da por parcial:** C1, C3, C5 y C7.

| # | Hallazgo | Verificación | Arreglo en Rev641 |
|---|---|---|---|
| 1 | La consigna inicial de AUTOWIND podía pisar una orden manual dada **durante** la espera del cambio de modo (los 400 ms) | Cierto | La intención se captura al activar AUTOWIND (`targetGenAtStart`). Cualquier orden de consigna posterior, también durante la espera, gana y no se escribe nada |
| 2 | Margen de 5°: una orden externa próxima al valor anterior (82 frente a 80) se tomaba por "pypilot repuso el suyo" y se reescribía. Y `Number(null)` daba 0 | Cierto | **Ya no hay reescritura automática.** Una escritura y una comprobación con lo que informa pypilot (2°). Si no coincide, se deja como está y se avisa (`lastError`): no se puede saber de quién es la otra orden. Un valor ausente es "no confirmado", nunca 0 |
| 3 | Un traspaso entre pantallas podía revertirse: el visor dueño ignoraba el fin en sus primeros 3 s, seguía renovando y, al caducar el bloqueo del id, el backend volvía a aceptarlo | Cierto | Mientras el dueño siga renovando un id terminado, el bloqueo se renueva y nunca vuelve. Además, la respuesta a la renovación dice `ended:true` y el visor dueño cierra su maniobra |
| 4 | Un traspaso atrasado (`"*"`) cancelaba una maniobra iniciada después | Cierto | El traspaso ya no es `"*"`: lleva los **ids** que veía la otra pantalla (publicados en `steering.autopilot.maneuverIds`), así que una maniobra nueva no se ve afectada |
| 5 | Cancelar el diálogo de NAV ya había cerrado la maniobra de la otra pantalla | Cierto | Con NAV y giro de más de 60°, el traspaso se hace solo al aceptar, y solo si sigue siendo la última elección |
| 6 | Una ganancia del Empopado que no se pudo restaurar se quedaba en el objeto de la maniobra cerrada, sin reintento | Cierto | Pasa a un registro aparte: reintento cada 15 s mientras el perfil sea el suyo, 4 veces. Si no se consigue, aviso con el perfil y las ganancias a revisar (ES/EN/DE/FR) |
| Rev640 | La alarma de acceso dependía del texto del mensaje | Cierto, menor | Mira primero la clave de la solicitud (`pypilot-<n>`), y el texto como respaldo |

## Tests

499 en verde (`npm test`, código de salida 0). Nuevos o cambiados:
- `ManeuverGate`: traspaso por ids; un id terminado que se sigue
  renovando no vuelve (400 s); un traspaso atrasado no cierra una
  maniobra posterior;
- visor: la ganancia rechazada queda en el registro aparte.

La consigna inicial de AUTOWIND sigue sin test unitario, porque vive
dentro de `index.ts`. Se prueba en el puerto.

## Sigue abierto (aceptado)

- Ganancias en un perfil abandonado si se cambia de perfil a mitad de la
  restauración (ahora con aviso al final).
- El perfil de AUTOWIND se da por bueno al aceptarse la escritura.
- Fuera de la 3.12.0: re-anchor del backend, aumento de D en rachas,
  cruce de ±180° y viento mínimo.

# Revisión externa de Rev630-632: verificación y arreglos (Rev633)

Fecha: 2026-11-06.

**Fuentes:**
- GPT, "Reauditoría Rev630–632": 10 hallazgos, reproducidos con
  simulaciones deterministas.
- Gemini, con el prompt `docs/_prompt_llm_review_rev630-632_2026-11-06.md`.

Cada hallazgo se ha comprobado en el código antes de tocar nada.

## Resultado

| # | Hallazgo | Quién | Verificación | Arreglo en Rev633 |
|---|---|---|---|---|
| R01 | AUTOWIND apagado todavía manda el reintento de `ap.mode`: `_setWithRetry` solo miraba `modeGen` | GPT | Cierto | `setModeIfWanted(mode, stillWanted)` en el proveedor: comprueba antes de escribir y antes de cada reintento. AUTOWIND lo usa con su número de operación |
| R02 | El perfil se aplicaba con la escritura aceptada, sin el eco de pypilot | GPT | Cierto | `_autowindApply` espera hasta 3 s a que `data.mode` (eco de pypilot) sea el pedido. Si no llega, es un fallo: sin perfil y con reintento a los 10 s |
| R03 | Cerrar Empopado no cancelaba su arranque (cambio de perfil → `true wind`) ni su salida (perfil → compás → consigna). Lo mismo en la salida de Aproado | GPT | Cierto | Comprobación `state.empopado/aproado === esa maniobra` tras cada `await` de Execute y Finish. Si se cierra mientras cambia de perfil, vuelve al perfil anterior y no manda nada más |
| R04 | La restauración de ganancias solo miraba el perfil al empezar: una D antigua podía caer en el perfil nuevo | GPT | Cierto | Comprobación del perfil antes de **cada** escritura. Si cambió, para y lo registra |
| R05 | Los aumentos de ganancia seguían tras cerrar el Empopado, y el registro de los originales se guardaba al final | GPT | Cierto | El original de cada ganancia se anota **antes** de subirla. No se sube ninguna más si la maniobra terminó o cambió el perfil. La restauración cubre lo que ya se mandó |
| R06 | Activar AUTOWIND saltaba los bloqueos (virada, maniobra) y la antigüedad de los datos | GPT | Cierto | Con virada o maniobra en curso, el backend responde 409 y AUTOWIND no arranca; el visor lo explica. Sin viento real fresco o por debajo de 3 kn, arranca en aparente a propósito, y queda en el registro |
| R07 | El permiso interno de la virada era un booleano compartido durante un `await`: una orden externa que llegaba durante un reintento lo heredaba | GPT | Cierto | Parámetro `internal` en cada llamada a `setMode`/`setTarget`. Desaparece `_vtInternalWrite` |
| R08 | Una renovación atrasada de una maniobra cerrada la reabría hasta 3 min | GPT | Cierto | `ManeuverGate` recuerda los id cerrados durante un TTL. El id `legacy` queda como antes |
| R09 / G3.1 | Un perfil que pypilot no acepta no se reintentaba | GPT, Gemini | Cierto | Reintento cada 10 s, hasta 5 veces, mientras se mantenga el mismo lado. Se abandona si el patrón elige otro perfil, y entonces lo indica |
| R10 / G2.2 | Aproado y Empopado podían convivir (el selector excluía los dos de la limpieza) | GPT, Gemini | Cierto | Elegir Aproado cierra el Empopado y viceversa |
| G2.1 | Tras Aproado/Empopado, elegir AUTOWIND (o Aparente/Real) dejaba la consigna extrema de la maniobra (AWA 0 / TWA 180) | Gemini | Cierto; ya pasaba antes de Rev630 | Si se acaba de terminar una maniobra en modo viento, la consigna pasa al ángulo de viento actual antes de AUTOWIND o del modo elegido |
| G2.3 | El "off" de una maniobra que ya no renovaba el aviso no llegaba al backend (3 min con alarmas calladas) | Gemini | Cierto | Ese "off" se manda igualmente al backend con su propio id |
| G3.2 | La activación manual no anotaba el fallo en el decisor | Gemini | Cierto, menor | La activación pasa `fromTick = true` |
| G2.4 | `empopadoFinish` apaga el aviso antes de la salida a compás (1-3 s): falsas alarmas | Gemini | **Descartado** | Las tres alarmas tienen 30 s de espera sostenida (`sustainSec`). 1-3 s no las disparan, y apagar el aviso al terminar era el arreglo de Rev630 |

GPT confirma como correctos: el cierre del resumen, el latido con id y
fase, el rechazo en la virada virtual (caso normal), el perfil tras
apagar AUTOWIND, y los datos viejos y huecos en el decisor periódico.
Gemini confirma los ocho cambios declarados, salvo lo de arriba.

## Lo que queda abierto (aceptado, documentado)

- **Ganancias en un perfil abandonado.** Si el patrón cambia de perfil a
  mitad de la restauración, las ganancias que faltan se quedan
  aumentadas en el perfil que dejó el Empopado. No se escriben en el
  nuevo, que es lo grave. Queda registrado en la consola del visor.
- **Confirmación del perfil.** AUTOWIND da el perfil por bueno cuando
  pypilot acepta la escritura; no espera su eco. El modo sí se confirma
  con el eco.
- **Sin pruebas de integración con un pypilot simulado por TCP** (GPT,
  punto 5). Los tests son unitarios y de lógica; la prueba real es la
  QA en amarre y en navegación.
- **Siguen pendientes, fuera de este bloque:**
  - N5: el re-anchor del backend ignora la confirmación de modo; hoy no
    actúa porque le faltan datos;
  - N12 y N13: el aumento de D en rachas.

## Tests

481 en verde (`npm test`, código de salida 0). Nuevos:
- reintento de modo cancelado con `setModeIfWanted`;
- orden externa durante un reintento interno de la virada → rechazada;
- `ManeuverGate` con mensajes atrasados;
- ganancias temporales: sin aumentos tras el cierre, y sin escrituras en
  el perfil nuevo;
- el selector cierra Aproado ↔ Empopado;
- el "off" de una maniobra que ya no renovaba llega al backend.

Los cinco tests nuevos del visor y del aviso fallan con el código de
Rev632; los del proveedor ni compilan sin `setModeIfWanted`.

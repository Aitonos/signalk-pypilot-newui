# Reauditoría de Pypilot NewUI · Rev641

6 de noviembre de 2026. Revisión de los cambios desde Rev640 para la candidata a 3.12.0.

**Veredicto: aplazar la publicación.** La protección nueva contra órdenes obsoletas rechaza la propia consigna de AUTOWIND. En un arranque sin intervención de otro patrón, con piloto conectado y activado, el servidor simulado siguió informando de 80° y recibió cero consignas cuando AUTOWIND debía fijar 30°. Una orden de control enviada por la interfaz del proveedor sí llegó a ese mismo servidor.

## Bloqueo determinante

**B1 · Alta · AUTOWIND invalida su propia orden antes de enviarla.** Deriva del código y está reproducido en el transporte. El manejador captura la generación antes del cambio de modo en `src/index.ts:2939` y la entrega a la rutina de arranque en 2948. La rutina exige que el contador siga siendo igual al valor inicial en 5149–5151. Pero el proveedor incrementa ese mismo contador en `src/autopilot-provider.ts:827` **antes** de evaluar la condición en 831–833. Así, la generación pasa de 0 a 1 aunque el único que haya intervenido sea AUTOWIND.

| Ensayo | Resultado |
|---|---|
| Activación mediante el callback real de `POST /autowind`, estando ya en aparente | Respuesta con `enabled:true`, `lastError: hold the current wind angle: target no longer wanted`. Cero escrituras al servidor. |
| Rutina de arranque sin espera inicial, consigna previa 80°, viento actual 30° | Generación 0→1, cero envíos de AUTOWIND. Control independiente por el mismo proveedor: 30° recibido. |
| Misma rutina con la espera de 400 ms correspondiente a un cambio de modo | Mismo rechazo y control positivo. En este ensayo se ejercita la rama de espera con el modo destino ya informado. |
| El patrón pide 60° durante los 400 ms | El servidor recibe únicamente 60°. Esta protección sí funciona. |

**Corrección mínima.** El proveedor debe comprobar la generación esperada y reservar la nueva generación en una sola operación síncrona, antes de cualquier espera. Tras reservarla, la vigencia se comprueba contra la generación propia de esa orden y contra el estado de AUTOWIND. Mover solamente la primera comprobación dejaría el mismo problema en la comprobación posterior al envío o en el reintento.

**Criterio de publicación.** Usar el mismo camino de activación y el mismo servidor para comprobar cuatro casos: sin intervención llega exactamente una consigna de 30°; si el patrón pide 60° durante la espera, solo llegan 60°; si corrige después de la primera escritura, prevalece su corrección; si desactiva AUTOWIND antes de un reintento, no aparece un envío posterior. Para dar por válida la confirmación, añadir casos con informe numérico, ausente y divergente una vez restaurado el camino normal.

La QA de puerto reseñada en el documento dice que la consigna se aplicó sin error. El resultado local difiere. Los archivos recién compilados `dist/index.js` y `dist/autopilot-provider.js` coinciden por SHA-256 con los dos compilados correspondientes de la carpeta original de Descargas. Para resolver la diferencia hace falta identificar los archivos que cargó Signal K en la Pi y rastrear el origen de la escritura en aquel ensayo. No he inspeccionado el equipo embarcado.

## Estado de las seis observaciones anteriores

| Rev640 | Resultado en Rev641 | Qué se comprobó |
|---|---|---|
| #1 · Corrección manual durante la espera inicial | **Pasa su caso individual, pero el cambio introduce B1.** | El ensayo con intervención conserva 60°. El complementario sin intervención falla. `src/index.ts:5145–5165`. |
| #2 · Reenvío sobre una corrección externa próxima y conversión de `null` a cero | **Correcciones presentes por inspección. Validación funcional incompleta.** | Hay una sola llamada de escritura y lectura estrictamente numérica en 5152–5155 y 5164–5175. B1 impide alcanzar normalmente la verificación posterior de una consigna emitida. |
| #3 · Reapertura del identificador ya cedido | **Cerrado para renovaciones continuas del caso anterior.** | Renovaciones cada 20 s durante 400 s: siempre `ended`, sin reapertura. Además el visor procesa la respuesta con el id correspondiente. `src/maneuver-gate.ts:34–54`, `public/app.js:12383–12399`. |
| #4 · Un traspaso tardío cancela al nuevo propietario | **Cerrado para el caso anterior.** | Con B activa, el fin demorado dirigido a A deja B activa. El selector captura los ids observados. `src/maneuver-gate.ts:65–77`, `public/app.js:14194–14196`. |
| #5 · NAV rechazado ya había cedido el control | **Corregido para la otra pantalla. Queda la variante local.** | Rechazar un giro NAV de 150° no envía el traspaso remoto. Si la maniobra pertenece al mismo visor, el selector ejecuta el teardown local antes de preguntar. `public/app.js:14178–14186,14198–14200,14221–14227`. |
| #6 · Ganancia sin restaurar tras el cierre | **Un fallo aislado ya puede recuperarse. La recuperación no está aislada entre operaciones.** | Un reintento individual recuperó D=0,2 en su perfil. Hay pérdida o sobrescritura en los escenarios B2 y B3. `public/app.js:13088–13118,13149`. |
| Alarma · Identidad de la solicitud de acceso | **Corregido el caso de clave documentada.** | La clave `pypilot-1` con aviso y texto sin comillas se detectó. En estado normal no disparó; otra clave con el mismo texto tampoco. Sigue existiendo el fallback por texto. `src/index.ts:5115–5133`. |

## Otras observaciones reproducidas

**B2 · Media-alta · Dos restauraciones pendientes compiten por un solo registro.** `public/app.js:13088–13118`. Registrar una obligación para el perfil B cancela el temporizador del perfil A y reemplaza su registro. En una segunda prueba, un reintento de B quedó esperando una respuesta mientras se registraba C. Cuando B terminó, borró el puntero común: C quedó con un temporizador programado pero sin un registro activo que ese temporizador pueda procesar. Esta secuencia ocurre incluso si las dos obligaciones son de perfiles distintos. Conservar obligaciones por operación y perfil. Comprobar la identidad después de cada espera antes de retirar una entrada.

**B3 · Media-alta · Una restauración diferida puede pisar un ajuste manual posterior del mismo perfil.** `public/app.js:13095–13109`. La autorización del reintento solo mira el perfil. Con D ajustada a 0,4 posteriormente, la restauración antigua escribió 0,2 en la prueba. Es distinto del límite conocido sobre cambiar de perfil. Registrar también el valor temporal que puso la maniobra y la identidad del cambio. Antes de restaurar, comprobar si ese cambio sigue siendo el que se está deshaciendo; si ya hay una elección manual distinta, respetarla.

**B4 · Media · Cancelar NAV en el visor propietario termina la maniobra local.** El componente de selección real produjo `teardown → diálogo rechazado` para una maniobra local y solo `diálogo rechazado` para una remota. El primer escenario ya era posible antes de la Rev641. La nueva revisión corrige el segundo. Diferir las dos formas de cierre hasta que el patrón acepte y comprobar de nuevo que la elección siga vigente.

## Alcance y reproducción

Comparación final de 124 archivos en `src` y `public` con la carpeta original. Todos coincidían. Se ejecutaron **499 pruebas, 147 suites, cero fallos, cero omisiones y cierre natural en 79,34 s**. El banco adicional utiliza TCP en loopback, el cliente y proveedor reales del proyecto y los cuerpos de los manejadores actuales. Controla los mensajes del piloto simulado y, para las pruebas de interfaz, el reloj y las respuestas asíncronas. Se verificaron las órdenes enviadas, no la respuesta física del barco.

El paquete incluye informe, código, compilados, `bank.cjs`, `results.json`, `bank.log`, `suite.txt` y manifiesto de hashes. Desde la carpeta extraída, con las dependencias instaladas del proyecto:

```powershell
$env:NODE_PATH='C:\Users\bybek\Downloads\signalk-pypilot-newui\node_modules'
node bank.cjs
node --test --test-timeout=110000 --test-reporter=tap "dist/test/*.test.js"
```

Las aserciones de reproducción describen deliberadamente la Rev641 tal como se recibió. Tras corregir B1, debe invertirse la aserción de cero escrituras para exigir una escritura efectiva. El control positivo directo se mantiene para distinguir una regresión de software de un problema del banco.

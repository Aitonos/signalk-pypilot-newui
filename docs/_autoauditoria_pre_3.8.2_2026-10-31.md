# Autoauditoría antes de publicar 3.8.2 — y por qué GPT ve lo que yo no

Fecha: 2026-10-31. Carlos: "audítate tú a ti mismo antes de hacer
publish, a ver por qué GPT ve cosas que tú no ves".

## Por qué se me escapan

Repasando las dos auditorías de GPT (15 + 6 hallazgos, casi todos
ciertos), casi todos los fallos son del mismo puñado de tipos, y casi
todos en código que yo mismo había escrito o tocado poco antes:

1. **Reviso con el mismo modelo mental con el que escribí.** Leo el código
   como "lo que quise hacer", no como "lo que hace". GPT lo lee sin saber
   la intención y pregunta qué pasa en cada caso.
2. **Pruebo el camino que diseñé.** Mis tests comprueban que lo nuevo
   funciona como pensé; GPT escribe pruebas que intentan romperlo
   (reproducciones contra el comportamiento actual).
3. **No recorro sistemáticamente cada `await`, cada escritura y cada
   dato.** GPT lo hace casi mecánicamente:
   - en cada espera: ¿qué puede cambiar mientras tanto? (A08, R02);
   - en cada `set`: ¿y si devuelve false? (A02, B01, y hoy otra vez en la
     prueba del amarre);
   - en cada valor: ¿y si falta, está desfasado o no es finito? (A07,
     R01, y hoy otra vez al arrancar);
   - en cada estado: ¿sobrevive a un reinicio? (R05);
   - en cada operación: ¿tiene identidad propia o la puede pisar otra?
     (R02);
   - en cada escritura: ¿pasa por el permiso? (A09, y hoy el vigilante al
     arrancar).
4. **Arreglo el caso concreto, no el patrón.** Corregí "set ignorado" en
   las rachas y lo volví a dejar en la prueba del amarre; corregí datos
   ausentes en un sitio y no en el arranque.
5. **Me fío de "pasan los tests".** Una vez se publicó un commit con un
   test fallando porque el comando miraba la salida de `grep`, no el
   código de salida.

## Lista que aplico desde ahora antes de cada publish

Sobre todo el código cambiado desde la última versión publicada:

| Pregunta | Dónde mirar |
|---|---|
| ¿Qué cambia durante cada `await` / temporizador? ¿Se comprueba después? | `await`, `setTimeout`, `setInterval` |
| ¿Se comprueba el resultado de cada escritura? ¿Se confirma leyendo? | `client.set`, `fs.write*`, `spawn` |
| ¿Qué pasa si el dato falta, no es finito o es de antes (otro perfil, antes del arranque)? | lecturas de `getValues`, `getSelfPath`, JSON |
| ¿Sobrevive a un reinicio de Signal K o de la Pi? | estado en variables |
| ¿Puede una operación vieja pisar una nueva? ¿Tiene identificador? | pruebas, restauraciones, temporizadores |
| ¿Pasa la escritura por `allowWrites`? | cualquier salida a pypilot / NMEA / Course API |
| ¿Bucles con condición que puede no cumplirse nunca? | `while`, recursión |
| ¿Tests nuevos que fallarían con el código anterior? ¿Código de salida real? | `npm test; echo $?` |

## Resultado de aplicarla ahora (Rev575-582 + lo nuevo)

Tres fallos más, todos del tipo de la tabla, corregidos en **Rev583**:

| # | Tipo | Fallo | Arreglo |
|---|---|---|---|
| S1 | Dato ausente | Al arrancar con una restauración de racha pendiente (Rev581), antes de que pypilot mande sus valores, se tomaba como "perfil cambiado" y salía un aviso falso | Sin piloto / perfil conocidos no se juzga nada |
| S2 | Retorno ignorado | La prueba del amarre no miraba si pypilot aceptaba el cambio al perfil de prueba; su tarea asíncrona no capturaba errores | Si se rechaza, la prueba no empieza y se cierra la autorización; errores capturados |
| S3 | Permiso | Al arrancar, el vigilante restauraba una prueba sin cerrar aunque `allowWrites` estuviera desactivado | Con escrituras desactivadas solo avisa en el log |

Revisado sin hallazgos nuevos: normalización de ángulos (los NaN acaban
como "sin dato" en sesiones, base de datos y Doctor), base de datos y modo
sombra, calidad de sensores, ruta (APB), Doctor.

Anotado sin arreglar:
- Si se reinicia el Doctor justo mientras aplica, el perfil copia ya creado
  queda activo sin el cambio de ganancia (inofensivo, pero sorprende).
- El latido del vigilante escribe un fichero pequeño cada segundo mientras
  corre (solo durante pruebas y 10 min después).
- La coordinación plugin/vigilante por fichero no es atómica (ventana de
  milisegundos).

438 tests en verde (código de salida 0).

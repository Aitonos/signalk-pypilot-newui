# Autoauditoría antes de publicar 3.12.0 (Rev630 → Rev655)

2026-11-07. Carlos dio el OK a publicar sin revisión externa de Rev642-654
("publica ya"). GPT revisó hasta Rev641; sus cuatro hallazgos sobre Rev641
(B1-B4) están corregidos en Rev645 con pruebas.

## Revisión externa

| Tramo | Revisión | Estado |
|---|---|---|
| Rev630-641 (AUTOWIND, maniobras entre pantallas, Empopado, alarma de acceso) | GPT + Gemini, cuatro rondas | hallazgos corregidos; B1-B4 de la última en Rev645 |
| Rev642-654 (COG, ajustes avanzados, avisos, Doctor, caja negra, registros, bitácora, copias, PIN) | ninguna externa | autoauditoría abajo + QA de puerto de Carlos |

## Lista de comprobación

**Esperas (awaits) y órdenes obsoletas.**
- AUTOWIND (B1): la generación de consigna se compara y reserva en un solo
  paso síncrono; probado sin intervención, con orden del patrón durante la
  espera y con corrección posterior.
- Restauración de ganancias de Empopado (B2/B3): una entrada por maniobra,
  identidad comprobada tras cada espera, y solo se restaura si pypilot
  sigue marcando el valor que puso la maniobra.
- NAV con giro grande (B4): nada se cierra hasta que el patrón dice Sí.

**Escrituras a pypilot.**
- Ajustes avanzados: nada sin "Permitir cambios"; los de instalación piden
  confirmación en el visor y, con PIN puesto, el servidor los rechaza sin
  la llave de administrador.
- Doctor: un nombre de perfil existente se rechaza en el servidor (escribirlo
  en pypilot cambiaría a ese perfil y el consejo caería ahí).

**Datos en disco.**
- Registros de la TinyPilot: compresión en streaming, un archivo cada vez,
  nunca el del día; primera pasada en el barco 692 MB → 8 MB, Signal K
  respondiendo durante la pasada.
- Copias: escritura atómica (`.tmp` + rename), 30 como máximo, ~54 KB cada
  una. Sin contraseña SSH ni token de Signal K (comprobado en el archivo real).
- Bitácora: pausar no guarda muestras ni suma distancia; borrar el viaje en
  curso elimina sus archivos.

**Reinicio de Signal K.**
- Las llaves de administrador viven solo en memoria: un reinicio obliga a
  desbloquear de nuevo (a propósito). El PIN (hash) persiste.
- El bloqueo de "viaje parado a mano" se borra al arrancar el plugin.
- Temporizadores nuevos (limpieza de registros, copias) se limpian en stop
  o son `unref`; las copias comprueban cada hora si falta la de hoy.

**Identidad y permisos.**
- El PIN se guarda con scrypt + sal en la carpeta de datos, nunca en las
  opciones del plugin (no viaja en exportaciones ni copias). Comparación en
  tiempo constante. 5 fallos → 5 min de bloqueo.
- Sin PIN puesto no se bloquea nada (actualizar no deja fuera a nadie).
- La exportación de configuración ya no incluye la contraseña SSH (antes sí).
- Rutas protegidas en el servidor: exportar/importar configuración, paths,
  reinicios, ssh-exec, debug-cmd, captura de registros y traza (activar y
  descargar), copias (hacer y descargar) y escrituras de instalación.
- Límite conocido: si Signal K no pide login, el PIN protege frente a quien
  usa el visor, no frente a quien entra en la Pi (documentado).

**Código de salida de las pruebas.** `npm test`: 527 pruebas, 0 fallos,
código de salida 0 (Rev654). Se repite con la versión final antes del tag.

## Riesgos que quedan

- La alarma `pypilot-sk-access` sigue teniendo un respaldo por texto.
- La TinyPilot tiene el reloj en 2024: las fechas de sus propios registros
  no valen (no afecta a las copias, que usan el reloj del servidor).
- Restaurar todos los perfiles desde una copia todavía no está en el visor
  (la parte de configuración sí, con la importación existente).

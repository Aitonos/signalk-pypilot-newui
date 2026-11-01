# Autoauditoría antes de publicar 3.10.0

Fecha: 2026-11-01. Alcance: todo lo cambiado desde 3.9.0 (Rev602 → Rev618).
Lista aplicada: la de `docs/_autoauditoria_pre_3.8.2_2026-10-31.md`.

## Qué cambia

- **Zonas de puerto**: marcar regiones de Signal K (dibujadas en Freeboard)
  como puerto / campo de boyas (`feature.properties.zoneType`, propuesta
  SignalK/signalk-server#3271); dentro de una zona de puerto la alarma AIS
  pasa sola a modo Puerto (backend, todos los dispositivos).
- **Fondeo**: un barco lento dentro del círculo de borneo avisa (regla de
  mareas-ihm), salvo si mareas ya vigila el fondeo.
- **collision-alerts**: nombre nuevo `@signalk/collision-alerts` y los dos
  identificadores del plugin (0.6.0 y 0.6.1+).
- **Ventana de configuración** ordenada en secciones plegables con nombres
  aprobados; estilos al de la app; móvil sin desbordes.
- **Panel multifunción**: botón de pestañas abajo en el centro; marcador
  de escora con triángulos centrados; gráfica: tooltip en minutos y en
  colores, sin marca de tiempo central.
- **Rosa**: letras A/T blancas, racha en viento real con la forma de la
  flecha real, barra "/" coloreada, cierre automático de pestañas.
- **Histórico de la gráfica** (30 min) que sobrevive a reinicios.
- **Vigilante de ganancias**: conexión cerrada sin respuesta = intento
  fallido inmediato; test A10 estable.

## Lista

| Pregunta | Resultado |
|---|---|
| ¿Qué cambia durante cada `await` / temporizador? | Zonas: lectura con contador de generación; al parar el plugin se invalida una lectura en vuelo. Guardar zona: se relee la región justo antes del PUT (ventana de milisegundos si otra app la edita a la vez; aceptado). Zona de fondeo: la última lectura gana. Temporizadores nuevos (zonas cada 60 s, histórico cada 10 min) se paran en `stop()`. |
| ¿Se comprueba cada escritura? | PUT de región: estado HTTP comprobado (401/403 avisa de iniciar sesión, otros errores visibles y relectura). Histórico: fichero temporal + rename, errores capturados. Ninguna escritura nueva a pypilot. |
| ¿Dato ausente / no finito / antiguo? | Posición propia o del blanco ausente o NaN = fuera de zona; regiones mal formadas se ignoran; restauración del histórico descarta muestras de más de 30 min, del futuro o mal formadas. |
| ¿Sobrevive a un reinicio? | Histórico: sí (nuevo; verificado en la Pi, el fichero se escribe al reiniciar Signal K). Zona de puerto: se recalcula en 1 s tras leer las regiones. |
| ¿Una operación vieja pisa una nueva? | Lecturas de regiones con generación; guardado de zona relee antes de escribir. |
| ¿Pasa por `allowWrites`? | No hay escrituras nuevas a pypilot, NMEA ni Course API. La edición de regiones es un recurso de Signal K que hace el usuario con su sesión. |
| ¿Bucles que pueden no terminar? | Punto en polígono y restauración acotados por tamaño de datos. |
| ¿Tests nuevos? ¿Código de salida real? | `harbour-zones.test.ts` (6: geometría, filtro por tipo, modo Puerto al entrar y salir, desactivado), `historian-persist.test.ts` (3), A10 reescrito. El visor sin arnés: verificado con capturas y medidas en Edge sin interfaz. `npm test`: 449 en verde, código de salida 0, tres pases seguidos sin fallos. |

## Anotado sin arreglar

- En modo Puerto (manual, por 2 min parado o por zona) no avisa ni de un
  barco rápido que entra; comportamiento previo, decidido por Carlos
  ("en puerto, sin avisos").
- El histórico se guarda cada 10 min además de al parar: ~500 KB por
  escritura, ~75 MB/día en la tarjeta de la Pi. Si se ve desgaste, subir
  el intervalo.
- La marca de zona solo la usa todavía nuestro plugin; collision-alerts la
  usará si se acepta SignalK/collision-alerts#47.

# Autoauditoría antes de 3.15.0 (Rev684-691) — 2026-11-11

Cambios desde v3.14.0:
- Rumbo preparado con el piloto desconectado (compás / GPS).
- Textos más grandes y legibles en todo el visor menos Control.
- Barra de pestañas a 14 px, con hueco para el botón de pantalla completa.
- Zona del PIN de Setup recolocada.

Origen: comentarios de Moeritsen en el foro (hilo 7074) y de Carlos.

## Rumbo preparado (`public/app.js`)

1. **Qué cambia durante cada await.**
   - `doEngage` lee el rumbo preparado antes de cambiar `state.engaged` de
     forma optimista. Ese valor es el objetivo que se envía a la vez que se
     conecta: el mismo camino que ya usaba el rumbo actual, sin escrituras
     nuevas.
   - El rumbo preparado se borra solo si la conexión sale bien.
2. **Retorno de cada escritura.**
   - Si falla la conexión, el rumbo preparado se conserva y la interfaz
     vuelve a su estado anterior, como antes.
   - Si la conexión sale bien pero falla el envío del objetivo, pypilot se
     queda con su objetivo por defecto (el rumbo actual) y el rumbo
     preparado se borra. Es el mismo comportamiento que ya había con el
     rumbo actual.
3. **Dato que falta.** Sin rumbo (`state.heading` no numérico) no se
   prepara nada y el botón solo se anima, como antes.
4. **Reinicio.** El rumbo preparado vive solo en la pestaña. Al recargar se
   pierde, que es lo seguro.
5. **Operación vieja que pisa una nueva.**
   - `_preparedRad()` lo anula si el piloto está conectado (también si lo
     conecta otro dispositivo), si cambió el modo o si pasaron 60 s sin
     tocarlo.
   - Nunca se envía un rumbo preparado caducado.
6. **allowWrites.** No hay escrituras nuevas. La conexión sigue pasando por
   `/ap/engage` y `/target`, que lo comprueban.
7. **Bucles.** Ninguno; un solo temporizador, de 60 s, que se reinicia en
   cada toque.
8. **Tests.**
   - La lógica es del visor, que no tiene banco de pruebas unitarias.
   - Verificado en headless con el barco en compás: tres veces −10 dan
     «259° −30» y el rombo visible.
   - En modo viento, nada, como antes.
   - Suite completa: código de salida 0.

**Referencia del rumbo.** En GPS el objetivo al conectar ya era
`state.heading` antes de este cambio. El rumbo preparado usa la misma
referencia, así que no cambia nada respecto a 3.14.0.

**Modos viento y NAV.** Sin cambios a propósito. En viento, que un giro sume
o reste depende de la amura, y no se adivina con el piloto desconectado.

## Tamaños y colores (`public/style.css`)

- Las reglas generadas por script están limitadas a Gráfica, Regata, Setup
  (y sus tarjetas a pantalla completa), Info y Configuración del visor.
  Control y las demás ventanas emergentes no cambian.
- El gris secundario (`#b8c4d0`) se mantiene fuera de Tune para conservar
  la jerarquía título / dato.
- Barra de pestañas medida a 360, 390, 412, 440, 800 y 1280 px: ninguna
  pestaña queda bajo el botón de pantalla completa.
- Ninguna página produce desplazamiento horizontal.

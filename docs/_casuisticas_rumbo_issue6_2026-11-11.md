# Otras casuísticas del rumbo en Signal K (tras 3.15.2) — 2026-11-11

Seguimiento del issue #6. La 3.15.2 cubre estos casos:
- pypilot sin acceso a SK;
- pypilot en la misma máquina;
- salida SK de pypilot apagada;
- servidor no encontrado.

Aquí van los casos que aún pueden fallar o portarse raro.

## A. El respaldo puede equivocarse

1. **Eco con un plugin que deriva el rumbo magnético.**
   - Si algún plugin (derived-data u otro) calcula `headingMagnetic` a partir
     de `headingTrue` + variación, y ese `headingTrue` sale de nuestro propio
     rumbo, el plugin derivado aparece como «otra fuente».
   - Entonces el respaldo se apaga, el derivado se queda sin entrada, el
     respaldo vuelve a encenderse... Oscila cada 10-15 s.
   - Pendiente: comprobar qué cálculos trae derived-data.
   - Arreglo posible: contar como «otra fuente» solo la que siga publicando
     5 s después de apagarnos; si no, volver a encender y recordarlo.
2. **Actitud y velocidad de giro duplicadas.**
   - Hoy el respaldo decide mirando solo `headingMagnetic`.
   - Un barco con un sensor de actitud aparte (N2K, otra IMU, el IMU de
     mareas) pero sin rumbo recibiría una segunda fuente de
     `navigation.attitude`. Las apps saltarían entre las dos.
   - Arreglo: decidir camino a camino; publicar actitud o giro solo si nadie
     más lo hace.
3. **Otra fuente lenta o intermitente.**
   - Una brújula NMEA 0183 a menos de 0,2 Hz, o un enlace con cortes (4G,
     EMI), queda fuera del margen de 5 s.
   - El respaldo entra y sale. Los valores son coherentes, pero el log se
     llena de `[imu-fallback] on/off`.
   - Arreglo: histéresis (apagar en el acto, volver a encender tras 30 s) y
     un tope a las líneas de log.
4. **Prioridades de fuentes en SK.**
   - Si el usuario configuró prioridades para `headingMagnetic`, la fuente
     `pypilot-newui` no está en la lista.
   - Pendiente: comprobar en SK 2.x si descarta valores de fuentes no
     listadas. En ese caso el respaldo publicaría, pero nadie lo vería.
   - Como mínimo, documentarlo en el README.
5. **Saltos de reloj en la máquina SK.**
   - `set-system-time` o NTP tras 4G pueden adelantar o atrasar el reloj.
   - Un salto puede hacer que la otra fuente parezca vieja durante una
     pasada.
   - Ya hacen falta 2 pasadas seguidas, así que el riesgo es bajo. Lo dejo
     anotado.

## B. El usuario no se entera

6. **El check dice «OK» cuando el rumbo viene del respaldo.**
   - pypilot sigue sin acceso a SK y nadie lo sabe.
   - Las demás cosas que pypilot publica dejarían de llegar sin aviso
     (estado del piloto, que usan KIP y otros).
   - Arreglo: mostrar «OK (rumbo publicado por el plugin: pypilot no escribe
     en SK)» con el enlace a Seguridad.
7. **No hay forma de apagar el respaldo.**
   - Ejemplo: alguien desactivó la salida SK de pypilot a propósito, porque
     su IMU está sin calibrar y no la quiere en el plotter.
   - El respaldo se la vuelve a meter sin preguntar.
   - Arreglo: un interruptor en Setup (activado por defecto).

## C. Fuera del alcance del respaldo

8. **pypilot conectado a otro servidor SK de la red** (por ejemplo un Cerbo
   GX con SK, u otra Pi).
   - pypilot elige el servidor por zeroconf.
   - El respaldo lo cubre, pero la causa queda oculta. Lo mismo que en el
     punto 6.
9. **pypilot sin `ap.heading`** (versiones antiguas o catálogo raro).
   - El respaldo no se enciende nunca, porque usa `ap.heading` para saber si
     hay rumbo.
   - Arreglo: aceptar también `imu.heading_lowpass` como señal.
10. **El plugin no llega a pypilot** (IP mal, otra red).
    - No hay respaldo posible. El check ya lo dice («no reachable»).

## Propuesta

Una sola Rev, testable:
- **Hacer:** 2 (decisión por camino), 3 (histéresis y tope de log), 6 (aviso
  en el check), 7 (interruptor) y 9 (`imu.heading_lowpass`).
- **Hacer si se confirma en el código de derived-data:** 1.
- **Comprobar y documentar:** 4.
- **Solo nota:** 5, 8 y 10.

## Resultado (Rev698-699, desplegado en la Pi)

- **1. Eco con derived-data:** descartado. derived-data lee
  `headingMagnetic` (rumbo verdadero, viento, corriente) pero no lo escribe.
  Si otro plugin lo hiciera, lo frena el margen de 30 s del punto 3.
- **2. Hecho.** Decisión camino a camino.
  - Al probarlo en el barco salió que pypilot **nunca** publica
    `rateOfTurn`: su `signalk.py` lo tiene en la tabla, pero no vigila
    `imu.headingrate_lowpass`.
  - Por eso la velocidad de giro va atada al rumbo: solo se publica junto
    al rumbo del respaldo. Así no se añade nada nuevo mientras pypilot
    escribe en SK.
- **3. Hecho.** Margen de 30 s tras ver otra fuente; tope de 20 líneas de
  log por hora.
- **4. Comprobado** en `deltaPriority.js` de SK 2.37: una fuente fuera de
  la lista toma el relevo tras `unknownSourceTimeout` (10 s por defecto) de
  silencio de las fuentes listadas. El respaldo se ve. Queda explicado en el
  README.
- **6. Hecho.** El check da aviso (`viaFallback`) con enlace a Security >
  Devices.
- **7. Hecho.** Interruptor en Setup > conexión pypilot (activado por
  defecto, pide el PIN de admin).
- **9. Hecho.** También cuenta `imu.heading_lowpass`.

### Comprobado en el barco

- Respaldo apagado: rumbo y actitud llegan de `pypilot`; no hay
  `rateOfTurn`, igual que antes.
- Check en «ready».
- Tarjeta de Setup en español y marcada.
- Aviso del splash simulado en el navegador de pruebas.

### Sin probar en real

El encendido con pypilot sin acceso. Lo cubren los tests (569/569).

### Posible PR a pypilot

En `setup_watches`, añadir `imu.headingrate_lowpass` para que pypilot
publique `rateOfTurn`.

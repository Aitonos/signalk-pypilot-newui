# Propuesta: control de pilotos Raymarine sin Signal K (ESP32 + móvil)

Fecha: 2026-11-04. Estado: idea, sin código. Nada de esto toca
signalk-pypilot-newui.

## Objetivo

Una versión reducida del visor para pilotos Raymarine que funcione sin
Raspberry y sin Signal K: un ESP32 a bordo conectado al bus del piloto y
un móvil Android como pantalla.

## Arquitectura

```
 Piloto Raymarine ── bus NMEA 2000 / SeaTalkNG (o SeaTalk1) ──┐
                                                              │
                                    ESP32-S3 + transceptor CAN
                                    - lee rumbo, posición, viento, estado AP
                                    - manda órdenes al piloto
                                    - vigilancia de fondeo (siempre encendida)
                                    - sirve la página web + WebSocket
                                    - aviso Telegram (si hay internet a bordo)
                                                              │ WiFi
                                                     Móvil (navegador)
                                                     - interfaz del piloto
                                                     - carta con teselas
                                                     - mareas (NEAPS local)
```

Regla de reparto: lo crítico y lo que tiene que estar siempre encendido
va en el ESP32; lo pesado (dibujo, carta, mareas) va en el móvil.

Se descarta una app Android nativa con pasarela comercial: obliga a
pasar por Play Store o APK, y la vigilancia de fondeo en el móvil no es
fiable (Android duerme las apps en segundo plano y el móvil puede salir
del barco).

## Funciones

| Función | Dónde | Notas |
|---|---|---|
| Standby / Auto / Viento / Track | ESP32 | Track solo si el piloto lo admite |
| ±1 / ±10, virada | ESP32 | Órdenes propietarias Raymarine, ya documentadas (canboat, `signalk-raymarine-autopilot`) |
| Rumbo actual / fijado, timón | ESP32 → móvil | Timón solo si hay sensor |
| Alarma de pérdida de conexión | móvil | El piloto sigue con la última orden; avisar claro y no reenviar órdenes viejas |
| Vigilancia de fondeo | ESP32 | Posición GPS del bus; zumbador; Telegram si hay router 4G |
| Carta | móvil | OpenStreetMap + OpenSeaMap, teselas guardadas para sin cobertura |
| Mareas | móvil | NEAPS (sin internet una vez descargadas las constantes); Open-Meteo Marine como alternativa |

Fuera de alcance: ganancias (Raymarine no las expone), doctor, sesiones,
todo lo específico de pypilot.

## Potencia

ESP32-S3 (2 núcleos a 240 MHz, ~512 KB RAM, 4-16 MB flash, PSRAM
recomendada): leer el bus, mandar órdenes, vigilar el fondeo y servir
datos a 2-4 móviles a 2-5 Hz va holgado. El controlador CAN está en el
chip; solo falta el transceptor.

El visor actual no cabe tal cual: `app.js` 1,2 MB (360 KB gzip), más
200 KB de HTML y 150 KB de CSS, casi todo específico de pypilot y Signal
K. Hay que hacer un visor reducido reutilizando el aspecto.

Coste aproximado del hardware: 15-25 € (placa, transceptor CAN, caja).
Consumo < 0,5 W.

## Trabajo

1. Firmware C++ (Arduino / ESP-IDF) con la librería NMEA 2000 de código
   abierto que ya soporta ESP32. Es el grueso del trabajo: el backend
   Node.js no se puede portar.
2. Visor reducido (HTML/JS comprimido en la flash del ESP32).
3. WiFi: conectarse al router del barco si existe; punto de acceso
   propio solo como alternativa (el móvil se quedaría sin internet para
   carta y mareas en línea).
4. SeaTalk1 (pilotos antiguos) como fase 2: otro bus y otro protocolo
   (pulsaciones de teclas).

## Riesgos

- **No hay piloto Raymarine para probar.** Hace falta un probador de la
  comunidad con un Evolution. Un simulador NMEA 2000 sirve para
  desarrollar pero no sustituye al piloto real.
- Diferencias entre generaciones de pilotos y controladores: limitar la
  lista de compatibles a lo probado.
- Seguridad: cualquier fallo de conexión debe dejar el piloto en un
  estado conocido y visible; nunca reenviar órdenes en cola.

## Antes de empezar

Buscar si alguien de la comunidad ya tiene un control Raymarine en ESP32
(no reinventar).

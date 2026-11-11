# Autoauditoría antes de 3.15.2 (Rev694-697) — 2026-11-11

Cambios desde v3.15.1, a raíz del issue #6 de GitHub (Moeritsen: sin HDG en
el visor aunque pypilot tiene rumbo):
- `appIcon` relativo a la carpeta servida (icono en blanco en Webapps).
- Aprobación automática del acceso de pypilot también desde 127.0.0.1, ::1
  y las direcciones propias, cuando pypilot corre en la máquina de Signal K.
- La comprobación del piloto distingue «pypilot tiene rumbo pero no llega a
  Signal K» de «IMU sin datos».
- Respaldo del rumbo: el plugin publica rumbo, actitud y velocidad de giro
  desde la IMU de pypilot cuando nadie más lo hace.

## Lista (feedback_self_audit_before_publish)

1. **Qué cambia durante cada await o temporizador.**
   - El temporizador del respaldo (5 s) relee la fuente del rumbo y la edad
     de `ap.heading` en cada pasada; no arrastra estado salvo el contador de
     pasadas.
   - Al apagarse, `imuFallbackActive` se pone a false antes de reajustar lo
     que se vigila en pypilot, así que el siguiente valor de la IMU ya no se
     publica.
2. **Retorno de cada escritura.**
   - `handleMessage` va en try/catch y se reintenta con el siguiente valor
     (2-5 Hz).
   - No hay escrituras a pypilot.
3. **Dato que falta.**
   - Sin `imu.heading_lowpass` no se publica nada.
   - Sin pitch o roll, no se publica la actitud.
   - Sin velocidad de giro, no se publica `rateOfTurn`.
   - Valores no finitos: se descartan.
4. **Reinicio.**
   - El estado del respaldo no se guarda: arranca apagado y decide en 10 s.
   - `stop()` limpia el temporizador y la bandera.
5. **Dos fuentes a la vez.**
   - Se activa solo si ninguna otra fuente actualizó
     `navigation.headingMagnetic` en los últimos 5 s, durante dos pasadas
     seguidas.
   - Se apaga en la primera pasada en que otra fuente lo hace.
   - Las propias publicaciones no cuentan como «otra fuente».
6. **allowWrites.** No aplica: es publicación hacia Signal K de datos que
   pypilot ya tiene; no escribe en pypilot.
7. **Bucles.** Ninguno. Un temporizador de 5 s y un límite de 5 Hz en la
   publicación.
8. **Tests.**
   - Nuevos: `imu-fallback.test.ts` (fuentes y unidades),
     `prechecks.test.ts` (`notInSk`) y `pypilot-sk-access.test.ts` (alias
     locales).
   - Suite completa con código de salida real.

## Comprobado en el barco (TinyPilot aparte)

- El respaldo queda apagado, porque pypilot publica el rumbo.
- La aprobación automática no añade direcciones, porque la TinyPilot no es
  la máquina local.
- La comprobación del piloto da «listo».
- Caso #6 simulado en headless: aparece el mensaje «pypilot lo tiene, pero
  no llega a Signal K».

**No probado en real:** el encendido del respaldo. Habría que quitarle a
pypilot el acceso en el barco. Lo cubren los tests unitarios.

## Seguridad de la aprobación

Se siguen aprobando solo dispositivos `pypilot-<dígitos>` con descripción
«pypilot». Las direcciones locales se añaden únicamente si la dirección de
pypilot configurada es la propia máquina.

# Autoauditoría antes de 3.15.3 (Rev698-700) — 2026-11-11

Cambios desde v3.15.2: casos del respaldo del rumbo
(`docs/_casuisticas_rumbo_issue6_2026-11-11.md`).
- Decisión por cada dato: rumbo, actitud y velocidad de giro por separado.
- La velocidad de giro se publica solo junto al rumbo del respaldo.
- Espera de 30 s para volver a encenderse tras ver otra fuente.
- Tope de líneas de log.
- Interruptor en Setup.
- Aviso `viaFallback` en el check.
- `imu.heading_lowpass` también cuenta como «pypilot tiene rumbo».

## Lista (feedback_self_audit_before_publish)

1. **Qué cambia durante cada await o temporizador.**
   - Cada pasada de 5 s relee la fuente de cada camino, el rumbo de pypilot
     y el interruptor (`props`, que `/options` actualiza en el momento).
   - La velocidad de giro mira el estado del rumbo de esa misma pasada: el
     rumbo va primero en la lista.
2. **Retorno de cada escritura.**
   - `handleMessage` va en try/catch.
   - Guardar el interruptor pasa por `/options`; si falla, el visor
     revierte la casilla y muestra el error.
3. **Dato que falta.**
   - Sin rumbo no se publica nada.
   - Sin pitch o roll no se publica la actitud.
   - La velocidad de giro necesita el rumbo del respaldo encendido.
4. **Reinicio.**
   - Arranca con todo apagado; `stop()` reinicia los estados.
   - El interruptor queda guardado en la configuración del plugin.
5. **Dos fuentes a la vez.**
   - Cada camino se retira en cuanto otra fuente lo escribe.
   - Para volver, 30 s de silencio.
   - Con prioridades configuradas en SK, el respaldo entra tras 10 s de
     silencio de las fuentes de la lista (`deltaPriority.js`).
6. **Permiso.** El interruptor es una opción técnica: pide el PIN de admin
   si está activo.
7. **Bucles.**
   - Ninguno nuevo.
   - Publicación a 5 Hz como máximo; log a 20 líneas por hora como máximo.
8. **Tests.**
   - Nuevos:
     - `stepFallbackPath`: encendido, retirada, espera de 30 s, interruptor;
     - filtro de `imuFallbackValues`;
     - `viaFallback` en prechecks;
     - `headingFallback` en `/options`.
   - Suite completa: 569/569.

## Comprobado en el barco (Rev699)

- Con Rev698 apareció `rateOfTurn` con fuente `pypilot-newui`, porque
  pypilot nunca lo publica. Corregido en Rev699; PR a pypilot #325.
- Con Rev699: respaldo apagado, rumbo y actitud de `pypilot`, check
  «ready», nada en el log.
- Tarjeta de Setup en español y marcada.
- Aviso del splash simulado en el navegador de pruebas.

**No probado en real:** el encendido con pypilot sin acceso.

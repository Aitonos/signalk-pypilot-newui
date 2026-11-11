# Autoauditoría antes de 3.15.4 (Rev701-705) — 2026-11-11

Cambios desde v3.15.3:
- Configuración del visor: nombres de apartado y orden de tarjetas
  (Rev701).
- Instrucciones de la pestaña Info, título del README sin «for Signal K» y
  subtítulo de la barra del panel multifunción (Rev702).
- Respaldo de rumbo: al retirarse de un dato que nadie más publica, lo deja
  a `null` (Rev703).
- Aviso de conexiones rechazadas por Signal K (429) y banner que hace salto
  de línea (Rev703-704).
- Captura 13 del README nueva.

## Lista (feedback_self_audit_before_publish)

1. **Qué cambia durante cada await o temporizador.**
   - `_wsOpenFails` lo cambian solo el `open` y el `close` del socket
     actual (se mantiene el filtro `sock !== ws`).
   - Un socket aparcado a propósito (pestaña oculta) sale antes de contar.
2. **Retorno de cada escritura.** El `null` del respaldo va en try/catch,
   como el resto de publicaciones.
3. **Dato que falta.**
   - Sin un ping HTTP que haya respondido al menos una vez
     (`_lastPingRttMs` nulo), no se muestra el aviso del 429: sigue el de
     red intermitente.
   - El `null` se manda solo si ninguna otra fuente publica ese dato.
4. **Reinicio.** Nada se guarda. El contador vuelve a 0 al recargar o al
   abrir un socket.
5. **Dos fuentes a la vez.** Con otra fuente activa no se manda `null`, así
   que no se le pisa el valor.
6. **Permiso.** Sin cambios.
7. **Bucles.** Ninguno. El banner solo cambia de texto en el tick que ya
   existía.
8. **Tests.**
   - Suite completa: 569/569.
   - Comprobado de verdad:
     - el corte de pypilot hacia Signal K en el barco (iptables, piloto
       desconectado), dos veces;
     - el banner del 429 en el navegador de pruebas, con el stream
       redirigido a un puerto cerrado: aparece a los 10 s y desaparece al
       volver la conexión.

## Comprobado en el barco

- Prueba 1 (Rev699):
  - encendido a los 30 s;
  - check en «listo con avisos», con `viaFallback`;
  - pypilot reconecta a los 85 s;
  - el respaldo se apaga 3 s después.
- Prueba 2 (Rev704): igual que la primera, y la velocidad de giro queda en
  `null` al retirarse.
- Configuración del visor: los seis apartados, en inglés y en español.
- Instrucciones nuevas servidas por la Pi.

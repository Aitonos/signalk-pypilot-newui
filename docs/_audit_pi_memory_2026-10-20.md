# Audit — memoria de la Pi y registro RSS de SK (2026-10-18 → 2026-10-20)

Registro cada 15 min de `/home/pi/sk-rss.log` (48 h). El script se
retiró solo del cron al terminar y se ha borrado; el log se conserva.

## SignalK (node)

- Muchas reinicios por los despliegues de estos días: solo dos tramos
  largos sirven para ver tendencia.
  - 18-oct 01:35 → 15:30 (14 h): 816 → 963 MB.
  - 19-oct 04:15 → 16:45 (12.7 h, amarrado): 502 → 924 MB.
  - Proceso actual (desde 20-oct 00:56): 912 MB a las 16:00.
- Conclusión: crece ~30 MB/h las primeras horas y se va por encima de
  los 800 MB objetivo en ~10-12 h. Con el reinicio cada 3 días por cron
  no hay riesgo inmediato (8 GB de RAM), pero no se estabiliza.

## Lo que más pesa: tráfico REST a SK

- `journalctl`: 138 107 líneas de SK en 1 hora (38/s), casi todas logs de
  peticiones HTTP.
- 21 000 GET en 10 min (35/s) a
  `/signalk/v1/api/vessels/<propio>/notifications/navigation/closestApproach/<mmsi>`
  (uno por blanco AIS, muchos 404) y 300 GET en 10 min a cada
  `notifications/autopilot/steer-*`: un cliente consulta por REST cada
  ruta de alarma cada ~2 s.
- **No es** el visor de pypilot-newui (alarmas por WebSocket), ni
  AnchorWatch Pro, ni Home Assistant (`signalk_ha` usa WebSocket y
  descubrimiento cada 24 h), ni AvNav (`receiveNotifications="false"`).
- Conexiones persistentes a :3000: 7 desde el portátil `carlos-tt`
  (Tailscale), 5 locales, TinyPilot, tablet.
- Primera sospecha descartada: con Firefox del portátil cerrado (incl.
  Freeboard) la tasa seguía igual. Tampoco es `signalk-collision-alerts`
  (crea las alarmas con la API interna, sin HTTP).
- **Causa real**: 1 988 conexiones TIME-WAIT desde `::1` (una por
  consulta). Eran **73 ventanas emergentes de OpenPlotter Notifications**
  (`/usr/bin/openplotter-notifications-visual`), abiertas desde el
  18-oct 02:06: 70 alarmas de colisión de barcos amarrados al lado (CPA
  0.01-0.03 NM, estado `alarm`) y 2 de nuestras `steer-*`. Cada ventana
  hace un GET REST de su alarma cada 2 s (`visual.py`, `wx.Timer(2000)`)
  y solo se cierra sola si su nivel tiene autoclose; en
  `~/.openplotter/openplotter.conf`: `visualalarm = [..., False]`,
  `visualemergency = [..., False]`. **Sumaban 3.3 GB de RAM.**
- Cerradas a mano (kill por PID) el 2026-10-20 16:3x: GET de
  notificaciones 35/s → 0, log de SK ~1 000 → 13 líneas / 30 s,
  memoria disponible 1.6 → 4.2 GB.
- **Para que no vuelva** (decisión de Carlos, configuración de
  OpenPlotter → Notifications): marcar auto-cierre en el nivel
  "alarm" (y "emergency"), y/o ignorar
  `notifications.navigation.closestApproach` en los avisos visuales (el
  visor de pypilot-newui ya muestra las alarmas AIS en la rosa).

## Memoria del sistema (fuera de SK)

- Disponible: 4.9 GB (18-oct) → 1.8 GB (20-oct), uptime 4 d 19 h.
- Procesos grandes desde el arranque del 15-oct:
  - `dbus-daemon --system`: **364 MB** (normal < 10 MB): fuga.
  - `lxpanel` (panel LXDE): **362 MB** (normal ~40 MB): fuga.
  - Home Assistant 330 MB, AvNav 143 MB: normales.
- El cron reinicia SK pero no dbus ni lxpanel. Un reinicio de la Pi los
  limpia. Muy probablemente crecieron por las 73 ventanas emergentes
  (cada una es una ventana wx del escritorio LXDE).

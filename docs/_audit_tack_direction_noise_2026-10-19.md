# Audit — `ap.tack.direction` alternando none ↔ port/starboard (2026-10-19), Rev513

## Causa (pypilot, `/usr/local/lib/python3.11/dist-packages/pypilot/tacking.py`)

- `Tack.process()`: con el AP desacoplado pone `direction = 'none'` en
  cada vuelta del bucle.
- `Tack.poll()`: cada ≥ 0.25 s, si las 20 últimas lecturas de viento
  (5 s) están todas por encima de 20° del mismo lado, pone
  `direction = 'port'` o `'starboard'`.
- En standby con viento estable de un lado, las dos se pisan sin parar.
  Es comportamiento de pypilot, no un fallo nuestro.

## Medido

- Traza 2026-10-18 (16:09-21:15): 7587 cambios, **7551 (99.5 %) con el
  AP desacoplado** (~40/min, también en el amarre). Acoplado: 36
  cambios (los legítimos).
- Traza 2026-10-19 04:00-16:46 (amarre): **111196 de 111262 líneas
  (99.9 %)** eran este ruido, 34.5 MB.
- Cada cambio viajaba como delta SK a todos los clientes y como evento
  de traza desde cada visor.

## Arreglo (Rev513)

En standby el plugin publica `ap.tack.direction = 'none'` una vez y no
reenvía el parpadeo; acoplado publica el valor real como siempre (y lo
resincroniza al acoplar / desacoplar). El provider y el detector de fin
de virada siguen recibiendo el valor crudo.

## Pendiente de decisión

`maneuver-trace/` ocupa **888 MB** (201 archivos desde 2026-09-28) y no
tiene limpieza automática. Disco al 39 % de 234 GB: no es urgente.
Propuesta: conservar las 60 trazas más recientes (como las sesiones,
Rev505). No aplicado: borra histórico de sea trials.

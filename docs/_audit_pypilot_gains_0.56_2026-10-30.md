# Auditoría — qué hace cada ganancia en el pypilot del Tunatunes (fase 2 del Doctor automático)

Fecha: 2026-10-30. Solo lectura (catálogo y valores por TCP desde la Pi;
código fuente de pypilot en GitHub). Sin navegar.

## Versión instalada

- **pypilot 0.56** (`ap.version`), commit `f74400ad` del 2024-07-10.
  Código revisado: `pypilot/pilots/basic.py`, `pilots/pilot.py` y
  `autopilot.py` en ese commit.
- Piloto activo: `basic` (existe también `absolute`).
- `imu.rate` = 20 Hz configurado; **17,8–18,2 Hz medidos**.
- `rudder.source` = `none`: **sin sensor de timón** (confirmado).
  `rudder.range` = 63 ya configurado. Al conectar el sensor habrá que
  calibrarlo en pypilot (`rudder.calibration_state`).

Atención: la versión actual de pypilot en GitHub (0.71) **ha quitado el
término I** del piloto `basic`. Lo de abajo vale para la 0.56 instalada;
si se actualiza la TinyPilot hay que repetir esta auditoría.

## Cómo calcula pypilot el mando

El mando al servo es la **suma de seis términos**, cada uno ganancia × su
entrada (`AutopilotPilot.Compute`). pypilot publica además **cuánto aporta
cada término** en cada instante (`ap.pilot.basic.Pgain`, `Igain`, `Dgain`,
`DDgain`, `PRgain`, `FFgain`) a la frecuencia del IMU (~18 Hz).

| Ganancia | Entrada | Rango | Valor ahora | Qué hace en la práctica |
|---|---|---|---|---|
| **P** | Error de rumbo (°), limitado a ±60°; signo invertido en modos viento | 0–0,03 | 0,0165 | Corrección proporcional al error |
| **I** | Integral del error: suma `error/1500` por segundo, limitada a ±5; **se pone a 0 al cambiar de modo**, y se reduce con los cambios de rumbo ordenado | 0–0,05 | 0,0015 | Corrige un desvío sostenido, **muy despacio** (ver abajo) |
| **D** | Velocidad de giro **medida por el giróscopo** (filtrada), no la derivada del error | 0–0,24 | 0,1505 | Amortigua el giro del barco. Un cambio de rumbo ordenado no le da "patada" |
| **DD** | Aceleración de giro (derivada de la anterior, filtrada) | 0–0,24 | 0,0796 | Anticipa: frena antes de que el giro coja velocidad |
| **PR** | Raíz cuadrada del error, con su signo | 0–0,02 | 0,0051 | Fuerte con errores pequeños y casi plano con grandes: quita la "zona muerta" cerca del rumbo |
| **FF** | Ritmo al que cambia el rumbo ordenado (filtrado) | 0–2,4 | 0,452 | Solo actúa mientras cambia el objetivo (±1/±10, viradas): empuja el giro desde el principio. Con el objetivo quieto vale 0 |

## Consecuencias para el Doctor y el auto-ajuste

1. **No es un PID de libro** (GPT tenía razón). D y DD trabajan sobre el
   giro medido, PR no es lineal y FF solo existe durante los cambios de
   rumbo. Las reglas "síntoma → ganancia" hay que pensarlas con esto.
2. **El término I es muy lento.** Con 3° de desvío sostenido la integral
   crece 3/1500 = 0,002 por segundo. Con I = 0,0015, al cabo de 3 minutos
   aporta ~0,0005 frente a ~0,05 del término P: **un 1 %**. La regla
   actual del Doctor "desvío sostenido → I +20 %" apenas cambia nada en
   una sesión de 3 minutos. Además se reinicia en cada cambio de modo.
   Para un desvío sostenido, **PR (y P) actúan mucho antes**. Revisar la
   regla 1 del Doctor (propuesta: no tocar en este paso, decidir con los
   datos del modo sombra).
3. **FF se ajusta con los cambios de rumbo, no navegando recto**: sus
   métricas son las de los episodios (subida, sobrepaso), no el error en
   rumbo fijo.
4. **Los aportes por término son oro para el auto-ajuste**: permiten ver
   qué término domina el mando. En el amarre, con el piloto desconectado,
   D aportaba −0,054 frente a −0,007 de P. Propuesta: guardar en la base de
   datos por tramo el RMS del aporte de cada término.
5. **Rangos**: el catálogo de pypilot da los límites de cada ganancia; el
   Doctor ya los respeta (Rev536).

## Ritmo de datos y carga de la TinyPilot

Medido desde la Pi, 15 s por prueba:

| Prueba | Frecuencia IMU (media / mínima) | Líneas por segundo |
|---|---|---|
| Solo `imu.frequency` | 18,20 / 17,95 Hz | 5 |
| + 12 valores a ritmo completo (rumbo, giro, escora, cabeceo, 6 aportes, acelerómetro, giróscopo) | 17,91 / 17,70 Hz | 220 |
| Solo `imu.frequency` otra vez | 18,19 / 17,98 Hz | 5 |

- Pedir 12 valores a ~18 Hz cuesta **un 1,6 %** de frecuencia del IMU. La
  Pi Zero aguanta, pero ya va algo por debajo de los 20 Hz configurados.
- Propuesta: el auto-ajuste pide solo lo que necesita y **a 10 Hz** (watch
  con periodo 0,1 s), y vigila `imu.frequency`: si baja de 17 Hz, reduce el
  ritmo. Así se respeta la decisión de Rev889-891 de cargar lo mínimo la
  TinyPilot.
- `servo.current` llega a ~4,4 Hz: suficiente para el uso del servo por
  tramo.

## Pendiente

- Repetir con el piloto conectado y navegando (aportes reales por término).
- Repetir si se actualiza pypilot (0.60+ cambia el piloto `basic`).

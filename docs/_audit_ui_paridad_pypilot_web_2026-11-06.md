# Paridad con el cliente web de pypilot (pypilot_web)

Fecha: 2026-11-06, versión Rev642. Carlos pegó la lista completa de
valores que muestra el cliente web de pypilot (pypilot 0.56) y preguntó
si todo eso está en nuestra interfaz.

**Método:** cada clave de la lista se ha buscado en `public/app.js` y en
`src/*.ts`, teniendo en cuenta que el visor recorre partes del catálogo
de pypilot de forma genérica (no nombra cada clave):

- **Ajustes → Tune → Configuración** pinta como deslizador **todo
  ajuste numérico** que pypilot declare `RangeSetting`, agrupado en
  Virada / Servo / Viento / IMU / Otros (`renderConfigSliders`).
- **Tune → ganancias** pinta **todas las ganancias** del piloto activo
  (`ap.pilot.<piloto>.*` con `AutopilotGain`).
- **Paths & API** lista **todo el catálogo**, con el interruptor de
  publicar en Signal K. Solo enseña los nombres; ni valores ni edición.

No se ha leído el catálogo en vivo (pide autenticación y la TinyPilot
debe tener las mínimas conexiones). Que una clave sea `RangeSetting`
sale de cómo funciona pypilot 0.56; conviene confirmarlo mirando la
pestaña Tune en el visor.

## 1. Cubierto

| Del cliente web | Dónde está en nuestra interfaz |
|---|---|
| `profile`, `profiles` | Selector de perfil, gestor de perfiles |
| `ap.mode`, `ap.modes`, `ap.enabled`, `ap.heading_command`, `ap.heading` | Control (modo, AP, consigna, rumbo) |
| `ap.pilot` | Selector de piloto (Tune) |
| `ap.pilot.basic.*` (P, I, D, DD, PR, FF) y `ap.pilot.absolute.*` | Tune: ganancias del piloto activo |
| `ap.tack.delay`, `ap.tack.angle`, `ap.tack.rate`, `ap.tack.threshold` | Tune → Configuración → Virada |
| `ap.tack.state`, `ap.tack.direction` | Botones de virada, HUD |
| `servo.max_current`, `servo.max_slew_speed`, `servo.max_slew_slow`, `servo.period`, `servo.speed.min/max`, `servo.max_controller_temp`, `servo.max_motor_temp`, `servo.gain`, `servo.position.p/i/d`, `servo.clutch_pwm`, factores y offsets de corriente y tensión | Tune → Configuración → Servo (genérico) |
| `rudder.offset`, `rudder.scale`, `rudder.nonlinearity`, `rudder.range` | Tune → Configuración → IMU/timón (genérico); calibración del timón en Setup |
| `imu.heading_offset`, constantes de filtro `*_lowpass_constant` | Tune → Configuración → IMU (genérico); nivelado del IMU en Setup |
| `wind.offset`, `truewind.offset`, `*.sensors_height` | Tune → Configuración → Viento (genérico) |
| `apb.xte.gain`, `signalk.period` | Tune → Configuración → Otros (genérico) |
| `servo.current`, `servo.voltage`, `servo.controller_temp`, `servo.motor_temp`, `servo.engaged`, `servo.flags`, `servo.amp_hours`, `servo.faults` | Alarmas, salud del servo, estadísticas; algunas en el visor |
| `imu.warning`, `imu.error` | Alarmas |
| `imu.heading`, `imu.heel`, `imu.pitch`, `imu.roll` | Rosa, escora, barra inferior (vía Signal K) |
| `rudder.calibration_state`, `imu.alignmentCounter` | Calibración en Setup |

## 2. No cubierto

### 2a. Ajustes sí/no (booleanos), que el visor no pinta

El visor solo pinta ajustes numéricos. Estos solo se pueden cambiar desde
el cliente web de pypilot:

| Clave | Para qué sirve |
|---|---|
| `servo.compensate_current`, `servo.compensate_voltage` | Compensar la lectura de corriente y tensión del servo |
| `servo.use_brake` | Freno del motor del servo |
| `servo.use_eeprom` | Guardar la calibración del servo en el controlador |
| `imu.accel.calibration.locked`, `imu.compass.calibration.locked` | Bloquear la calibración de acelerómetro y compás |
| `gps.filtered.enabled`, `gps.filtered.output` | Filtro de GPS de pypilot |
| `ap.gps_and_nav_modes` | Ofrecer los modos GPS y NAV |
| `ap.tack.use_heel`, `ap.tack.use_wind_direction` | Cómo decide pypilot el lado de la virada |

### 2b. Ajustes de texto o lista

| Clave | Para qué sirve |
|---|---|
| `nmea.client` | Servidor NMEA del que pypilot lee (`192.168.1.104:10110`) |
| `nmea.gps_id`, `ap.preferred_mode` | GPS preferido, modo preferido |
| `signalk.uid` | Identidad de pypilot en Signal K |

### 2c. Calibración del compás y del acelerómetro (solo lectura)

`imu.compass.calibration` (y su `.age`, `.log`, `.field_strength`,
`.inclination`, `.points`, `.sigmapoints`), `imu.accel.calibration` (y su
`.age`, `.log`, `.points`) e `imu.gyrobias`.

El cliente web muestra el estado de la calibración automática. En esta
captura: "0d fit, insufficient data", "need more range", edad 3 h 19 min.
Nosotros no lo mostramos.

### 2d. Diagnóstico de pypilot (solo lectura)

| Clave | Qué es |
|---|---|
| `ap.version` | Versión de pypilot (aquí 0.56) |
| `ap.runtime`, `ap.timings` | Tiempo en marcha y tiempos del bucle de control |
| `imu.frequency`, `imu.uptime`, `imu.rate`, `imu.alignmentQ`, `imu.fusionQPose` | Salud del IMU |
| `gps.source`, `wind.source`, `truewind.source`, `rudder.source`, `water.source`, `apb.source` (con sus `.rate`) | **De dónde saca pypilot cada sensor** (aquí: GPS y viento por TCP, timón ninguno) |
| `gps.fix`, `gps.speed`, `gps.track`, `wind.direction`, `wind.speed`, `truewind.*`, `water.*`, `apb.track`, `apb.xte` | Lo que pypilot recibe de cada sensor |
| `servo.state`, `servo.controller`, `servo.watts`, `servo.position`, `servo.command`, `servo.duty`, `servo.calibration` | Estado interno del servo |
| `ap.heading_error`, `ap.heading_error_int`, `ap.pilot.basic.*gain` (contribuciones) | Error y aporte de cada término (el backend los usa en la base de datos de navegación; el visor no los enseña en crudo) |
| `ap.tack.count`, `ap.tack.timeout` | Contador y tiempo de virada |

## 3. Propuesta

Por utilidad para el patrón, de más a menos:

1. **Tarjeta "Fuentes de pypilot"** en Setup: de dónde saca pypilot
   GPS, viento, viento real, timón y agua, y si le llegan datos. Es lo
   más útil para diagnosticar en el agua: "pypilot no ve el viento".
2. **Ajustes sí/no** en Tune → Configuración, en el mismo desplegable
   que ya hay, con una línea de explicación cada uno. Sobre todo
   `ap.tack.use_heel` / `use_wind_direction`, los bloqueos de
   calibración y `servo.use_brake`.
3. **Estado de la calibración del compás** en Setup → Calibración: edad,
   mensaje ("datos insuficientes", "necesita más rango"), intensidad e
   inclinación del campo, y el bloqueo.
4. **Diagnóstico de pypilot** en Info: versión, tiempo en marcha, IMU a
   X Hz, estado del servo y controlador. Solo lectura.

Lo de 2b (`nmea.client`, `signalk.uid`) es configuración de instalación.
Mejor dejarlo en el cliente web de pypilot, porque cambiarlo mal deja al
piloto sin sensores.

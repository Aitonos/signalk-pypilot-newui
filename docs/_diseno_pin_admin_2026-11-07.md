# PIN de administrador y grupos de Setup (punto D)

Decidido por Carlos (2026-11-07): **PIN propio de pypilot-newui**,
independiente del de mareas.

## Grupos

Las tarjetas de Setup se ordenan en tres grupos con cabecera:

| Grupo | Tarjetas | PIN |
|---|---|---|
| **Navegación** | Comprobación del piloto, Doctor, Piloto inteligente, Alarmas, Calidad de sensores, Bitácora, Caja negra | no |
| **Ajustes** | Calibración, Idioma, Conexión | no |
| **Técnico** | Ajustes avanzados de pypilot, Paths & API, Emergencia (reinicios), Captura de registros, Traza de maniobras, Copia de seguridad | sí |

Sin desbloquear, las tarjetas de Técnico se ven atenuadas con un candado;
al tocarlas se pide el PIN.

## Dónde se guarda y cómo se comprueba

- El PIN se guarda **cifrado con hash (scrypt + sal)** en la carpeta de
  datos del plugin (`admin-pin.json`), no en las opciones del plugin: así
  no viaja en exportaciones ni copias de seguridad.
- Desbloquear: `POST /admin/unlock {pin}` devuelve una llave de sesión
  aleatoria válida **12 horas** (solo en memoria; un reinicio de Signal K la
  borra). El visor la guarda en la pestaña (sessionStorage) y la envía en
  cada petición técnica. "Bloquear" la anula.
- **El backend la exige** en las acciones técnicas, no solo el visor
  (abrir la consola del navegador no basta):
  - reinicios y comandos por SSH (Emergencia);
  - activar o desactivar paths publicados;
  - captura de registros y traza de maniobras (activar/desactivar);
  - importar configuración;
  - hacer copia y descargar copias (llevan toda la configuración);
  - escrituras de ajustes de instalación de pypilot desde Ajustes avanzados
    (los que hoy salen en ámbar: `nmea.*`, `signalk.*`, calibraciones,
    `servo.use_eeprom`...). Las ganancias y los mandos normales no piden PIN.
- **Intentos:** 5 fallos seguidos bloquean el desbloqueo 5 minutos.

## Primer uso y olvido

- **Sin PIN puesto** (instalación nueva o actualización): Técnico funciona
  como hoy, y la cabecera del grupo invita a poner uno. Nada se bloquea a
  nadie que actualice el plugin.
- **Poner o cambiar el PIN:** desde la cabecera del grupo Técnico (cambiarlo
  pide el actual). 4 a 8 cifras.
- **Olvidé el PIN:** en la configuración del plugin en el admin de Signal K
  (que ya pide el usuario y contraseña de Signal K) hay una casilla "Borrar
  el PIN de administrador". Al guardar, el PIN desaparece y se vuelve al
  estado "sin PIN".

## Fuera de alcance

- No hay invitados ni varios niveles (eso es de mareas).
- No sustituye la seguridad de Signal K: si Signal K no pide login, el
  PIN protege lo técnico frente a quien use el visor, no frente a quien
  entre en la Pi.

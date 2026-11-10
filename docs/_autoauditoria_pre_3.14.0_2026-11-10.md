# Autoauditoría antes de 3.14.0 (Rev675-683) — 2026-11-10

Cambios desde v3.13.0: nombre "PyPilot New-UI", logo y capturas; configuración
del admin de Signal K reducida a 3 opciones (resto al visor); pantalla de
arranque; PIN de administrador también para Tune y el gestor de perfiles;
interruptor "Pedir el PIN"; voz en el idioma del visor; tour que espera la
aprobación de Signal K; recarga del visor ante una revisión nueva.

## Lista (feedback_self_audit_before_publish)

1. **Qué cambia durante cada await.**
   - `_tunePinOk`: la casilla se desmarca mientras se pide el PIN y solo se
     vuelve a marcar si el desbloqueo sale bien.
   - Selector de piloto: vuelve al piloto actual mientras se pide el PIN y
     escribe el elegido después; si pypilot cambió de piloto entretanto, gana
     la elección del usuario, que es lo que pidió.
   - Pantalla de arranque: cada render comprueba `closed`. El botón "Abrir"
     cierra la pantalla antes de navegar.
2. **Retorno de cada escritura.**
   - `POST /admin/use` devuelve 500 si `setOn` no puede guardar; el visor
     revierte la casilla.
   - `/options` sigue respondiendo con lo guardado; el reinicio de la
     captura de logs va en try/catch.
3. **Dato que falta.**
   - `/prechecks` o `/quality` sin `items`: listas vacías.
   - Sin acceso a Signal K y sin `/prechecks`: se muestra igualmente el fallo
     de acceso.
   - `logCaptureIntervalSec` se valida entre 30 y 3600 s.
4. **Reinicio.**
   - El estado "Pedir el PIN" se guarda en `admin-pin.json` (test: sobrevive).
   - Las opciones movidas al visor siguen en la configuración del plugin
     (verificado en la Pi tras desplegar).
5. **Operación vieja que pisa una nueva.**
   - Riesgo encontrado: una tablet con el visor anterior (sin la marca
     `auto: "empopado"`) vería rechazadas sus ganancias de empopado con PIN
     activo.
   - Arreglo Rev682: el visor se recarga solo si el plugin tiene otra
     revisión, solo con el piloto desconectado y una vez por revisión, para
     evitar bucles con una página en caché. Con el piloto conectado, el fallo
     deja las ganancias como estaban (sin riesgo).
6. **allowWrites.** `/raw` sigue comprobando `allowWrites` antes del PIN.
   `/admin/use` no escribe en pypilot.
7. **Bucles.** El tour reintenta cada 3 s mientras haya una ventana encima;
   termina al arrancar o si ya se vio.
8. **Tests.**
   - Nuevos: claves de `/options` (Rev676), esquema reducido e interruptor
     del PIN (Rev680). Fallarían con el código anterior.
   - Suite completa con código de salida real (abajo).

## Escrituras automáticas del visor frente al PIN

| Escritura | Pasa sin PIN | Por qué |
|---|---|---|
| Ganancias del empopado | sí | marca `auto: "empopado"` |
| Cambio de perfil (empopado, Smart Pilot, selector) | sí | `profile` sin `origin` |
| Doctor, Smart Pilot, gain watchdog | sí | escriben desde el servidor, no por `/raw` |
| Tune, tipo de piloto, grupos de Tune | no | PIN en el momento |
| Gestor de perfiles (nuevo, renombrar, importar, borrar, reordenar) | no | PIN en el momento |

## Límite conocido

pypilot_web en la TinyPilot (puerto 80) no tiene contraseña. El PIN protege
el visor y las rutas del plugin, no la TinyPilot.

## Rev683: textos sin traducir (Carlos, 2026-11-10)

- **Causa 1**: la comprobación del piloto y los nombres de sensores venían
  del servidor en inglés y el visor los mostraba tal cual.
  - Arreglo: el servidor añade un código y parámetros, y el visor traduce
    con claves `pc.*` y `sq.name.*`. Si falta una clave, queda el inglés.
- **Causa 2**: unos 20 textos fijos en el visor (en inglés o en español).
  Pasados a i18n.
- **Causa 3**: el idioma lo comparten todas las pestañas. Al cambiarlo en
  una, las otras mezclaban textos.
  - Arreglo: el evento `storage` retraduce la pestaña.
- **Comprobación**: las tablas EN/ES/DE/FR tienen todas las claves
  (1331 en inglés, ninguna falta). Prueba headless en alemán: precheck,
  sensores y aviso sin conexión en alemán; el cambio de idioma desde otra
  pestaña se aplica.

# ¿Plugin nuevo "Backup to Dropbox"? Análisis antes de empezar

2026-11-09. Petición de Carlos: un plugin que copie a Dropbox el sistema
operativo, el servidor Signal K y los ajustes de los plugins. Antes de
escribir nada, ver qué existe.

## Qué existe

| Qué | Hace | Límites |
|---|---|---|
| **Copia de seguridad del propio Signal K** (admin → Server → Backup / Restore) | Descarga un zip de `~/.signalk` (ajustes del servidor, de los plugins, seguridad) y lo restaura, reinstalando los plugins. | Manual: sin programación, sin nube. No incluye nada del sistema operativo. |
| **`signalk-backup`** (dirkwa, npm 1.6.0, 32 versiones desde mayo 2026, activo) | Copias programadas (cada hora, día, semana, al arrancar) deduplicadas con Kopia, en local, USB/NAS, SMB o **Google Drive** (rclone). Restaura un archivo suelto o todo, con copia de seguridad previa. Puede incluir archivos elegidos del sistema operativo (issue #31). Publica su estado en Signal K. | Necesita Docker o Podman + el plugin `signalk-container`. En la nube **solo Google Drive** (rclone admite Dropbox, pero el plugin no lo ofrece). |
| `signalk-pypilot-newui` 3.12 | Copia diaria de **sus** ajustes en `~/Backups-pypilot-newui`. | Solo nuestro plugin. |

No hay ningún plugin de Signal K que suba a Dropbox.

## Lo que ya hay en el barco (comprobado)

**`signalk-backup` 1.6.0 ya está instalado y funcionando en la Pi de
Tunatunes**, con `signalk-container` 1.38 y Docker:

- el contenedor `sk-signalk-backup-server` lleva días arrancado y sano;
- hace la copia de cada hora ("hourly backup completed");
- tiene la nube configurada: **Google Drive**, una vez al día.

Pero **la subida a Google Drive falla desde el 6 de noviembre**:

- el repositorio de copias ocupa **13 GB**, porque copia todo `~/.signalk`,
  incluidos datos que no son ajustes;
  - `plugin-config-data/signalk-weather-router-plus`: **4 GB**;
  - 24 registros `skserver-raw_*` de abril: 576 MB;
  - cartas (175 MB) y `node_modules` (530 MB);
- sube a unos **65 KB/s por 4G**: calcula 22-23 horas por pasada y acaba
  fallando ("error copying blobs"). Última subida buena: 2026-11-06 09:32.
  Cada intento posterior choca con "Sync already in progress".

Los **ajustes** de verdad (servidor, plugins, seguridad, OpenPlotter,
archivos del sistema) caben en pocos MB.

## Opciones

1. **Ajustar `signalk-backup` (recomendado, sin código).** Excluir lo que no
   son ajustes: datos de weather-router, registros raw, cartas,
   `node_modules`. La copia queda en unos pocos MB y la subida diaria a
   Google Drive vuelve a funcionar por 4G. Añadir los archivos del sistema
   operativo que interesen (red, cron, udev de OpenPlotter, `config.txt`).
2. **Dropbox en `signalk-backup` mediante un PR a dirkwa.** rclone ya sabe
   hablar con Dropbox; habría que añadir el destino en el servidor de copias
   y en la web del plugin. Lo aprovecha todo el ecosistema (regla: buscar el
   plugin existente antes de reinventar).
3. **Plugin propio sin Docker.** Solo tiene sentido para instalaciones que
   no pueden usar contenedores: Cerbo GX / Venus OS, Pi pequeñas. Sería un
   copia ligera (zip de ajustes + subida a Dropbox por su API, sin
   dependencias), sin deduplicación ni restauración por archivo.

## Hecho (2026-11-09, opción 1, Carlos: "ok")

- **Exclusiones en `signalk-backup`** (`PUT http://127.0.0.1:3010/api/settings`,
  `backupExclusions`): además de `node_modules/` y `charts*/`, ahora
  `skserver-raw_*`, `appstore-cache/`, `.cache/`, los datos descargados de
  weather-router (`forecast`, `ecmwf`, `overlay-tiles`, `coast-tiles`, `smoc`,
  `sealevel`, `coastline`), `kip/historicalData/` y los registros de
  pypilot-newui (`pizero-logs`, `maneuver-trace`). Se siguen copiando los
  ajustes de servidor y plugins, la bitácora, las sesiones y los tracks.
  Tamaño de lo copiado: de ~4,5 GB a ~330 MB (Kopia solo sube lo que cambia).
- **Configuración del sistema operativo:** `~/bin/os-config-snapshot.sh`
  vuelca en `~/.signalk/os-config/` (224 KB) arranque, hostname/hosts/fstab,
  reglas udev (puertos `ttyOP_*`), `cron.d`, crontab de pi, servicios
  systemd hechos a mano, `openplotter.conf`, lista de paquetes (376 a mano),
  contenedores Docker. Nunca Wi-Fi, claves SSH ni contraseñas.
  `signalk-backup` lo incluye en cada copia. Falta programarlo cada día
  (`crontab`): lo añade Carlos.
- **Queda:** las 37 copias antiguas (con los GB de tiempo descargado) caducan
  solas (horarias 1 día, diarias 7, semanales 4 semanas; las 2 de arranque
  de mayo y septiembre, al hacerse dos nuevas). Hasta entonces el
  repositorio sigue grande y la subida a Drive, lenta. Borrarlas a mano lo
  acelera (decide Carlos).
- La caché de Kopia (`~/.signalk/.cache/kopia`) ocupa 12 GB de disco. No se
  copia; Kopia la gestiona.

## Sobre "copiar el sistema operativo"

Una imagen completa de la tarjeta o el NVMe son decenas de GB: no cabe por
4G ni en un Dropbox gratuito (2 GB). Lo útil es copiar la **configuración**
del sistema: lista de paquetes instalados, `/etc` relevante (red, cron,
udev), `/boot/firmware/config.txt`, la configuración de OpenPlotter. Eso
son unos pocos MB y basta para rehacer el sistema desde una imagen limpia.

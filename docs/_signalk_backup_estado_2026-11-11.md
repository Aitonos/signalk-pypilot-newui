# signalk-backup en el Tunatunes: estado — 2026-11-11

Seguimiento de `docs/_analisis_plugin_backup_dropbox_2026-11-09.md`. Hoy
tocaba comprobar si Kopia liberó espacio y si la copia sube a Google Drive.

## Lo que hay

- **Copias locales:** funcionan. Hay 26 (24 por horas y 2 diarias), desde
  el 09/11 23:00 UTC, de unos 306 MB cada una.
- **Repositorio local:** 4,3 GB (antes 13 GB). Liberó parte, pero sigue
  siendo grande para 26 copias de 300 MB: cada copia horaria añade mucho
  contenido nuevo.
- **Qué cambia cada hora** (archivos de más de 2 MB modificados en la
  última hora, fuera de las exclusiones):
  - `plugin-config-data/tracks/tracks.db` (87 MB, SQLite de los tracks);
  - `signalk-charts-provider-simple/enc-index-cache/enc-index.json` (8 MB).

  Una base SQLite cambia páginas repartidas por todo el archivo, así que
  cada hora se suben trozos nuevos.
- **Subida a Drive:** la última correcta fue el **06/11 09:32 UTC**. Desde
  entonces ninguna termina:
  - El repositorio que hay que reflejar en Drive pesa 4,3 GB, y en Drive
    ya hay unos 5,8 GB antiguos.
  - Por 4G (unos 65 KB/s medidos) son muchas horas de subida.
  - **Cada reinicio de Signal K reinicia el contenedor** de signalk-backup
    (lo gestiona signalk-container), y la subida vuelve a empezar desde el
    principio. Hoy, con los despliegues, se ha reiniciado más de diez
    veces. Además está el cron de reinicio cada 3 días.
  - En el log se ve «Sync already in progress» cada hora y un «Starting
    cloud sync» nuevo tras cada reinicio.

## Opciones (decide Carlos)

1. **Una subida completa con buena conexión** (wifi del puerto o en casa),
   sin reiniciar Signal K mientras dure. Es lo más sencillo. Después, cada
   día solo sube lo nuevo, aunque seguirán siendo cientos de MB por la base
   de tracks.
2. **Menos copias horarias**, por ejemplo 6 en vez de 24, si signalk-backup
   lo permite. El repositorio y la subida diaria bajan.
3. **Sacar `tracks.db` de la copia horaria** y dejarlo solo en la diaria.
   signalk-backup no distingue entre una y otra: habría que pedirlo en su
   repositorio (dirkwa/signalk-backup) o aceptar perder los tracks de la
   copia.
4. **Excluir `enc-index-cache/`**: es una caché que se regenera sola. Es un
   cambio seguro que ahorra 8 MB por copia.

Recomendación: 4 ya, y 1 la próxima vez que haya buena wifi. Si después de
eso la subida diaria sigue sin terminar, la 2.

No he tocado nada: ni exclusiones, ni copias, ni la subida.

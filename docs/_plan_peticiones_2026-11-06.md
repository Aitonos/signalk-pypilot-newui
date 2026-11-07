# Peticiones de Carlos del 2026-11-06 (noche): estado y plan

## Hecho (Rev644, en la Pi)

1. **Avisos que tapan el menú.** "Red intermitente / lenta" y "SIN
   CONEXIÓN AL AUTOPILOTO" se cierran con un toque. Vuelven a salir si
   la situación cambia. Con el aviso rojo cerrado, los controles siguen
   bloqueados mientras no haya conexión.
2. **Cambiar valores sin "Permitir cambios".** Nunca salió ninguna
   escritura a pypilot (no hay ni un `PUT /raw` en el registro), pero los
   controles parecían editables. Ahora están desactivados hasta marcar la
   casilla. También se corrigió que el buscador mandara ~20 peticiones de
   vigilancia en un segundo.

3. **Caja negra (A)**, Rev646: botón "Revisado" por entrada y "Marcar
   todas como revisadas"; las revisadas, atenuadas.
4. **Doctor (C)**, Rev645: pide el nombre del perfil nuevo, propone
   "<perfil activo> - Doc NNN"; botón Renombrar en el resultado.
5. **Registros de la TinyPilot (F)**, Rev647: días anteriores comprimidos,
   30 días, tope 300 MB. Primera pasada en la Pi: 692 MB -> 8 MB. Copia de
   lo anterior en `/home/pi/pizero-logs-backup-20261107.tar.gz` (12,6 MB).
   Nota: la Pi de Tunatunes tiene NVMe (136 GB libres); era urgente para
   instalaciones con SD, no para esta.

## Pendiente: plan

### A. Caja negra: marcar entradas como revisadas (ack) — HECHO Rev646

**Hoy:** el backend ya guarda "visto" por entrada (`POST /black-box/seen/:id`)
y el resumen de la baldosa se pone en ámbar si hay alguna sin ver.

**Propuesta:**
- botón "Revisado" en cada entrada;
- "Marcar todas como revisadas";
- las revisadas, atenuadas.

Tamaño: pequeño.

### B. Bitácora: parar, pausar, borrar o reiniciar el viaje en curso — HECHO Rev648

**Hoy:** el viaje empieza y acaba solo con `navigation.state`
(navegando / amarrado). Solo se pueden borrar viajes ya cerrados.

**Propuesta,** en la cabecera del viaje en curso:
- **Parar:** lo cierra ahora, con su resumen.
- **Pausar / seguir:** no cuenta tiempo ni distancia mientras está en
  pausa.
- **Borrar:** lo descarta, con confirmación.
- **Reiniciar:** lo borra y empieza uno nuevo desde ahora.

Tamaño: medio (backend `trip-recorder` y visor).

### C. Doctor: nombre del perfil al aplicar consejos — HECHO Rev645

**Hoy:** al aplicar el primer consejo, el Doctor copia el perfil activo en
uno nuevo llamado `doctor-AAAAMMDD-HHMMSS`, sin preguntar. Se puede
renombrar después desde el gestor de perfiles, pero no en el momento.

**Propuesta:**
- al aplicar el primer consejo, preguntar el nombre con una propuesta
  ya puesta, por ejemplo "Ceñida fondo medio viento (Doctor 6/11)";
- después, un botón "Renombrar" en el resultado del Doctor.

Tamaño: pequeño-medio.

### D. Agrupar las tarjetas de Setup y PIN de administrador

**Hoy:** 14 baldosas sueltas en Setup.

**Grupos propuestos:**
- **Navegación:** Comprobación del piloto, Doctor, Piloto inteligente,
  Alarmas, Calidad de sensores, Bitácora, Caja negra.
- **Ajustes:** Calibración, Idioma, Conexión.
- **Técnico (con PIN):** Ajustes avanzados de pypilot, Paths & API,
  Emergencia (reinicios), registros (log capture, maneuver trace),
  copia de seguridad.

**PIN:** el mismo modelo que en mareas. Un PIN maestro que lo abre todo;
sin PIN, el grupo Técnico se ve bloqueado. El PIN se comprueba en el
backend, no solo en el visor, para que no baste con abrir la consola del
navegador.

Tamaño: medio-grande.

**Decidir:**
- ¿Qué entra en "Técnico"?
- ¿Se reutiliza el PIN de mareas o va uno propio para pypilot-newui?

### E. Copia de seguridad de los ajustes — FASE 1 HECHA Rev651

**Qué entra:**
- opciones del plugin;
- **todos los perfiles de pypilot con sus ganancias**;
- los ajustes de pypilot que se guardan (los que exporta ya
  `/config/export`);
- preferencias del visor;
- presets de pantalla;
- zonas de puerto;
- vigilante de ganancias;
- referencia del servo.

**Qué no entra:** viajes, sesiones, registros, histórico de la gráfica y
caja negra. Son datos, no ajustes.

**Tamaño estimado:**

| Parte | Tamaño |
|---|---|
| Opciones del plugin | ~2 KB (medido: 1,9 KB) |
| Perfiles y ajustes de pypilot (~14 perfiles) | ~30-60 KB |
| Preferencias, presets, zonas, servo, vigilante | ~10 KB |
| Base de datos de navegación (si se incluye) | ~110 KB (medido) |
| **Total** | **~50-80 KB; con la base de datos, ~200 KB. Comprimido, ~15-50 KB** |

**Propuesta:**
- **diaria:** una copia en la Pi cada noche; se guardan las últimas 30
  (unos 1,5-6 MB en total);
- **mensual:** el día 1, aviso en el visor ("Descarga la copia del
  mes"), porque el plugin no puede guardar fuera de la Pi por sí solo;
- **a petición:** botón "Descargar copia ahora" (ya existe
  `/config/export`; se amplía a todo lo de arriba);
- **restaurar:** desde un archivo o desde una de las 30 copias diarias,
  con resumen previo de qué cambia.

Tamaño: medio.

**Decidido (Carlos, 2026-11-07):** "una copia que no sabes que tienes no
sirve para nada". Las copias diarias van a una carpeta muy visible en la
carpeta personal del usuario de la Pi, no escondidas en `~/.signalk`:
`~/Backups-pypilot-newui/` (se ve nada más abrir el gestor de archivos).
Además, la tarjeta muestra la ruta, la fecha de la última copia y un aviso
si la última tiene más de 2 días.

**Salir del barco: Google Drive / Dropbox (fase 2, a decidir).**

- **Dropbox:** lo más sencillo. API HTTP simple (subir un archivo es una
  llamada), sin dependencias (fetch de Node). Autorización: el usuario
  pulsa "Conectar Dropbox", inicia sesión en una pestaña, copia un código y
  lo pega (PKCE, sin servidor propio ni URL pública). El plugin guarda un
  token de refresco. Hay que registrar una app en Dropbox (gratis) con
  permiso solo a su propia carpeta (App folder). Para un plugin público, la
  app empieza en modo desarrollo (hasta 500 usuarios) y luego se pide paso
  a producción.
- **Google Drive:** posible, pero más pesado. Sin URL pública hay que usar
  el flujo para dispositivos (el usuario mete un código en otra pantalla).
  Con el permiso mínimo (`drive.file`, solo los archivos que crea la app)
  no hace falta la verificación de seguridad completa de Google, pero sí un
  proyecto de Google Cloud y una pantalla de consentimiento publicada.
- **Telegram:** mareas-ihm ya tiene un bot de Telegram en el barco. Enviar
  la copia mensual como documento (`sendDocument`) sería lo más rápido de
  hacer, sin cuentas nuevas, aunque el chat no es un sitio pensado para
  guardar copias.

Recomendación: fase 1 sin nube (carpeta visible + aviso mensual para
descargar + botón "descargar ahora"); fase 2, Dropbox como primer destino
en la nube.

### F. Disco: registros de la TinyPilot — HECHO Rev647

La captura de registros de la TinyPilot ocupa **708 MB** en la Pi
(`pizero-logs`), con días de hasta 290 MB. No hay rotación ni límite.

**Propuesta:**
- comprimir los días anteriores (un registro de texto queda en ~10 %);
- borrar los de más de 30 días;
- tope total, por ejemplo 300 MB.

Tamaño: pequeño. **Prioridad alta:** en una SD puede llenar el disco.

## Orden propuesto

1. F (disco), A (caja negra) y C (Doctor): pequeños y útiles ya.
2. E (copia de seguridad).
3. B (bitácora).
4. D (agrupar y PIN): necesita las decisiones de arriba.

// PyPilot New-UI - webapp logic. Vanilla JS, no framework.
//
// Data model:
//   - Reads live SK values via a WebSocket stream subscribed to the paths we
//     need. Path list is the union of Autopilot API (owned by
//     pypilot-autopilot-provider) plus steering.autopilot.pypilot.* (owned by
//     this plugin) plus environment.wind.*.
//   - Writes go through the SK REST API. Autopilot API v1 endpoints for
//     engage/mode/target/tack; our plugin's /raw endpoint for gains and
//     calibration.
//
// SK versions handled:
//   - No hard dependency on Autopilot API v2 (user's server 404s on it).
//     We use v1: /signalk/v1/api/vessels/self/steering/autopilot with
//     targeted PUT to specific leaves.

(function () {
  "use strict";

  const PLUGIN_ID = "signalk-pypilot-newui";

  // ---- i18n (Rev20, expanded Rev61) ----
  // Simple dictionary lookup by data-i18n attribute. First visit picks the
  // browser language automatically (currentLang below). Users override via
  // Setup -> Language. Missing keys fall back to English so DE/FR still
  // render sensibly while translations are being filled in.
  const I18N = {
    en: {
      "tack": "TACK",
      "cal": "CAL",
      "cal.level": "Level (boat flat)",
      "cal.rudCentered": "Rudder centered",
      "cal.rudPort": "Rudder port range",
      "cal.rudStar": "Rudder star range",
      "cal.rudReset": "Rudder reset",
      "cal.headingOffset": "IMU heading offset (deg)",
      "cal.rudRange": "Rudder range (deg)",
      "configuration": "Configuration",
      "calibration.title": "Calibration",
      "save": "Save",
      "cancel": "Cancel",
      "close": "Close",
      "loading": "loading...",
      "paths.publish": "Publish",
      "paths.skPath": "SK path",
      "paths.units": "Units",
      "paths.put": "PUT?",
      "paths.copy": "Copy",
      "paths.hint": "Applies instantly, no restart. Essential paths (state / mode / target / tack / selectors) always publish. When \"essentials only\" is ON, tick a checkbox to opt in a path; when OFF, tick to keep publishing and untick to stop.",
      "paths.header": "Live catalog of Signal K paths this plugin publishes and PUT-handles. Use the Copy buttons to paste into KIP widget configs.",
      "paths.refresh": "Refresh",
      "paths.kip.title": "KIP action paths",
      "paths.kip.hint": "Wire these to KIP \"Simple Switch\" widgets (blue rows) or \"Put\" widgets (green rows).",
      "paths.all.title": "All published paths",
      "paths.search.ph": "filter paths...",
      "paths.essentials.label": "Publish only essentials + explicitly enabled (recommended)",
      "nudge.title": "Nudge steps",
      "nudge.small": "Small (-1/+1)",
      "nudge.big": "Big (-10/+10)",
      "nudge.hint": "Degrees added to the target each time you press a nudge button. Also configurable in Signal K Admin -> Plugin Config -> PyPilot New-UI.",
      "language.title": "Language",
      "language.hint": "Persists in this browser only. No server round-trip.",
      // Tabs
      "tab.control": "Control",
      "tab.tune":    "Tune",
      "tab.regata":  "Race",
      "tab.paths":   "Paths & API",
      "tab.setup":   "Setup",
      "tab.info":    "Info",
      // Setup tab
      "setup.connection": "Connection",
      "setup.scan.title": "Scan LAN for pypilot_web",
      "setup.scan.subnet.ph": "auto-detect (e.g. 192.168.1.0/24)",
      "setup.scan.btn": "Scan",
      "setup.scan.scanning": "scanning...",
      "setup.scan.none": "no pypilot_web found",
      "setup.scan.failed": "scan failed",
      "setup.manual.title": "Manual host",
      "setup.manual.hint": "Applying rewrites the plugin config and restarts the plugin. Requires Signal K admin login.",
      "setup.host.ph": "192.168.1.115",
      "setup.apply.btn": "Apply & reconnect",
      "setup.absorb.title": "Autopilot Provider (one-socket mode)",
      "setup.absorb.label": "Absorb official provider",
      "setup.absorb.btn": "Save & restart",
      "setup.absorb.hint": "When ON, this plugin registers itself as the Signal K Autopilot Provider (WilhelmSK / freeboard / KIP connect to it via /signalk/v2/api/vessels/self/autopilots). You must also disable the 'pypilot-autopilot-provider' plugin in SK Admin - two providers would fight for the pilot ID. Benefit: one less socket to the Pi Zero TinyPilot.",
      "setup.emergency": "Emergency",
      "setup.ssh.user": "SSH user",
      "setup.ssh.password": "SSH password",
      "setup.ssh.password.ph.notset": "(not set)",
      "setup.ssh.password.ph.set": "(set - retype to change)",
      "setup.ssh.save.btn": "Save",
      "setup.restart.btn": "RESTART pypilot",
      "setup.restart.hint": "Restarts the pypilot process on the TinyPilot via SSH using the user+password above, running sudo systemctl restart pypilot pypilot_web. If SSH fails, falls back to a local socket reconnect.",
      "setup.security.hint": "Signal K stores plugin config in plain text at ~/.signalk/plugin-config-data/. Use a password that is only valid for this isolated TinyPilot.",
      // Tune tab
      "tune.pilot": "Pilot",
      "tune.profile": "Profile",
      "tune.unlock": "Unlock settings (auto-relock on tab exit)",
      // Regata tab
      "regata.state.idle": "IDLE",
      "regata.timer": "TIMER",
      "regata.sync": "SYNC",
      "regata.reset": "RESET",
      "regata.beeps": "Beeps",
      "regata.voice": "Voice",
      "regata.hint": "TIMER: start / pause. In race (after 0), stops. SYNC: in countdown rounds to the nearest minute; in idle starts from T2. RESET: back to idle.",
      // Dashboard corner popup
      "dash.help.title": "Configure the rose corners",
      "dash.help.body": "Pick which datum shows in each corner. Saved in your browser.",
      "dash.corner.tl": "Top left",
      "dash.corner.tr": "Top right",
      "dash.corner.bl": "Bottom left",
      "dash.corner.br": "Bottom right",
      "dash.corner.empty": "(empty)",
      "dash.wind.arrows": "WIND ARROWS",
      "dash.wind.awa": "AWA (apparent, amber)",
      "dash.wind.twa": "TWA (true, magenta)",
      "dash.polar.title": "POLAR PERFORMANCE",
      "dash.polar.hint": "Enable the ones you want available in the corner selectors. Requires the signalk-polar-performance-plugin.",
      "dash.custom.title": "CUSTOM SK PATH",
      "dash.custom.hint": "Add any path published by Signal K. Shown as it appears on the bus (no conversion).",
      "dash.custom.path.ph": "e.g. environment.water.temperature",
      "dash.custom.label.ph": "Label",
      "dash.custom.unit.ph": "Unit (opt)",
      "dash.custom.add": "Add",
      // Alerts / prompts / confirms
      "alert.saveOk": "Saved.",
      "alert.saveFail": "Save failed. Are you logged in to Signal K admin?",
      "alert.configApplied": "Config saved. Plugin restarting.",
      "alert.configFail": "Config failed. Sign in to Signal K admin first.",
      "alert.absorb.on": "Enabled the AutopilotProvider. IMPORTANT: go to SK Admin and DISABLE the 'pypilot-autopilot-provider' plugin so they do not fight.",
      "alert.absorb.off": "Disabled the AutopilotProvider. Re-enable 'pypilot-autopilot-provider' in SK Admin if you want WilhelmSK / freeboard to keep working.",
      "alert.hostRequired": "Host required",
      "alert.nudgeSaved": "Saved. Nudge values updated.",
      "confirm.removeProfile": "Remove current profile?",
      "confirm.restartPypilot": "Restart pypilot on the TinyPilot? The connection will drop ~10 s while it comes back up.",
      "confirm.resetCfg": "Delete all visor configuration (corners, arrows, polars, custom paths)? Pilot settings on the TinyPilot are NOT touched.",
      "prompt.profileName": "Profile name",
      "prompt.pasteCfg": "Paste the exported configuration JSON:",
      // Setup SSH + restart status
      "setup.ssh.status.emptyPwd": "Empty password. Type it before Save (you have to retype it every time for safety).",
      "setup.ssh.status.saving": "Saving...",
      "setup.ssh.status.savedRestarting": "Saved. Restarting plugin...",
      "setup.ssh.status.set": "Password set",
      "setup.ssh.status.notset": "No password set.",
      "setup.ssh.status.enabled": "RESTART pypilot enabled.",
      "setup.ssh.status.reconnectOnly": "RESTART pypilot will only reconnect the local socket.",
      "setup.restart.wait": "Restarting pypilot...",
      "setup.restart.ok": "Restarted via SSH.",
      "setup.restart.reconnecting": "Reconnecting socket in 3 s...",
      "setup.restart.notConfigured": "SSH not configured.",
      "setup.restart.reconnectOnly": "Local socket reconnected but pypilot itself is unchanged.",
      "setup.restart.error": "Error",
      "setup.restart.network": "Network error",
      // Info tab config export/import
      "info.cfg.shared": "Shared.",
      "info.cfg.sharedText": "Shared as text.",
      "info.cfg.cancelled": "Cancelled.",
      "info.cfg.noShareApi": "No share API - downloaded as file instead.",
      "info.cfg.downloaded": "Downloaded.",
      "info.cfg.copied": "JSON copied to clipboard.",
      "info.cfg.copyFail": "Could not copy",
      "info.cfg.imported": "Imported ({N} keys). Reloading...",
      "info.cfg.importFail": "Import failed",
      "info.cfg.reset": "Config wiped. Reloading...",
      "info.cfg.downloadFail": "Download failed",
      // Rev63 / 2.0.0: escalated restart triad + helm-manned confirmation
      "setup.restart.title":         "Restart / reboot (escalated)",
      "setup.restart.web.title":     "restart pypilot_web",
      "setup.restart.web.sub":       "~3-5 s · AP keeps steering",
      "setup.restart.pypilot.title": "RESTART pypilot",
      "setup.restart.pypilot.sub":   "~10-15 s · AP drops the heading",
      "setup.restart.reboot.title":  "reboot Pi",
      "setup.restart.reboot.sub":    "~35-60 s · full outage",
      "setup.restart.hint":          "All three actions use the SSH user+password above. Level 1 does not interrupt steering; levels 2 and 3 do. A confirmation asking whether someone is at the helm is shown before executing.",
      "setup.restart.outage.web":     "The pypilot web socket restarts. The AP core keeps steering the boat during those seconds.",
      "setup.restart.outage.pypilot": "Both pypilot core and its web server restart. The AP releases the heading briefly and re-engages after reconnect.",
      "setup.restart.outage.reboot":  "The whole Raspberry Pi reboots (kernel, services, network). NO autopilot for ~35-60 seconds. Cold restart from scratch.",
      "helm.outage":  "Autopilot outage:",
      "helm.warn":    "MAKE SURE SOMEONE IS AT THE HELM before you continue. This is not the moment to be below deck.",
      "helm.cancel":  "Cancel",
      "helm.confirm": "I confirm - helm is manned",
      // Debug console
      "setup.debug.title":      "Debug console",
      "setup.debug.output.ph":  "Press a preset above. Output shows here.",
      "setup.debug.follow":     "Follow logs (poll every 3 s)",
      "setup.debug.copy":       "Copy",
      "setup.debug.send":       "Share / send",
      "setup.debug.clear":      "Clear",
      "setup.debug.running":    "Running preset...",
      "setup.debug.ok":         "OK",
      "setup.debug.failed":     "Failed",
      "setup.debug.noSsh":      "SSH not configured - save the SSH password above first.",
    },
    es: {
      "tack": "VIRAR",
      "cal": "CAL",
      "cal.level": "Nivelar (barco adrizado)",
      "cal.rudCentered": "Timon centrado",
      "cal.rudPort": "Rango babor",
      "cal.rudStar": "Rango estribor",
      "cal.rudReset": "Reset timon",
      "cal.headingOffset": "Offset rumbo IMU (grados)",
      "cal.rudRange": "Rango timon (grados)",
      "configuration": "Configuracion",
      "calibration.title": "Calibracion",
      "save": "Guardar",
      "cancel": "Cancelar",
      "close": "Cerrar",
      "loading": "cargando...",
      "paths.publish": "Publicar",
      "paths.skPath": "Path SK",
      "paths.units": "Unidades",
      "paths.put": "PUT?",
      "paths.copy": "Copiar",
      "paths.hint": "Se aplica al instante, sin reinicio. Los paths esenciales (state / mode / target / tack / selectores) siempre publican. Con \"solo esenciales\" ON marca el check para activar un path; con OFF marca para mantener y desmarca para parar.",
      "paths.header": "Catalogo en vivo de paths Signal K que este plugin publica y responde a PUT. Copia con los botones para pegar en configuraciones de widgets KIP.",
      "paths.refresh": "Refrescar",
      "paths.kip.title": "Paths de accion para KIP",
      "paths.kip.hint": "Enlaza estos con widgets KIP \"Simple Switch\" (filas azules) o \"Put\" (filas verdes).",
      "paths.all.title": "Todos los paths publicados",
      "paths.search.ph": "filtrar paths...",
      "paths.essentials.label": "Publicar solo esenciales + los activados explicitamente (recomendado)",
      "nudge.title": "Pasos de nudge",
      "nudge.small": "Pequeno (-1/+1)",
      "nudge.big": "Grande (-10/+10)",
      "nudge.hint": "Grados anadidos al rumbo objetivo cada vez que pulsas un boton de nudge. Tambien se configura en SK Admin -> Plugin Config -> PyPilot New-UI.",
      "language.title": "Idioma",
      "language.hint": "Solo en este navegador. No pasa por el servidor.",
      // Tabs
      "tab.control": "Control",
      "tab.tune":    "Ajustes",
      "tab.regata":  "Regata",
      "tab.paths":   "Paths & API",
      "tab.setup":   "Setup",
      "tab.info":    "Info",
      // Setup tab
      "setup.connection": "Conexion",
      "setup.scan.title": "Escanear LAN buscando pypilot_web",
      "setup.scan.subnet.ph": "auto-detectar (p.ej. 192.168.1.0/24)",
      "setup.scan.btn": "Escanear",
      "setup.scan.scanning": "escaneando...",
      "setup.scan.none": "no se ha encontrado pypilot_web",
      "setup.scan.failed": "escaneo fallido",
      "setup.manual.title": "Host manual",
      "setup.manual.hint": "Al aplicar reescribe la config del plugin y lo reinicia. Requiere login de admin de Signal K.",
      "setup.host.ph": "192.168.1.115",
      "setup.apply.btn": "Aplicar y reconectar",
      "setup.absorb.title": "Provider de Autopiloto (modo un-solo-socket)",
      "setup.absorb.label": "Absorber el provider oficial",
      "setup.absorb.btn": "Guardar y reiniciar",
      "setup.absorb.hint": "Cuando esta ON, este plugin se registra como Signal K Autopilot Provider (WilhelmSK / freeboard / KIP se conectan por /signalk/v2/api/vessels/self/autopilots). Debes desactivar tambien el plugin 'pypilot-autopilot-provider' en SK Admin - dos providers pelearian por el pilot ID. Ventaja: un socket menos hacia la TinyPilot Pi Zero.",
      "setup.emergency": "Emergencia",
      "setup.ssh.user": "Usuario SSH",
      "setup.ssh.password": "Password SSH",
      "setup.ssh.password.ph.notset": "(sin configurar)",
      "setup.ssh.password.ph.set": "(configurado - reescribe para cambiarlo)",
      "setup.ssh.save.btn": "Guardar",
      "setup.restart.btn": "REINICIAR pypilot",
      "setup.restart.hint": "Reinicia el proceso pypilot en la TinyPilot via SSH usando el usuario+password de arriba, ejecutando sudo systemctl restart pypilot pypilot_web. Si el SSH falla, cae a un reconnect local del socket.",
      "setup.security.hint": "Signal K guarda la config del plugin en texto plano en ~/.signalk/plugin-config-data/. Usa un password que solo valga para esta TinyPilot aislada.",
      // Tune tab
      "tune.pilot": "Piloto",
      "tune.profile": "Perfil",
      "tune.unlock": "Desbloquear ajustes (se relockea al salir del tab)",
      // Regata tab
      "regata.state.idle": "IDLE",
      "regata.timer": "TIMER",
      "regata.sync": "SYNC",
      "regata.reset": "RESET",
      "regata.beeps": "Beeps",
      "regata.voice": "Voz",
      "regata.hint": "TIMER: arranca / pausa. En race (tras 0), detiene. SYNC: en countdown redondea al minuto; en idle arranca desde T2. RESET: vuelve a idle.",
      // Dashboard corner popup
      "dash.help.title": "Configurar las esquinas de la rosa",
      "dash.help.body": "Elige que dato quieres ver en cada esquina. Se guarda en tu navegador.",
      "dash.corner.tl": "Arriba izquierda",
      "dash.corner.tr": "Arriba derecha",
      "dash.corner.bl": "Abajo izquierda",
      "dash.corner.br": "Abajo derecha",
      "dash.corner.empty": "(vacio)",
      "dash.wind.arrows": "FLECHAS DE VIENTO",
      "dash.wind.awa": "AWA (aparente, amber)",
      "dash.wind.twa": "TWA (real, magenta)",
      "dash.polar.title": "DATOS DE POLARES",
      "dash.polar.hint": "Activa las que quieras que aparezcan en los selectores de esquinas. Requiere el plugin signalk-polar-performance-plugin.",
      "dash.custom.title": "SK PATH PERSONALIZADO",
      "dash.custom.hint": "Anade cualquier path publicado por Signal K. Se muestra como aparezca en el bus (sin conversion).",
      "dash.custom.path.ph": "p.ej. environment.water.temperature",
      "dash.custom.label.ph": "Etiqueta",
      "dash.custom.unit.ph": "Unidad (opt)",
      "dash.custom.add": "Anadir",
      // Alerts / prompts / confirms
      "alert.saveOk": "Guardado.",
      "alert.saveFail": "Guardar fallo. Estas logueado como admin en Signal K?",
      "alert.configApplied": "Config guardada. Plugin reiniciando.",
      "alert.configFail": "Config fallo. Inicia sesion como admin en Signal K primero.",
      "alert.absorb.on": "Habilitado el AutopilotProvider. IMPORTANTE: ve a SK Admin y DESACTIVA el plugin 'pypilot-autopilot-provider' para que no se peleen.",
      "alert.absorb.off": "Deshabilitado el AutopilotProvider. Vuelve a activar 'pypilot-autopilot-provider' en SK Admin si quieres que WilhelmSK / freeboard sigan funcionando.",
      "alert.hostRequired": "Falta host",
      "alert.nudgeSaved": "Guardado. Valores de nudge actualizados.",
      "confirm.removeProfile": "Borrar el perfil actual?",
      "confirm.restartPypilot": "Reiniciar pypilot en la TinyPilot? La conexion se cortara ~10 s mientras vuelve.",
      "confirm.resetCfg": "Borrar toda la configuracion del visor (esquinas, flechas, polares, custom paths)? Los ajustes del piloto en la TinyPilot NO se tocan.",
      "prompt.profileName": "Nombre del perfil",
      "prompt.pasteCfg": "Pega el JSON de configuracion exportado:",
      // Setup SSH + restart status
      "setup.ssh.status.emptyPwd": "Password vacio. Escribelo antes de Save (aunque no lo cambies, hay que retypearlo cada vez por seguridad).",
      "setup.ssh.status.saving": "Guardando...",
      "setup.ssh.status.savedRestarting": "Guardado. Reiniciando plugin...",
      "setup.ssh.status.set": "Password configurado",
      "setup.ssh.status.notset": "Sin password configurado.",
      "setup.ssh.status.enabled": "REINICIAR pypilot activado.",
      "setup.ssh.status.reconnectOnly": "REINICIAR pypilot solo reconectara el socket local.",
      "setup.restart.wait": "Reiniciando pypilot...",
      "setup.restart.ok": "Reiniciado via SSH.",
      "setup.restart.reconnecting": "Reconectando socket en 3 s...",
      "setup.restart.notConfigured": "SSH no configurado.",
      "setup.restart.reconnectOnly": "Se reconecto el socket local pero pypilot sigue igual.",
      "setup.restart.error": "Error",
      "setup.restart.network": "Error de red",
      // Info tab config export/import
      "info.cfg.shared": "Compartido.",
      "info.cfg.sharedText": "Compartido como texto.",
      "info.cfg.cancelled": "Cancelado.",
      "info.cfg.noShareApi": "Sin API compartir - descargado como archivo.",
      "info.cfg.downloaded": "Descargado.",
      "info.cfg.copied": "JSON copiado al portapapeles.",
      "info.cfg.copyFail": "No se pudo copiar",
      "info.cfg.imported": "Importado ({N} claves). Recargando...",
      "info.cfg.importFail": "Import fallo",
      "info.cfg.reset": "Config borrada. Recargando...",
      "info.cfg.downloadFail": "Download fallo",
      // Rev63 / 2.0.0: escalated restart triad + helm-manned confirmation
      "setup.restart.title":         "Restart / reboot (escalado)",
      "setup.restart.web.title":     "restart pypilot_web",
      "setup.restart.web.sub":       "~3-5 s · el AP sigue pilotando",
      "setup.restart.pypilot.title": "REINICIAR pypilot",
      "setup.restart.pypilot.sub":   "~10-15 s · el AP suelta el rumbo",
      "setup.restart.reboot.title":  "reboot de la Pi",
      "setup.restart.reboot.sub":    "~35-60 s · corte total",
      "setup.restart.hint":          "Las tres acciones usan el usuario+password SSH de arriba. El nivel 1 no interrumpe el pilotaje; los niveles 2 y 3 sí. Se muestra una confirmacion pidiendo que haya alguien al timon antes de ejecutar.",
      "setup.restart.outage.web":     "Se reinicia solo el servidor web de pypilot. El core sigue pilotando durante esos segundos.",
      "setup.restart.outage.pypilot": "Se reinician el core pypilot y su servidor web. El AP suelta el rumbo brevemente y se reengancha tras reconectar.",
      "setup.restart.outage.reboot":  "Se reinicia la Raspberry Pi entera (kernel, servicios, red). NO hay autopiloto durante ~35-60 segundos. Arranque en frio.",
      "helm.outage":  "Corte del piloto:",
      "helm.warn":    "ASEGURATE DE QUE ALGUIEN ESTA AL TIMON antes de continuar. No es el momento de estar bajo cubierta.",
      "helm.cancel":  "Cancelar",
      "helm.confirm": "Confirmo - hay alguien al timon",
      // Debug console
      "setup.debug.title":      "Consola debug",
      "setup.debug.output.ph":  "Pulsa un preset de arriba. La salida aparecera aqui.",
      "setup.debug.follow":     "Follow logs (poll cada 3 s)",
      "setup.debug.copy":       "Copiar",
      "setup.debug.send":       "Compartir / enviar",
      "setup.debug.clear":      "Limpiar",
      "setup.debug.running":    "Ejecutando preset...",
      "setup.debug.ok":         "OK",
      "setup.debug.failed":     "Fallo",
      "setup.debug.noSsh":      "SSH no configurado - guarda el password SSH arriba primero.",
    },
    de: {
      "tack": "WENDEN",
      "cal": "KAL",
      "cal.level": "Waagerecht (Boot flach)",
      "cal.rudCentered": "Ruder zentriert",
      "cal.rudPort": "Ruder Backbord-Bereich",
      "cal.rudStar": "Ruder Steuerbord-Bereich",
      "cal.rudReset": "Ruder Reset",
      "cal.headingOffset": "IMU Kursoffset (Grad)",
      "cal.rudRange": "Ruderbereich (Grad)",
      "configuration": "Konfiguration",
      "calibration.title": "Kalibrierung",
      "save": "Speichern",
      "cancel": "Abbrechen",
      "close": "Schliessen",
      "loading": "laedt...",
      "paths.publish": "Publizieren",
      "paths.skPath": "SK-Pfad",
      "paths.units": "Einheiten",
      "paths.put": "PUT?",
      "paths.copy": "Kopieren",
      "paths.refresh": "Aktualisieren",
      "paths.search.ph": "Pfade filtern...",
      "nudge.title": "Nudge-Schritte",
      "nudge.small": "Klein (-1/+1)",
      "nudge.big": "Gross (-10/+10)",
      "language.title": "Sprache",
      "tab.control": "Steuerung",
      "tab.tune":    "Einstellungen",
      "tab.regata":  "Regatta",
      "tab.paths":   "Pfade & API",
      "tab.setup":   "Setup",
      "tab.info":    "Info",
      "setup.connection": "Verbindung",
      "setup.emergency":  "Notfall",
      "setup.restart.btn": "pypilot NEU STARTEN",
      "setup.ssh.user":     "SSH-Benutzer",
      "setup.ssh.password": "SSH-Passwort",
      // Restart triad + helm
      "setup.restart.title":         "Neustart / Reboot (eskaliert)",
      "helm.warn":    "STELL SICHER, DASS JEMAND AM RUDER STEHT, bevor du fortfahrst. Nicht der Moment, unter Deck zu sein.",
      "helm.cancel":  "Abbrechen",
      "helm.confirm": "Bestatigt - Rudergaenger ist am Platz",
    },
    fr: {
      "tack": "VIRER",
      "cal": "CAL",
      "cal.level": "Nivele (bateau a plat)",
      "cal.rudCentered": "Safran centre",
      "cal.rudPort": "Amplitude babord",
      "cal.rudStar": "Amplitude tribord",
      "cal.rudReset": "Reset safran",
      "cal.headingOffset": "Offset cap IMU (deg)",
      "cal.rudRange": "Amplitude safran (deg)",
      "configuration": "Configuration",
      "calibration.title": "Calibration",
      "save": "Enregistrer",
      "cancel": "Annuler",
      "close": "Fermer",
      "loading": "chargement...",
      "paths.publish": "Publier",
      "paths.skPath": "Path SK",
      "paths.units": "Unites",
      "paths.put": "PUT?",
      "paths.copy": "Copier",
      "paths.refresh": "Actualiser",
      "paths.search.ph": "filtrer paths...",
      "nudge.title": "Pas nudge",
      "nudge.small": "Petit (-1/+1)",
      "nudge.big": "Grand (-10/+10)",
      "language.title": "Langue",
      "tab.control": "Controle",
      "tab.tune":    "Reglages",
      "tab.regata":  "Regate",
      "tab.paths":   "Paths & API",
      "tab.setup":   "Config",
      "tab.info":    "Info",
      "setup.connection": "Connexion",
      "setup.emergency":  "Urgence",
      "setup.restart.btn": "REDEMARRER pypilot",
      "setup.ssh.user":     "Utilisateur SSH",
      "setup.ssh.password": "Mot de passe SSH",
      // Restart triad + helm
      "setup.restart.title":         "Redemarrage / reboot (escalade)",
      "helm.warn":    "ASSURE-TOI QU'UNE PERSONNE EST A LA BARRE avant de continuer. Ce n'est pas le moment d'etre en bas.",
      "helm.cancel":  "Annuler",
      "helm.confirm": "Confirme - quelqu'un est a la barre",
    },
  };
  const LANG_KEY = "pypilot-newui.lang";
  // Rev61: first visit picks the browser language automatically. User's
  // explicit choice in Setup > Language wins on subsequent visits.
  function currentLang() {
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (stored && I18N[stored]) return stored;
      const nav = ((navigator.language || navigator.userLanguage || "en") + "").slice(0, 2).toLowerCase();
      return I18N[nav] ? nav : "en";
    } catch { return "en"; }
  }
  function setLang(l) {
    if (!I18N[l]) l = "en";
    try { localStorage.setItem(LANG_KEY, l); } catch {}
    applyI18n();
  }
  function t(key) {
    const d = I18N[currentLang()] || I18N.en;
    return d[key] ?? I18N.en[key] ?? key;
  }
  function applyI18n() {
    // Text content via data-i18n.
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      el.textContent = t(key);
    });
    // Rev61: placeholder / title / aria-label via data-i18n-attr="key1:attr1,key2:attr2".
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    // Rev61: multi-language content blocks. Any group of sibling elements
    // with [data-lang] shows only the one matching the current language;
    // if none matches, the "en" fallback is shown.
    const cur = currentLang();
    const groups = new Map();   // parent -> array of [data-lang] children
    document.querySelectorAll("[data-lang]").forEach((el) => {
      const p = el.parentElement;
      if (!p) return;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    });
    groups.forEach((kids) => {
      const match = kids.find((k) => k.dataset.lang === cur)
                 || kids.find((k) => k.dataset.lang === "en");
      kids.forEach((k) => { k.style.display = (k === match) ? "" : "none"; });
    });
    // Rev61: keep the language <select> in sync with what is actually active.
    const sel = document.getElementById("lang-select");
    if (sel && sel.value !== cur) sel.value = cur;
    // Rev61: reflect language on <html lang="..."> for browser accessibility.
    try { document.documentElement.lang = cur; } catch {}
  }

  // ---- state ----
  const state = {
    values: {},          // path -> value cache
    mode: null,
    modeList: [],
    engaged: false,
    apState: "unknown",
    heading: null,       // rad from SK; converted to deg for display
    target: null,        // rad
    windAngle: null,     // rad
    windSpeed: null,     // m/s
    pilot: null,
    pilots: [],
    profile: null,
    profiles: [],
    gains: {},           // { pilot: { P: {min,max,value}, I: {...}, ... } }
    catalog: {},         // last known pypilot catalog
    availableActions: [],
    lastNudgeTs: 0,
    localTargetRad: null,
    autopilotId: "", // discovered on boot from /autopilots; must not default to a specific id.
    authFailed: false,
    nudgeSmall: 1,             // populated from plugin config
    nudgeBig: 10,
    windAngleTrue: null,
    windSpeedTrue: null,
    sog: null,                 // m/s
  };

  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;

  // ---- helpers ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmtDeg = (rad) =>
    (rad == null || isNaN(rad)) ? "---" : (rad * RAD2DEG).toFixed(0);
  const fmtDeg1 = (rad) =>
    (rad == null || isNaN(rad)) ? "---" : (rad * RAD2DEG).toFixed(1);
  const wrapDeg = (d) => {
    let x = d % 360;
    if (x < 0) x += 360;
    return x;
  };

  // ---- WebSocket stream to SK ----
  let ws = null;
  function connectSK() {
    const loc = window.location;
    const wsProto = loc.protocol === "https:" ? "wss" : "ws";
    const url = `${wsProto}://${loc.host}/signalk/v1/stream?subscribe=none`;
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      subscribeAll();
    });
    ws.addEventListener("message", (evt) => {
      try { handleDelta(JSON.parse(evt.data)); } catch { /* ignore */ }
    });
    ws.addEventListener("close", () => {
      setTimeout(connectSK, 2500);
    });
    ws.addEventListener("error", () => { try { ws.close(); } catch {} });
  }

  // Throttle renderControl. Even without user input, the pypilot_web can burst
  // ~30 deltas at reconnect and each render triggers SVG reflow. 50 ms window
  // keeps the UI snappy and cuts main-thread work by 10x on cheap phones.
  let _renderScheduled = false;
  function scheduleRenderControl() {
    if (_renderScheduled) return;
    _renderScheduled = true;
    setTimeout(() => { _renderScheduled = false; renderControl(); }, 50);
  }

  function subscribeAll() {
    const paths = [
      // Core autopilot API v1 (published by pypilot-autopilot-provider)
      "steering.autopilot.state",
      "steering.autopilot.mode",
      "steering.autopilot.target",
      "steering.autopilot.engaged",
      "steering.autopilot.availableActions",
      // Ours - a single wildcard on the pypilot subtree catches everything
      // including gains, servo, calibration, tack detail, errors, warnings,
      // availableModes, availablePilots, profile, pilot, runtime, version.
      "steering.autopilot.pypilot.*",
      // Heading (from pypilot plugin) + rudder + wind + SOG for dashboard tiles
      "navigation.headingMagnetic",
      "navigation.speedOverGround",
      "navigation.courseOverGroundTrue",
      "steering.rudderAngle",
      "environment.wind.angleApparent",
      "environment.wind.speedApparent",
      "environment.wind.angleTrueWater",
      "environment.wind.angleTrueGround",
      "environment.wind.speedTrue",
      "environment.wind.directionTrue",
      "environment.depth.belowKeel",
      "environment.depth.belowTransducer",
      "environment.depth.belowSurface",
      // Rev58: polar-performance-plugin paths + water temp. Also a
      // wildcard on performance.* so any other polar-related path the
      // plugin publishes appears in the raw path cache (state.values)
      // and can be added by the user via the "custom SK path" input.
      "performance.polarSpeed",
      "performance.polarSpeedRatio",
      "performance.velocityMadeGood",
      "performance.targetAngle",
      "performance.targetSpeed",
      "performance.beatAngle",
      "performance.beatAngleVelocityMadeGood",
      "performance.gybeAngle",
      "performance.gybeAngleVelocityMadeGood",
      "performance.*",
      "environment.water.temperature",
    ];
    const sub = {
      context: "vessels.self",
      subscribe: paths.map((p) => ({
        path: p,
        // Rev11: ease off from 500 ms/200 ms. The dashboard tiles do not
        // need to update faster than 1 Hz, and when several devices are
        // subscribed this halves the total delta traffic.
        period: 1000,
        format: "delta",
        policy: "instant",
        minPeriod: 500,
      })),
    };
    ws.send(JSON.stringify(sub));
  }

  function handleDelta(msg) {
    if (!msg || !Array.isArray(msg.updates)) return;
    let touchedGain = false;
    for (const u of msg.updates) {
      const values = u.values || [];
      for (const v of values) {
        state.values[v.path] = v.value;
        applyValue(v.path, v.value);
        // Rev63 / 2.0.0: gain paths now verbatim (see publisher.ts refactor).
        if (v.path.startsWith("steering.autopilot.pypilot.ap.pilot.")) {
          touchedGain = true;
          const row = document.querySelector(`.gain-row[data-sk="${v.path}"]`);
          if (row) {
            const rng = row.querySelector("input[type=range]");
            const lbl = row.querySelector(".value");
            if (rng && !row.classList.contains("active")) rng.value = String(v.value);
            if (lbl) lbl.textContent = Number(v.value).toFixed(4);
          }
        }
      }
    }
    renderHeader();
    scheduleRenderControl();
    if (touchedGain && state.pilot && !document.querySelector(".gain-row")) {
      // First gain arrived before renderGains had been called (pilot came in
      // slightly later). Trigger a render now so the row appears.
      renderGains();
    }
  }

  function applyValue(path, value) {
    switch (path) {
      case "steering.autopilot.state":            state.apState = value; break;
      case "steering.autopilot.mode":             state.mode = value; setSelect("#mode-select", value); break;
      case "steering.autopilot.target":           state.target = numericOrNull(value); renderTargetArrow(); break;
      case "steering.autopilot.engaged":          state.engaged = !!value; renderEngage(); renderTargetArrow(); break;
      case "steering.autopilot.availableActions": state.availableActions = value || []; break;
      // Rev63 / 2.0.0: verbatim path is `ap.modes` (was `availableModes` alias).
      case "steering.autopilot.pypilot.ap.modes":
        if (Array.isArray(value)) { state.modeList = value; fillSelect("#mode-select", value); }
        break;
      // Rev63 / 2.0.0: verbatim - was `.pilot`, now `.ap.pilot` (from pypilot key `ap.pilot`).
      case "steering.autopilot.pypilot.ap.pilot":
        state.pilot = value; setSelect("#pilot-select", value); renderGains();
        break;
      case "steering.autopilot.pypilot.availablePilots":
        if (Array.isArray(value)) { state.pilots = value; fillSelect("#pilot-select", value); setSelect("#pilot-select", state.pilot); }
        break;
      case "steering.autopilot.pypilot.profile":
        {
          const prev = state.profile;
          state.profile = value;
          setSelect("#profile-select", value);
          // Rev38: when the active profile changes, pypilot swaps in that
          // profile's stored gains. Force a values refresh so the Ajustes
          // sliders reflect the new gains instead of the old ones. The
          // per-gain deltas alone may not arrive if pypilot only emits on
          // change and the new values happen to equal old-cached ones.
          if (prev !== undefined && prev !== value) {
            setTimeout(refreshPypilotValues, 400);
            setTimeout(refreshPypilotValues, 1500);
          }
        }
        break;
      case "steering.autopilot.pypilot.profiles":
        if (Array.isArray(value)) { state.profiles = value; fillSelect("#profile-select", value); }
        break;
      // Rev63 / 2.0.0: verbatim - was `.tack.state`, now `.ap.tack.state` (from pypilot key `ap.tack.state`).
      case "steering.autopilot.pypilot.ap.tack.state":
        renderTackButton(value); break;
      case "navigation.headingMagnetic":
        state.heading = numericOrNull(value); break;
      case "steering.rudderAngle":
        renderRudder(numericOrNull(value)); break;
      case "environment.wind.angleApparent":
        state.windAngle = numericOrNull(value); break;
      case "environment.wind.speedApparent":
        state.windSpeed = numericOrNull(value); break;
      case "environment.wind.angleTrueWater":
      case "environment.wind.angleTrueGround":
        state.windAngleTrue = numericOrNull(value); break;
      case "environment.wind.speedTrue":
        state.windSpeedTrue = numericOrNull(value); break;
      case "navigation.speedOverGround":
        state.sog = numericOrNull(value); break;
      case "navigation.courseOverGroundTrue":
        state.cog = numericOrNull(value); break;
      case "environment.wind.directionTrue":
        state.windDirTrue = numericOrNull(value); break;
      case "environment.depth.belowKeel":
      case "environment.depth.belowTransducer":
      case "environment.depth.belowSurface":
        // First non-null wins: prefer belowKeel > belowTransducer > belowSurface.
        {
          const v = numericOrNull(value);
          if (v != null) state.depth = v;
        }
        break;
      // Rev58: polar-performance-plugin. All values kept in SI (m/s for
      // speeds, rad for angles) so the DASH_DATA formatters can convert
      // consistently. Water temperature stays in kelvin.
      case "performance.polarSpeed":              state.polarSpeed  = numericOrNull(value); break;
      case "performance.polarSpeedRatio":         state.polarRatio  = numericOrNull(value); break;
      case "performance.velocityMadeGood":        state.vmg         = numericOrNull(value); break;
      case "performance.targetAngle":             state.targetAngle = numericOrNull(value); break;
      case "performance.targetSpeed":             state.targetSpeed = numericOrNull(value); break;
      case "performance.beatAngle":               state.beatAngle   = numericOrNull(value); break;
      case "performance.beatAngleVelocityMadeGood": state.beatVmg   = numericOrNull(value); break;
      case "performance.gybeAngle":               state.gybeAngle   = numericOrNull(value); break;
      case "performance.gybeAngleVelocityMadeGood": state.gybeVmg   = numericOrNull(value); break;
      case "environment.water.temperature":       state.waterTempK  = numericOrNull(value); break;
    }
  }

  function numericOrNull(v) {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  // ---- Renderers ----
  function renderHeader() {
    // Header pills were removed in Rev10. Kept as no-op so the delta pipeline
    // can call renderHeader() without gating.
  }

  function renderControl() {
    // Rev57: HDG lives at the top rim of the rose. The number is
    // rendered in its own <text> centered at x=0 with text-anchor=middle,
    // then the degree symbol is positioned in a second <text> placed
    // just after the digits (measured with getComputedTextLength). This
    // way "9" and "298" both stay optically centered inside the rose.
    const hdgTxt = document.getElementById("rose-hdg-value");
    const hdgDeg = document.getElementById("rose-hdg-deg");
    if (hdgTxt) {
      const s = state.heading == null ? "---" : Math.round(state.heading * RAD2DEG).toString().padStart(3, "0");
      hdgTxt.textContent = s;
      if (hdgDeg) {
        // getComputedTextLength() only works on rendered SVG text nodes.
        // Fall back to a heuristic width if the SVG has not laid out yet
        // (e.g. tab is not visible).
        let w;
        try { w = hdgTxt.getComputedTextLength(); } catch { w = s.length * 12; }
        if (!isFinite(w) || w <= 0) w = s.length * 12;
        hdgDeg.setAttribute("x", (w / 2 + 1).toFixed(1));
      }
    }
    _dashRenderCorners();
    renderWindRose();
    renderTargetArrow();
  }

  // Rev48: 4 configurable corner tiles. Each corner shows one field
  // chosen by the user in the popup. Values come from state.* (already
  // populated by the SK stream). Persisted in localStorage.
  const DASH_CORNER_LS_KEY = "pypilot-newui.dashCorners";
  const _dashCornerCfg = { tl: "hdg", tr: "wind", bl: "tgt", br: "sog" };
  const DASH_DATA = {
    none:  { label: "-",   read: () => "" },
    hdg:   { label: "HDG", read: () => state.heading    == null ? "---" : Math.round(state.heading    * RAD2DEG) + "°" },
    awa:   { label: "AWA", read: () => state.windAngle  == null ? "---" : _sgn(state.windAngle  * RAD2DEG) + "°" },
    aws:   { label: "AWS", read: () => state.windSpeed  == null ? "---" : (state.windSpeed  * 1.94384).toFixed(1) + " kn" },
    twa:   { label: "TWA", read: () => state.windAngleTrue == null ? "---" : _sgn(state.windAngleTrue * RAD2DEG) + "°" },
    tws:   { label: "TWS", read: () => state.windSpeedTrue == null ? "---" : (state.windSpeedTrue * 1.94384).toFixed(1) + " kn" },
    twd:   { label: "TWD", read: () => state.windDirTrue   == null ? "---" : Math.round(state.windDirTrue * RAD2DEG) + "°" },
    wind:  { label: () => (String(state.mode || "").includes("true") ? "TWA/TWS" : "AWA/AWS"),
             read: () => {
               const useTrue = String(state.mode || "").includes("true");
               const ang = useTrue ? state.windAngleTrue : state.windAngle;
               const spd = useTrue ? state.windSpeedTrue : state.windSpeed;
               const a = ang == null ? "---" : _sgn(ang * RAD2DEG) + "°";
               const s = spd == null ? "---" : (spd * 1.94384).toFixed(1) + " kn";
               return { value: a, sub: s };
             } },
    sog:   { label: "SOG", read: () => state.sog == null ? "---" : (state.sog * 1.94384).toFixed(1) + " kn" },
    cog:   { label: "COG", read: () => state.cog == null ? "---" : Math.round(state.cog * RAD2DEG) + "°" },
    tgt:   { label: "TGT", read: () => state.target == null ? "---" : Math.round(state.target * RAD2DEG) + "°" },
    depth: { label: "DEPTH", read: () => state.depth == null ? "---" : state.depth.toFixed(1) + " m" },
    mode:  { label: "MODE",  read: () => String(state.mode || "---") },
    // Rev58: polar-performance-plugin (opt-in per user via popup toggle).
    // The toggle only controls whether these entries are OFFERED in the
    // corner selector - the value always renders if the SK path is live.
    perfPolarSpd: { label: "POLAR",  read: () => state.polarSpeed == null ? "---" : (state.polarSpeed * 1.94384).toFixed(1) + " kn" },
    perfPolarPct: { label: "POLAR%", read: () => state.polarRatio == null ? "---" : (state.polarRatio * 100).toFixed(0) + " %" },
    perfVmg:      { label: "VMG",    read: () => state.vmg        == null ? "---" : (state.vmg * 1.94384).toFixed(1) + " kn" },
    perfTgtAng:   { label: "TGT AWA",read: () => state.targetAngle == null ? "---" : Math.round(state.targetAngle * RAD2DEG) + "°" },
    perfTgtSpd:   { label: "TGT SPD",read: () => state.targetSpeed == null ? "---" : (state.targetSpeed * 1.94384).toFixed(1) + " kn" },
    perfBeatAng:  { label: "BEAT",   read: () => state.beatAngle  == null ? "---" : Math.round(state.beatAngle * RAD2DEG) + "°" },
    perfBeatVmg:  { label: "BEAT VMG",read: () => state.beatVmg   == null ? "---" : (state.beatVmg * 1.94384).toFixed(1) + " kn" },
    perfGybeAng:  { label: "GYBE",   read: () => state.gybeAngle  == null ? "---" : Math.round(state.gybeAngle * RAD2DEG) + "°" },
    perfGybeVmg:  { label: "GYBE VMG",read: () => state.gybeVmg   == null ? "---" : (state.gybeVmg * 1.94384).toFixed(1) + " kn" },
    waterTemp:    { label: "WATER",  read: () => state.waterTempK == null ? "---" : (state.waterTempK - 273.15).toFixed(1) + " °C" },
  };
  // Rev58: which "extended" datapoints the user has enabled to appear in
  // the corner selector. Everything ships OFF by default so the default
  // dropdown stays tight. Toggled from the popup, persisted in localStorage.
  const DASH_EXTRA_LS_KEY = "pypilot-newui.dashExtras";
  const DASH_EXTRA_KEYS = [
    "perfPolarSpd","perfPolarPct","perfVmg","perfTgtAng","perfTgtSpd",
    "perfBeatAng","perfBeatVmg","perfGybeAng","perfGybeVmg","waterTemp",
  ];
  const _dashExtras = new Set();
  try {
    const raw = localStorage.getItem(DASH_EXTRA_LS_KEY);
    if (raw) { for (const k of JSON.parse(raw)) _dashExtras.add(k); }
  } catch {}
  function _dashSaveExtras() {
    try { localStorage.setItem(DASH_EXTRA_LS_KEY, JSON.stringify([..._dashExtras])); } catch {}
  }
  // Rev58: custom user-added SK paths. Each entry is { path, label, unit }.
  // The value comes straight from state.values[path] (the raw SK cache).
  const DASH_CUSTOM_LS_KEY = "pypilot-newui.dashCustom";
  const _dashCustom = [];
  try {
    const raw = localStorage.getItem(DASH_CUSTOM_LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const c of arr) if (c && c.path) _dashCustom.push(c);
    }
  } catch {}
  function _dashSaveCustom() {
    try { localStorage.setItem(DASH_CUSTOM_LS_KEY, JSON.stringify(_dashCustom)); } catch {}
  }
  function _dashCustomKey(i) { return `custom${i}`; }
  function _refreshCustomDashEntries() {
    // Remove old custom entries then re-add so removals stick.
    for (const k of Object.keys(DASH_DATA)) if (k.startsWith("custom")) delete DASH_DATA[k];
    _dashCustom.forEach((c, i) => {
      DASH_DATA[_dashCustomKey(i)] = {
        label: c.label || (c.path.split(".").pop() || c.path).toUpperCase(),
        read: () => {
          const v = state.values ? state.values[c.path] : undefined;
          if (v == null) return "---";
          if (typeof v === "number") return v.toFixed(2) + (c.unit ? " " + c.unit : "");
          if (typeof v === "object") {
            // SK often wraps: { value: N, timestamp: ... }
            const inner = v.value != null ? v.value : (Array.isArray(v) ? v[0] : null);
            if (typeof inner === "number") return inner.toFixed(2) + (c.unit ? " " + c.unit : "");
            return JSON.stringify(v).slice(0, 12);
          }
          return String(v);
        },
      };
    });
  }
  _refreshCustomDashEntries();
  function _sgn(n) { return (n > 0 ? "+" : "") + Math.round(n); }
  function _dashLoadCfg() {
    try {
      const raw = localStorage.getItem(DASH_CORNER_LS_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      for (const k of ["tl","tr","bl","br"]) {
        if (c[k] && DASH_DATA[c[k]]) _dashCornerCfg[k] = c[k];
      }
    } catch { /* silent */ }
  }
  function _dashSaveCfg() {
    try { localStorage.setItem(DASH_CORNER_LS_KEY, JSON.stringify(_dashCornerCfg)); } catch {}
  }
  function _dashRenderCorners() {
    for (const corner of ["tl","tr","bl","br"]) {
      const el = document.querySelector(`.dash-cell[data-corner="${corner}"]`);
      if (!el) continue;
      const key = _dashCornerCfg[corner];
      const meta = DASH_DATA[key];
      if (!meta) continue;
      const label = typeof meta.label === "function" ? meta.label() : meta.label;
      const val = meta.read();
      // Wind returns {value, sub}; the rest returns a string.
      if (val && typeof val === "object" && "value" in val) {
        el.innerHTML = `<div class="label">${label}</div><div class="value">${val.value}</div><div class="sub">${val.sub}</div>`;
      } else {
        el.innerHTML = `<div class="label">${label}</div><div class="value">${val}</div>`;
      }
      // Rev48: color coding by data type - keep classic B&G-ish palette.
      el.classList.remove("heading","target","wind","sog","depth","cog","mode","twa","twd");
      const colorMap = { hdg:"heading", tgt:"target", wind:"wind", awa:"wind", aws:"wind",
                         twa:"twa", tws:"wind", twd:"twd", sog:"sog", cog:"cog", depth:"depth", mode:"mode" };
      if (colorMap[key]) el.classList.add(colorMap[key]);
    }
  }
  function _dashPopulateSelectors() {
    // Rev58: the corner dropdown lists CORE keys + user-enabled extras +
    // any custom paths the user has added. Everything else stays hidden
    // to keep the list scannable at the helm.
    const CORE_KEYS = ["none","hdg","awa","aws","twa","tws","twd","wind","sog","cog","tgt","depth","mode"];
    const listKeys = () => [
      ...CORE_KEYS,
      ...DASH_EXTRA_KEYS.filter((k) => _dashExtras.has(k)),
      ..._dashCustom.map((_, i) => _dashCustomKey(i)),
    ].filter((k) => DASH_DATA[k]);
    for (const corner of ["tl","tr","bl","br"]) {
      const sel = document.getElementById(`dash-corner-${corner}`);
      if (!sel) continue;
      sel.innerHTML = "";
      for (const key of listKeys()) {
        const opt = document.createElement("option");
        opt.value = key;
        const lab = typeof DASH_DATA[key].label === "function" ? DASH_DATA[key].label() : DASH_DATA[key].label;
        opt.textContent = key === "none" ? "(vacío)" : `${lab} · ${key}`;
        sel.appendChild(opt);
      }
      // If the currently-configured corner key was disabled/removed, fall
      // back to "none" so the <select> does not show a phantom option.
      if (!Array.from(sel.options).some((o) => o.value === _dashCornerCfg[corner])) {
        _dashCornerCfg[corner] = "none"; _dashSaveCfg();
      }
      sel.value = _dashCornerCfg[corner];
      sel.onchange = () => {
        _dashCornerCfg[corner] = sel.value;
        _dashSaveCfg();
        _dashRenderCorners();
      };
    }
    // Rev58: two independent wind-arrow checkboxes (AWA + TWA).
    const awaCb = document.getElementById("dash-wind-arrow-awa");
    const twaCb = document.getElementById("dash-wind-arrow-twa");
    if (awaCb) { awaCb.checked = _windArrowShow.awa; awaCb.onchange = () => _setWindArrow("awa", awaCb.checked); }
    if (twaCb) { twaCb.checked = _windArrowShow.twa; twaCb.onchange = () => _setWindArrow("twa", twaCb.checked); }

    // Polar toggles.
    const polBox = document.getElementById("dash-polar-toggles");
    if (polBox) {
      polBox.innerHTML = "";
      for (const key of DASH_EXTRA_KEYS) {
        const lab = typeof DASH_DATA[key].label === "function" ? DASH_DATA[key].label() : DASH_DATA[key].label;
        const row = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = _dashExtras.has(key);
        cb.onchange = () => {
          if (cb.checked) _dashExtras.add(key); else _dashExtras.delete(key);
          _dashSaveExtras();
          _dashPopulateSelectors();
          _dashRenderCorners();
        };
        const txt = document.createElement("span");
        txt.textContent = `${lab} — ${key.startsWith("perf") ? "performance." : ""}${key}`;
        row.appendChild(cb); row.appendChild(txt);
        polBox.appendChild(row);
      }
    }

    // Custom SK path picker + list.
    const list = document.getElementById("dash-custom-list");
    if (list) {
      list.innerHTML = "";
      _dashCustom.forEach((c, i) => {
        const chip = document.createElement("div");
        chip.className = "chip";
        const info = document.createElement("span");
        info.innerHTML = `<b>${c.label || c.path.split(".").pop()}</b> <code style="font-size:11px;opacity:0.7">${c.path}</code>${c.unit ? " ["+c.unit+"]" : ""}`;
        const rm = document.createElement("button");
        rm.textContent = "×";
        rm.title = "Quitar";
        rm.onclick = () => {
          _dashCustom.splice(i, 1);
          _dashSaveCustom();
          _refreshCustomDashEntries();
          _dashPopulateSelectors();
          _dashRenderCorners();
        };
        chip.appendChild(info); chip.appendChild(rm);
        list.appendChild(chip);
      });
    }
    // Populate the datalist with all currently-known SK paths (from what
    // has streamed in so far). Non-authoritative - just a helper.
    const dl = document.getElementById("dash-custom-path-list");
    if (dl && state.values) {
      dl.innerHTML = "";
      for (const p of Object.keys(state.values).sort()) {
        const o = document.createElement("option");
        o.value = p;
        dl.appendChild(o);
      }
    }
    const addBtn = document.getElementById("dash-custom-add");
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.onclick = () => {
        const pi = document.getElementById("dash-custom-path");
        const li = document.getElementById("dash-custom-label");
        const ui = document.getElementById("dash-custom-unit");
        const path = (pi?.value || "").trim();
        if (!path) return;
        _dashCustom.push({
          path,
          label: (li?.value || "").trim() || (path.split(".").pop() || path).toUpperCase(),
          unit:  (ui?.value || "").trim(),
        });
        _dashSaveCustom();
        _refreshCustomDashEntries();
        _dashPopulateSelectors();
        _dashRenderCorners();
        if (pi) pi.value = ""; if (li) li.value = ""; if (ui) ui.value = "";
      };
    }
  }

  // Rev58: user picks whether to show the AWA arrow, the TWA arrow, or
  // BOTH at the same time. Kept as two independent flags (not a radio)
  // because on a race boat the crew wants to watch both cones at once.
  // Persisted individually in localStorage.
  const WIND_ARROW_AWA_LS = "pypilot-newui.windArrow.awa";
  const WIND_ARROW_TWA_LS = "pypilot-newui.windArrow.twa";
  let _windArrowShow = { awa: true, twa: false };
  try {
    const a = localStorage.getItem(WIND_ARROW_AWA_LS);
    const t = localStorage.getItem(WIND_ARROW_TWA_LS);
    if (a != null) _windArrowShow.awa = a === "1";
    if (t != null) _windArrowShow.twa = t === "1";
  } catch {}
  function _setWindArrow(which, on) {
    _windArrowShow[which] = !!on;
    try {
      localStorage.setItem(which === "awa" ? WIND_ARROW_AWA_LS : WIND_ARROW_TWA_LS, on ? "1" : "0");
    } catch {}
    renderWindRose();
  }

  // SVG compass rose. The card (cardinals + ticks) rotates so N points to
  // magnetic north regardless of boat heading; the boat is fixed pointing up;
  // TWO independent wind arrows (AWA amber solid, TWA magenta dashed) rotate
  // to their respective angles; wedges are boat-fixed helm guides.
  function renderWindRose() {
    const card = document.getElementById("rose-card");
    if (card && state.heading != null) {
      card.setAttribute("transform", `rotate(${-state.heading * RAD2DEG})`);
    }

    const awa = document.getElementById("rose-wind-arrow");
    if (awa) {
      if (_windArrowShow.awa && state.windAngle != null) {
        awa.setAttribute("transform", `rotate(${state.windAngle * RAD2DEG})`);
        awa.style.display = "";
      } else {
        awa.style.display = "none";
      }
    }
    const twa = document.getElementById("rose-wind-arrow-twa");
    if (twa) {
      if (_windArrowShow.twa && state.windAngleTrue != null) {
        twa.setAttribute("transform", `rotate(${state.windAngleTrue * RAD2DEG})`);
        twa.style.display = "";
      } else {
        twa.style.display = "none";
      }
    }

    // Speed readout at the bottom: prefer the source that is enabled; if
    // both are enabled, show apparent (the one the crew feels).
    const showAws = _windArrowShow.awa && state.windSpeed != null;
    const showTws = _windArrowShow.twa && state.windSpeedTrue != null;
    let windSpeed = null, tag = "";
    if (showAws) { windSpeed = state.windSpeed; tag = "AWS"; }
    else if (showTws) { windSpeed = state.windSpeedTrue; tag = "TWS"; }

    // Rev56: sailing zones (green stbd / red port) are DRAWN STATIC in
    // the SVG at fixed boat-centerline angles +/-30..60, so nothing to
    // update here.
    const speedText = document.getElementById("rose-speed");
    if (speedText) {
      speedText.textContent = windSpeed == null
        ? "--- kn"
        : (windSpeed * 1.94384).toFixed(1) + " kn" + (tag ? " " + tag : "");
    }
  }

  // Rev57: target indicator - a small cyan diamond OUTSIDE the compass
  // ring at radius r=~96, pointing where pypilot is steering. Only
  // visible when the AP is engaged. Compass/GPS modes: rotate by
  // (target - heading), which is where the target lies relative to the
  // boat bow. Wind modes: target IS a wind angle (already boat-frame),
  // so rotate by target directly.
  function renderTargetArrow() {
    const g = document.getElementById("rose-target-arrow");
    if (!g) return;
    if (!state.engaged || state.target == null) {
      g.style.display = "none";
      return;
    }
    const modeStr = String(state.mode || "").toLowerCase();
    const isWindMode = modeStr.includes("wind");
    let deg;
    if (isWindMode) {
      // Target is the wind angle we hold to; already in boat frame.
      deg = state.target * RAD2DEG;
    } else if (state.heading != null) {
      // Compass / GPS / nav: target is absolute; subtract heading.
      let d = (state.target - state.heading) * RAD2DEG;
      // Normalise to (-180, 180] so the diamond takes the short way round.
      while (d >  180) d -= 360;
      while (d <= -180) d += 360;
      deg = d;
    } else {
      // No heading yet - cannot resolve; hide.
      g.style.display = "none";
      return;
    }
    g.setAttribute("transform", `rotate(${deg.toFixed(1)})`);
    g.style.display = "";
  }

  // Build an SVG arc path from compass angle a1 to a2 (degrees). r is radius.
  function arcPath(a1, a2, r) {
    const t1 = a1 * Math.PI / 180;
    const t2 = a2 * Math.PI / 180;
    const x1 = r * Math.sin(t1);
    const y1 = -r * Math.cos(t1);
    const x2 = r * Math.sin(t2);
    const y2 = -r * Math.cos(t2);
    const delta = a2 - a1;
    const largeArc = Math.abs(delta) > 180 ? 1 : 0;
    const sweep = delta > 0 ? 1 : 0;
    return `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${r},${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  }

  function renderEngage() {
    const el = $("#engage-toggle");
    if (!el) return;
    if (state.engaged) el.classList.add("engaged");
    else el.classList.remove("engaged");
    el.setAttribute("aria-pressed", state.engaged ? "true" : "false");
    // The center button is only meaningful with a rudder sensor and disengaged.
    // Show it just when we KNOW there is a rudder source and we are disengaged.
    // For now default to hidden; it will be revealed later when we track
    // rudder.source properly.
  }

  function renderNudgeLabels() {
    const s = state.nudgeSmall;
    const b = state.nudgeBig;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set("lbl-big-port",   "-" + b);
    set("lbl-small-port", "-" + s);
    set("lbl-small-star", "+" + s);
    set("lbl-big-star",   "+" + b);
  }

  function renderTackButton(tackState) {
    // Two per-side buttons now. If tack in progress, mark both as Cancel.
    const p = $("#tack-port-btn");
    const s = $("#tack-star-btn");
    if (!p || !s) return;
    const inProgress = tackState && tackState !== "none";
    for (const b of [p, s]) {
      if (inProgress) {
        b.classList.add("tack-active");
        b.querySelector(".lbl").textContent = "CANCEL";
        b.dataset.state = "cancel";
      } else {
        b.classList.remove("tack-active");
        b.querySelector(".lbl").textContent = "TACK";
        b.dataset.state = "tack";
      }
    }
  }

  function renderRudder(rad) {
    if (rad == null) { $("#rudder-widget").setAttribute("hidden", ""); return; }
    $("#rudder-widget").removeAttribute("hidden");
    const deg = rad * RAD2DEG;
    const pct = Math.max(-1, Math.min(1, deg / 45));
    const fill = $("#rudder-fill");
    fill.style.width = Math.abs(pct * 50) + "%";
    fill.style.transform = pct < 0 ? "translateX(-100%)" : "translateX(0%)";
    $("#rudder-value").textContent = deg.toFixed(1) + " deg";
  }

  // Rev36 helper: build a slider row with nudge buttons -10/-1/+1/+10.
  // Layout is two rows so long names never collide with the next row:
  //   [name .............................. value]
  //   [ -10 ] [ -1 ] [========slider========] [ +1 ] [ +10 ]
  // The nudge step is the slider's own `step`, so gain sliders (step 0.0001)
  // become truly fine-tuning and RangeSettings (step (max-min)/200) scale
  // naturally with their own range.
  function _buildSliderRow(opts) {
    // opts: { name, min, max, step, decimals, cur, onChange }
    const step = opts.step;
    const min = opts.min;
    const max = opts.max;
    const decimals = opts.decimals ?? 3;
    const clamp = (v) => Math.max(min, Math.min(max, v));
    const row = document.createElement("div");
    row.className = "gain-row";
    // Rev45: dedicated span for the baseline value shown in orange while
    // unlocked, so the user always sees "was: X" next to "now: Y".
    // Hidden until unlock captures a snapshot of the current value.
    row.innerHTML =
      `<div class="gain-top">` +
      `  <div class="name">${opts.name}</div>` +
      `  <div class="baseline" data-baseline="" hidden></div>` +
      `  <div class="value">${opts.cur == null ? "--" : Number(opts.cur).toFixed(decimals)}</div>` +
      `</div>` +
      `<div class="gain-bot">` +
      `  <button type="button" class="nudge-btn" data-nudge="-10" title="-10 steps">-10</button>` +
      `  <button type="button" class="nudge-btn" data-nudge="-1"  title="-1 step">-1</button>` +
      `  <input type="range" min="${min}" max="${max}" step="${step}" value="${opts.cur ?? min}">` +
      `  <button type="button" class="nudge-btn" data-nudge="1"  title="+1 step">+1</button>` +
      `  <button type="button" class="nudge-btn" data-nudge="10" title="+10 steps">+10</button>` +
      `</div>`;
    const rng = row.querySelector("input[type=range]");
    const val = row.querySelector(".value");
    // Rev45: expose the decimals count so _setTuneLocked can format the
    // baseline consistently with the live value.
    row.dataset.decimals = String(decimals);
    const commit = (v) => {
      rng.value = String(v);
      val.textContent = Number(v).toFixed(decimals);
      try { opts.onChange(Number(v)); } catch { /* silent */ }
    };
    rng.addEventListener("pointerdown", () => {
      document.body.classList.add("adjusting");
      row.classList.add("active");
    });
    rng.addEventListener("pointerup", () => {
      document.body.classList.remove("adjusting");
      row.classList.remove("active");
    });
    rng.addEventListener("input", () => { val.textContent = Number(rng.value).toFixed(decimals); });
    rng.addEventListener("change", () => { try { opts.onChange(Number(rng.value)); } catch { /* silent */ } });
    row.querySelectorAll(".nudge-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = Number(btn.getAttribute("data-nudge"));
        const cur = Number(rng.value) || 0;
        const next = clamp(cur + k * step);
        commit(next);
      });
    });
    // Rev42: apply current lock state to the freshly-built controls.
    const unlockCb = document.getElementById("tune-unlock");
    const locked = !(unlockCb && unlockCb.checked);
    if (locked) {
      rng.setAttribute("disabled", "");
      row.querySelectorAll(".nudge-btn").forEach((b) => b.setAttribute("disabled", ""));
    }
    return { row, rng, val, commit };
  }

  // Rev20/21: render "Configuration" RangeSetting sliders below gains.
  // Reads current values from state.pypilotValues (populated by /values fetch).
  // Rev36: uses _buildSliderRow so RangeSettings get the nudge buttons too.
  function renderConfigSliders() {
    const cont = $("#config-sliders");
    if (!cont) return;
    cont.textContent = "";
    const cat = state.catalog;
    if (!cat) return;
    const names = Object.keys(cat).filter((k) => cat[k]?.type === "RangeSetting");
    names.sort();
    for (const name of names) {
      const meta = cat[name];
      const step = (meta.max - meta.min) / 200 || 0.001;
      const cur = (state.pypilotValues || {})[name];
      const { row } = _buildSliderRow({
        name,
        min: meta.min, max: meta.max, step,
        decimals: 3,
        cur,
        onChange: (v) => pluginRaw(name, v),
      });
      row.dataset.pypilot = name;
      cont.appendChild(row);
    }
  }

  // Rev36: /values requires SK auth. Was fetched as plain (no JWT) so the
  // response was 401 on Tunatunes and state.pypilotValues stayed empty
  // forever - which is why the Ajustes sliders never showed real positions.
  // Now uses skFetch (adds JWT if we have one), retries with backoff, and
  // opens the login modal after 3 consecutive 401s.
  let _refreshValues401Streak = 0;
  async function refreshPypilotValues() {
    try {
      const r = await skFetch(`/plugins/${PLUGIN_ID}/values`);
      if (!r.ok) {
        if (r.status === 401) {
          _refreshValues401Streak++;
          if (_refreshValues401Streak >= 3) {
            openLoginModal("Signal K login required to load current pypilot values (Ajustes tab).");
            _refreshValues401Streak = 0;
          }
        }
        return;
      }
      _refreshValues401Streak = 0;
      state.pypilotValues = await r.json();
      // Refresh anything that depends on it.
      renderConfigSliders();
      // Populate Calibration inputs on Setup tab.
      const off = $("#cal-heading-offset");
      if (off && state.pypilotValues["imu.heading_offset"] != null) off.value = String(state.pypilotValues["imu.heading_offset"]);
      const rr  = $("#cal-rud-range");
      if (rr  && state.pypilotValues["rudder.range"] != null)      rr.value  = String(state.pypilotValues["rudder.range"]);
      // Refresh gain slider positions in case the initial render was before values arrived.
      for (const g of Object.keys(state.pypilotValues)) {
        if (g.startsWith("ap.pilot.") && state.catalog?.[g]?.AutopilotGain) {
          // Rev63 / 2.0.0: verbatim path derivation, same as publisher.ts.
          const skPath = `steering.autopilot.pypilot.${g}`;
          const row = document.querySelector(`.gain-row[data-sk="${skPath}"]`);
          if (row) {
            const rng = row.querySelector("input[type=range]");
            const lbl = row.querySelector(".value");
            const v = Number(state.pypilotValues[g]);
            if (Number.isFinite(v) && !row.classList.contains("active")) {
              if (rng) rng.value = String(v);
              if (lbl) lbl.textContent = v.toFixed(4);
            }
          }
        }
      }
    } catch (e) { /* silent */ }
  }

  function renderGains() {
    const cont = $("#gains-container");
    cont.textContent = "";
    const cat = state.catalog;
    const pilot = state.pilot;
    renderConfigSliders();
    if (!pilot) return;
    // Rev38: pull fresh values shortly after (re-)rendering so the sliders
    // always reflect what pypilot has now, not what was cached in the SK
    // stream when the previous pilot/profile was active.
    setTimeout(refreshPypilotValues, 300);
    // pypilot exposes gains as ap.pilot.<pilot>.<gain> (singular).
    const gains = Object.keys(cat).filter((k) =>
      k.startsWith(`ap.pilot.${pilot}.`) && cat[k].AutopilotGain
    );
    for (const g of gains) {
      const meta = cat[g];
      const shortName = g.split(".").slice(3).join(".");
      // Rev63 / 2.0.0: verbatim path (`steering.autopilot.pypilot.ap.pilot.<pilot>.<gain>`).
      const skPath = `steering.autopilot.pypilot.${g}`;
      const cur = state.values[skPath];
      // Rev36: use shared _buildSliderRow (2-row layout + nudge buttons).
      const { row, rng, val } = _buildSliderRow({
        name: shortName,
        min: meta.min, max: meta.max, step: 0.0001,
        decimals: 4,
        cur,
        onChange: (v) => pluginRaw(g, v),
      });
      row.dataset.pypilot = g;
      row.dataset.sk = skPath;
      cont.appendChild(row);
      // If cache is empty (stream started after gain deltas were emitted),
      // fetch the current value via REST so the slider position reflects
      // reality on first paint.
      if (cur == null) {
        skFetch(`/signalk/v1/api/vessels/self/${skPath.replace(/\./g, "/")}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!j) return;
            const v = j.value ?? (j.values && j.values.value);
            if (typeof v === "number") {
              state.values[skPath] = v;
              if (!row.classList.contains("active")) rng.value = String(v);
              val.textContent = v.toFixed(4);
            }
          })
          .catch(() => {});
      }
    }
  }

  function fillSelect(sel, list) {
    const el = $(sel);
    if (!el) return;
    const prev = el.value;
    el.textContent = "";
    for (const v of list) {
      const o = document.createElement("option");
      o.value = String(v); o.textContent = String(v);
      el.appendChild(o);
    }
    if (list.includes(prev)) el.value = prev;
  }

  function setSelect(sel, value) {
    const el = $(sel);
    if (el) el.value = String(value == null ? "" : value);
  }

  // ---- SK writes via OUR PLUGIN endpoints (Rev15) ----
  // All writes go through /plugins/signalk-pypilot-newui/ap/* which internally
  // delegate to either the AutopilotProvider (when absorbProvider=true) or
  // straight to the pypilot socket.io. This bypasses the stricter permission
  // wall SK enforces on /signalk/v2/api/vessels/self/autopilots/*/* and uses
  // the same auth level as our /status endpoint. If you can GET /status, you
  // can also engage / set mode / set target.

  async function discoverAutopilot() {
    try {
      // Always fetch fresh - do not trust cache in case the user switched
      // providers via SK Admin without reloading the webapp.
      const res = await fetch("/signalk/v2/api/vessels/self/autopilots?_=" + Date.now(), { credentials: "include", cache: "no-store" });
      if (!res.ok) { console.warn("[pypilot-newui] /autopilots HTTP", res.status); return; }
      const j = await res.json();
      const entries = Object.entries(j || {});
      if (!entries.length) { console.warn("[pypilot-newui] /autopilots returned no providers"); return; }
      // Prefer isDefault, then our own id, then any available.
      let picked = "";
      for (const [id, info] of entries) {
        if (info?.isDefault) { picked = id; break; }
      }
      if (!picked) {
        for (const [id] of entries) {
          if (id === "pypilot-newui") { picked = id; break; }
        }
      }
      if (!picked) picked = entries[0][0];
      state.autopilotId = picked;
      console.info("[pypilot-newui] autopilotId =", picked, "(from", entries.map(e => e[0]).join(","), ")");
    } catch (e) { console.warn("discoverAutopilot failed", e); }
  }

  // ---- SK auth: JWT token cached in localStorage (Rev17) ----
  // The webapp obtains a JWT via POST /signalk/v1/auth/login {username,password}
  // and sends it as `Authorization: JWT <token>` on every write. This works
  // regardless of the browser cookie state and regardless of tab/session
  // quirks. The token is saved in localStorage so the user only logs in once.
  const TOKEN_KEY = "pypilot-newui.jwt";
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }
  function authHeaders() {
    const t = getToken();
    return t ? { "Authorization": `JWT ${t}` } : {};
  }
  async function skFetch(url, opts) {
    const o = opts || {};
    const merged = {
      ...o,
      credentials: "include",
      headers: { ...(o.headers || {}), ...authHeaders() },
    };
    return fetch(url, merged);
  }

  function openLoginModal(prefillMsg) {
    const m = $("#login-modal");
    if (!m) return;
    m.removeAttribute("hidden");
    const err = $("#login-error");
    if (err) err.textContent = prefillMsg || "";
    const u = $("#login-user"); if (u && !u.value) u.value = "tunatunes";
    const p = $("#login-pass"); if (p) p.focus();
  }
  function closeLoginModal() {
    const m = $("#login-modal");
    if (m) m.setAttribute("hidden", "");
  }
  async function doLogin() {
    const u = $("#login-user").value.trim();
    const p = $("#login-pass").value;
    const err = $("#login-error");
    if (!u || !p) { if (err) err.textContent = "Both fields required"; return; }
    try {
      const r = await fetch("/signalk/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        if (err) err.textContent = `Login failed (${r.status}) ${txt}`;
        return;
      }
      const j = await r.json();
      if (j?.token) {
        setToken(j.token);
        closeLoginModal();
        console.info("[pypilot-newui] JWT saved, writes should work now");
      } else {
        if (err) err.textContent = "Login OK but no token in response";
      }
    } catch (e) {
      if (err) err.textContent = "Network error: " + e;
    }
  }

  function handleAuthWrite(res) {
    if (!res) return res;
    if (res.status === 401) {
      console.warn(`[pypilot-newui] auth 401 on:`, res.url);
      openLoginModal("Your saved token expired or was rejected - re-enter your password.");
    } else if (res.status < 400) {
      console.info(`[pypilot-newui] write ok ${res.status}:`, res.url);
    } else {
      console.warn(`[pypilot-newui] write failed ${res.status}:`, res.url);
    }
    return res;
  }
  function handleAuthRead(res) { return res; }
  const handleAuth = handleAuthWrite;

  // Writes go via the SK Autopilot API v2. Confirmed working with Carlos's
  // session cookie in Rev7-Rev14. The /plugins/*/ap/* endpoints exist in the
  // backend as an alternative (for scripts or headless clients) but the webapp
  // uses the v2 API because that is what the SK security policy on Tunatunes
  // grants writes for.
  //
  //   POST /signalk/v2/api/vessels/self/autopilots/<id>/engage
  //   POST /signalk/v2/api/vessels/self/autopilots/<id>/disengage
  //   PUT  /signalk/v2/api/vessels/self/autopilots/<id>/mode      {"value":"compass"}
  //   PUT  /signalk/v2/api/vessels/self/autopilots/<id>/target    {"value":<rad>}
  //   POST /signalk/v2/api/vessels/self/autopilots/<id>/tack/{port|starboard}
  async function ensureAutopilotId() {
    if (!state.autopilotId) await discoverAutopilot();
    if (!state.autopilotId) {
      alert("No SK autopilot provider detected. Enable 'PyPilot New-UI' in SK Admin (or disable then re-enable it) so the provider registers.");
      return false;
    }
    return true;
  }
  async function apEngage() {
    if (!await ensureAutopilotId()) return;
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/engage`;
    return handleAuth(await skFetch(url, { method: "POST" }));
  }
  async function apDisengage() {
    if (!await ensureAutopilotId()) return;
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/disengage`;
    return handleAuth(await skFetch(url, { method: "POST" }));
  }
  async function apSetMode(mode) {
    if (!await ensureAutopilotId()) return;
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/mode`;
    return handleAuth(await skFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: mode }),
    }));
  }
  async function apSetTargetRad(rad) {
    if (!await ensureAutopilotId()) return;
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/target`;
    return handleAuth(await skFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: rad }),
    }));
  }
  async function apTack(direction) {
    if (!await ensureAutopilotId()) return;
    const url = `/signalk/v2/api/vessels/self/autopilots/${state.autopilotId}/tack/${direction}`;
    return handleAuth(await skFetch(url, { method: "POST" }));
  }

  // For pypilot-specific paths that the Autopilot API does NOT cover (gains,
  // profiles, calibration, tack detail), route through our own /raw endpoint.
  async function pluginRaw(name, value) {
    const url = `/plugins/${PLUGIN_ID}/raw`;
    const res = await skFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
    handleAuth(res);
    if (!res.ok) console.warn("raw PUT failed", name, res.status, await res.text());
    return res;
  }

  // ---- Control tab wiring ----
  function wireControl() {
    // Nudges. Use a local accumulator like the pypilot upstream JS so quick
    // successive presses don't rubber-band against the server value.
    // Kinds: big-port (-nudgeBig), small-port (-nudgeSmall), small-star (+nudgeSmall), big-star (+nudgeBig).
    const kindToDelta = () => ({
      "big-port":   -state.nudgeBig,
      "small-port": -state.nudgeSmall,
      "small-star":  state.nudgeSmall,
      "big-star":    state.nudgeBig,
    });
    $$(".steer-btn[data-nudge-kind]").forEach((b) => {
      b.addEventListener("click", () => {
        const nudge = kindToDelta()[b.dataset.nudgeKind];
        if (nudge == null) return;
        const now = Date.now();
        if (!state.engaged) {
          b.animate([{ transform: "scale(1)" }, { transform: "scale(0.94)" }, { transform: "scale(1)" }], { duration: 180 });
          return;
        }
        if (now - state.lastNudgeTs > 1000 || state.localTargetRad == null) {
          state.localTargetRad = state.target ?? state.heading;
        }
        state.lastNudgeTs = now;
        const sign = String(state.mode || "").includes("wind") ? -1 : 1;
        const newTargetRad = (state.localTargetRad ?? 0) + sign * nudge * DEG2RAD;
        state.localTargetRad = newTargetRad;
        apSetTargetRad(newTargetRad);
      });
    });

    // Engage / disengage via Autopilot API v2.
    // Rev56: over Tailscale the first click sometimes lost the POST silently
    // (RTT spike / packet drop) and Carlos had to press twice. Now the UI
    // flips OPTIMISTICALLY on click so the intent is visible instantly, and
    // the backend call retries once automatically on any failure. A pending
    // guard blocks double-taps from firing two opposite POSTs.
    const eng = $("#engage-toggle");
    let _apPending = false;
    const _apRetry = async (fn) => {
      // Try twice: first attempt, then a 400ms-delayed retry on any error/non-2xx.
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fn();
          if (r && r.ok) return r;
        } catch (_) { /* network flake, retry */ }
        if (i === 0) await new Promise((res) => setTimeout(res, 400));
      }
      return null;
    };
    const doEngage = async () => {
      if (_apPending) return;
      _apPending = true;
      eng.classList.add("pending");
      const wasEngaged = state.engaged;
      // Optimistic: flip the visual state before waiting on the network.
      state.engaged = !wasEngaged;
      renderEngage();
      let ok = false;
      try {
        if (wasEngaged) {
          const r = await _apRetry(apDisengage);
          ok = !!(r && r.ok);
        } else {
          // Fire target-set + engage in PARALLEL so a slow Tailscale RTT
          // does not serialise 2 round-trips before the AP actually engages.
          const [rEng, rTgt] = await Promise.all([
            _apRetry(apEngage),
            state.heading != null ? _apRetry(() => apSetTargetRad(state.heading)) : Promise.resolve({ ok: true }),
          ]);
          ok = !!(rEng && rEng.ok);
          if (rTgt && rTgt.ok && state.heading != null) {
            state.target = state.heading;
            state.localTargetRad = state.heading;
            renderControl();
          }
        }
      } catch (_) { ok = false; }
      if (!ok) {
        // Revert the optimistic flip so the UI reflects reality.
        state.engaged = wasEngaged;
        renderEngage();
        eng.classList.add("failed");
        setTimeout(() => eng.classList.remove("failed"), 1500);
      }
      eng.classList.remove("pending");
      _apPending = false;
    };
    eng.addEventListener("click", doEngage);
    eng.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doEngage(); }
    });

    // Mode change
    $("#mode-select").addEventListener("change", (e) => {
      apSetMode(e.target.value);
    });

    // Tack per side. If tack in progress, both act as Cancel.
    const tackHandler = (dir) => async () => {
      const st = $("#tack-port-btn").dataset.state;
      if (st === "cancel") {
        pluginRaw("ap.tack.state", "none");
      } else {
        apTack(dir);
      }
    };
    $("#tack-port-btn").addEventListener("click", tackHandler("port"));
    $("#tack-star-btn").addEventListener("click", tackHandler("starboard"));

    // Center rudder (disengaged only, hidden until we detect rudder.source)
    const centerBtn = $("#center-btn");
    if (centerBtn) centerBtn.addEventListener("click", () => pluginRaw("servo.position", 0));

    // Rev21: calibration dropdown removed from Control tab. Access via
    // Setup > Calibration section instead.
  }

  // ---- Tune tab wiring ----
  function wireTune() {
    // Rev42: unlock tick for gain / config sliders. Default OFF. Re-locks
    // automatically on each tab re-entry (see _tabPostActivate).
    const unlockCb = $("#tune-unlock");
    if (unlockCb) {
      unlockCb.checked = false;
      unlockCb.addEventListener("change", (e) => {
        _setTuneLocked(!e.target.checked);
      });
    }
    $("#pilot-select").addEventListener("change", (e) => {
      pluginRaw("ap.pilot", e.target.value);
    });
    $("#profile-select").addEventListener("change", (e) => {
      pluginRaw("profile", e.target.value);
    });
    $("#profile-add").addEventListener("click", async () => {
      const name = prompt(t("prompt.profileName"));
      if (!name) return;
      if (state.profiles.includes(name)) return alert("Already exists");
      await pluginRaw("profile", name);
    });
    $("#profile-remove").addEventListener("click", async () => {
      if (!confirm(t("confirm.removeProfile"))) return;
      const remaining = state.profiles.filter((p) => p !== state.profile);
      await pluginRaw("profiles", remaining);
    });
    $("#cal-level").addEventListener("click", () => {
      pluginRaw("imu.alignmentCounter", 100);
    });
    $("#cal-heading-offset").addEventListener("change", (e) => {
      pluginRaw("imu.heading_offset", Number(e.target.value));
    });
    $("#cal-rud-centered").addEventListener("click", () => pluginRaw("rudder.calibration_state", "centered"));
    $("#cal-rud-port")    .addEventListener("click", () => pluginRaw("rudder.calibration_state", "port range"));
    $("#cal-rud-star")    .addEventListener("click", () => pluginRaw("rudder.calibration_state", "starboard range"));
    $("#cal-rud-reset")   .addEventListener("click", () => pluginRaw("rudder.calibration_state", "reset"));
    $("#cal-rud-range")   .addEventListener("change", (e) => pluginRaw("rudder.range", Number(e.target.value)));
  }

  // ---- Paths tab ----
  let _lastPathsItems = [];
  let _lastEnabledMap = {};

  let _publishOnlyEssentials = true;

  async function refreshPaths() {
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/paths`, { credentials: "include" });
      const j = await res.json();
      _lastPathsItems = j.items || [];
      _lastEnabledMap = j.enabledPaths || {};
      _publishOnlyEssentials = !!j.publishOnlyEssentials;
      const cb = $("#cfg-only-essentials");
      if (cb) cb.checked = _publishOnlyEssentials;
      renderPathsTable();
    } catch (e) {
      console.warn("paths fetch failed", e);
    }
  }

  function renderPathsTable() {
    const tb = $("#paths-table tbody");
    if (!tb) return;
    tb.textContent = "";
    const filter = ($("#paths-search")?.value || "").toLowerCase().trim();
    let shown = 0;
    for (const it of _lastPathsItems) {
      if (filter && !(
        it.skPath.toLowerCase().includes(filter) ||
        it.pypilotName.toLowerCase().includes(filter) ||
        (it.displayName || "").toLowerCase().includes(filter)
      )) continue;
      shown++;
      const tr = document.createElement("tr");
      const isEssential = !!it.essential;
      // Rev23: checkbox reflects whether this path is currently being published.
      // Semantics differ per mode:
      //   publishOnlyEssentials=true  -> checkbox checked if explicitly true in enabledPaths
      //   publishOnlyEssentials=false -> checkbox checked unless explicitly false
      let checked;
      if (isEssential) checked = true;
      else if (_publishOnlyEssentials) checked = _lastEnabledMap[it.pypilotName] === true;
      else checked = _lastEnabledMap[it.pypilotName] !== false;
      const disabledAttr = isEssential ? "disabled" : "";
      const essBadge = isEssential ? ' <span style="color:var(--warn); font-size:10px; font-weight:700;">ESSENTIAL</span>' : '';
      tr.innerHTML =
        `<td><input type="checkbox" class="publish-toggle" data-name="${it.pypilotName}" ${checked ? "checked" : ""} ${disabledAttr} /></td>` +
        `<td class="path">${it.skPath}${essBadge}</td>` +
        `<td>${it.units || ""}</td>` +
        `<td class="put">${it.put ? "yes" : ""}</td>` +
        `<td><button class="copy" data-copy="${it.skPath}">${t("paths.copy")}</button></td>`;
      tb.appendChild(tr);
    }
    const counter = $("#paths-counter");
    if (counter) counter.textContent = `${shown} / ${_lastPathsItems.length}`;

    tb.querySelectorAll("button.copy").forEach((b) => {
      b.addEventListener("click", () => {
        navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = "OK";
        setTimeout(() => (b.textContent = t("paths.copy")), 800);
      });
    });
    // Rev24: also wire the static KIP-actions table copy buttons (they live
    // in the DOM outside the injected tbody).
    document.querySelectorAll("#tab-paths > .setup-block button.copy").forEach((b) => {
      if (b.__wired) return;
      b.__wired = true;
      b.addEventListener("click", () => {
        navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = "OK";
        setTimeout(() => (b.textContent = "Copy"), 800);
      });
    });
    // Rev21/22: hot-apply on change, feedback on failed persist.
    tb.querySelectorAll(".publish-toggle").forEach((cb) => {
      if (cb.disabled) return;
      cb.addEventListener("change", async () => {
        const map = { ..._lastEnabledMap };
        map[cb.dataset.name] = cb.checked;
        _lastEnabledMap = map;
        try {
          const r = await skFetch(`/plugins/${PLUGIN_ID}/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabledPaths: map }),
          });
          if (!r.ok) {
            console.warn("publish hot-apply HTTP", r.status);
            cb.checked = !cb.checked; // revert visual state
            return;
          }
          const j = await r.json();
          if (j.persisted === false) {
            console.warn("publish hot-apply not persisted:", j.warning);
            alert("Change applied in memory but not persisted. Warning: " + (j.warning || "unknown"));
          }
        } catch (e) {
          console.warn("publish hot-apply failed", e);
          cb.checked = !cb.checked;
        }
      });
    });
  }

  // ---- Setup tab ----
  async function loadStatus() {
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/status`, { credentials: "include" });
      handleAuthRead(res);
      if (!res.ok) throw new Error("status " + res.status);
      const j = await res.json();
      $("#setup-status").textContent = JSON.stringify(j, null, 2);
      $("#rev-tag").textContent = `PyPilot New-UI ${j.revision || ""}`;
      if (typeof j.nudgeSmall === "number") state.nudgeSmall = j.nudgeSmall;
      if (typeof j.nudgeBig === "number")   state.nudgeBig   = j.nudgeBig;
      renderNudgeLabels();
      // Prefill the Setup tab nudge inputs
      const ns = $("#cfg-nudge-small"); if (ns) ns.value = String(state.nudgeSmall);
      const nb = $("#cfg-nudge-big");   if (nb) nb.value = String(state.nudgeBig);
      // Prefill host/port too
      if (typeof j.host === "string") { const h = $("#cfg-host"); if (h) h.value = j.host; }
      if (typeof j.port === "number") { const p = $("#cfg-port"); if (p) p.value = String(j.port); }
      // Prefill absorbProvider toggle
      const ab = $("#cfg-absorb"); if (ab) ab.checked = !!j.absorbProvider;
      // Rev55: SSH creds - prefill user, mask password (only show if set).
      const su = $("#cfg-ssh-user"); if (su) su.value = j.sshUser || "tc";
      const sp = $("#cfg-ssh-password");
      if (sp) sp.placeholder = t(j.sshPasswordSet ? "setup.ssh.password.ph.set" : "setup.ssh.password.ph.notset");
      const sst = $("#cfg-ssh-status");
      if (sst) sst.innerHTML = j.sshPasswordSet
        ? `<span style="color:#2ecc71">${t("setup.ssh.status.set")}</span> — <code>${j.sshUser || "tc"}@${j.host}</code>. ${t("setup.ssh.status.enabled")}`
        : `<span style="color:#f3c812">${t("setup.ssh.status.notset")}</span> ${t("setup.ssh.status.reconnectOnly")}`;
      if (j.host) {
        const a = $("#link-oldui-a");
        a.href = `http://${j.host}:${j.port}/`;
        a.textContent = `Classic pypilot UI ${j.host}:${j.port}`;
      }
      // Rev59: also feed the Info tab header (visible version + link to
      // the classic pypilot_web UI on the TinyPilot).
      const iv = document.getElementById("info-version");
      if (iv) {
        const ver = j.version ? `v${j.version}` : "";
        const rev = j.revision || "";
        iv.textContent = [ver, rev].filter(Boolean).join(" · ");
      }
      const io = document.getElementById("info-oldui-link");
      if (io && j.host) {
        io.href = `http://${j.host}:${j.port}/`;
        io.textContent = `Interfaz clásica pypilot (${j.host}:${j.port})`;
      }
    } catch (e) {
      $("#setup-status").textContent = "status endpoint unreachable";
    }
    try {
      const res2 = await fetch(`/plugins/${PLUGIN_ID}/catalog`, { credentials: "include" });
      handleAuthRead(res2);
      if (res2.ok) {
        state.catalog = await res2.json();
        renderGains();
      }
    } catch { /* ignore */ }
  }

  // Rev55: merge-save the plugin config. Reads the FULL current config
  // from /skServer/plugins/<id>/config (requires admin JWT - includes the
  // SSH password), overlays only the fields in `patch`, POSTs back. This
  // way, editing one section (e.g. nudge) never wipes another (e.g. SSH
  // creds) that /plugins/<id>/status intentionally omits.
  async function _pluginConfigMerge(patch) {
    const full = await skFetch(`/skServer/plugins/${PLUGIN_ID}/config`);
    if (!full.ok) throw new Error("GET config " + full.status);
    const cur = await full.json();
    const configuration = { ...(cur?.configuration || {}), ...patch };
    const res = await skFetch(`/skServer/plugins/${PLUGIN_ID}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, configuration }),
    });
    if (!res.ok) throw new Error("POST config " + res.status + " " + (await res.text().catch(() => "")));
  }

  async function applyNudgeCfg() {
    const s = Number($("#cfg-nudge-small").value) || 1;
    const b = Number($("#cfg-nudge-big").value) || 10;
    try {
      await _pluginConfigMerge({ nudgeSmall: s, nudgeBig: b });
      state.nudgeSmall = s; state.nudgeBig = b;
      renderNudgeLabels();
      alert(t("alert.nudgeSaved"));
    } catch (e) {
      alert(t("alert.saveFail") + "\n" + e);
    }
  }

  async function scan() {
    $("#scan-results").textContent = t("setup.scan.scanning");
    const subnet = $("#scan-subnet").value.trim();
    const q = subnet ? `?subnet=${encodeURIComponent(subnet)}` : "";
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/scan${q}`, { credentials: "include" });
      const j = await res.json();
      const el = $("#scan-results");
      el.textContent = "";
      const hits = j.hits || [];
      if (!hits.length) { el.textContent = t("setup.scan.none"); return; }
      for (const h of hits) {
        const d = document.createElement("div");
        d.className = "scan-hit";
        d.innerHTML = `<span>${h.ip}:${h.port} (${h.hint})</span><button data-ip="${h.ip}" data-port="${h.port}">Use</button>`;
        d.querySelector("button").addEventListener("click", () => {
          $("#cfg-host").value = h.ip;
          $("#cfg-port").value = String(h.port);
        });
        el.appendChild(d);
      }
    } catch (e) {
      $("#scan-results").textContent = t("setup.scan.failed");
    }
  }

  async function applyCfg() {
    const host = $("#cfg-host").value.trim();
    const port = Number($("#cfg-port").value) || 80;
    if (!host) return alert(t("alert.hostRequired"));
    try {
      await _pluginConfigMerge({ host, port });
      alert(t("alert.configApplied"));
      setTimeout(loadStatus, 3500);
    } catch (e) {
      alert(t("alert.configFail") + "\n" + e);
    }
  }

  function wireSetup() {
    $("#scan-btn").addEventListener("click", scan);
    $("#cfg-apply").addEventListener("click", applyCfg);
    $("#paths-refresh").addEventListener("click", refreshPaths);
    const nb = $("#cfg-nudge-apply"); if (nb) nb.addEventListener("click", applyNudgeCfg);
    const langSel = $("#lang-select");
    if (langSel) {
      langSel.value = currentLang();
      langSel.addEventListener("change", (e) => setLang(e.target.value));
    }
    // Rev63 / 2.0.0 - three escalated restart levels sharing a common
    // helm-manned confirmation modal + a shared status line. Level 2 is
    // the classic RESTART pypilot (existing /restart-pypilot endpoint);
    // levels 1 and 3 hit the new /debug-cmd whitelist with presets
    // "restart.web" and "reboot.pi" respectively.
    const rpStatus = $("#cli-restart-status");
    const runRestartLevel = async (btn, opts) => {
      // opts: { titleKey, outageKey, durationLabel, endpoint }
      const ok = await askHelmConfirm({
        titleKey: opts.titleKey,
        outageKey: opts.outageKey,
        duration: opts.durationLabel,
      });
      if (!ok) return;
      if (rpStatus) rpStatus.textContent = t("setup.restart.wait");
      btn.disabled = true;
      try {
        let res, j;
        if (opts.endpoint === "restart-pypilot") {
          res = await skFetch(`/plugins/${PLUGIN_ID}/restart-pypilot`, { method: "POST" });
        } else {
          res = await skFetch(`/plugins/${PLUGIN_ID}/debug-cmd`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preset: opts.endpoint }),
          });
        }
        j = await res.json().catch(() => ({}));
        if (res.ok && j.ok) {
          if (rpStatus) rpStatus.innerHTML = `<span style="color:#2ecc71">✓ ${t("setup.restart.ok")}</span> ${t("setup.restart.reconnecting")}`;
        } else if (res.status === 202 && j.hint) {
          if (rpStatus) rpStatus.innerHTML = `<span style="color:#f3c812">⚠ ${t("setup.restart.notConfigured")}</span> ${t("setup.restart.reconnectOnly")}<br/><small>${j.hint}</small>`;
        } else {
          if (rpStatus) rpStatus.innerHTML = `<span style="color:#e74c3c">✗ ${t("setup.restart.error")} ${res.status}:</span> ${j.error || j.detail || "unknown"}`;
        }
      } catch (e) {
        if (rpStatus) rpStatus.innerHTML = `<span style="color:#e74c3c">✗ ${t("setup.restart.network")}:</span> ${e}`;
      } finally {
        setTimeout(() => { btn.disabled = false; }, 3000);
      }
    };
    const btnWeb  = $("#btn-restart-web");
    const btnPyp  = $("#cli-restart-pypilot");
    const btnPi   = $("#btn-reboot-pi");
    if (btnWeb) btnWeb.addEventListener("click", () => runRestartLevel(btnWeb, {
      titleKey: "setup.restart.web.title",
      outageKey: "setup.restart.outage.web",
      durationLabel: "~3-5 s",
      endpoint: "restart.web",
    }));
    if (btnPyp) btnPyp.addEventListener("click", () => runRestartLevel(btnPyp, {
      titleKey: "setup.restart.pypilot.title",
      outageKey: "setup.restart.outage.pypilot",
      durationLabel: "~10-15 s",
      endpoint: "restart-pypilot",
    }));
    if (btnPi) btnPi.addEventListener("click", () => runRestartLevel(btnPi, {
      titleKey: "setup.restart.reboot.title",
      outageKey: "setup.restart.outage.reboot",
      durationLabel: "~35-60 s",
      endpoint: "reboot.pi",
    }));

    // Rev63 / 2.0.0 - Debug console. Preset buttons + textarea + follow
    // polling + copy/share via existing helpers.
    const dbgOut  = $("#debug-output");
    const dbgStat = $("#debug-status");
    let _dbgFollowTimer = null;
    const runDebugPreset = async (preset) => {
      if (dbgStat) dbgStat.textContent = t("setup.debug.running");
      try {
        const res = await skFetch(`/plugins/${PLUGIN_ID}/debug-cmd`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 202 && j.hint) {
          if (dbgOut) dbgOut.value = t("setup.debug.noSsh") + "\n\n" + (j.hint || "");
          if (dbgStat) dbgStat.textContent = t("setup.debug.failed");
          return;
        }
        if (dbgOut) dbgOut.value = (j.stdout || "").trim();
        if (dbgStat) dbgStat.textContent = `${t(j.ok ? "setup.debug.ok" : "setup.debug.failed")} (${j.elapsedMs || 0} ms, exit ${j.code ?? "?"})`;
      } catch (e) {
        if (dbgOut) dbgOut.value = "" + e;
        if (dbgStat) dbgStat.textContent = t("setup.debug.failed");
      }
    };
    $$(".debug-preset").forEach((b) => {
      b.addEventListener("click", () => runDebugPreset(b.dataset.preset));
    });
    const dbgFollow = $("#debug-follow");
    if (dbgFollow) dbgFollow.addEventListener("change", () => {
      if (_dbgFollowTimer) { clearInterval(_dbgFollowTimer); _dbgFollowTimer = null; }
      if (dbgFollow.checked) {
        runDebugPreset("logs.follow");
        _dbgFollowTimer = setInterval(() => runDebugPreset("logs.follow"), 3000);
      }
    });
    const dbgCopy = $("#debug-copy");
    if (dbgCopy) dbgCopy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(dbgOut?.value || ""); if (dbgStat) dbgStat.textContent = t("info.cfg.copied"); }
      catch (e) { if (dbgStat) dbgStat.textContent = t("info.cfg.copyFail"); }
    });
    const dbgSend = $("#debug-send");
    if (dbgSend) dbgSend.addEventListener("click", async () => {
      const text = dbgOut?.value || "";
      if (!text) return;
      try {
        if (navigator.share) {
          await navigator.share({ title: "pypilot-newui debug", text });
          if (dbgStat) dbgStat.textContent = t("info.cfg.shared");
          return;
        }
      } catch (e) { if (String(e).includes("AbortError")) { if (dbgStat) dbgStat.textContent = t("info.cfg.cancelled"); return; } }
      _downloadFile(`pypilot-newui-debug-${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.txt`, text);
      if (dbgStat) dbgStat.textContent = t("info.cfg.downloaded");
    });
    const dbgClear = $("#debug-clear");
    if (dbgClear) dbgClear.addEventListener("click", () => {
      if (dbgOut) dbgOut.value = "";
      if (dbgStat) dbgStat.textContent = "";
    });
    const ab = $("#cfg-absorb-apply"); if (ab) ab.addEventListener("click", applyAbsorbCfg);
    // Rev55: Save SSH creds (user + password) into plugin config.
    // Password field must be typed each time - SK returns only sshPasswordSet
    // (boolean flag), never the actual password, so a "keep existing" mode
    // would silently drop it if the user only edits the SSH user field.
    const sshBtn = $("#cfg-ssh-save");
    if (sshBtn) sshBtn.addEventListener("click", async () => {
      const sshUser = ($("#cfg-ssh-user")?.value || "tc").trim() || "tc";
      const sshPassword = $("#cfg-ssh-password")?.value || "";
      const sst = $("#cfg-ssh-status");
      if (!sshPassword) {
        if (sst) sst.innerHTML = `<span style="color:#e74c3c">${t("setup.ssh.status.emptyPwd")}</span>`;
        return;
      }
      if (sst) sst.textContent = t("setup.ssh.status.saving");
      sshBtn.disabled = true;
      try {
        await _pluginConfigMerge({ sshUser, sshPassword });
        if (sst) sst.innerHTML = `<span style="color:#2ecc71">${t("setup.ssh.status.savedRestarting")}</span>`;
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        if (sst) sst.innerHTML = `<span style="color:#e74c3c">${t("setup.restart.error")}:</span> ${e}`;
      } finally {
        sshBtn.disabled = false;
      }
    });
  }

  async function applyAbsorbCfg() {
    const absorbProvider = !!$("#cfg-absorb").checked;
    try {
      await _pluginConfigMerge({ absorbProvider });
      alert(absorbProvider ? t("alert.absorb.on") : t("alert.absorb.off"));
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      alert(t("alert.saveFail") + "\n" + e);
    }
  }

  // Rev63 / 2.0.0 - helm-manned confirmation modal used by the 3
  // escalated restart levels. Fills the shared modal in index.html with
  // the level-specific title, outage duration and scope, then returns a
  // Promise that resolves to true (user confirmed) or false (cancelled).
  // Cancelling via Cancel button, click outside, or Escape all resolve
  // false so a helm operator never confirms by accident.
  function askHelmConfirm({ titleKey, outageKey, duration }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("helm-confirm-pop");
      const titleEl = document.getElementById("helm-modal-title");
      const durEl   = document.getElementById("helm-modal-duration");
      const scopeEl = document.getElementById("helm-modal-scope");
      const cancel  = document.getElementById("helm-cancel");
      const confirm = document.getElementById("helm-confirm");
      if (!overlay || !titleEl || !durEl || !scopeEl || !cancel || !confirm) {
        resolve(false); return;
      }
      titleEl.innerHTML = `&#9888; ${t(titleKey)}`;
      durEl.textContent = duration;
      scopeEl.textContent = t(outageKey);
      const cleanup = () => {
        overlay.classList.remove("open");
        cancel.removeEventListener("click",  onCancel);
        confirm.removeEventListener("click", onConfirm);
        overlay.removeEventListener("click", onOverlay);
        document.removeEventListener("keydown", onKey);
      };
      const onCancel  = () => { cleanup(); resolve(false); };
      const onConfirm = () => { cleanup(); resolve(true); };
      const onOverlay = (e) => { if (e.target === overlay) onCancel(); };
      const onKey     = (e) => { if (e.key === "Escape") onCancel(); };
      cancel.addEventListener("click",  onCancel);
      confirm.addEventListener("click", onConfirm);
      overlay.addEventListener("click", onOverlay);
      document.addEventListener("keydown", onKey);
      overlay.classList.add("open");
    });
  }

  // ---- Info tab (Rev59) ----
  // Export/import the visor's local layout: corner assignments, wind
  // arrow flags, polar toggles, custom SK paths. Nothing sensitive; the
  // payload is safe to email or paste into a chat.
  const CFG_LS_KEYS = [
    "pypilot-newui.dashCorners",
    "pypilot-newui.dashExtras",
    "pypilot-newui.dashCustom",
    "pypilot-newui.windArrow.awa",
    "pypilot-newui.windArrow.twa",
  ];
  function _buildCfgPayload() {
    const settings = {};
    for (const k of CFG_LS_KEYS) {
      try { const v = localStorage.getItem(k); if (v != null) settings[k] = v; } catch {}
    }
    return {
      app: "signalk-pypilot-newui",
      rev: (document.getElementById("info-version")?.textContent || "").trim(),
      exportedAt: new Date().toISOString(),
      settings,
    };
  }
  function _applyCfgPayload(obj) {
    if (!obj || typeof obj !== "object" || !obj.settings) throw new Error("payload sin 'settings'");
    let n = 0;
    for (const k of CFG_LS_KEYS) {
      if (obj.settings[k] != null) {
        try { localStorage.setItem(k, String(obj.settings[k])); n++; } catch {}
      }
    }
    return n;
  }
  function _cfgStatus(msg, isErr) {
    const s = document.getElementById("cfg-export-status");
    if (!s) return;
    s.innerHTML = isErr
      ? `<span style="color:var(--err,#e74c3c)">${msg}</span>`
      : `<span style="color:#2ecc71">${msg}</span>`;
    setTimeout(() => { s.innerHTML = ""; }, 6000);
  }
  function wireInfo() {
    const shareBtn = document.getElementById("cfg-export-share");
    const fileBtn  = document.getElementById("cfg-export-file");
    const copyBtn  = document.getElementById("cfg-export-copy");
    const importFI = document.getElementById("cfg-import-file");
    const pasteBtn = document.getElementById("cfg-import-paste");
    const resetBtn = document.getElementById("cfg-reset");

    if (shareBtn) shareBtn.addEventListener("click", async () => {
      const payload = _buildCfgPayload();
      const json = JSON.stringify(payload, null, 2);
      const filename = `pypilot-newui-config-${payload.exportedAt.slice(0,10)}.json`;
      // Try native share with a file first (opens the OS share sheet on
      // mobile: WhatsApp, Gmail, Signal, AirDrop, etc). Fall back to text
      // share, then to file download.
      try {
        if (navigator.canShare) {
          try {
            const file = new File([json], filename, { type: "application/json" });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: "PyPilot New-UI config", text: "Config del visor pypilot-newui" });
              _cfgStatus(t("info.cfg.shared"));
              return;
            }
          } catch { /* try text share below */ }
        }
        if (navigator.share) {
          await navigator.share({ title: "PyPilot New-UI config", text: json });
          _cfgStatus(t("info.cfg.sharedText"));
          return;
        }
      } catch (e) {
        if (String(e).includes("AbortError")) { _cfgStatus(t("info.cfg.cancelled")); return; }
      }
      // No share API - download the file as fallback.
      _downloadFile(filename, json);
      _cfgStatus(t("info.cfg.noShareApi"));
    });

    if (fileBtn) fileBtn.addEventListener("click", () => {
      const payload = _buildCfgPayload();
      const json = JSON.stringify(payload, null, 2);
      _downloadFile(`pypilot-newui-config-${payload.exportedAt.slice(0,10)}.json`, json);
      _cfgStatus(t("info.cfg.downloaded"));
    });

    if (copyBtn) copyBtn.addEventListener("click", async () => {
      const json = JSON.stringify(_buildCfgPayload(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
        _cfgStatus(t("info.cfg.copied"));
      } catch (e) {
        _cfgStatus(t("info.cfg.copyFail") + ": " + e, true);
      }
    });

    if (importFI) importFI.addEventListener("change", async () => {
      const f = importFI.files && importFI.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const obj = JSON.parse(text);
        const n = _applyCfgPayload(obj);
        _cfgStatus(t("info.cfg.imported").replace("{N}", n));
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        _cfgStatus(t("info.cfg.importFail") + ": " + e, true);
      } finally {
        importFI.value = "";
      }
    });

    if (pasteBtn) pasteBtn.addEventListener("click", () => {
      const text = prompt(t("prompt.pasteCfg"));
      if (!text) return;
      try {
        const obj = JSON.parse(text);
        const n = _applyCfgPayload(obj);
        _cfgStatus(t("info.cfg.imported").replace("{N}", n));
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        _cfgStatus(t("info.cfg.importFail") + ": " + e, true);
      }
    });

    if (resetBtn) resetBtn.addEventListener("click", () => {
      if (!confirm(t("confirm.resetCfg"))) return;
      for (const k of CFG_LS_KEYS) { try { localStorage.removeItem(k); } catch {} }
      _cfgStatus(t("info.cfg.reset"));
      setTimeout(() => location.reload(), 700);
    });
  }
  function _downloadFile(name, contents) {
    try {
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (e) {
      _cfgStatus(t("info.cfg.downloadFail") + ": " + e, true);
    }
  }

  // ---- Tabs ----
  // Rev43: animated tab transitions with all panels always in the DOM.
  // Enter panel is pre-staged at translateX(±60%) then loses that class
  // on the next frame while gaining .active, letting the CSS transition
  // interpolate from far-off to translateX(0). Old panel gets .leaving-*
  // to slide the opposite way. Cleanup after 350 ms.
  const TAB_ANIM_MS = 360;
  function _activateTab(id, direction) {
    $$(".tab-btn").forEach((x) => x.classList.remove("active"));
    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    if (btn) btn.classList.add("active");
    const nextPanel = $(`#tab-${id}`);
    const currentActive = document.querySelector(".tab-panel.active");
    if (!nextPanel || currentActive === nextPanel) {
      _tabPostActivate(id);
      return;
    }
    if (!direction || !currentActive) {
      // No direction hint: instant switch (used on initial load and on
      // direct button click - clicks feel snappier without the sideways
      // travel, matching desktop expectations).
      $$(".tab-panel").forEach((p) => {
        p.classList.remove("active", "enter-from-left", "enter-from-right", "leaving-left", "leaving-right");
      });
      nextPanel.classList.add("active");
      _tabPostActivate(id);
      return;
    }
    const leaveCls = direction === "next" ? "leaving-left"    : "leaving-right";
    const enterCls = direction === "next" ? "enter-from-right" : "enter-from-left";
    // Stage the entering panel BEFORE marking it active - its transform
    // must be at the far side when the browser next paints so the
    // transition to translateX(0) actually animates.
    nextPanel.classList.remove("active", "enter-from-left", "enter-from-right", "leaving-left", "leaving-right");
    nextPanel.classList.add(enterCls);
    // Force reflow so the entry transform is committed.
    void nextPanel.offsetWidth;
    requestAnimationFrame(() => {
      currentActive.classList.add(leaveCls);
      nextPanel.classList.remove(enterCls);
      nextPanel.classList.add("active");
      setTimeout(() => {
        currentActive.classList.remove("active", leaveCls);
      }, TAB_ANIM_MS);
    });
    _tabPostActivate(id);
  }
  function _tabPostActivate(id) {
    if (id === "paths") refreshPaths();
    if (id === "setup") loadStatus();
    if (id === "tune") {
      refreshPypilotValues();
      // Rev42: auto-relock the Ajustes controls every time the user
      // re-enters the tab. Muscle memory should be "tick then touch".
      _setTuneLocked(true);
    }
    document.body.classList.toggle("tab-regata-active", id === "regata");
    // Rev53/54: only Control can hide the nav. Any other tab restores
    // it. Entering Control (from any other tab) shows the nav briefly
    // and auto-hides it 5 s later so the dashboard reclaims the space.
    if (id !== "control") {
      document.body.classList.remove("nav-hidden");
      if (_navAutoHideTimer) { clearTimeout(_navAutoHideTimer); _navAutoHideTimer = null; }
    } else {
      document.body.classList.remove("nav-hidden");
      _navScheduleAutoHide();
    }
  }
  // Rev42/45: lock/unlock all gain + config sliders and their nudge buttons.
  // On unlock (locked=false), snapshot each slider's current value into
  // a data attribute and render it in orange next to the live value so
  // the user always knows where the value started. On lock, clear the
  // baseline so the next unlock captures a fresh snapshot.
  function _setTuneLocked(locked) {
    const unlockCb = $("#tune-unlock");
    if (unlockCb) unlockCb.checked = !locked;
    const containers = [$("#gains-container"), $("#config-sliders")];
    for (const cont of containers) {
      if (!cont) continue;
      cont.classList.toggle("locked", !!locked);
      cont.querySelectorAll(".gain-row").forEach((row) => {
        const rng = row.querySelector("input[type=range]");
        const baselineEl = row.querySelector(".baseline");
        const decimals = parseInt(row.dataset.decimals || "3", 10);
        row.querySelectorAll("input[type=range], .nudge-btn").forEach((el) => {
          if (locked) el.setAttribute("disabled", "");
          else el.removeAttribute("disabled");
        });
        if (!locked) {
          // Just unlocked: capture the current value as baseline.
          const now = Number(rng && rng.value);
          if (Number.isFinite(now) && baselineEl) {
            baselineEl.dataset.baseline = String(now);
            baselineEl.textContent = "was: " + now.toFixed(decimals);
            baselineEl.hidden = false;
          }
        } else {
          // Locked again: clear baseline.
          if (baselineEl) {
            baselineEl.dataset.baseline = "";
            baselineEl.textContent = "";
            baselineEl.hidden = true;
          }
        }
      });
    }
  }
  function wireTabs() {
    $$(".tab-btn").forEach((b) => {
      b.addEventListener("click", () => _activateTab(b.dataset.tab, null));
    });
    // Rev45/Rev46: swipe hint arrows inside Control tab. Each arrow
    // jumps to the neighbouring tab with the matching slide animation.
    $$(".swipe-hint-arrow").forEach((el) => {
      el.addEventListener("click", () => {
        const dir = el.dataset.swipeDir === "prev" ? -1 : +1;
        const ids = $$(".tab-btn").map((b) => b.dataset.tab);
        const cur = document.querySelector(".tab-btn.active");
        const idx = ids.indexOf(cur ? cur.dataset.tab : ids[0]);
        const nextIdx = ((idx + dir) % ids.length + ids.length) % ids.length;
        _activateTab(ids[nextIdx], dir === 1 ? "next" : "prev");
      });
    });
    // Rev48: long-press on any of the 4 corner cells opens the selector
    // popup so the user assigns whatever data they want per corner.
    _dashLoadCfg();
    _dashPopulateSelectors();
    _dashRenderCorners();
    let _dashLongPressTimer = null;
    $$(".dash-rose .dash-cell[data-corner]").forEach((cell) => {
      const openSelector = (e) => {
        e && e.preventDefault();
        _dashPopulateSelectors();
        const pop = document.getElementById("dash-help-pop");
        if (pop) pop.classList.add("open");
      };
      cell.addEventListener("touchstart", (e) => {
        if (_dashLongPressTimer) clearTimeout(_dashLongPressTimer);
        _dashLongPressTimer = setTimeout(() => openSelector(e), 500);
      }, { passive: true });
      const cancel = () => { if (_dashLongPressTimer) { clearTimeout(_dashLongPressTimer); _dashLongPressTimer = null; } };
      cell.addEventListener("touchend", cancel, { passive: true });
      cell.addEventListener("touchmove", cancel, { passive: true });
      cell.addEventListener("touchcancel", cancel, { passive: true });
      cell.addEventListener("contextmenu", openSelector);
      let _mouseTimer = null;
      cell.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        _mouseTimer = setTimeout(() => openSelector(e), 600);
      });
      cell.addEventListener("mouseup",    () => { if (_mouseTimer) { clearTimeout(_mouseTimer); _mouseTimer = null; } });
      cell.addEventListener("mouseleave", () => { if (_mouseTimer) { clearTimeout(_mouseTimer); _mouseTimer = null; } });
    });
    // Rev43: horizontal swipe between tabs on mobile/tablet.
    // Rules:
    //  - Swipe is DISABLED when the Ajustes sliders are unlocked. The
    //    unlock tick doubles as "no accidental tab flip while tuning."
    //  - Threshold is intentionally forgiving (45 px) and needs the drag
    //    to be clearly horizontal (dx > 1.4 * dy).
    //  - Haptic pulse (15 ms) fires on the moment we decide to swipe so
    //    the user feels the transition even without looking at the screen.
    //  - Touches that begin inside an interactive control (slider, button,
    //    select, wind rose) are ignored so the control keeps its own touch.
    const main = document.querySelector("main");
    if (main && "ontouchstart" in window) {
      // Rev57: swipe threshold and ratio raised so scrolling a long list
      // (Paths tab, Ajustes) does not accidentally flip the tab. Also
      // requires the FIRST move to already be horizontal-dominant, so a
      // downward scroll that curves later never triggers a swipe.
      const SWIPE_DX_MIN = 80;
      const SWIPE_HV_RATIO = 2.2;
      const SWIPE_FIRST_MOVE_TOL_Y = 12;
      const tabIds = () => $$(".tab-btn").map((b) => b.dataset.tab);
      const _swipeAllowed = () => {
        const cb = document.getElementById("tune-unlock");
        // Unlock CB checked -> user is tuning -> DO NOT swipe.
        return !(cb && cb.checked);
      };
      let sx = 0, sy = 0, tracking = false, swiped = false, hLocked = false, vLocked = false;
      main.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) { tracking = false; return; }
        if (!_swipeAllowed()) { tracking = false; return; }
        const t = e.target;
        if (t && t.closest) {
          const ctrl = t.closest("input,select,textarea,button");
          if (ctrl && !ctrl.disabled) { tracking = false; return; }
          if (t.closest(".rose-wrap")) { tracking = false; return; }
          // Rev57: the horizontally-scrollable table wrappers own the
          // gesture entirely; the tab swipe must not steal it.
          if (t.closest(".paths-scroll")) { tracking = false; return; }
        }
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        tracking = true; swiped = false; hLocked = false; vLocked = false;
      }, { passive: true });
      main.addEventListener("touchmove", (e) => {
        if (!tracking || swiped || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - sx;
        const dy = e.touches[0].clientY - sy;
        // First-move axis lock: if the initial couple of pixels of travel
        // point mostly vertical, mark the gesture as a vertical scroll and
        // stop watching it. Prevents "started scrolling but curved" false
        // positives.
        if (!hLocked && !vLocked) {
          const adx = Math.abs(dx), ady = Math.abs(dy);
          if (adx < 8 && ady < 8) return; // too small to decide yet
          if (ady > adx || ady > SWIPE_FIRST_MOVE_TOL_Y) { vLocked = true; return; }
          hLocked = true;
        }
        if (vLocked) return;
        if (Math.abs(dx) > SWIPE_DX_MIN && Math.abs(dx) > Math.abs(dy) * SWIPE_HV_RATIO) {
          swiped = true;
          try { if (navigator.vibrate) navigator.vibrate(15); } catch { /* silent */ }
          const ids = tabIds();
          const cur = document.querySelector(".tab-btn.active");
          const idx = ids.indexOf(cur ? cur.dataset.tab : ids[0]);
          const dir = dx < 0 ? +1 : -1;
          const nextIdx = ((idx + dir) % ids.length + ids.length) % ids.length;
          _activateTab(ids[nextIdx], dir === 1 ? "next" : "prev");
        }
      }, { passive: true });
      main.addEventListener("touchend",    () => { tracking = false; }, { passive: true });
      main.addEventListener("touchcancel", () => { tracking = false; }, { passive: true });
    }
    // Rev22: paths search filter (live).
    const ps = $("#paths-search");
    if (ps) ps.addEventListener("input", () => renderPathsTable());
    // Rev23: toggle publishOnlyEssentials (hot-apply).
    const oeCb = $("#cfg-only-essentials");
    if (oeCb) oeCb.addEventListener("change", async () => {
      const newVal = oeCb.checked;
      try {
        // Read current status to preserve everything else, then POST full config.
        const s = await fetch(`/plugins/${PLUGIN_ID}/status`, { credentials: "include" });
        if (!s.ok) throw new Error("status " + s.status);
        const cur = await s.json();
        const configuration = {
          host: cur.host, port: cur.port,
          reconnectDelayMs: 3000,
          allowWrites: cur.allowWrites, allowDirectServo: cur.allowDirectServo,
          publishUnmapped: false,
          nudgeSmall: cur.nudgeSmall, nudgeBig: cur.nudgeBig,
          absorbProvider: cur.absorbProvider,
          enabledPaths: cur.enabledPaths || {},
          publishOnlyEssentials: newVal,
        };
        const r = await fetch(`/skServer/plugins/${PLUGIN_ID}/config`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, configuration }),
        });
        if (!r.ok) throw new Error(await r.text());
        alert(newVal
          ? "Essentials-only mode ON. Non-essential paths will only publish when explicitly ticked."
          : "Legacy mode: all paths publish unless explicitly unticked.");
        setTimeout(() => refreshPaths(), 2500);
      } catch (e) {
        alert("Config save failed: " + e);
        oeCb.checked = !newVal;
      }
    });
  }

  // ---- Regata timer (Rev35) ----
  // State machine: idle -> running -> race (overtime, counts up).
  // TIMER button cycles start/pause/stop. SYNC rounds to nearest minute
  // when running or preloads T2 when idle. Beeps last 10 s + long top at 0.
  const REGATA_LS_KEY = "pypilot-newui.regata";
  const regata = {
    state: "idle",           // idle | running | paused | race
    remaining: 300,          // seconds; positive = countdown, negative = race elapsed
    t1: 300, t2: 240,        // configurable
    beepsOn: true,
    voiceOn: true,           // Rev40: independent from beepsOn
    tickTimer: null,
    lastBeepSec: null,       // dedupe beeps within a second boundary
    audioCtx: null,
  };
  function _regataAudio() {
    // Lazy-create WebAudio context on first user gesture (autoplay policy).
    if (!regata.audioCtx) {
      try { regata.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { regata.audioCtx = null; }
    }
    return regata.audioCtx;
  }
  // Rev37: beep uses a square wave through a lightly filtered path so it is
  // loud AND penetrating in a noisy cockpit. Sine at 0.35 was too subtle for
  // Carlos to hear over engine + wind. Now default gain 0.9, square wave.
  function _regataBeep(freq, ms, gain) {
    if (!regata.beepsOn) return;
    const ctx = _regataAudio();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";                 // square = louder + harmonics that carry
      osc.frequency.value = freq;
      g.gain.value = 0;
      osc.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      const peak = gain != null ? gain : 0.9;
      g.gain.linearRampToValueAtTime(peak, now + 0.005);   // fast attack
      g.gain.setValueAtTime(peak, now + ms / 1000 - 0.02);
      g.gain.linearRampToValueAtTime(0, now + ms / 1000);
      osc.start(now);
      osc.stop(now + ms / 1000);
    } catch { /* silent */ }
  }
  // Rev37: chain of beeps with gaps between them, so a single "second"
  // fires two short pulses instead of one - much more attention-grabbing
  // than a single quick beep and works better on tinny device speakers.
  function _regataBeepPattern(pattern) {
    // pattern: array of { freq, ms, gain, delayAfter }
    let t = 0;
    for (const p of pattern) {
      setTimeout(() => _regataBeep(p.freq, p.ms, p.gain), t);
      t += p.ms + (p.delayAfter || 0);
    }
  }
  function _regataLoadCfg() {
    try {
      const raw = localStorage.getItem(REGATA_LS_KEY);
      if (!raw) return;
      const cfg = JSON.parse(raw);
      if (typeof cfg.t1 === "number") regata.t1 = cfg.t1;
      if (typeof cfg.t2 === "number") regata.t2 = cfg.t2;
      if (typeof cfg.beepsOn === "boolean") regata.beepsOn = cfg.beepsOn;
      if (typeof cfg.voiceOn === "boolean") regata.voiceOn = cfg.voiceOn;
    } catch { /* silent */ }
  }
  function _regataSaveCfg() {
    try {
      localStorage.setItem(REGATA_LS_KEY, JSON.stringify({
        t1: regata.t1, t2: regata.t2,
        beepsOn: regata.beepsOn, voiceOn: regata.voiceOn,
      }));
    } catch { /* silent */ }
  }
  function _regataFormat(sec) {
    const abs = Math.abs(Math.floor(sec));
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  // Rev39/Rev40: voice countdown - respects the app's current language and
  // is toggled independently from beeps via regata.voiceOn.
  const _REGATA_VOICE_LOCALES = { es: "es-ES", en: "en-US", de: "de-DE", fr: "fr-FR" };
  const _REGATA_VOICE_START   = { es: "Salida", en: "Start",  de: "Start",  fr: "Départ" };
  const _REGATA_VOICE_MIN_SG  = { es: "minuto", en: "minute", de: "Minute", fr: "minute" };
  const _REGATA_VOICE_MIN_PL  = { es: "minutos",en: "minutes",de: "Minuten",fr: "minutes" };
  function _regataSpeak(text) {
    if (!regata.voiceOn) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const lang = (typeof currentLang === "function" ? currentLang() : "en");
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = _REGATA_VOICE_LOCALES[lang] || "en-US";
      u.rate = 1.15;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch { /* silent */ }
  }
  function _regataSpeakStart()   { _regataSpeak(_REGATA_VOICE_START[currentLang()] || "Start"); }
  function _regataSpeakSeconds(n) { _regataSpeak(String(n)); }
  function _regataSpeakMinutes(m) {
    const lang = currentLang();
    const word = (m === 1 ? _REGATA_VOICE_MIN_SG : _REGATA_VOICE_MIN_PL)[lang] || (m === 1 ? "minute" : "minutes");
    _regataSpeak(`${m} ${word}`);
  }
  function _regataRender() {
    const clockEl = $("#regata-clock");
    const stateEl = $("#regata-state");
    // Rev39: also update the always-visible HUD in the top-right corner
    // whenever we re-render. The HUD is shown when state is not idle.
    _regataRenderHud();
    if (!clockEl || !stateEl) return;
    let label = "IDLE";
    let stateClass = "";
    let clockClass = "";
    let shown = regata.remaining;
    if (regata.state === "idle") {
      label = "IDLE";
      shown = regata.t1;
    } else if (regata.state === "paused") {
      label = "PAUSED";
      stateClass = "armed";
      clockClass = regata.remaining <= 10 ? "critical" : (regata.remaining <= 60 ? "warning" : "");
    } else if (regata.state === "running") {
      label = "RUNNING";
      stateClass = "running";
      clockClass = regata.remaining <= 10 ? "critical" : (regata.remaining <= 60 ? "warning" : "");
    } else if (regata.state === "race") {
      label = "RACE";
      stateClass = "race";
      clockClass = "race";
      shown = -regata.remaining; // remaining goes negative in race; display absolute
    }
    stateEl.textContent = label;
    stateEl.className = "regata-state " + stateClass;
    clockEl.textContent = (regata.state === "race" ? "+" : "") + _regataFormat(shown);
    clockEl.className = "regata-clock " + clockClass;
    // Update button label based on state.
    const btn = $("#regata-timer-btn");
    if (btn) {
      btn.classList.remove("pause", "stop");
      if (regata.state === "idle" || regata.state === "paused") btn.textContent = "START";
      else if (regata.state === "running") { btn.textContent = "PAUSE"; btn.classList.add("pause"); }
      else if (regata.state === "race") { btn.textContent = "STOP"; btn.classList.add("stop"); }
    }
  }
  // Rev39: render the always-visible timer HUD (top-right of viewport).
  // Hidden when idle, shown otherwise. Colors mirror the main clock so the
  // urgency is immediately readable from any tab.
  function _regataRenderHud() {
    const hud = $("#regata-hud");
    if (!hud) return;
    if (regata.state === "idle") { hud.hidden = true; hud.className = "regata-hud"; return; }
    hud.hidden = false;
    const clock = $("#regata-hud-clock");
    const st = $("#regata-hud-state");
    let cls = "regata-hud";
    let label = "IDLE";
    let shown = regata.remaining;
    if (regata.state === "paused") {
      label = "PAUSED";
      cls += regata.remaining <= 10 ? " critical" : (regata.remaining <= 60 ? " warning" : " running");
    } else if (regata.state === "running") {
      label = "RUNNING";
      cls += regata.remaining <= 10 ? " critical" : (regata.remaining <= 60 ? " warning" : " running");
    } else if (regata.state === "race") {
      label = "RACE";
      cls += " race";
      shown = -regata.remaining;
    }
    hud.className = cls;
    if (clock) clock.textContent = (regata.state === "race" ? "+" : "") + _regataFormat(shown);
    if (st) st.textContent = label;
  }

  // Rev37: viewport flash for the last 10 seconds + long green flash at top.
  // Uses body classes so the flash is visible even if the user has moved to
  // another tab (Control, Setup) - the flash covers the whole viewport.
  function _regataSetFlash(kind) {
    // kind: null | "critical" | "start"
    document.body.classList.remove("regata-flash-critical", "regata-flash-start");
    if (kind === "critical") document.body.classList.add("regata-flash-critical");
    else if (kind === "start") {
      document.body.classList.add("regata-flash-start");
      setTimeout(() => document.body.classList.remove("regata-flash-start"), 2500);
    }
  }
  function _regataTick() {
    if (regata.state !== "running" && regata.state !== "race") return;
    regata.remaining -= 1;
    // Fire beeps at second boundaries. Only in countdown mode (positive values).
    const s = regata.remaining;
    if (s !== regata.lastBeepSec) {
      regata.lastBeepSec = s;
      if (regata.state === "running") {
        if (s === 0) {
          // Long, loud top-of-race horn: three descending pulses.
          _regataBeepPattern([
            { freq: 700, ms: 300, gain: 1.0, delayAfter: 40 },
            { freq: 500, ms: 300, gain: 1.0, delayAfter: 40 },
            { freq: 350, ms: 900, gain: 1.0 },
          ]);
          _regataSetFlash("start");
          _regataSpeakStart();
        } else if (s > 0 && s <= 10) {
          // Rev40: last 10 s beeps still every second (visual + audible
          // urgency stays intense), but the VOICE only says specific
          // milestones: 10, 5, 4, 3, 2, 1. Less chatter, more clarity.
          _regataBeepPattern([
            { freq: 1100, ms: 120, gain: 1.0, delayAfter: 60 },
            { freq: 1100, ms: 120, gain: 1.0 },
          ]);
          if (s === 10 || s <= 5) _regataSpeakSeconds(s);
        } else if (s > 10 && s < 60) {
          // Rev40: voice every 10 s milestone in the last minute
          // (50, 40, 30, 20). No beep to keep it non-invasive.
          if (s % 10 === 0) _regataSpeakSeconds(s);
        } else if (s > 0 && s % 60 === 0) {
          // Per-minute tick: single medium beep + spoken minutes remaining.
          _regataBeep(1400, 180, 0.85);
          _regataSpeakMinutes(Math.floor(s / 60));
        }
      }
    }
    // Enable/disable viewport flash based on state.
    if (regata.state === "running" && s > 0 && s <= 10) _regataSetFlash("critical");
    else if (regata.state !== "race") document.body.classList.remove("regata-flash-critical");
    // Transition from countdown to race the moment we cross zero.
    if (regata.state === "running" && regata.remaining <= 0) {
      regata.state = "race";
      document.body.classList.remove("regata-flash-critical");
      // remaining will decrement further (negative) each tick; display uses -remaining.
    }
    _regataRender();
  }
  function _regataStartTick() {
    if (regata.tickTimer) return;
    regata.tickTimer = setInterval(_regataTick, 1000);
  }
  function _regataStopTick() {
    if (regata.tickTimer) { clearInterval(regata.tickTimer); regata.tickTimer = null; }
  }
  function _regataTimerBtn() {
    _regataAudio(); // prime AudioContext on user gesture
    if (regata.state === "idle") {
      regata.remaining = regata.t1;
      regata.state = "running";
      regata.lastBeepSec = null;
      _regataStartTick();
    } else if (regata.state === "running") {
      regata.state = "paused";
      _regataStopTick();
    } else if (regata.state === "paused") {
      regata.state = "running";
      _regataStartTick();
    } else if (regata.state === "race") {
      regata.state = "idle";
      regata.remaining = regata.t1;
      _regataStopTick();
    }
    _regataRender();
  }
  function _regataSyncBtn() {
    _regataAudio();
    if (regata.state === "idle") {
      // Preload T2 and start countdown from T2 (typical for 4-min pistol call).
      regata.remaining = regata.t2;
      regata.state = "running";
      regata.lastBeepSec = null;
      _regataStartTick();
    } else if (regata.state === "running" || regata.state === "paused") {
      // Round remaining seconds to the nearest whole minute.
      const roundedMinutes = Math.round(regata.remaining / 60);
      regata.remaining = Math.max(0, roundedMinutes * 60);
      regata.lastBeepSec = null;
    }
    _regataRender();
  }
  function _regataResetBtn() {
    regata.state = "idle";
    regata.remaining = regata.t1;
    _regataStopTick();
    _regataRender();
  }
  function wireRegata() {
    _regataLoadCfg();
    const t1El = $("#regata-t1");
    const t2El = $("#regata-t2");
    const beepEl = $("#regata-beep");
    const voiceEl = $("#regata-voice");
    if (t1El) t1El.value = String(regata.t1 / 60);
    if (t2El) t2El.value = String(regata.t2 / 60);
    if (beepEl) beepEl.checked = regata.beepsOn;
    if (voiceEl) voiceEl.checked = regata.voiceOn;
    // Rev37: enforce T1 > T2 (invariant of a regatta start sequence).
    // If the user types a T1 that would leave T1 <= T2, we clamp T2 down
    // to T1-1 (or clamp T1 up to T2+1 when T2 was just raised). The input
    // whose value the user *did not* just touch is the one we clamp.
    const readCfg = (which) => {
      const t1v = parseInt(t1El && t1El.value, 10);
      const t2v = parseInt(t2El && t2El.value, 10);
      let newT1 = (t1v >= 1 && t1v <= 60) ? t1v : Math.floor(regata.t1 / 60);
      let newT2 = (t2v >= 1 && t2v <= 59) ? t2v : Math.floor(regata.t2 / 60);
      if (newT1 <= newT2) {
        if (which === "t2") {
          // User raised T2 above T1; bump T1 up.
          newT1 = Math.min(60, newT2 + 1);
        } else {
          // User lowered T1 to/below T2 (or generic path); clamp T2 down.
          newT2 = Math.max(1, newT1 - 1);
        }
      }
      regata.t1 = newT1 * 60;
      regata.t2 = newT2 * 60;
      if (t1El) t1El.value = String(newT1);
      if (t2El) t2El.value = String(newT2);
      if (beepEl) regata.beepsOn = beepEl.checked;
      if (voiceEl) regata.voiceOn = voiceEl.checked;
      _regataSaveCfg();
      if (regata.state === "idle") { regata.remaining = regata.t1; _regataRender(); }
    };
    if (t1El) t1El.addEventListener("change", () => readCfg("t1"));
    if (t2El) t2El.addEventListener("change", () => readCfg("t2"));
    if (beepEl) beepEl.addEventListener("change", () => readCfg());
    if (voiceEl) voiceEl.addEventListener("change", () => readCfg());
    const bt = $("#regata-timer-btn"); if (bt) bt.addEventListener("click", _regataTimerBtn);
    const bs = $("#regata-sync-btn");  if (bs) bs.addEventListener("click", _regataSyncBtn);
    const br = $("#regata-reset-btn"); if (br) br.addEventListener("click", _regataResetBtn);
    _regataRender();
  }

  // Rev53/54: central triangle inside Control's swipe-hint bar toggles
  // the top nav. Other tabs always have the nav visible. When the user
  // enters Control from another tab, the nav is visible and auto-hides
  // 5 s later (unless they toggle it manually first).
  let _navAutoHideTimer = null;
  function _navHide() {
    document.body.classList.add("nav-hidden");
    if (_navAutoHideTimer) { clearTimeout(_navAutoHideTimer); _navAutoHideTimer = null; }
  }
  function _navShow() { document.body.classList.remove("nav-hidden"); }
  function _navToggle() {
    if (document.body.classList.contains("nav-hidden")) _navShow();
    else _navHide();
  }
  function _navScheduleAutoHide() {
    if (_navAutoHideTimer) clearTimeout(_navAutoHideTimer);
    _navAutoHideTimer = setTimeout(() => {
      // Only auto-hide when we are still in Control.
      const cur = document.querySelector(".tab-btn.active");
      if (cur && cur.dataset.tab === "control") {
        document.body.classList.add("nav-hidden");
      }
      _navAutoHideTimer = null;
    }, 5000);
  }
  function wireInfoBar() {
    const btn = document.getElementById("nav-toggle");
    if (btn) btn.addEventListener("click", () => {
      _navToggle();
      // User interacted -> cancel any pending auto-hide.
      if (_navAutoHideTimer) { clearTimeout(_navAutoHideTimer); _navAutoHideTimer = null; }
    });
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", async () => {
    wireTabs();
    wireControl();
    wireTune();
    wireSetup();
    wireInfo();
    wireRegata();
    wireInfoBar();
    applyI18n();
    renderEngage();
    renderNudgeLabels();

    // Login modal wiring (Rev17)
    const loginSubmit = $("#login-submit");
    if (loginSubmit) loginSubmit.addEventListener("click", doLogin);
    const loginCancel = $("#login-cancel");
    if (loginCancel) loginCancel.addEventListener("click", closeLoginModal);
    const loginPass = $("#login-pass");
    if (loginPass) loginPass.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doLogin(); }
    });

    await discoverAutopilot();
    loadStatus();
    // Rev21: pull current pypilot values once so sliders show real positions
    // (gains, config, calibration inputs). Retry after 3s in case the
    // catalog arrives late.
    // Rev36: staggered retries so the first attempt covers race conditions
    // with the pypilot catalog (~3 s), and the follow-ups cover late auth
    // (user still typing login when the boot fires).
    refreshPypilotValues();
    setTimeout(refreshPypilotValues, 3000);
    setTimeout(refreshPypilotValues, 8000);
    setTimeout(refreshPypilotValues, 20000);
    connectSK();
  });
})();

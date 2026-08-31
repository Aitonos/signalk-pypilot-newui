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
      "cal.advanced.title": "Advanced sliders",
      "cal.advanced.hint":  "All the pypilot RangeSettings, grouped. Long-press or hover a name to see the raw pypilot key.",
      "cal.grp.rudder":     "Rudder",
      "cal.grp.servo":      "Servo",
      "cal.grp.imu":        "IMU",
      "cal.grp.ap":         "Autopilot",
      "cal.grp.other":      "Other",
      "cal.slider.was":     "before:",
      "cal.slider.restore": "Restore previous value",
      "cal.unlock":         "Unlock sliders",
      "cal.stampReset":     "Reset history",
      "tune.fork.title":    "Save gain changes",
      "tune.fork.body":     "You just tweaked a gain. Where should the change live?",
      "tune.fork.keep":     "Keep in '{pilot}'",
      "tune.fork.new":      "Save in new '{name}'",
      "tune.fork.cancel":   "Cancel",
      "tune.fork.hint":     "'New' clones the active profile and switches to it, so the original stays untouched. Cancel keeps the modal from popping again until you re-lock.",
      "setup.status.language":  "Active:",
      "setup.status.host":      "TinyPilot:",
      "setup.status.hostMissing": "not configured",
      "setup.status.ssh":       "SSH user configured:",
      "setup.status.sshConfigured": "SSH configured",
      "setup.status.sshSummary": "SSH: {user}",
      "setup.status.sshMissing": "SSH not configured",
      "setup.status.sentences": "Active sentences:",
      "setup.status.calLast":   "Last adjustment:",
      "setup.status.calNever":  "No adjustments recorded yet.",
      "setup.status.calNeverShort": "not adjusted yet",
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
      "paths.kip.col.widget":  "Widget",
      "paths.kip.col.path":    "Path",
      "paths.kip.col.type":    "Type",
      "paths.kip.col.values":  "Value(s)",
      "paths.kip.col.copy":    "Copy",
      "paths.kip.widget.apEngage":  "AP engage",
      "paths.kip.widget.nudge":     "Nudge <code>-10 / -1 / +1 / +10</code>",
      "paths.kip.widget.tack":      "Tack <code>port / starboard / cancel</code>",
      "paths.kip.widget.mode":      "Mode <code>compass / gps / wind / true / nav</code>",
      "paths.kip.widget.profile":   "Profile <code>&lt;name&gt;</code>",
      "paths.kip.widget.modePut":   "<b>Mode</b> (Put)",
      "paths.kip.widget.targetPut": "Target (Put)",
      "paths.kip.type.simple":    "Simple Switch",
      "paths.kip.type.momentary": "Simple Switch (momentary)",
      "paths.kip.type.radio":     "Simple Switch (radio)",
      "paths.kip.type.radioDyn":  "Simple Switch (radio, dynamic)",
      "paths.kip.type.string":    "string",
      "paths.kip.type.numberRad": "number (rad)",
      "paths.kip.val.engage":       "1 = engage, 0 = disengage",
      "paths.kip.val.fireReset":    "1 = fire, auto-resets",
      "paths.kip.val.fire":         "1 = fire",
      "paths.kip.val.select":       "1 = select",
      "paths.kip.val.modeStrings":  "\"compass\" / \"gps\" / \"wind\" / \"true wind\" / \"nav\"",
      "paths.kip.val.targetExample":"e.g. 1.57 for 90 deg",
      "paths.kip.copy":          "Copy",
      "paths.kip.copy.plus1":    "Copy +1",
      "paths.kip.copy.port":     "Copy port",
      "paths.kip.copy.compass":  "Copy compass",
      "paths.kip.copy.prefix":   "Copy prefix",
      "paths.all.title": "All published paths",
      "paths.search.ph": "filter paths...",
      "paths.essentials.label": "Publish only essentials + explicitly enabled (recommended)",
      "nudge.title": "Heading trim buttons",
      "nudge.small": "Small (-1/+1)",
      "nudge.big": "Big (-10/+10)",
      "nudge.hint": "Degrees added to the target each time you press a nudge button. Also configurable in Signal K Admin -> Plugin Config -> PyPilot New-UI.",
      "language.title": "Language",
      "language.hint": "Persists in this browser only. No server round-trip.",
      // Tabs
      "tab.control": "Control",
      "tab.tune":    "Tune",
      "tab.chart":   "Chart",
      "tab.regata":  "Race",
      "tab.paths":   "Paths & API",
      "tab.setup":   "Setup",
      "tab.info":    "Info",
      // Chart tab (Rev96)
      "chart.stats.title":         "TRIP STATS",
      "chart.session.empty":       "Session not started",
      "chart.session.started":     "Session started at",
      "chart.session.ago":         "ago",
      "chart.session.reset":       "Reset",
      "chart.session.confirm":     "Reset the trip stats to zero? The chart history is kept.",
      "chart.stat.engaged":        "AP engaged",
      "chart.stat.distance":       "Distance",
      "chart.stat.energy":         "Energy",
      "chart.stat.meanErr":        "Mean err",
      "chart.stat.rmsErr":         "RMS err",
      "chart.stat.p95Err":         "p95 err",
      "chart.stat.servoRuntime":   "Servo runtime",
      "chart.stat.tacksGybes":     "Tacks / Gybes",
      "chart.stat.maxServoA":      "Max servo A",
      "chart.history.title":       "HISTORY",
      "chart.history.refresh":     "Refresh",
      "chart.empty":               "No data yet - waiting for the first sample...",
      "chart.servoHealth.title":   "SERVO HEALTH",
      "chart.servoHealth.learning":"Learning baseline...",
      "chart.servoHealth.baseline":"Baseline",
      "chart.servoHealth.recent":  "Recent avg",
      "chart.servoHealth.deviation":"Deviation",
      "chart.servoHealth.peak":    "Peak 30 s",
      "chart.servoHealth.temp":    "Temp",
      "chart.servoHealth.voltage": "Voltage",
      "setup.paths.title":         "Signal K Sentences",
      "setup.conn.title":          "pypilot connection",
      "setup.conn.status":         "Status",
      "setup.remoteConsole":       "Remote Control Console",
      // Alarms (Rev101)
      "setup.alarms.title":        "Alarms",
      "setup.alarms.hint":         "Turn each rule on or off and mute it temporarily. Active alarms appear in the banner at the top and publish canonical SK notifications for KIP / WilhelmSK.",
      "alarm.ack":                 "ACK",
      "alarm.acked":               "Acked",
      "alarm.mute15":              "Mute 15m",
      "alarm.unmute":              "Unmute",
      "alarm.idle":                "IDLE",
      "alarm.active":              "ACTIVE",
      "alarm.muted":               "MUTED",
      "alarm.off":                 "OFF",
      // Pre-departure check (Rev102)
      "setup.precheck.title":      "Autopilot check",
      "setup.precheck.hint":       "Pre-departure sanity check. Aggregates every sensor / servo / voltage / connectivity signal into a single verdict. Recomputes every 3 s while this tab is open.",
      "setup.precheck.refresh":    "Refresh",
      "setup.precheck.unknown":    "Checking...",
      "setup.precheck.verdict.ready":   "Ready to engage",
      "setup.precheck.verdict.caveats": "Ready with caveats",
      "setup.precheck.verdict.fail":    "Do not engage",
      // Doctor (Rev104)
      "setup.doctor.title":        "Diagnostics & advice",
      "setup.doctor.hint":         "Engage the AP first, then press DIAGNOSE. The plugin records the heading error + servo response and proposes P/I/D adjustments. Nothing is applied automatically - review each suggestion and press APPLY.",
      "setup.doctor.start":        "DIAGNOSE",
      "setup.doctor.cancel":       "Cancel",
      "setup.doctor.recording":    "Recording",
      "setup.doctor.analyzing":    "Analyzing",
      "setup.doctor.findings":     "Findings",
      "setup.doctor.suggestions":  "Suggested gain adjustments",
      "setup.doctor.apply":        "APPLY",
      "setup.doctor.applied":      "APPLIED",
      "setup.doctor.applyAll":     "Apply all",
      "setup.doctor.applyAllConfirm": "Apply every suggested gain change to pypilot?",
      "setup.doctor.confidence":   "Confidence",
      "setup.doctor.samplesSummary": "{engaged} engaged samples of {total}, pilot '{pilot}'.",
      "setup.doctor.forkedProfile":  "Changes applied to a NEW profile {new}. Your original profile {orig} is untouched and one tap away in Tune → Profile.",
      "setup.doctor.discard":   "Discard",
      "setup.doctor.discarded": "DISCARDED",
      "setup.doctor.hide":      "Hide",
      "doctor.cat.bias":        "bias",
      "doctor.cat.oscillation": "oscillation",
      "doctor.cat.authority":   "authority",
      "doctor.cat.noise":       "noise",
      "doctor.conf.low":        "low",
      "doctor.conf.medium":     "medium",
      "doctor.conf.high":       "high",
      "doctor.reason.bias":         "The boat has been off the target heading by {deg}° on average. That drift is what the integral gain (I) fights over time - a small I means the AP takes a long time (or never) to close a persistent offset.",
      "doctor.effect.bias":         "Increasing I should erase that drift within seconds. Watch the wheel: a too-large I overshoots and starts hunting - if you see it, back off.",
      "doctor.reason.oscillation":  "The heading is swinging periodically every {period} seconds. Without enough derivative gain (D) the AP cannot damp its own corrections and the boat wobbles side to side.",
      "doctor.effect.oscillation":  "More D calms the swing and makes the AP feel less nervous. Steering response gets slightly slower - a fair trade for a straight track.",
      "doctor.reason.authority":    "The servo is running hard but the boat still misses the heading. That is classic weak P: the AP is asking, the rudder is moving, but the correction is too small.",
      "doctor.effect.authority":    "A larger P puts more rudder for the same error. Should tighten the track. If it starts to hunt at each swell, roll it back and reach for D instead.",
      "setup.doctor.idle":         "idle",
      "setup.doctor.analyzing.short": "analyzing...",
      "setup.doctor.healthy":      "healthy",
      "setup.doctor.suggested":    "{n} suggested",
      "setup.doctor.noted":        "{n} noted",
      // Rev136: summary + findings i18n so the whole doctor panel
      // reads in the active language, not half English half Spanish.
      "doctor.summary.clean":      "No significant issues detected. Current gains look healthy.",
      "doctor.summary.notedOnly":  "{issues} issue(s) noted (no gain change suggested).",
      "doctor.summary.detected":   "{issues} issue(s) detected. {suggestions} gain change(s) suggested.",
      "doctor.finding.insufficientData": "Only {n} engaged samples collected. Analysis skipped - keep the AP engaged during the whole session.",
      "doctor.finding.bias":        "Persistent heading offset of {deg}° (mean error).",
      "doctor.finding.oscillation": "Heading oscillating with period ~{period}s, RMS {rms}°.",
      "doctor.finding.authority":   "Servo running at {duty}% duty but heading error still {rms}°. AP is losing authority.",
      "doctor.finding.noise":       "Heading is tight ({rms}°) but servo running {duty}% duty - possible chatter on a noisy heading signal.",
      "alarm.summary.active":      "{n} active",
      "alarm.summary.muted":       "{n} muted",
      "alarm.summary.off":         "{n} off",
      "alarm.summary.ok":          "all clear",
      "alarm.summary.actShort":    "act",
      "alarm.summary.okShort":     "OK",
      "alarm.summary.mutedShort":  "muted",
      "alarm.summary.offShort":    "off",
      "alarm.summary.firingShort":  "firing",
      "alarm.summary.watchingShort":"watching",
      // Sensor Quality panel (Rev97)
      "setup.quality.title":       "Sensor Quality",
      "setup.quality.hint":        "Freshness and update rate of the SK paths the autopilot depends on. Green = good, amber = degraded, red = lost.",
      "sq.col.sensor":             "Sensor",
      "sq.col.value":              "Value",
      "sq.col.age":                "Age",
      "sq.col.hz":                 "Hz",
      "sq.col.jitter":             "Jitter",
      "sq.col.source":             "Source",
      "sq.col.status":             "Status",
      "sq.action.ignore":          "Ignore",
      "sq.action.restore":         "Restore",
      // Rev135: alarm engine i18n. Backend still emits English via
      // the AP Notifications channel; the visor renders these when
      // present, and everyone else keeps the backend fallback.
      "alarm.rule.heading-deviation.label":    "Heading deviation",
      "alarm.rule.heading-deviation.msg":      "Sustained AP heading error of {deg}°",
      "alarm.rule.unable-to-steer.label":      "Unable to steer",
      "alarm.rule.unable-to-steer.msg":        "AP losing authority: {deg}° error, servo at {duty}% duty",
      "alarm.rule.servo-overcurrent.label":    "Servo overcurrent",
      "alarm.rule.servo-overcurrent.msg":      "Servo overcurrent {amp} A",
      "alarm.rule.servo-temp-high.label":      "Servo temperature high",
      "alarm.rule.servo-temp-high.msg":        "Servo temperature {temp} °C",
      "alarm.rule.low-voltage.label":          "Low voltage",
      "alarm.rule.low-voltage.msg":            "Low voltage {volt} V",
      "alarm.rule.sensor-lost.label":          "Sensor lost",
      "alarm.rule.sensor-lost.msg":            "Sensor lost: {list}",
      "alarm.rule.pypilot-disconnected.label": "pypilot disconnected",
      "alarm.rule.pypilot-disconnected.msg":   "pypilot_web disconnected for {sec}s",
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
      "setup.ssh.password.ph.default": "tc (TinyPilot default)",
      "setup.ssh.password.ph.set": "(set - retype to change)",
      "setup.ssh.defaultHint": "TinyPilot ships with default credentials user <b>tc</b> / password <b>tc</b>. Change them on the Pi if you want tighter security.",
      "setup.ssh.save.btn": "Save",
      "setup.restart.btn": "RESTART pypilot",
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
      "dash.overlays.title": "ROSE OVERLAYS",
      "dash.overlays.hint": "Toggle what floats on the compass rose. Each card lists what data it needs to render.",
      "dash.overlay.awa.title": "A · Apparent wind",
      "dash.overlay.awa.needs": "Amber arrow · needs a wind sensor.",
      "dash.overlay.twa.title": "T · True wind",
      "dash.overlay.twa.needs": "Teal arrow · needs a wind sensor + SOG.",
      "dash.overlay.cog.title": "Course over ground",
      "dash.overlay.cog.needs": "Only shows when SOG > 0.15 kn (boat moving).",
      "dash.overlay.current.title": "Current vector",
      "dash.overlay.current.needs": "Only shows when the log (SOW) is publishing and current > 0.2 kn.",
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
      "info.classic.link":             "Classic pypilot UI ({host}:{port})",
      "info.classic.link.placeholder": "Classic pypilot UI",
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
      "setup.restart.title":         "Emergency restart / reboot",
      "setup.restart.web.title":     "restart pypilot_web",
      "setup.restart.web.sub":       "~3-5 s · AP keeps steering",
      "setup.restart.pypilot.title": "RESTART pypilot",
      "setup.restart.pypilot.sub":   "~10-15 s · AP drops the heading",
      "setup.restart.reboot.title":  "reboot Pi",
      "setup.restart.reboot.sub":    "~35-60 s · full outage",
      "setup.restart.hint":          "Both buttons use the SSH user+password above. RESTART pypilot briefly drops the heading; reboot Pi is a full outage. A helm-manned confirmation is shown before executing. Restart pypilot_web (no steering interruption) is available as a preset in the Debug console below.",
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
      "setup.ssh.exec.ph":      "Enter shell command (e.g. cat /proc/loadavg)",
      "setup.ssh.exec.run":     "Run",
      "setup.ssh.exec.hint":    "Free-form SSH: any command runs as the saved user on the TinyPilot. Arrow up/down navigates history.",
      // Rev115: SSH preset labels (plain human names). Actual shell
      // command in the button's title attribute for the curious.
      "ssh.p.logsPypilot":   "pypilot log",
      "ssh.p.logsWeb":       "pypilot_web log",
      "ssh.p.dmesg":         "System errors",
      "ssh.p.top":           "What is using CPU",
      "ssh.p.uptime":        "Uptime",
      "ssh.p.df":            "Disk space",
      "ssh.p.free":          "RAM memory",
      "ssh.p.ps":            "pypilot processes",
      "ssh.p.ip":            "IP table",
      "ssh.p.iw":            "WiFi",
      "ssh.p.temp":          "Temperature",
      "ssh.p.who":           "Who is connected",
      "ssh.p.ver":           "pypilot version",
      "ssh.p.restartWeb":    "Restart pypilot web",
      // Rev88 / Rev89 / Rev90: Aproado (sail-raising into-the-wind) pseudo-mode
      "aproado.modal.title":       "Head to wind: hoist sail",
      "aproado.modal.sub":         "Point the boat head-to-wind to hoist the sails. Pick which side to swing through.",
      "aproado.choice.bow":        "BY BOW",
      "aproado.choice.stern":      "BY STERN",
      "aproado.choice.recommended":"Recommended",
      "aproado.tws.mild":          "TWS {tws} kn",
      "aproado.tws.hot":           "TWS {tws} kn - jibing is risky, prefer BOW",
      "aproado.cancel":            "Cancel",
      "aproado.cd.exec":           "Starting in",
      "aproado.cd.title.bow":      "HEADING UP BY BOW",
      "aproado.cd.title.stern":    "HEADING UP BY STERN",
      "aproado.transit.title.bow": "TURNING BY BOW",
      "aproado.transit.title.stern":"TURNING BY STERN",
      "aproado.transit.sub":       "Rotating to wind...",
      "aproado.transit.remaining": "still to head-to-wind",
      "aproado.hud.title":         "APROADO",
      "aproado.hud.summary":       "MANEUVER DONE",
      "aproado.hud.dist":          "Dist",
      "aproado.hud.hdg":           "Heading",
      "aproado.hud.exit":          "EXIT",
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
      "cal.advanced.title": "Sliders avanzados",
      "cal.advanced.hint":  "Todos los RangeSettings de pypilot, agrupados. Pulsa largo o pon el raton sobre el nombre para ver la clave pypilot cruda.",
      "cal.grp.rudder":     "Timon",
      "cal.grp.servo":      "Servo",
      "cal.grp.imu":        "IMU",
      "cal.grp.ap":         "Piloto",
      "cal.grp.other":      "Otros",
      "cal.slider.was":     "antes:",
      "cal.slider.restore": "Restaurar valor anterior",
      "cal.stampReset":     "Reset historial",
      "tune.fork.title":    "Guardar cambios de ganancia",
      "tune.fork.body":     "Has movido una ganancia. Donde quieres que se guarde?",
      "tune.fork.keep":     "Guardar en '{pilot}'",
      "tune.fork.new":      "Crear nuevo '{name}'",
      "tune.fork.cancel":   "Cancelar",
      "tune.fork.hint":     "'Crear nuevo' clona el perfil activo y cambia a el, dejando el original intacto. Cancelar cierra el aviso hasta que vuelvas a bloquear.",
      "setup.status.language":  "Activo:",
      "setup.status.host":      "TinyPilot:",
      "setup.status.hostMissing": "sin configurar",
      "setup.status.ssh":       "Usuario SSH configurado:",
      "setup.status.sshConfigured": "SSH Configurado",
      "setup.status.sshSummary": "SSH: {user}",
      "setup.status.sshMissing": "SSH sin configurar",
      "setup.status.sentences": "Sentencias activas:",
      "setup.status.calLast":   "Ultimo ajuste:",
      "setup.status.calNever":  "Todavia no se ha ajustado nada.",
      "setup.status.calNeverShort": "sin ajustar",
      "cal.unlock":         "Desbloquear sliders",
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
      "paths.kip.title": "Sentencias de accion para KIP",
      "paths.kip.hint": "Enlaza estas sentencias con widgets KIP \"Simple Switch\" (filas azules) o \"Put\" (filas verdes).",
      "paths.kip.col.widget":  "Widget",
      "paths.kip.col.path":    "Sentencia",
      "paths.kip.col.type":    "Tipo",
      "paths.kip.col.values":  "Valor(es)",
      "paths.kip.col.copy":    "Copiar",
      "paths.kip.widget.apEngage":  "Activar AP",
      "paths.kip.widget.nudge":     "Correccion rumbo <code>-10 / -1 / +1 / +10</code>",
      "paths.kip.widget.tack":      "Virar <code>babor / estribor / cancelar</code>",
      "paths.kip.widget.mode":      "Modo <code>compas / gps / viento / real / nav</code>",
      "paths.kip.widget.profile":   "Perfil <code>&lt;nombre&gt;</code>",
      "paths.kip.widget.modePut":   "<b>Modo</b> (Put)",
      "paths.kip.widget.targetPut": "Objetivo (Put)",
      "paths.kip.type.simple":    "Simple Switch",
      "paths.kip.type.momentary": "Simple Switch (momentaneo)",
      "paths.kip.type.radio":     "Simple Switch (radio)",
      "paths.kip.type.radioDyn":  "Simple Switch (radio, dinamico)",
      "paths.kip.type.string":    "texto",
      "paths.kip.type.numberRad": "numero (rad)",
      "paths.kip.val.engage":       "1 = activar, 0 = desactivar",
      "paths.kip.val.fireReset":    "1 = disparar, auto-reset",
      "paths.kip.val.fire":         "1 = disparar",
      "paths.kip.val.select":       "1 = seleccionar",
      "paths.kip.val.modeStrings":  "\"compass\" / \"gps\" / \"wind\" / \"true wind\" / \"nav\"",
      "paths.kip.val.targetExample":"p.ej. 1.57 para 90 grados",
      "paths.kip.copy":          "Copiar",
      "paths.kip.copy.plus1":    "Copiar +1",
      "paths.kip.copy.port":     "Copiar babor",
      "paths.kip.copy.compass":  "Copiar compass",
      "paths.kip.copy.prefix":   "Copiar prefijo",
      "paths.all.title": "Todos los paths publicados",
      "paths.search.ph": "filtrar paths...",
      "paths.essentials.label": "Publicar solo esenciales + los activados explicitamente (recomendado)",
      "nudge.title": "Botones correccion rumbo",
      "nudge.small": "Pequeno (-1/+1)",
      "nudge.big": "Grande (-10/+10)",
      "nudge.hint": "Grados anadidos al rumbo objetivo cada vez que pulsas un boton de nudge. Tambien se configura en SK Admin -> Plugin Config -> PyPilot New-UI.",
      "language.title": "Idioma",
      "language.hint": "Solo en este navegador. No pasa por el servidor.",
      // Tabs
      "tab.control": "Control",
      "tab.tune":    "Ajustes",
      "tab.chart":   "Grafica",
      "tab.regata":  "Regata",
      "tab.paths":   "Paths & API",
      "tab.setup":   "Setup",
      "tab.info":    "Info",
      // Chart tab (Rev96)
      "chart.stats.title":         "ESTADISTICAS SESION",
      "chart.session.empty":       "Sesion no iniciada",
      "chart.session.started":     "Sesion iniciada a las",
      "chart.session.ago":         "hace",
      "chart.session.reset":       "Reiniciar",
      "chart.session.confirm":     "Poner las estadisticas a cero? El historico grafico se conserva.",
      "chart.stat.engaged":        "AP activo",
      "chart.stat.distance":       "Distancia",
      "chart.stat.energy":         "Energia",
      "chart.stat.meanErr":        "Error medio",
      "chart.stat.rmsErr":         "RMS error",
      "chart.stat.p95Err":         "p95 error",
      "chart.stat.servoRuntime":   "Servo activo",
      "chart.stat.tacksGybes":     "Viradas / Trasluchadas",
      "chart.stat.maxServoA":      "Max servo A",
      "chart.history.title":       "HISTORICO",
      "chart.history.refresh":     "Actualizar",
      "chart.empty":               "Aun sin datos - esperando primera muestra...",
      "chart.servoHealth.title":   "SALUD DEL SERVO",
      "chart.servoHealth.learning":"Aprendiendo baseline...",
      "chart.servoHealth.baseline":"Baseline",
      "chart.servoHealth.recent":  "Media reciente",
      "chart.servoHealth.deviation":"Desviacion",
      "chart.servoHealth.peak":    "Pico 30 s",
      "chart.servoHealth.temp":    "Temp",
      "chart.servoHealth.voltage": "Voltaje",
      "setup.paths.title":         "Sentencias de Signal K",
      "setup.conn.title":          "Conexion pypilot",
      "setup.conn.status":         "Estado",
      "setup.remoteConsole":       "Consola control remoto",
      // Alarms (Rev101)
      "setup.alarms.title":        "Alarmas",
      "setup.alarms.hint":         "Activa o desactiva cada regla y silencia temporalmente. Las alarmas activas salen en el banner de arriba y publican notificaciones SK canonicas para KIP / WilhelmSK.",
      "alarm.ack":                 "ACK",
      "alarm.acked":               "Ack'd",
      "alarm.mute15":              "Silenciar 15m",
      "alarm.unmute":              "Reactivar",
      "alarm.idle":                "OK",
      "alarm.active":              "ACTIVA",
      "alarm.muted":               "SILENCIADA",
      "alarm.off":                 "OFF",
      // Pre-departure check (Rev102)
      "setup.precheck.title":      "Comprobacion del piloto",
      "setup.precheck.hint":       "Chequeo antes de zarpar. Agrega sensores, servo, voltaje y conectividad en un veredicto unico. Se recalcula cada 3 s mientras esta pestana esta abierta.",
      "setup.precheck.refresh":    "Actualizar",
      "setup.precheck.unknown":    "Comprobando...",
      "setup.precheck.verdict.ready":   "Listo para activar",
      "setup.precheck.verdict.caveats": "Listo con reservas",
      "setup.precheck.verdict.fail":    "NO activar",
      // Doctor (Rev104)
      "setup.doctor.title":        "Asesoramiento y diagnostico",
      "setup.doctor.hint":         "Activa el AP primero y pulsa DIAGNOSTICAR. El plugin graba el error de rumbo y respuesta del servo, y propone ajustes P/I/D. Nada se aplica automaticamente - revisa cada sugerencia y pulsa APLICAR.",
      "setup.doctor.start":        "DIAGNOSTICAR",
      "setup.doctor.cancel":       "Cancelar",
      "setup.doctor.recording":    "Grabando",
      "setup.doctor.analyzing":    "Analizando",
      "setup.doctor.findings":     "Hallazgos",
      "setup.doctor.suggestions":  "Ajustes de gain sugeridos",
      "setup.doctor.apply":        "APLICAR",
      "setup.doctor.applied":      "APLICADO",
      "setup.doctor.applyAll":     "Aplicar todo",
      "setup.doctor.applyAllConfirm": "Aplicar todos los ajustes sugeridos a pypilot?",
      "setup.doctor.confidence":   "Confianza",
      "setup.doctor.samplesSummary": "{engaged} muestras activas de {total}, piloto '{pilot}'.",
      "setup.doctor.forkedProfile":  "Cambios aplicados en un perfil NUEVO {new}. Tu perfil original {orig} queda intacto y a un toque en Ajustes → Perfil.",
      "setup.doctor.discard":   "Descartar",
      "setup.doctor.discarded": "DESCARTADA",
      "setup.doctor.hide":      "Ocultar",
      "doctor.cat.bias":        "sesgo",
      "doctor.cat.oscillation": "oscilacion",
      "doctor.cat.authority":   "autoridad",
      "doctor.cat.noise":       "ruido",
      "doctor.conf.low":        "baja",
      "doctor.conf.medium":     "media",
      "doctor.conf.high":       "alta",
      "doctor.reason.bias":         "El barco se ha desviado del rumbo objetivo {deg}° de media. Esa deriva es lo que corrige la ganancia integral (I) con el tiempo — una I baja hace que el AP tarde mucho (o nunca) en cerrar un desvio persistente.",
      "doctor.effect.bias":         "Subir I deberia borrar la deriva en segundos. Vigila la rueda: una I demasiado alta genera overshoot y empieza a bailar — si lo ves, reduce de nuevo.",
      "doctor.reason.oscillation":  "El rumbo oscila con un periodo de unos {period} segundos. Sin suficiente ganancia derivativa (D) el AP no puede amortiguar sus propias correcciones y el barco culea de un lado a otro.",
      "doctor.effect.oscillation":  "Mas D calma el vaiven y hace que el AP se sienta menos nervioso. La respuesta al timon se vuelve algo mas lenta — es un cambio razonable para conseguir un rumbo mas recto.",
      "doctor.reason.authority":    "El servo esta trabajando mucho pero el barco sigue sin alcanzar el rumbo. Esto es P debil clasico: el AP pide, el timon se mueve, pero la correccion es demasiado pequena.",
      "doctor.effect.authority":    "Una P mayor mete mas timon para el mismo error. Deberia apretar el seguimiento del rumbo. Si empieza a bailar con cada ola, reduce y prueba a subir D en su lugar.",
      "setup.doctor.idle":         "inactivo",
      "setup.doctor.analyzing.short": "analizando...",
      "setup.doctor.healthy":      "sano",
      "setup.doctor.suggested":    "{n} sugerencias",
      "setup.doctor.noted":        "{n} notas",
      "doctor.summary.clean":      "Sin incidencias significativas. Las ganancias parecen sanas.",
      "doctor.summary.notedOnly":  "{issues} incidencia(s) anotada(s) (sin cambio de ganancia sugerido).",
      "doctor.summary.detected":   "{issues} incidencia(s) detectada(s). {suggestions} cambio(s) de ganancia sugerido(s).",
      "doctor.finding.insufficientData": "Solo {n} muestras activas. Analisis omitido - deja el piloto enganchado toda la sesion.",
      "doctor.finding.bias":        "Desvio de rumbo persistente de {deg}° (error medio).",
      "doctor.finding.oscillation": "Rumbo oscilando con periodo ~{period}s, RMS {rms}°.",
      "doctor.finding.authority":   "Servo al {duty}% de trabajo pero el error de rumbo sigue en {rms}°. El piloto pierde autoridad.",
      "doctor.finding.noise":       "Rumbo muy ajustado ({rms}°) pero servo al {duty}% de trabajo - posible ruido en la señal de rumbo.",
      "alarm.summary.active":      "{n} activas",
      "alarm.summary.muted":       "{n} silenciadas",
      "alarm.summary.off":         "{n} off",
      "alarm.summary.ok":          "todo OK",
      "alarm.summary.actShort":    "act",
      "alarm.summary.okShort":     "OK",
      "alarm.summary.mutedShort":  "silen",
      "alarm.summary.offShort":    "off",
      "alarm.summary.firingShort":  "sonando",
      "alarm.summary.watchingShort":"vigilando",
      // Sensor Quality panel (Rev97)
      "setup.quality.title":       "Calidad de sensores",
      "setup.quality.hint":        "Frescura y frecuencia de las rutas SK que usa el AP. Verde = OK, ambar = degradado, rojo = perdido.",
      "sq.col.sensor":             "Sensor",
      "sq.col.value":              "Valor",
      "sq.col.age":                "Edad",
      "sq.col.hz":                 "Hz",
      "sq.col.jitter":             "Jitter",
      "sq.col.source":             "Fuente",
      "sq.col.status":             "Estado",
      "sq.action.ignore":          "Ignorar",
      "sq.action.restore":         "Restaurar",
      "alarm.rule.heading-deviation.label":    "Desvio de rumbo",
      "alarm.rule.heading-deviation.msg":      "Error de rumbo del piloto: {deg}° sostenido",
      "alarm.rule.unable-to-steer.label":      "Piloto sin autoridad",
      "alarm.rule.unable-to-steer.msg":        "El piloto pierde autoridad: {deg}° de error, servo al {duty}%",
      "alarm.rule.servo-overcurrent.label":    "Sobrecorriente servo",
      "alarm.rule.servo-overcurrent.msg":      "Sobrecorriente en el servo: {amp} A",
      "alarm.rule.servo-temp-high.label":      "Temperatura servo alta",
      "alarm.rule.servo-temp-high.msg":        "Temperatura del servo: {temp} °C",
      "alarm.rule.low-voltage.label":          "Tension baja",
      "alarm.rule.low-voltage.msg":            "Tension baja: {volt} V",
      "alarm.rule.sensor-lost.label":          "Sensor perdido",
      "alarm.rule.sensor-lost.msg":            "Sensor perdido: {list}",
      "alarm.rule.pypilot-disconnected.label": "pypilot desconectado",
      "alarm.rule.pypilot-disconnected.msg":   "pypilot_web desconectado desde hace {sec}s",
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
      "setup.ssh.password.ph.default": "tc (por defecto en TinyPilot)",
      "setup.ssh.defaultHint": "TinyPilot viene con credenciales por defecto: usuario <b>tc</b> / contrasena <b>tc</b>. Cambialas en el Pi si quieres mayor seguridad.",
      "setup.ssh.password.ph.set": "(configurado - reescribe para cambiarlo)",
      "setup.ssh.save.btn": "Guardar",
      "setup.restart.btn": "REINICIAR pypilot",
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
      "dash.overlays.title": "CAPAS SOBRE LA ROSA",
      "dash.overlays.hint": "Activa las que quieras ver sobre la rosa. Cada tarjeta indica qué datos necesita.",
      "dash.overlay.awa.title": "A · Viento aparente",
      "dash.overlay.awa.needs": "Flecha amarilla · necesita sensor de viento.",
      "dash.overlay.twa.title": "T · Viento real",
      "dash.overlay.twa.needs": "Flecha verde · necesita sensor de viento + SOG.",
      "dash.overlay.cog.title": "Rumbo real (COG)",
      "dash.overlay.cog.needs": "Solo se ve si SOG > 0,15 nudos (barco en movimiento).",
      "dash.overlay.current.title": "Vector corriente",
      "dash.overlay.current.needs": "Solo se ve si la corredera (SOW) publica y la corriente supera 0,2 nudos.",
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
      "info.classic.link":             "Interfaz clasica pypilot ({host}:{port})",
      "info.classic.link.placeholder": "Interfaz clasica pypilot",
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
      "setup.restart.title":         "Emergencia: reinicio / reboot",
      "setup.restart.web.title":     "restart pypilot_web",
      "setup.restart.web.sub":       "~3-5 s · el AP sigue pilotando",
      "setup.restart.pypilot.title": "REINICIAR pypilot",
      "setup.restart.pypilot.sub":   "~10-15 s · el AP suelta el rumbo",
      "setup.restart.reboot.title":  "reboot de la Pi",
      "setup.restart.reboot.sub":    "~35-60 s · corte total",
      "setup.restart.hint":          "Los dos botones usan el usuario+password SSH de arriba. RESTART pypilot suelta brevemente el pilotaje; reboot de la Pi es corte total. Se muestra una confirmacion pidiendo que haya alguien al timon antes de ejecutar. El restart de pypilot_web (sin interrumpir pilotaje) esta como preset en la consola de Debug de abajo.",
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
      "setup.ssh.exec.ph":      "Escribe un comando shell (ej: cat /proc/loadavg)",
      "setup.ssh.exec.run":     "Ejecutar",
      "setup.ssh.exec.hint":    "SSH libre: cualquier comando se ejecuta como el usuario guardado en el TinyPilot. Flechas arriba/abajo para navegar historial.",
      // Rev115: Etiquetas humanas para presets SSH (comando real en title).
      "ssh.p.logsPypilot":   "Registro pypilot",
      "ssh.p.logsWeb":       "Registro pypilot_web",
      "ssh.p.dmesg":         "Errores sistema",
      "ssh.p.top":           "Que consume CPU",
      "ssh.p.uptime":        "Tiempo encendido",
      "ssh.p.df":            "Espacio disco",
      "ssh.p.free":          "Memoria RAM",
      "ssh.p.ps":            "Procesos pypilot",
      "ssh.p.ip":            "Tabla IP",
      "ssh.p.iw":            "WiFi",
      "ssh.p.temp":          "Temperatura",
      "ssh.p.who":           "Quien esta conectado",
      "ssh.p.ver":           "Version pypilot",
      "ssh.p.restartWeb":    "Reiniciar web pypilot",
      // Rev88 / Rev89 / Rev90: Aproado (subir velas al viento) pseudo-modo
      "aproado.modal.title":       "Aproarse: subir vela",
      "aproado.modal.sub":         "Poner barco cara al viento para izar las velas. Elige por que lado hacer la maniobra.",
      "aproado.choice.bow":        "POR PROA",
      "aproado.choice.stern":      "POR POPA",
      "aproado.choice.recommended":"Recomendado",
      "aproado.tws.mild":          "Viento real {tws} kn",
      "aproado.tws.hot":           "Viento real {tws} kn - trasluchar es delicado, mejor PROA",
      "aproado.cancel":            "Cancelar",
      "aproado.cd.exec":           "Ejecutando en",
      "aproado.cd.title.bow":      "APROARSE POR PROA",
      "aproado.cd.title.stern":    "APROARSE POR POPA",
      "aproado.transit.title.bow": "APROANDOSE POR PROA",
      "aproado.transit.title.stern":"APROANDOSE POR POPA",
      "aproado.transit.sub":       "Girando al viento...",
      "aproado.transit.remaining": "aun para estar aproado",
      "aproado.hud.title":         "APROADO",
      "aproado.hud.summary":       "MANIOBRA COMPLETADA",
      "aproado.hud.dist":          "Dist",
      "aproado.hud.hdg":           "Rumbo",
      "aproado.hud.exit":          "SALIR",
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
      // Rev134: setup-tile summary chips + tune fork modal + info bar.
      "setup.status.language":     "Aktiv:",
      "setup.status.host":         "TinyPilot:",
      "setup.status.hostMissing":  "nicht konfiguriert",
      "setup.status.ssh":          "SSH-Benutzer konfiguriert:",
      "setup.status.sshConfigured": "SSH konfiguriert",
      "setup.status.sshSummary":   "SSH: {user}",
      "setup.status.sshMissing":   "SSH nicht konfiguriert",
      "setup.status.sentences":    "Aktive Saetze:",
      "setup.status.calLast":      "Letzte Anpassung:",
      "setup.status.calNever":     "Noch keine Anpassung.",
      "setup.status.calNeverShort":"noch nicht angepasst",
      "tune.fork.title":  "Aenderungen speichern",
      "tune.fork.body":   "Du hast eine Verstaerkung geaendert. Wohin damit?",
      "tune.fork.keep":   "In '{pilot}' behalten",
      "tune.fork.new":    "Neu speichern als '{name}'",
      "tune.fork.cancel": "Abbrechen",
      "tune.fork.hint":   "'Neu' klont das aktive Profil und wechselt dorthin. Das Original bleibt unveraendert.",
      "info.classic.link":             "Klassische pypilot-UI ({host}:{port})",
      "info.classic.link.placeholder": "Klassische pypilot-UI",
      "cal.slider.was":     "vorher:",
      "cal.slider.restore": "Frueheren Wert wiederherstellen",
      "setup.conn.title":     "pypilot-Verbindung",
      "setup.remoteConsole":  "Fernsteuerungskonsole",
      "setup.alarms.title":   "Alarme",
      "setup.quality.title":  "Sensor-Qualitaet",
      "setup.paths.title":    "Pfade & API",
      "setup.precheck.title": "Autopilot-Check",
      "setup.doctor.title":   "Diagnose & Empfehlungen",
      "alarm.rule.heading-deviation.label":    "Kursabweichung",
      "alarm.rule.heading-deviation.msg":      "AP-Kursfehler {deg}° anhaltend",
      "alarm.rule.unable-to-steer.label":      "AP verliert Steuerung",
      "alarm.rule.unable-to-steer.msg":        "AP verliert Autoritaet: {deg}° Fehler, Servo {duty}%",
      "alarm.rule.servo-overcurrent.label":    "Servo-Ueberstrom",
      "alarm.rule.servo-overcurrent.msg":      "Servo-Ueberstrom {amp} A",
      "alarm.rule.servo-temp-high.label":      "Servo-Temperatur hoch",
      "alarm.rule.servo-temp-high.msg":        "Servo-Temperatur {temp} °C",
      "alarm.rule.low-voltage.label":          "Unterspannung",
      "alarm.rule.low-voltage.msg":            "Unterspannung {volt} V",
      "alarm.rule.sensor-lost.label":          "Sensor verloren",
      "alarm.rule.sensor-lost.msg":            "Sensor verloren: {list}",
      "alarm.rule.pypilot-disconnected.label": "pypilot getrennt",
      "alarm.rule.pypilot-disconnected.msg":   "pypilot_web {sec}s getrennt",
      "doctor.summary.clean":      "Keine relevanten Probleme. Die Gains wirken gesund.",
      "doctor.summary.notedOnly":  "{issues} Punkt(e) notiert (keine Gain-Aenderung vorgeschlagen).",
      "doctor.summary.detected":   "{issues} Problem(e) erkannt. {suggestions} Gain-Aenderung(en) vorgeschlagen.",
      "doctor.finding.bias":        "Anhaltender Kursversatz von {deg}° (mittlerer Fehler).",
      "doctor.finding.oscillation": "Kurs schwingt mit Periode ~{period}s, RMS {rms}°.",
      "doctor.finding.authority":   "Servo bei {duty}% aber Kursfehler {rms}°. AP verliert Autoritaet.",
      "doctor.finding.noise":       "Kurs sehr eng ({rms}°) aber Servo bei {duty}% - moegliches Rauschen im Kurssignal.",
      // Restart triad + helm
      "setup.restart.title":         "Notfall-Neustart / Reboot",
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
      // Rev134: setup-tile summary chips + tune fork modal + info bar.
      "setup.status.language":     "Actif:",
      "setup.status.host":         "TinyPilot:",
      "setup.status.hostMissing":  "non configure",
      "setup.status.ssh":          "Utilisateur SSH configure:",
      "setup.status.sshConfigured": "SSH configure",
      "setup.status.sshSummary":   "SSH: {user}",
      "setup.status.sshMissing":   "SSH non configure",
      "setup.status.sentences":    "Phrases actives:",
      "setup.status.calLast":      "Dernier ajustement:",
      "setup.status.calNever":     "Aucun ajustement enregistre.",
      "setup.status.calNeverShort":"non ajuste",
      "tune.fork.title":  "Enregistrer les changements de gain",
      "tune.fork.body":   "Tu as modifie un gain. Ou l'enregistrer?",
      "tune.fork.keep":   "Garder dans '{pilot}'",
      "tune.fork.new":    "Enregistrer dans '{name}'",
      "tune.fork.cancel": "Annuler",
      "tune.fork.hint":   "'Nouveau' clone le profil actif et bascule dessus, l'original reste intact.",
      "info.classic.link":             "UI pypilot classique ({host}:{port})",
      "info.classic.link.placeholder": "UI pypilot classique",
      "cal.slider.was":     "avant:",
      "cal.slider.restore": "Restaurer la valeur precedente",
      "setup.conn.title":     "Connexion pypilot",
      "setup.remoteConsole":  "Console de controle distant",
      "setup.alarms.title":   "Alarmes",
      "setup.quality.title":  "Qualite capteurs",
      "setup.paths.title":    "Paths & API",
      "setup.precheck.title": "Verification autopilote",
      "setup.doctor.title":   "Diagnostic & Conseils",
      "alarm.rule.heading-deviation.label":    "Deviation de cap",
      "alarm.rule.heading-deviation.msg":      "Erreur de cap AP {deg}° soutenue",
      "alarm.rule.unable-to-steer.label":      "AP en perte d'autorite",
      "alarm.rule.unable-to-steer.msg":        "AP en perte d'autorite: {deg}° d'erreur, servo a {duty}%",
      "alarm.rule.servo-overcurrent.label":    "Surintensite servo",
      "alarm.rule.servo-overcurrent.msg":      "Surintensite servo {amp} A",
      "alarm.rule.servo-temp-high.label":      "Temperature servo elevee",
      "alarm.rule.servo-temp-high.msg":        "Temperature servo {temp} °C",
      "alarm.rule.low-voltage.label":          "Tension basse",
      "alarm.rule.low-voltage.msg":            "Tension basse {volt} V",
      "alarm.rule.sensor-lost.label":          "Capteur perdu",
      "alarm.rule.sensor-lost.msg":            "Capteur perdu: {list}",
      "alarm.rule.pypilot-disconnected.label": "pypilot deconnecte",
      "alarm.rule.pypilot-disconnected.msg":   "pypilot_web deconnecte depuis {sec}s",
      "doctor.summary.clean":      "Aucun probleme majeur. Les gains ont l'air sains.",
      "doctor.summary.notedOnly":  "{issues} point(s) note(s) (aucun changement de gain suggere).",
      "doctor.summary.detected":   "{issues} probleme(s) detecte(s). {suggestions} changement(s) de gain suggere(s).",
      "doctor.finding.bias":        "Decalage de cap persistant de {deg}° (erreur moyenne).",
      "doctor.finding.oscillation": "Cap oscillant avec periode ~{period}s, RMS {rms}°.",
      "doctor.finding.authority":   "Servo a {duty}% mais erreur de cap {rms}°. AP en perte d'autorite.",
      "doctor.finding.noise":       "Cap tres serre ({rms}°) mais servo a {duty}% - bruit possible dans le signal de cap.",
      // Restart triad + helm
      "setup.restart.title":         "Urgence : redemarrage / reboot",
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
    // Rev130: language card badge changes with the language.
    if (typeof _refreshSetupBadges === "function") _refreshSetupBadges();
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
    // Rev112: data-i18n-html for strings that legitimately carry inline
    // markup (<code>, <b>...) - textContent would escape them.
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      el.innerHTML = t(key);
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
    sow: null,                 // m/s (Rev85: navigation.speedThroughWater)
    // Rev65 / 2.0.2 - wind-corner display preference. "awa" or "twa".
    // Initial value derives from the browser-stored preference; if
    // absent, defaults to "awa" and later auto-follows the AP mode
    // (see _syncWindCornerFromMode).
    windCornerShow: (() => {
      try { return localStorage.getItem("pypilot-newui.windCornerShow") || "awa"; }
      catch { return "awa"; }
    })(),
    windCornerUserPinned: (() => {
      // User's manual tap "pins" the choice so mode changes stop
      // overwriting it. Persistent per browser.
      try { return localStorage.getItem("pypilot-newui.windCornerPinned") === "1"; }
      catch { return false; }
    })(),
    // Rev88: navigation.position { latitude, longitude } in decimal degrees.
    // Needed to compute the straight-line distance travelled during an
    // "Aproado" maneuver.
    position: null,
    // Rev88: "Aproado" pseudo-mode runtime state. Null when inactive.
    // Non-null shape: { phase:"choosing"|"active"|"summary",
    //                   direction:"bow"|"stern"|null,
    //                   snapshot:{ mode, targetRad, headingRad, engaged, ts },
    //                   startTs, endTs,
    //                   startPos:{lat,lon}|null,
    //                   startHeadingDeg,
    //                   distanceNm,
    //                   _modalTimer, _hudTimer, _summaryTimer }
    aproado: null,
  };

  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;

  // Rev82: piece-label flip helper. Given a piece's rotation in
  // degrees, returns the LOCAL rotation to apply to its "A"/"T"
  // letter so the letter has only TWO possible orientations
  // (0° or 180° in the piece's local frame). Rule per Carlos:
  //   piece_angle normalized to [0, 360):
  //     [271, 360) ∪ [0, 90]  → 0   (front half, letter as-is)
  //     [91, 270]             → 180 (rear half, letter flipped)
  // The letter's vertical axis stays on the piece's tips axis in
  // both cases; the flip just prevents the glyph from ending up
  // completely upside-down when the piece points aft.
  function _pieceLabelFlipDeg(pieceDeg) {
    const n = ((pieceDeg % 360) + 360) % 360;
    return (n >= 91 && n <= 270) ? 180 : 0;
  }

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
      // Rev85: SOW (speedThroughWater) needed to compute the current
      // vector as (SOG − SOW).
      "navigation.speedThroughWater",
      // Rev88: position for "Aproado" maneuver distance tracking.
      "navigation.position",
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
    // Rev96: stats KPIs live under steering.autopilot.pypilot.stats.*
    // and land here via the existing wildcard subscription. Fan them
    // out to the Trip Stats cards; return early - none of them need to
    // go through the pypilot mapping / gain-row logic below.
    if (path.indexOf("steering.autopilot.pypilot.stats.") === 0) {
      _applyStatsPath(path, value);
      return;
    }
    // Rev99: servo health paths feed a dedicated card in the Chart tab.
    // Also intercept the raw voltage / controller_temp paths for the
    // "battery + temperature" sub-cells - they come from the same
    // wildcard subscription so no extra socket work.
    if (_applyServoHealthPath(path, value)) return;
    switch (path) {
      case "steering.autopilot.state":            state.apState = value; break;
      case "steering.autopilot.mode":
        state.mode = value;
        // Rev88 / Rev90: while the local "Aproado" pseudo-mode is active
        // (transit or aproado achieved), pypilot reports "wind" (what we
        // sent). Keep the dropdown pinned on "aproado" so the user sees
        // the pseudo-mode they picked. Summary phase releases the pin so
        // the restored mode shows through.
        if (state.aproado && (state.aproado.phase === "transit" || state.aproado.phase === "active")) {
          setSelect("#mode-select", "aproado");
        } else {
          setSelect("#mode-select", value);
        }
        _syncWindCornerFromMode(value);
        break;
      case "steering.autopilot.target":           state.target = numericOrNull(value); renderTargetArrow(); break;
      case "steering.autopilot.engaged":          state.engaged = !!value; renderEngage(); renderTargetArrow(); break;
      case "steering.autopilot.availableActions": state.availableActions = value || []; break;
      // Rev63 / 2.0.0: verbatim path is `ap.modes` (was `availableModes` alias).
      // Rev88: append the local pseudo-mode "aproado" (into-the-wind) so it
      // shows up in the dropdown alongside the pypilot-provided modes. It is
      // never sent to pypilot as-is: the change handler intercepts it and
      // runs the local aproado state machine (switches pypilot to `wind`
      // under the hood + sets the target).
      case "steering.autopilot.pypilot.ap.modes":
        if (Array.isArray(value)) {
          state.modeList = value.slice();
          const withAproado = value.includes("aproado") ? value : [...value, "aproado"];
          fillSelect("#mode-select", withAproado);
          // If aproado is currently active or transitioning, keep the dropdown pinned on it.
          if (state.aproado && (state.aproado.phase === "transit" || state.aproado.phase === "active")) {
            setSelect("#mode-select", "aproado");
          }
        }
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
        state.heading = numericOrNull(value); renderCogAndCurrent(); break;
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
        state.sog = numericOrNull(value); renderCogAndCurrent(); break;
      case "navigation.courseOverGroundTrue":
        state.cog = numericOrNull(value); renderCogAndCurrent(); break;
      case "navigation.speedThroughWater":
        state.sow = numericOrNull(value); renderCogAndCurrent(); break;
      case "navigation.position":
        if (value && typeof value === "object" &&
            typeof value.latitude === "number" &&
            typeof value.longitude === "number") {
          state.position = { lat: value.latitude, lon: value.longitude };
        }
        break;
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
        // Fallback width when SVG has not laid out yet (tab not visible).
        // Rev65: HDG font shrunk from 18 to 14 for the new chip, so the
        // per-char heuristic drops from 12 to 9 units.
        let w;
        try { w = hdgTxt.getComputedTextLength(); } catch { w = s.length * 9; }
        if (!isFinite(w) || w <= 0) w = s.length * 9;
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
    // Rev66 / 2.0.4 (Carlos): awa/twa muestran ANGULO + VELOCIDAD juntos
    // como el `wind` combo. aws/tws solo velocidad para quien la quiera sola.
    awa:   { label: "AWA/AWS", read: () => {
              const a = state.windAngle == null ? "---" : _sgn(state.windAngle * RAD2DEG) + "°";
              const s = state.windSpeed == null ? "---" : (state.windSpeed * 1.94384).toFixed(1) + " kn";
              return { value: a, sub: s };
            } },
    aws:   { label: "AWS", read: () => state.windSpeed  == null ? "---" : (state.windSpeed  * 1.94384).toFixed(1) + " kn" },
    twa:   { label: "TWA/TWS", read: () => {
              const a = state.windAngleTrue == null ? "---" : _sgn(state.windAngleTrue * RAD2DEG) + "°";
              const s = state.windSpeedTrue == null ? "---" : (state.windSpeedTrue * 1.94384).toFixed(1) + " kn";
              return { value: a, sub: s };
            } },
    tws:   { label: "TWS", read: () => state.windSpeedTrue == null ? "---" : (state.windSpeedTrue * 1.94384).toFixed(1) + " kn" },
    twd:   { label: "TWD", read: () => state.windDirTrue   == null ? "---" : Math.round(state.windDirTrue * RAD2DEG) + "°" },
    // Rev65 / 2.0.2: the "wind" corner now honours a user-toggleable
    // preference (state.windCornerShow: "awa" or "twa"), overridable by
    // a short tap on the corner. When the AP mode changes TO true-wind,
    // the preference auto-flips to TWA/TWS; when it changes AWAY from
    // true-wind, it flips back to AWA/AWS. Manual taps after that stick
    // until the mode flips again (see _syncWindCornerFromMode).
    wind:  { label: () => (state.windCornerShow === "twa" ? "TWA/TWS" : "AWA/AWS"),
             read: () => {
               const useTrue = state.windCornerShow === "twa";
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
  // Rev65 / 2.0.2: short tap on the "wind" corner flips the preference
  // between AWA/AWS and TWA/TWS, and pins it so mode auto-changes stop
  // overwriting it until the user opts back into auto-follow.
  function _toggleWindCornerShow() {
    state.windCornerShow = (state.windCornerShow === "twa") ? "awa" : "twa";
    state.windCornerUserPinned = true;
    try {
      localStorage.setItem("pypilot-newui.windCornerShow", state.windCornerShow);
      localStorage.setItem("pypilot-newui.windCornerPinned", "1");
    } catch {}
    _dashRenderCorners();
    renderWindRose();
  }
  // Called from applyValue whenever the AP mode changes. If the user has
  // not pinned the wind-corner preference, follow the mode: true-wind
  // modes show TWA/TWS, everything else shows AWA/AWS.
  function _syncWindCornerFromMode(mode) {
    if (state.windCornerUserPinned) return;
    const wantTrue = String(mode || "").toLowerCase().includes("true");
    const next = wantTrue ? "twa" : "awa";
    if (state.windCornerShow === next) return;
    state.windCornerShow = next;
    try { localStorage.setItem("pypilot-newui.windCornerShow", next); } catch {}
    _dashRenderCorners();
    renderWindRose();
  }
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
    // Rev85: navigation overlays — COG line (yellow chevrons from bow)
    // and current vector (SOG − SOW blue arrow at boat). Each stored
    // independently in localStorage. Toggle re-renders immediately.
    const cogCb = document.getElementById("dash-show-cog");
    const curCb = document.getElementById("dash-show-current");
    if (cogCb) { cogCb.checked = _showCog;     cogCb.onchange = () => _setShowCog(cogCb.checked); }
    if (curCb) { curCb.checked = _showCurrent; curCb.onchange = () => _setShowCurrent(curCb.checked); }

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

  // Rev85: preferences for the new COG line + current vector overlays.
  // Each stored independently in localStorage; toggled by the selector
  // popup checkboxes (dash-show-cog / dash-show-current) or via
  // long-press on any corner cell or the boat sprite.
  const SHOW_COG_LS     = "pypilot-newui.showCog";
  const SHOW_CURRENT_LS = "pypilot-newui.showCurrent";
  let _showCog = false;
  let _showCurrent = false;
  try {
    const c = localStorage.getItem(SHOW_COG_LS);
    const u = localStorage.getItem(SHOW_CURRENT_LS);
    if (c != null) _showCog = c === "1";
    if (u != null) _showCurrent = u === "1";
  } catch {}
  function _setShowCog(on) {
    _showCog = !!on;
    try { localStorage.setItem(SHOW_COG_LS, on ? "1" : "0"); } catch {}
    renderCogAndCurrent();
  }
  function _setShowCurrent(on) {
    _showCurrent = !!on;
    try { localStorage.setItem(SHOW_CURRENT_LS, on ? "1" : "0"); } catch {}
    renderCogAndCurrent();
  }

  // Rev85: compute current vector from SOG (over ground) minus SOW
  // (over water). Both need direction. SOG uses COG; SOW uses HDG
  // (water flows past the boat parallel to its heading). Returns
  // { dirFromBoat, magKn } or null if any input missing or negligible.
  // `dirFromBoat` is the direction the current COMES FROM in boat
  // frame (radians, 0 = bow). The arrow is rendered with its TIP
  // pointing at the boat, so rotating by dirFromBoat places the
  // tail at the "come-from" angle and the tip on the boat.
  function _computeCurrent() {
    if (state.sog == null || state.cog == null || state.sow == null || state.heading == null) return null;
    const sogE = state.sog * Math.sin(state.cog);
    const sogN = state.sog * Math.cos(state.cog);
    const sowE = state.sow * Math.sin(state.heading);
    const sowN = state.sow * Math.cos(state.heading);
    const curE = sogE - sowE;
    const curN = sogN - sowN;
    const magMs = Math.sqrt(curE * curE + curN * curN);
    if (magMs < 0.1) return null; // < ~0.2 kn - noise, hide
    const dirFlowWorld = Math.atan2(curE, curN);       // rad, 0=N, where flow GOES
    const dirFromWorld = dirFlowWorld + Math.PI;        // where flow COMES FROM
    const dirFromBoat  = dirFromWorld - state.heading;  // relative to bow
    return { dirFromBoat, magKn: magMs * 1.94384 };
  }

  function renderCogAndCurrent() {
    // COG line: yellow chevron chain from bow toward course-over-ground
    // direction. Only visible when SOG > 0.15 kn (~ moving) and toggle on.
    const cogEl = document.getElementById("rose-cog-line");
    if (cogEl) {
      const cogSog = (state.sog || 0) * 1.94384;
      if (_showCog && state.cog != null && state.heading != null && cogSog > 0.15) {
        const dirBoat = (state.cog - state.heading) * RAD2DEG;
        cogEl.setAttribute("transform", `rotate(${dirBoat.toFixed(1)})`);
        cogEl.style.display = "";
      } else {
        cogEl.style.display = "none";
      }
    }
    // Current vector: two parallel wavy blue lines + 3 triangles
    // pointing at the boat.
    const curEl = document.getElementById("rose-current-arrow");
    if (curEl) {
      const cur = _showCurrent ? _computeCurrent() : null;
      if (cur) {
        curEl.setAttribute("transform", `rotate(${(cur.dirFromBoat * RAD2DEG).toFixed(1)})`);
        curEl.style.display = "";
      } else {
        curEl.style.display = "none";
      }
    }
  }

  // SVG compass rose. The card (cardinals + ticks) rotates so N points to
  // magnetic north regardless of boat heading; the boat is fixed pointing
  // up; TWO independent wind arrows (AWA amber solid, TWA sea-green solid)
  // rotate to their respective angles; wedges are boat-fixed helm guides;
  // the bottom AWS/TWS readout follows the user's wind-corner preference.
  function renderWindRose() {
    const card = document.getElementById("rose-card");
    if (card && state.heading != null) {
      card.setAttribute("transform", `rotate(${-state.heading * RAD2DEG})`);
    }

    // Rev73: gota-chain redesign. IDs updated from rose-wind-arrow /
    // rose-wind-arrow-twa (line + arrowhead + text label) to
    // rose-piece-awa / rose-piece-twa (concave-quadrilateral SVG
    // shapes that interlock with the target diamond into a "gota"
    // when target = AWA = TWA). Rotation logic unchanged: each piece
    // sits at its own wind angle in the boat frame.
    // Rev81/82: label inside each piece uses a TWO-ORIENTATION flip
    // (0° or 180° in the piece's local frame) so its vertical axis
    // stays on the piece's tips axis (spine). Front-half angles
    // (271°..90° through bow) → no local rotation. Rear-half angles
    // (91°..270° through stern) → local 180° flip so the glyph is
    // not fully upside-down when the piece points aft.
    // Rev125 (Carlos): REVERTED to original mapping - amber piece is
    // AWA (apparent), teal piece is TWA (true). The Rev122 swap was
    // undone: amber-big-"A" = apparent, teal-spiky-"T" = true.
    const awa = document.getElementById("rose-piece-awa");           // amber piece = AWA
    const awaRaya = document.getElementById("rose-raya-awa");
    if (awa) {
      if (_windArrowShow.awa && state.windAngle != null) {
        const awaDeg = state.windAngle * RAD2DEG;
        awa.setAttribute("transform", `rotate(${awaDeg})`);
        const awaLbl = document.getElementById("rose-piece-awa-label");
        if (awaLbl) awaLbl.setAttribute("transform", `rotate(${_pieceLabelFlipDeg(awaDeg)}, 0, -38)`);
        awa.style.display = "";
        if (awaRaya) {
          awaRaya.setAttribute("transform", `rotate(${awaDeg})`);
          awaRaya.style.display = "";
        }
      } else {
        awa.style.display = "none";
        if (awaRaya) awaRaya.style.display = "none";
      }
    }
    const twa = document.getElementById("rose-piece-twa");           // teal piece = TWA
    const twaRaya = document.getElementById("rose-raya-twa");
    if (twa) {
      if (_windArrowShow.twa && state.windAngleTrue != null) {
        const twaDeg = state.windAngleTrue * RAD2DEG;
        twa.setAttribute("transform", `rotate(${twaDeg})`);
        const twaLbl = document.getElementById("rose-piece-twa-label");
        if (twaLbl) twaLbl.setAttribute("transform", `rotate(${_pieceLabelFlipDeg(twaDeg)}, 0, -56)`);
        twa.style.display = "";
        if (twaRaya) {
          twaRaya.setAttribute("transform", `rotate(${twaDeg})`);
          twaRaya.style.display = "";
        }
      } else {
        twa.style.display = "none";
        if (twaRaya) twaRaya.style.display = "none";
      }
    }

    // Rev65 / 2.0.2: bottom AWS/TWS readout now uses TWO separate text
    // nodes (small dim label on top, big white number below) and follows
    // `state.windCornerShow` so a tap on the wind corner also swaps the
    // readout at the bottom of the rose. Falls back gracefully if the
    // chosen source has no value yet.
    const useTrue = state.windCornerShow === "twa";
    const primarySpd = useTrue ? state.windSpeedTrue : state.windSpeed;
    const primaryTag = useTrue ? "TWS" : "AWS";
    let windSpeed = primarySpd, tag = primaryTag;
    if (windSpeed == null) {
      // Fall back to the other source so the number is not "---" when only
      // one wind flavour is available (typical on boats without SOG).
      const altSpd = useTrue ? state.windSpeed : state.windSpeedTrue;
      const altTag = useTrue ? "AWS" : "TWS";
      if (altSpd != null) { windSpeed = altSpd; tag = altTag; }
    }
    const speedLabel = document.getElementById("rose-speed-label");
    const speedText  = document.getElementById("rose-speed");
    if (speedLabel) speedLabel.textContent = windSpeed == null ? "" : tag;
    if (speedText) {
      speedText.textContent = windSpeed == null
        ? "--- kn"
        : (windSpeed * 1.94384).toFixed(1) + " kn";
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
    const raya = document.getElementById("rose-raya");
    if (!g) return;
    if (!state.engaged || state.target == null) {
      g.style.display = "none";
      if (raya) raya.style.display = "none";
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
      if (raya) raya.style.display = "none";
      return;
    }
    const rot = deg.toFixed(1);
    g.setAttribute("transform", `rotate(${rot})`);
    g.style.display = "";
    // Rev73: raya rotates with the target and shows on top of the
    // diamond as a black tick with a subtle white halo. Only visible
    // when the AP is engaged (i.e., when there is a target to point at).
    if (raya) {
      raya.setAttribute("transform", `rotate(${rot})`);
      raya.style.display = "";
    }
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

  // Rev66 / 2.0.4 - cache to avoid repainting ticks every rudder delta.
  let _lastRudderRange = null;
  function _renderRudderScale(rangeDeg) {
    const ticksBox = $("#rudder-ticks");
    if (!ticksBox) return;
    ticksBox.innerHTML = "";
    // Ticks cada 10 deg, majors + labels cada 20 deg. Include 0 in the
    // middle. Sign of the number tells the side.
    const step = 10;
    for (let d = -Math.round(rangeDeg); d <= Math.round(rangeDeg); d += step) {
      const pct = 50 + (d / rangeDeg) * 50;
      const tick = document.createElement("div");
      tick.className = (d % 20 === 0) ? "rt major" : "rt";
      tick.style.left = pct.toFixed(2) + "%";
      ticksBox.appendChild(tick);
      // Numeric labels every 20 deg, but skip the extremes (already shown
      // by the left/right end labels) and skip 0 (would clash with the
      // yellow nav-toggle triangle in the middle).
      if (d % 20 === 0 && d !== 0 && Math.abs(d) < rangeDeg - 2) {
        const label = document.createElement("div");
        label.className = "rl";
        label.style.left = pct.toFixed(2) + "%";
        label.textContent = (d > 0 ? "+" : "") + d;
        ticksBox.appendChild(label);
      }
    }
  }
  function renderRudder(rad) {
    // Rev66 / 2.0.4: update the rudder-range labels FIRST so they show
    // even before the first rudder delta arrives (no rudder yet ->
    // marker centred but labels visible). Range from pypilot catalog,
    // defaults to 70 deg.
    const rangeDeg = Number(state.values?.["steering.autopilot.pypilot.rudder.range"]) || 70;
    const lLeft  = $("#rudder-label-left");
    const lRight = $("#rudder-label-right");
    if (lLeft)  lLeft.textContent  = "-" + Math.round(rangeDeg);
    if (lRight) lRight.textContent = "+" + Math.round(rangeDeg);
    if (rangeDeg !== _lastRudderRange) {
      _renderRudderScale(rangeDeg);
      _lastRudderRange = rangeDeg;
    }
    // Legacy widget (still hidden by default) - kept in case someone wires it.
    const w = $("#rudder-widget");
    if (rad == null) {
      if (w) w.setAttribute("hidden", "");
      // Centre the swipe-hint rudder marker so it looks amidships when
      // data is missing rather than sticking to some old value.
      const m = $("#rudder-marker");
      if (m) m.style.left = "50%";
      return;
    }
    if (w) w.removeAttribute("hidden");
    const deg = rad * RAD2DEG;
    const pct45 = Math.max(-1, Math.min(1, deg / 45));
    const fill = $("#rudder-fill");
    if (fill) {
      fill.style.width = Math.abs(pct45 * 50) + "%";
      fill.style.transform = pct45 < 0 ? "translateX(-100%)" : "translateX(0%)";
    }
    const val = $("#rudder-value");
    if (val) val.textContent = deg.toFixed(1) + " deg";
    const marker = $("#rudder-marker");
    if (marker) {
      const pct = Math.max(-1, Math.min(1, deg / rangeDeg));
      // pct = -1 -> left edge (0%), 0 -> center (50%), +1 -> right edge (100%).
      marker.style.left = (50 + pct * 50).toFixed(1) + "%";
    }
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
    // Rev117: opts.unlocked=true bypasses the tune-unlock guard (used by
    // Calibration sliders in Setup which have no lock checkbox nearby).
    const unlockCb = document.getElementById("tune-unlock");
    const forcedUnlocked = opts.unlocked === true;
    const locked = !forcedUnlocked && !(unlockCb && unlockCb.checked);
    if (locked) {
      rng.setAttribute("disabled", "");
      row.querySelectorAll(".nudge-btn").forEach((b) => b.setAttribute("disabled", ""));
    }
    // Rev117: baseline "was" value for sliders that live outside the
    // Tune tab (Calibration in Setup). We show it right away with the
    // current pypilot value so the user always has a reference point
    // to compare against while dragging.
    if (opts.showBaseline && opts.cur != null) {
      const baseEl = row.querySelector(".baseline");
      if (baseEl) {
        const label = t("cal.slider.was") || "was:";
        baseEl.textContent = `${label} ${Number(opts.cur).toFixed(decimals)}`;
        baseEl.setAttribute("data-baseline", String(opts.cur));
        baseEl.hidden = false;
      }
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
    // Rev116: also refresh the Calibration mirror in Setup.
    renderCalibrationSliders();
  }

  // Rev116-118 (Carlos): render every pypilot RangeSetting inside the
  // Calibration card in Setup, grouped by category (rudder / servo /
  // imu / ap / other). Skips gain rows (ap.pilot.*) since Tune owns those.
  //
  // Rev118 fixes:
  //  - Baseline is captured ONCE per name (in _calBaselines Map) and
  //    NEVER updated by subsequent renders. Carlos lost a slew_slow
  //    tweak because a re-render moved the baseline to the just-edited
  //    value, so a later reset lost the good number.
  //  - DOM is now updated IN PLACE (input value + live label) on each
  //    poll instead of recreated. Prevents the baseline from
  //    "disappearing" every catalog refresh.
  //  - Locked by default (checkbox "Desbloquear sliders" at the top of
  //    the section), same safety net as Tune.
  //  - Every slider has a per-row restore button that snaps back to the
  //    captured baseline and PUTs it to pypilot.
  const _CAL_GROUPS = [
    { key: "rudder", i18n: "cal.grp.rudder",  match: (n) => n.startsWith("rudder.") },
    { key: "servo",  i18n: "cal.grp.servo",   match: (n) => n.startsWith("servo.") },
    { key: "imu",    i18n: "cal.grp.imu",     match: (n) => n.startsWith("imu.") },
    { key: "ap",     i18n: "cal.grp.ap",      match: (n) => n.startsWith("ap.") && !n.startsWith("ap.pilot.") },
    { key: "other",  i18n: "cal.grp.other",   match: () => true },
  ];
  const _calBaselines = new Map();   // name → first-seen value (frozen)
  const _calRows = new Map();        // name → { row, rng, val, resetBtn, baselineEl }
  // Rev129 (Carlos): same pattern for the Tune tab gain sliders.
  // Baseline is captured ONCE (first non-null value seen) and never
  // overwritten so the ↺ restore button always returns to the profile's
  // last-known-good value. `_tuneForkAsked` is a session-scoped guard:
  // the "save in current profile or fork?" modal fires ONLY on the
  // first gain change per unlock; further tweaks assume the choice.
  const _tuneBaselines = new Map();  // shortName → first-seen value
  const _tuneForkAsked = { v: false };
  let _tuneLastChange = null;        // { pypilotKey, baselineKey, rng, val }

  function _calCurrentlyUnlocked() {
    const cb = document.getElementById("calib-unlock");
    return !!(cb && cb.checked);
  }
  function _applyCalibLockState() {
    const unlocked = _calCurrentlyUnlocked();
    for (const { row, rng, resetBtn } of _calRows.values()) {
      if (!row) continue;
      row.querySelectorAll(".nudge-btn").forEach((b) => {
        if (unlocked) b.removeAttribute("disabled"); else b.setAttribute("disabled", "");
      });
      if (rng) {
        if (unlocked) rng.removeAttribute("disabled"); else rng.setAttribute("disabled", "");
      }
      if (resetBtn) {
        if (unlocked) resetBtn.removeAttribute("disabled"); else resetBtn.setAttribute("disabled", "");
      }
    }
  }
  function renderCalibrationSliders() {
    const cont = document.getElementById("calib-sliders-mount");
    if (!cont) return;
    const cat = state.catalog;
    if (!cat) return;
    const values = state.pypilotValues || {};
    const names = Object.keys(cat).filter((k) => {
      const m = cat[k];
      if (!m || m.type !== "RangeSetting") return false;
      if (k.startsWith("ap.pilot.")) return false;   // gains live in Tune
      return true;
    });
    if (names.length === 0) return;
    names.sort();

    // Capture baseline the FIRST time we see a non-null value for each name.
    for (const n of names) {
      if (!_calBaselines.has(n)) {
        const v = values[n];
        if (typeof v === "number" && isFinite(v)) _calBaselines.set(n, v);
      }
    }

    // Rebuild sections only if the DOM layout changed (name set,
    // group membership). If every row already exists we do NOT touch
    // the DOM - just refresh the live value display in place.
    const needFullRebuild = (() => {
      if (cont.children.length === 0) return true;
      for (const n of names) if (!_calRows.has(n)) return true;
      return false;
    })();

    if (needFullRebuild) {
      cont.textContent = "";
      _calRows.clear();
      const claimed = new Set();
      for (const grp of _CAL_GROUPS) {
        const groupNames = names.filter((n) => !claimed.has(n) && grp.match(n));
        if (groupNames.length === 0) continue;
        groupNames.forEach((n) => claimed.add(n));
        const section = document.createElement("div");
        section.className = "calib-slider-group";
        const title = document.createElement("div");
        title.className = "calib-slider-group-title";
        title.setAttribute("data-i18n", grp.i18n);
        title.textContent = t(grp.i18n);
        section.appendChild(title);
        for (const name of groupNames) {
          const meta = cat[name];
          const step = (meta.max - meta.min) / 200 || 0.001;
          const cur = values[name];
          const baseline = _calBaselines.get(name);
          const { row, rng, val } = _buildSliderRow({
            name,
            min: meta.min, max: meta.max, step,
            decimals: 3,
            cur,
            onChange: (v) => { pluginRaw(name, v); _stampCalAdjust(); },
            unlocked: _calCurrentlyUnlocked(),
            // showBaseline is handled here (below) instead of inside
            // _buildSliderRow so the value stays FROZEN across renders.
            showBaseline: false,
          });
          row.dataset.pypilot = name;
          row.setAttribute("title", name);
          // Baseline label (frozen).
          const baseEl = row.querySelector(".baseline");
          if (baseEl && baseline != null) {
            baseEl.textContent = `${t("cal.slider.was")} ${Number(baseline).toFixed(3)}`;
            baseEl.hidden = false;
          }
          // Reset button: snap back to baseline and PUT to pypilot.
          const resetBtn = document.createElement("button");
          resetBtn.type = "button";
          resetBtn.className = "cal-reset-btn nudge-btn";
          resetBtn.setAttribute("aria-label", t("cal.slider.restore"));
          resetBtn.setAttribute("title", t("cal.slider.restore"));
          resetBtn.textContent = "↺";
          if (!_calCurrentlyUnlocked()) resetBtn.setAttribute("disabled", "");
          resetBtn.addEventListener("click", () => {
            const b = _calBaselines.get(name);
            if (b == null || rng == null) return;
            rng.value = String(b);
            if (val) val.textContent = Number(b).toFixed(3);
            pluginRaw(name, b);
            _stampCalAdjust();
          });
          const bot = row.querySelector(".gain-bot");
          if (bot) bot.appendChild(resetBtn);
          _calRows.set(name, { row, rng, val, resetBtn, baselineEl: baseEl });
          section.appendChild(row);
        }
        cont.appendChild(section);
      }
    } else {
      // In-place refresh of the live value / slider position only.
      for (const name of names) {
        const rec = _calRows.get(name);
        if (!rec) continue;
        const cur = values[name];
        if (typeof cur !== "number" || !isFinite(cur)) continue;
        // Do NOT clobber while the user is dragging.
        if (rec.row.classList.contains("active")) continue;
        if (rec.rng) rec.rng.value = String(cur);
        if (rec.val) rec.val.textContent = Number(cur).toFixed(3);
      }
    }
  }
  function wireCalibUnlock() {
    const cb = document.getElementById("calib-unlock");
    if (cb) cb.addEventListener("change", _applyCalibLockState);
    // Rev135 (Carlos): "Reset historial" button clears the stored
    // last-adjustment timestamp so the Setup Calibration chip goes
    // back to "sin ajustar" until the next real slider change.
    const rst = document.getElementById("cal-stamp-reset");
    if (rst) rst.addEventListener("click", () => {
      try { localStorage.removeItem(CAL_STAMP_KEY); } catch { /* silent */ }
      _refreshSetupBadges();
    });
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
            // Rev133 (Carlos): freeze the Tune baseline the FIRST time
            // pypilot answers with a value. renderGains() only captured
            // it in the synchronous path (state.values[skPath]) and
            // that map is empty until deltas start flowing - which is
            // why the ↺ reset button had nothing to restore to.
            if (Number.isFinite(v)) {
              const parts = g.split(".");
              const pilotName = parts[2];
              const shortName = parts.slice(3).join(".");
              const baselineKey = `${pilotName}::${shortName}`;
              if (!_tuneBaselines.has(baselineKey)) {
                _tuneBaselines.set(baselineKey, v);
              }
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
      // Rev129 (Carlos): freeze the baseline the first time we see a
      // valid value for this shortName. Never overwrite it, so the ↺
      // button always restores the profile's last-known-good value
      // even after several tweaks.
      const baselineKey = `${pilot}::${shortName}`;
      if (typeof cur === "number" && isFinite(cur) && !_tuneBaselines.has(baselineKey)) {
        _tuneBaselines.set(baselineKey, cur);
      }
      // Rev36: use shared _buildSliderRow (2-row layout + nudge buttons).
      const { row, rng, val } = _buildSliderRow({
        name: shortName,
        min: meta.min, max: meta.max, step: 0.0001,
        decimals: 4,
        cur,
        onChange: (v) => {
          pluginRaw(g, v);
          // Rev129: first change per unlock triggers the fork-or-save
          // prompt. Rev132: pass the row context so Cancel can revert
          // the slider back to the frozen baseline instead of leaving
          // the (uncommitted) new value on-screen.
          _maybePromptTuneFork({ pypilotKey: g, baselineKey, rng, val });
          // Rev130: gain writes count as calibration adjustments too.
          _stampCalAdjust();
        },
      });
      row.dataset.pypilot = g;
      row.dataset.sk = skPath;
      // Rev129: per-slider ↺ restore button (Carlos: mismo patron que
      // Calibracion). Snaps back to the frozen baseline and pushes it
      // to pypilot so the SK path also reverts.
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "tune-reset-btn nudge-btn";
      resetBtn.setAttribute("aria-label", t("cal.slider.restore") || "Restore");
      resetBtn.setAttribute("title", t("cal.slider.restore") || "Restore");
      resetBtn.textContent = "↺";
      const unlockCb2 = document.getElementById("tune-unlock");
      if (!(unlockCb2 && unlockCb2.checked)) resetBtn.setAttribute("disabled", "");
      resetBtn.addEventListener("click", () => {
        const b = _tuneBaselines.get(baselineKey);
        if (b == null) return;
        rng.value = String(b);
        val.textContent = Number(b).toFixed(4);
        pluginRaw(g, b);
        _stampCalAdjust();
      });
      const bot = row.querySelector(".gain-bot");
      if (bot) bot.appendChild(resetBtn);
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
              // Rev132: also capture the baseline once the async fetch
              // arrives. The synchronous branch above only fires when
              // the SK stream cached the gain BEFORE render; on first
              // paint (Tune reset broken bug) that map was empty and
              // the ↺ button had nothing to restore to.
              if (!_tuneBaselines.has(baselineKey)) {
                _tuneBaselines.set(baselineKey, v);
              }
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

  // Rev87: SK Access Request flow. The username/password JWT (Rev17) is a
  // short-lived session token — SK server invalidates it on every restart
  // and it also expires by TTL (typically 1 h). That forces the user to
  // log in again after every plugin deploy, which Carlos rightly called
  // out as unacceptable ("esto debe ser seamless; no podemos estar a
  // expensas de que caduquen se borren los token"). SK's Access Request
  // API instead gives us a PERMANENT device token: user (SK admin)
  // approves the visor ONCE at /admin/#/security/access-requests, and
  // from then on the token survives SK restarts, browser reloads, and
  // deploys. Stored in localStorage under the same TOKEN_KEY.
  const CLIENT_ID_KEY = "pypilot-newui.clientId";
  function getClientId() {
    try {
      let cid = localStorage.getItem(CLIENT_ID_KEY);
      if (!cid) {
        // RFC 4122 v4 UUID (crypto if available, fallback otherwise)
        if (window.crypto && crypto.randomUUID) cid = crypto.randomUUID();
        else cid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
        localStorage.setItem(CLIENT_ID_KEY, cid);
      }
      return cid;
    } catch { return "pypilot-newui-fallback"; }
  }

  // Test whether the current token still authenticates. Uses a lightweight
  // GET that requires auth in "secure" SK setups (the /plugins/... path
  // returns 401 when the token is missing or expired). 200/404/403 all
  // count as "at least reachable"; only an explicit 401 forces us to
  // start a new access request.
  async function isAuthValid() {
    if (!getToken()) return false;
    try {
      const r = await fetch("/plugins/pypilot-newui/status", {
        headers: authHeaders(),
        credentials: "include",
      });
      return r.status !== 401;
    } catch { return false; }
  }

  // Start (or resume) an SK Access Request. Returns true if the request
  // completes and a token was stored; false if pending / denied /
  // network error. When pending, opens the "waiting for admin approval"
  // modal so the user knows where to go.
  async function requestAccess() {
    const clientId = getClientId();
    try {
      const r = await fetch("/signalk/v1/access/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          description: "PyPilot New-UI visor",
          permissions: "admin",
        }),
      });
      if (!r.ok && r.status !== 202) return false;
      const j = await r.json().catch(() => ({}));
      if (j.state === "COMPLETED" && (j.accessRequest?.token || j.token)) {
        setToken(j.accessRequest?.token || j.token);
        hideAccessRequestModal();
        return true;
      }
      // PENDING → show modal, start polling
      const href = j.href || j.requestId ? (`/signalk/v1/requests/${j.requestId}`) : null;
      if (href) {
        showAccessRequestModal();
        return pollAccessRequest(href);
      }
      return false;
    } catch { return false; }
  }

  // Poll the access-request href every 4 s for up to 20 minutes. When
  // the admin approves, the response transitions to COMPLETED with the
  // permanent token. When denied, we bail out and let the user retry.
  async function pollAccessRequest(href) {
    for (let i = 0; i < 300; i++) {
      await new Promise((res) => setTimeout(res, 4000));
      try {
        const r = await fetch(href);
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({}));
        if (j.state === "COMPLETED" && (j.accessRequest?.token || j.token)) {
          setToken(j.accessRequest?.token || j.token);
          hideAccessRequestModal();
          return true;
        }
        if (j.state === "DENIED") {
          showAccessRequestModal("Admin denied the access request. Try again from Setup.");
          return false;
        }
      } catch { /* retry */ }
    }
    return false;
  }

  // Modal helpers — showAccessRequestModal / hideAccessRequestModal.
  // The modal is added dynamically the first time it is shown so we do
  // not have to touch the HTML for the boot happy-path.
  function showAccessRequestModal(errText) {
    let m = document.getElementById("access-request-modal");
    if (!m) {
      m = document.createElement("div");
      m.id = "access-request-modal";
      m.innerHTML = `
        <div class="modal-card">
          <h3>Signal K device access</h3>
          <p>This visor is waiting for one-time approval from your Signal K admin so it can send commands to the autopilot.</p>
          <ol style="margin:0 0 8px 20px;font-size:13px;color:var(--fg-dim);line-height:1.5">
            <li>Open the SK admin panel (link below).</li>
            <li>Go to <b>Security → Access Requests</b>.</li>
            <li>Approve the pending request from <b>PyPilot New-UI visor</b>.</li>
          </ol>
          <a id="access-request-admin-link" class="primary" style="text-decoration:none;text-align:center;padding:10px 12px;border-radius:8px;display:block" target="_blank">Open SK admin</a>
          <div id="access-request-status" style="font-size:12px;color:var(--fg-dim);margin-top:6px;text-align:center">Waiting for approval…</div>
        </div>`;
      document.body.appendChild(m);
      const link = m.querySelector("#access-request-admin-link");
      if (link) link.href = `${location.origin}/admin/#/security/access`;
    }
    m.removeAttribute("hidden");
    const status = m.querySelector("#access-request-status");
    if (status && errText) status.textContent = errText;
  }
  function hideAccessRequestModal() {
    const m = document.getElementById("access-request-modal");
    if (m) m.setAttribute("hidden", "");
  }

  // Boot-time auth guard: called ONCE on visor load before we try any
  // writes. If already authed, no-op. Otherwise, silently start an
  // access request. Never blocks the boot itself — reads work through
  // the WebSocket subscription regardless of auth on Tunatunes-style
  // setups.
  async function ensureAccessOnBoot() {
    if (await isAuthValid()) return;
    // Wipe the stale token so authHeaders() stops sending it.
    setToken("");
    await requestAccess();
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
      // Rev87: fire-and-forget a new SK Access Request instead of the old
      // username/password modal. If the admin has already approved this
      // clientId once (typical after first install), the server returns
      // a fresh permanent token immediately and the modal never shows.
      // Only when the admin has to approve for the first time will the
      // access-request modal appear with instructions.
      try {
        setToken("");
        requestAccess().catch(() => {});
      } catch {}
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

  // ---- Rev88 / Rev89: "Aproado" pseudo-mode (sail-raising into-the-wind) ----
  // Not part of pypilot. Single overlay panel over the boat that walks
  // through four phases:
  //   choosing  - modal-style buttons: POR PROA / POR POPA / Cancelar.
  //   countdown - 5 s grace after picking (user can still cancel).
  //   active    - live elapsed + straight-line distance from start +
  //               compass heading captured at activation.
  //   summary   - values frozen for 15 s after SALIR, then self-hides.
  // On SALIR (or auto-hide) the pre-aproado mode + target + engaged
  // state are restored (Carlos Rev88 feedback: if the AP was NOT engaged
  // when we entered aproado, disengage on exit).
  const APROADO_TWS_HOT_KN = 10;      // above this, PROA is highlighted
  const APROADO_COUNTDOWN_S = 5;       // grace period AFTER user picks
  const APROADO_HUD_TICK_MS = 500;
  const APROADO_SUMMARY_MS = 15000;    // Carlos Rev89: 15 s dwell (was 8)
  // Rev90: |AWA| below this threshold (degrees) → the boat is considered
  // "aproada" and the transit phase flips to the aproado phase (elapsed
  // timer starts). Once achieved the phase LATCHES - a subsequent wind
  // gust that pushes AWA above the threshold does NOT flip back.
  const APROADO_ACHIEVED_DEG = 10;

  function _distanceNm(a, b) {
    if (!a || !b) return 0;
    const R = 6371000;
    const dLat = (b.lat - a.lat) * DEG2RAD;
    const dLon = (b.lon - a.lon) * DEG2RAD;
    const mid = ((a.lat + b.lat) / 2) * DEG2RAD;
    const x = dLon * Math.cos(mid);
    const y = dLat;
    return Math.sqrt(x * x + y * y) * R / 1852;
  }
  function _formatElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }
  function _twsKn() {
    return state.windSpeedTrue != null ? state.windSpeedTrue * 1.94384 : null;
  }
  function _aproadoHud() { return document.getElementById("aproado-hud"); }
  function _setPhase(phase) {
    const hud = _aproadoHud();
    if (hud) hud.setAttribute("data-phase", phase);
  }
  function _paintTws(hud) {
    const twsEl = hud.querySelector("#aproado-choose-tws");
    if (!twsEl) return false;
    const twsKn = _twsKn();
    const hot = twsKn != null && twsKn > APROADO_TWS_HOT_KN;
    if (twsKn != null) {
      twsEl.textContent = hot
        ? t("aproado.tws.hot").replace("{tws}", twsKn.toFixed(0))
        : t("aproado.tws.mild").replace("{tws}", twsKn.toFixed(0));
    } else {
      twsEl.textContent = "";
    }
    twsEl.classList.toggle("hot", hot);
    hud.classList.toggle("hot", hot);
    return hot;
  }

  function aproadoStart() {
    // Snapshot everything we may need to restore on SALIR / cancel.
    const snapshot = {
      mode: state.mode,
      targetRad: state.target,
      headingRad: state.heading,
      engaged: state.engaged,
      ts: Date.now(),
    };
    state.aproado = {
      phase: "choosing",
      direction: null,
      snapshot,
      startTs: null,
      endTs: null,
      startPos: null,
      startHeadingDeg: null,
      distanceNm: 0,
    };
    const hud = _aproadoHud();
    if (!hud) return;
    hud.classList.remove("summary");
    _paintTws(hud);
    // Default recommendation: PROA (Carlos Q-3: safer, especially > 10 kn).
    const bowBtn = hud.querySelector('.aproado-choice[data-dir="bow"]');
    const sternBtn = hud.querySelector('.aproado-choice[data-dir="stern"]');
    if (bowBtn) bowBtn.classList.add("recommended");
    if (sternBtn) sternBtn.classList.remove("recommended");
    _setPhase("choosing");
    hud.removeAttribute("hidden");
  }

  // User picked bow or stern. Enter the 5 s countdown; the actual
  // pypilot switch happens when the countdown reaches 0.
  function aproadoPick(direction) {
    const apr = state.aproado;
    if (!apr || apr.phase !== "choosing") return;
    apr.direction = direction === "stern" ? "stern" : "bow";
    _setPhase("countdown");
    const hud = _aproadoHud();
    if (!hud) return;
    const titleEl = hud.querySelector("#aproado-cd-title");
    const numEl = hud.querySelector("#aproado-cd-num");
    if (titleEl) {
      titleEl.textContent = apr.direction === "bow"
        ? t("aproado.cd.title.bow")
        : t("aproado.cd.title.stern");
    }
    let secs = APROADO_COUNTDOWN_S;
    if (numEl) numEl.textContent = String(secs);
    apr._cdTimer = setInterval(() => {
      secs -= 1;
      if (secs <= 0) {
        clearInterval(apr._cdTimer);
        apr._cdTimer = null;
        if (numEl) numEl.textContent = "0";
        aproadoExecute();
        return;
      }
      if (numEl) numEl.textContent = String(secs);
    }, 1000);
  }

  async function aproadoExecute() {
    const apr = state.aproado;
    if (!apr) return;
    // Rev90: transit is a NEW phase between countdown and active. The
    // boat starts rotating toward head-to-wind; only when |AWA| falls
    // below APROADO_ACHIEVED_DEG do we consider it "aproada" and start
    // the elapsed timer. Distance tracking, however, begins here so it
    // covers the whole maneuver (transit + aproado).
    apr.phase = "transit";
    apr.executeTs = Date.now();
    apr.startTs = null;                      // elapsed clock arms later
    apr.startPos = state.position ? { ...state.position } : null;
    apr.startHeadingDeg = state.heading != null
      ? ((state.heading * RAD2DEG + 360) % 360)
      : null;
    setSelect("#mode-select", "aproado");
    _setPhase("transit");
    const hud = _aproadoHud();
    if (hud) { hud.classList.add("transit"); hud.classList.remove("summary"); }
    // Set the transit title now so it reflects the chosen direction.
    const transitTitle = document.getElementById("aproado-transit-title");
    if (transitTitle) {
      transitTitle.textContent = apr.direction === "bow"
        ? t("aproado.transit.title.bow")
        : t("aproado.transit.title.stern");
    }
    try {
      await apSetMode("wind");
      if (apr.direction === "bow" || state.windAngle == null) {
        // PROA: shortest path (pypilot's default) is bow-through when
        // starting from close-hauled or reaching. Also fallback for POPA
        // when we have no wind sensor - we cannot force the swing side
        // without knowing which side the wind is on.
        apr._targetIsFinal = true;
        await apSetTargetRad(0);
      } else {
        // POR POPA (Rev92): pypilot has no jibe primitive - if we just
        // command target = 0 it picks the SHORTEST arc, which for a
        // close-hauled boat is the bow-through side. To force the swing
        // to go through the stern we walk a chain of intermediate
        // targets 60 deg apart around the LONG side of the circle. Each
        // step waits for the boat to catch up before advancing, so
        // pypilot never has an ambiguous or reversible shortest-path
        // decision. When the chain wraps past the far side we release
        // the final target = 0 and let _aproadoCheckAchieved latch into
        // the active phase.
        apr._targetIsFinal = false;
        aproadoForceStern(state.windAngle);   // fire-and-forget async
      }
      if (!state.engaged) await apEngage();
    } catch (e) {
      console.warn("aproado: mode/target/engage failed", e);
    }
    updateAproadoHud();
    apr._hudTimer = setInterval(updateAproadoHud, APROADO_HUD_TICK_MS);
  }

  // Rev92: force POR POPA path by walking the target around the long
  // side of the circle in ~60 deg steps. Runs in the background from
  // aproadoExecute; aborts cleanly if the user hits SALIR (phase leaves
  // "transit") or if the wind sensor drops out mid-swing.
  async function aproadoForceStern(startWindAngleRad) {
    const apr = state.aproado;
    if (!apr || apr.direction !== "stern") return;
    const startDeg = startWindAngleRad * RAD2DEG;
    // If we start already near head-to-wind, no long path to force.
    if (Math.abs(startDeg) < 15) {
      try { await apSetTargetRad(0); } catch {}
      apr._targetIsFinal = true;
      return;
    }
    // Sign of rotation for stern-through swing. Wind on starboard (+):
    // rotate CW so AWA grows through +180 and wraps to -180 then up to 0.
    // Wind on port (-): rotate CCW.
    const dir = startDeg > 0 ? 1 : -1;
    const STEP_DEG = 60;
    const STEP_TOL_DEG = 25;         // "arrived" tolerance per step
    const STEP_TIMEOUT_MS = 15000;   // give up on a step after 15 s
    const totalRotation = 360 - Math.abs(startDeg);
    let accumulated = 0;
    console.info(`aproado stern: startAWA=${startDeg.toFixed(0)} dir=${dir} totalRot=${totalRotation.toFixed(0)}`);
    while (accumulated + STEP_DEG < totalRotation &&
           state.aproado === apr &&
           apr.phase === "transit") {
      // If wind swung around organically and we're already at head-to-wind,
      // stop stepping and commit to the final target.
      if (state.windAngle != null &&
          Math.abs(state.windAngle * RAD2DEG) <= APROADO_ACHIEVED_DEG) {
        console.info("aproado stern: achieved organically mid-chain");
        break;
      }
      accumulated += STEP_DEG;
      let nextDeg = startDeg + dir * accumulated;
      while (nextDeg > 180) nextDeg -= 360;
      while (nextDeg < -180) nextDeg += 360;
      console.info(`aproado stern step: acc=${accumulated} target=${nextDeg.toFixed(0)}`);
      try { await apSetTargetRad(nextDeg * DEG2RAD); }
      catch (e) { console.warn("aproado stern: step PUT failed", e); }
      const ok = await _waitForAWANear(nextDeg, STEP_TOL_DEG, STEP_TIMEOUT_MS, apr);
      if (!ok && state.aproado === apr && apr.phase === "transit") {
        console.warn(`aproado stern: step timeout at target=${nextDeg.toFixed(0)}`);
      }
    }
    // Final: commit target = 0 and unlock the achieved check.
    if (state.aproado === apr && apr.phase === "transit") {
      try { await apSetTargetRad(0); console.info("aproado stern: final target = 0"); }
      catch (e) { console.warn("aproado stern: final PUT failed", e); }
      apr._targetIsFinal = true;
    }
  }

  // Resolves true when |AWA - targetDeg| < tolDeg (or wind sensor missing
  // longer than timeoutMs), false on timeout. Aborts if the aproado
  // state is torn down (user pressed SALIR).
  function _waitForAWANear(targetDeg, tolDeg, timeoutMs, apr) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (state.aproado !== apr || apr.phase !== "transit") { resolve(false); return; }
        if (Date.now() - started > timeoutMs) { resolve(false); return; }
        if (state.windAngle == null) { setTimeout(tick, 500); return; }
        const currentDeg = state.windAngle * RAD2DEG;
        let delta = targetDeg - currentDeg;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        if (Math.abs(delta) < tolDeg) { resolve(true); return; }
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  // Called on every HUD tick. If we're still in transit and |AWA| has
  // fallen below the achievement threshold, latch into the active phase.
  // Rev92: for POR POPA we only allow the latch AFTER the forced-stern
  // chain has committed the final target (apr._targetIsFinal). Otherwise
  // an intermediate step that happens to cross near 0 could flip us
  // into "active" prematurely mid-swing.
  function _aproadoCheckAchieved() {
    const apr = state.aproado;
    if (!apr || apr.phase !== "transit") return;
    if (!apr._targetIsFinal) return;
    if (state.windAngle == null) return;
    const awaDeg = Math.abs(state.windAngle * RAD2DEG);
    if (awaDeg <= APROADO_ACHIEVED_DEG) {
      apr.phase = "active";
      apr.startTs = Date.now();
      _setPhase("active");
      const hud = _aproadoHud();
      if (hud) hud.classList.remove("transit");
    }
  }

  // Cancel from choosing OR countdown phase. Nothing was sent to pypilot
  // yet in choosing; in countdown we clear the timer before firing.
  function aproadoCancel() {
    const apr = state.aproado;
    if (!apr) return;
    if (apr._cdTimer) { clearInterval(apr._cdTimer); apr._cdTimer = null; }
    setSelect("#mode-select", apr.snapshot.mode || "");
    hideAproadoHud();
    state.aproado = null;
  }

  // Tear down live timers + hide HUD but DO NOT restore the previous mode
  // (used when the user picks another mode from the dropdown while active).
  function aproadoTearDown() {
    const apr = state.aproado;
    if (!apr) return;
    if (apr._cdTimer) { clearInterval(apr._cdTimer); apr._cdTimer = null; }
    if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
    if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
    hideAproadoHud();
    state.aproado = null;
  }

  // SALIR from the transit or active HUD: freeze counters, show the
  // summary card for APROADO_SUMMARY_MS, and restore the pre-aproado
  // mode + target + engaged state. Rev90: each restore step is guarded
  // by its own try/catch so a failure in one does NOT skip the next
  // (previously a single try/catch swallowed the rest of the chain -
  // that was Carlos's "wind mode does not come back" bug). The dropdown
  // is also updated optimistically so the UI reflects the restore even
  // before pypilot's echo lands.
  async function aproadoFinish() {
    const apr = state.aproado;
    if (!apr || (apr.phase !== "active" && apr.phase !== "transit")) return;
    if (apr._hudTimer) { clearInterval(apr._hudTimer); apr._hudTimer = null; }
    apr.endTs = Date.now();
    if (apr.startPos && state.position) {
      apr.distanceNm = _distanceNm(apr.startPos, state.position);
    }
    // If we never reached the achieved phase, stamp startTs so the
    // summary shows a meaningful "0:00" instead of NaN.
    if (apr.startTs == null) apr.startTs = apr.endTs;
    apr.phase = "summary";
    const hud = _aproadoHud();
    if (hud) { hud.classList.remove("transit"); hud.classList.add("summary"); }
    _setPhase("summary");
    updateAproadoHud();
    // Optimistic dropdown update so UI does not stay stuck on "aproado".
    const snap = apr.snapshot;
    if (snap.mode) setSelect("#mode-select", snap.mode);
    // Rev90: guard each step separately so one failure does not skip
    // the others. Log successes for QA visibility.
    if (snap.mode) {
      try { await apSetMode(snap.mode); console.info("aproado: mode restored ->", snap.mode); }
      catch (e) { console.warn("aproado: mode restore failed", e); }
    }
    if (snap.targetRad != null) {
      try { await apSetTargetRad(snap.targetRad); console.info("aproado: target restored ->", snap.targetRad.toFixed(3), "rad"); }
      catch (e) { console.warn("aproado: target restore failed", e); }
    }
    // If the AP was NOT engaged before aproado, disengage now (Rev88 #10).
    if (!snap.engaged) {
      try { await apDisengage(); console.info("aproado: AP disengaged (was OFF before aproado)"); }
      catch (e) { console.warn("aproado: disengage failed", e); }
    }
    apr._summaryTimer = setTimeout(() => {
      if (state.aproado === apr) {
        hideAproadoHud();
        state.aproado = null;
      }
    }, APROADO_SUMMARY_MS);
  }

  function hideAproadoHud() {
    const hud = _aproadoHud();
    if (hud) {
      hud.setAttribute("hidden", "");
      hud.classList.remove("summary", "hot", "transit");
      hud.removeAttribute("data-phase");
    }
  }
  function updateAproadoHud() {
    const apr = state.aproado;
    const hud = _aproadoHud();
    if (!apr || !hud) return;
    // Rev90: check for phase transition transit -> active.
    _aproadoCheckAchieved();
    // Distance covers transit + active + summary. Elapsed clock only
    // ticks once startTs has been armed (aproado achieved OR summary).
    if ((apr.phase === "active" || apr.phase === "transit") &&
        apr.startPos && state.position) {
      apr.distanceNm = _distanceNm(apr.startPos, state.position);
    }
    const nowTs = apr.phase === "summary" ? (apr.endTs || Date.now()) : Date.now();
    const elapsedMs = apr.startTs ? nowTs - apr.startTs : 0;
    // Common: heading captured at maneuver start.
    const hdgTxt = apr.startHeadingDeg != null
      ? `${String(Math.round(apr.startHeadingDeg)).padStart(3, "0")}°`
      : "---°";
    if (apr.phase === "transit") {
      const degEl = document.getElementById("aproado-transit-deg");
      const hdgTrEl = document.getElementById("aproado-transit-hdg");
      if (degEl) {
        degEl.textContent = state.windAngle != null
          ? `${Math.round(Math.abs(state.windAngle * RAD2DEG))}°`
          : "---°";
      }
      if (hdgTrEl) hdgTrEl.textContent = hdgTxt;
    } else {
      const elapsedEl = document.getElementById("aproado-hud-elapsed");
      const distEl = document.getElementById("aproado-hud-dist");
      const hdgEl = document.getElementById("aproado-hud-hdg");
      const titleEl = document.getElementById("aproado-active-title");
      const endBtn = document.getElementById("aproado-hud-end");
      if (elapsedEl) elapsedEl.textContent = _formatElapsed(elapsedMs);
      if (distEl) distEl.textContent = `${apr.distanceNm.toFixed(2)} nm`;
      if (hdgEl) hdgEl.textContent = hdgTxt;
      if (apr.phase === "summary") {
        if (titleEl) titleEl.textContent = t("aproado.hud.summary");
        if (endBtn) endBtn.textContent = t("close");
      } else {
        if (titleEl) titleEl.textContent = t("aproado.hud.title");
        if (endBtn) endBtn.textContent = t("aproado.hud.exit");
      }
    }
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
        // Rev66 / 2.0.4: also update state.target optimistically so the
        // target diamond MOVES IN THE SAME TICK as the nudge, instead of
        // waiting for the server's delta reply (~200-800 ms on Tailscale).
        // If the server later rejects the new target the incoming delta
        // will overwrite this and the diamond re-syncs.
        state.target = newTargetRad;
        renderTargetArrow();
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
    // Rev70: switched trigger from `click` to `pointerdown` (fires ONCE on
    // touch or mouse without waiting for the browser-synthesised click,
    // and the subsequent click is swallowed via preventDefault below).
    // This eliminates the "ghost click" path where a single tap produces
    // pointerdown + click both firing doEngage.
    // Rev71: cooldown trimmed from 1200 to 800 ms - the pointerdown +
    // preventDefault chain already kills the ghost path, so the cooldown
    // only needs to cover genuine rapid double-taps (~300 ms) with margin,
    // not the whole ghost-click window. Carlos: "1.5 segundos sea mucho
    // tiempo de espera".
    let _lastEngageTs = 0;
    const AP_CLICK_COOLDOWN_MS = 800;
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
      // Rev69: cooldown gate before the async guard fires. Blocks the
      // second edge of a rapid double-click (and any touch-emulated
      // ghost click after touchend) from producing an engage-disengage
      // bounce once _apPending has cleared.
      const nowTs = Date.now();
      if (nowTs - _lastEngageTs < AP_CLICK_COOLDOWN_MS) return;
      _lastEngageTs = nowTs;
      _apPending = true;
      eng.classList.add("pending");
      const wasEngaged = state.engaged;
      // Rev65 / 2.0.2: snapshot the heading the USER IS SEEING at the exact
      // moment of the click, and use that same value for (a) the target we
      // send to the server, (b) the optimistic local assign, (c) any later
      // reference in this handler.
      // Rev69: mode-aware target capture. In WIND / TRUE WIND modes pypilot
      // interprets ap.heading_command as the WIND ANGLE to hold (radians,
      // signed +/-pi), NOT as an absolute compass heading. Sending
      // state.heading in wind mode stores a compass-degrees value where
      // pypilot expects a wind angle, and the diamond then renders at
      // 60-90 degrees off from the actual wind. Carlos on Rev68: engaged
      // in wind mode with HDG=296 and the diamond landed at ~245 (i.e.
      // 296 read as wind angle -> upper-left of bow). Fix: capture
      // apparent wind angle for "wind" mode, true wind angle for the
      // "true wind" / "trueWind" modes, and only fall back to heading
      // for compass / gps / nav.
      const modeStrEng = String(state.mode || "").toLowerCase();
      const isWindEng = modeStrEng.includes("wind");
      const isTrueWindEng = isWindEng && modeStrEng.includes("true");
      const capturedTarget = isWindEng
        ? (isTrueWindEng ? state.windAngleTrue : state.windAngle)
        : state.heading;
      // Optimistic: flip the visual state AND the target reference before
      // waiting on the network (Rev66 / 2.0.4 fix; still needed as a
      // fallback if the backend delta is delayed).
      const prevTarget = state.target;
      const prevLocalTarget = state.localTargetRad;
      state.engaged = !wasEngaged;
      if (!wasEngaged && capturedTarget != null) {
        state.target = capturedTarget;
        state.localTargetRad = capturedTarget;
      }
      renderEngage();
      renderTargetArrow();
      let ok = false;
      try {
        if (wasEngaged) {
          const r = await _apRetry(apDisengage);
          ok = !!(r && r.ok);
        } else {
          // Rev84: BACK to parallel Promise.all after Rev83's serial fix
          // introduced a click-reliability regression (Carlos: "no
          // siempre coge el click; es un problema de arquitectura").
          // The 115°-flash race that motivated Rev83's serial is now
          // fixed at the ARCHITECTURAL level: the backend's
          // AutopilotProvider now publishes ONLY the field it actually
          // changed (setTarget → target, setState → engaged/state/
          // actions), so parallel POSTs no longer produce deltas that
          // clobber each other with stale sibling values. Best of both
          // worlds: fast engage response AND no visible target jump.
          // Rev69: if capturedTarget is null (no wind data yet) skip the
          // target-set and let pypilot pick its own current default.
          const [rEng, rTgt] = await Promise.all([
            _apRetry(apEngage),
            capturedTarget != null ? _apRetry(() => apSetTargetRad(capturedTarget)) : Promise.resolve({ ok: true }),
          ]);
          ok = !!(rEng && rEng.ok);
          if (rTgt && rTgt.ok && capturedTarget != null) renderControl();
        }
      } catch (_) { ok = false; }
      if (!ok) {
        // Revert the optimistic flip so the UI reflects reality.
        state.engaged = wasEngaged;
        state.target = prevTarget;
        state.localTargetRad = prevLocalTarget;
        renderEngage();
        renderTargetArrow();
        eng.classList.add("failed");
        setTimeout(() => eng.classList.remove("failed"), 1500);
      }
      eng.classList.remove("pending");
      _apPending = false;
    };
    // Rev70: primary trigger is pointerdown (fires exactly once per press
    // on both touch and mouse, before the browser synthesises `click`).
    // The `click` listener swallows the phantom that follows so it cannot
    // race the cooldown. Keyboard activation stays on keydown.
    eng.addEventListener("pointerdown", (e) => {
      // Only main button / primary pointer. Skip anything else so
      // right-click / middle-click never toggle the AP.
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      doEngage();
    });
    eng.addEventListener("click", (e) => {
      // Swallowed - pointerdown already handled the intent. Prevents
      // the synthesised click from also firing doEngage.
      e.preventDefault();
      e.stopPropagation();
    });
    eng.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doEngage(); }
    });

    // Mode change
    $("#mode-select").addEventListener("change", (e) => {
      const chosen = e.target.value;
      // Rev88: pseudo-mode "aproado" is intercepted locally - opens the
      // choice modal (bow / stern) and starts the maneuver on confirmation.
      if (chosen === "aproado") {
        aproadoStart();
        return;
      }
      // Picking another mode while aproado is active ends the maneuver
      // WITHOUT restoring the pre-aproado mode - honor the user's new
      // choice. (Use the SALIR button on the HUD to return to previous.)
      if (state.aproado && (state.aproado.phase === "transit" || state.aproado.phase === "active")) {
        aproadoTearDown();
      }
      apSetMode(chosen);
    });

    // Rev88 / Rev89: aproado overlay wiring. The overlay has 3 phases;
    // each phase has its own set of buttons. SALIR on the active phase
    // restores the pre-aproado mode + target + engaged state.
    const aproadoHud = document.getElementById("aproado-hud");
    if (aproadoHud) {
      aproadoHud.querySelectorAll('.aproado-choice[data-dir]').forEach((btn) => {
        btn.addEventListener("click", () => aproadoPick(btn.getAttribute("data-dir")));
      });
      const cancelChoose = document.getElementById("aproado-cancel-btn");
      if (cancelChoose) cancelChoose.addEventListener("click", () => aproadoCancel());
      const cancelCd = document.getElementById("aproado-cd-cancel");
      if (cancelCd) cancelCd.addEventListener("click", () => aproadoCancel());
      const exitHandler = () => {
        const apr = state.aproado;
        if (!apr) return;
        if (apr.phase === "summary") {
          if (apr._summaryTimer) { clearTimeout(apr._summaryTimer); apr._summaryTimer = null; }
          hideAproadoHud();
          state.aproado = null;
        } else if (apr.phase === "active" || apr.phase === "transit") {
          aproadoFinish();
        }
      };
      const exitBtn = document.getElementById("aproado-hud-end");
      if (exitBtn) exitBtn.addEventListener("click", exitHandler);
      const transitCancelBtn = document.getElementById("aproado-transit-cancel");
      if (transitCancelBtn) transitCancelBtn.addEventListener("click", exitHandler);
    }

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
  let _lastEssentialCount = 0;   // Rev135: how many essentials the backend advertises.

  let _publishOnlyEssentials = true;

  async function refreshPaths() {
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/paths`, { credentials: "include" });
      const j = await res.json();
      _lastPathsItems = j.items || [];
      _lastEnabledMap = j.enabledPaths || {};
      _publishOnlyEssentials = !!j.publishOnlyEssentials;
      _lastEssentialCount = Array.isArray(j.essentials) ? j.essentials.length : 0;
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
      b.addEventListener("click", async () => {
        await _copyToClipboardCompat(b.dataset.copy);
        b.textContent = "OK";
        setTimeout(() => (b.textContent = t("paths.copy")), 800);
      });
    });
    // Rev24: also wire the static KIP-actions table copy buttons (they live
    // in the DOM outside the injected tbody). Rev114: use compat helper.
    document.querySelectorAll("#paths-mount button.copy, #tab-paths button.copy").forEach((b) => {
      if (b.__wired) return;
      b.__wired = true;
      b.addEventListener("click", async () => {
        await _copyToClipboardCompat(b.dataset.copy);
        const orig = b.textContent;
        b.textContent = "OK";
        setTimeout(() => (b.textContent = orig || t("paths.copy")), 800);
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
        // Rev130: refresh active-sentences badge on the Paths card.
        _refreshSetupBadges();
      });
    });
    // Rev130: initial badge refresh on every render so the count shown
    // on the Paths card matches what the table displays.
    _refreshSetupBadges();
  }

  // ---- Setup tab ----
  async function loadStatus() {
    // Rev132: paint the setup-block-status badges immediately from
    // whatever we know (localStorage lang, existing input values,
    // last-calibration stamp) so the user sees them at once, even
    // before /status resolves. The fetch below will refresh them
    // again with the authoritative host/ssh from the plugin config.
    _refreshSetupBadges();
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
        // Rev129 (Carlos): i18n key with {host}/{port} sub. The bundle
        // was hard-coded in ES and leaked into every language.
        io.textContent = t("info.classic.link")
          .replace("{host}", j.host)
          .replace("{port}", String(j.port));
      }
      // Rev130: /status just told us the host, port, SSH user - update
      // the Setup card status badges so they show the fresh values.
      _refreshSetupBadges();
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
    // Rev130: live-update the "TinyPilot:" / "SSH user configured:"
    // badges as the user types so they can confirm what will be saved
    // before hitting Apply.
    ["cfg-host", "cfg-port", "cfg-ssh-user"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", _refreshSetupBadges);
    });
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
    // Rev114 (Carlos): append every command output to the console
    // instead of replacing the textarea, and auto-scroll to the newest
    // line. The user can scroll up freely through past outputs. The
    // follow-logs loop uses `_appendReplaceLastFollow` so it does not
    // clutter the buffer with 30-per-minute duplicates.
    let _dbgLastWasFollow = false;
    function _dbgAppendOutput(header, body) {
      if (!dbgOut) return;
      const line = `$ ${header}\n${(body || "").trim()}\n\n`;
      const prev = dbgOut.value || "";
      dbgOut.value = prev + line;
      // Cap at 200 KB so a bad grep does not eat all the memory.
      if (dbgOut.value.length > 200_000) {
        dbgOut.value = dbgOut.value.slice(-200_000);
      }
      dbgOut.scrollTop = dbgOut.scrollHeight;
      _dbgLastWasFollow = false;
    }
    function _dbgReplaceFollow(header, body) {
      if (!dbgOut) return;
      if (_dbgLastWasFollow) {
        // Peel back the previous follow output block and replace it.
        const marker = `$ ${header}\n`;
        const cut = dbgOut.value.lastIndexOf(marker);
        if (cut >= 0) dbgOut.value = dbgOut.value.slice(0, cut);
      }
      const line = `$ ${header}\n${(body || "").trim()}\n\n`;
      dbgOut.value = (dbgOut.value || "") + line;
      dbgOut.scrollTop = dbgOut.scrollHeight;
      _dbgLastWasFollow = true;
    }
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
          _dbgAppendOutput(`(${preset})`, t("setup.debug.noSsh") + "\n" + (j.hint || ""));
          if (dbgStat) dbgStat.textContent = t("setup.debug.failed");
          return;
        }
        if (preset === "logs.follow") {
          _dbgReplaceFollow(preset, j.stdout || "");
        } else {
          _dbgAppendOutput(preset, j.stdout || "");
        }
        if (dbgStat) dbgStat.textContent = `${t(j.ok ? "setup.debug.ok" : "setup.debug.failed")} (${j.elapsedMs || 0} ms, exit ${j.code ?? "?"})`;
      } catch (e) {
        _dbgAppendOutput(preset, "" + e);
        if (dbgStat) dbgStat.textContent = t("setup.debug.failed");
      }
    };
    $$(".debug-preset").forEach((b) => {
      b.addEventListener("click", () => runDebugPreset(b.dataset.preset));
    });

    // Rev113: interactive SSH command input. Free-form shell command
    // sent to /ssh-exec, history in localStorage, arrow up/down to
    // navigate. Output lands in the same #debug-output textarea.
    const sshInput = $("#ssh-cmd-input");
    const sshRun = $("#ssh-cmd-run");
    const SSH_HIST_KEY = "pypilot-newui.sshCmdHistory";
    let _sshHist = [];
    try { _sshHist = JSON.parse(localStorage.getItem(SSH_HIST_KEY) || "[]"); }
    catch { _sshHist = []; }
    let _sshHistIdx = _sshHist.length;
    async function runSshCmd(cmd) {
      const c = String(cmd || "").trim();
      if (!c) return;
      if (dbgStat) dbgStat.textContent = t("setup.debug.running");
      try {
        const r = await fetch(`/plugins/${PLUGIN_ID}/ssh-exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: c }),
        });
        const j = await r.json();
        _dbgAppendOutput(c, j.stdout || "");
        if (dbgStat) dbgStat.textContent = `${t(j.ok ? "setup.debug.ok" : "setup.debug.failed")} (${j.elapsedMs || 0} ms, exit ${j.code ?? "?"})`;
        if (_sshHist[_sshHist.length - 1] !== c) {
          _sshHist.push(c);
          if (_sshHist.length > 30) _sshHist.shift();
          try { localStorage.setItem(SSH_HIST_KEY, JSON.stringify(_sshHist)); } catch { /* silent */ }
        }
        _sshHistIdx = _sshHist.length;
      } catch (e) {
        _dbgAppendOutput(c, "" + e);
        if (dbgStat) dbgStat.textContent = t("setup.debug.failed");
      }
    }
    if (sshRun) sshRun.addEventListener("click", () => {
      if (sshInput) runSshCmd(sshInput.value);
    });
    // Rev114: on-screen arrows for mobile (no physical keyboard).
    function _sshHistPrev() {
      if (!sshInput) return;
      if (_sshHistIdx > 0) _sshHistIdx -= 1;
      sshInput.value = _sshHist[_sshHistIdx] || "";
      sshInput.focus();
    }
    function _sshHistNext() {
      if (!sshInput) return;
      if (_sshHistIdx < _sshHist.length - 1) {
        _sshHistIdx += 1;
        sshInput.value = _sshHist[_sshHistIdx] || "";
      } else {
        _sshHistIdx = _sshHist.length;
        sshInput.value = "";
      }
      sshInput.focus();
    }
    const histPrevBtn = $("#ssh-hist-prev");
    const histNextBtn = $("#ssh-hist-next");
    if (histPrevBtn) histPrevBtn.addEventListener("click", (e) => { e.preventDefault(); _sshHistPrev(); });
    if (histNextBtn) histNextBtn.addEventListener("click", (e) => { e.preventDefault(); _sshHistNext(); });
    if (sshInput) {
      sshInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); runSshCmd(sshInput.value); return; }
        if (e.key === "ArrowUp")   { e.preventDefault(); _sshHistPrev(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); _sshHistNext(); }
      });
    }
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
      const ok = await _copyToClipboardCompat(dbgOut?.value || "");
      if (dbgStat) dbgStat.textContent = t(ok ? "info.cfg.copied" : "info.cfg.copyFail");
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
      const ok = await _copyToClipboardCompat(json);
      _cfgStatus(ok ? t("info.cfg.copied") : t("info.cfg.copyFail"), !ok);
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
  // Rev114 (Carlos on HTTP LAN): navigator.clipboard requires a secure
  // context (HTTPS or localhost). On plain http://192.168.x.y the API
  // throws or silently no-ops. Fall back to the legacy textarea +
  // execCommand("copy") trick which still works on insecure origins.
  async function _copyToClipboardCompat(text) {
    if (!text) return false;
    try {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    // Insecure-context fallback.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
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
    // Rev96: Paths now lives inside Setup - entering Setup should still
    // refresh the paths table so counts stay live when the user opens it.
    // Rev97: also start the Sensor Quality poll while Setup is open.
    // Rev102: same for the pre-departure check card.
    // Rev104: same for the Doctor.
    if (id === "setup") { loadStatus(); refreshPaths(); sqOnTabEnter(); pcOnTabEnter(); doctorOnTabEnter(); }
    else { sqOnTabLeave(); pcOnTabLeave(); doctorOnTabLeave(); }
    if (id === "tune") {
      refreshPypilotValues();
      // Rev42: auto-relock the Ajustes controls every time the user
      // re-enters the tab. Muscle memory should be "tick then touch".
      _setTuneLocked(true);
    }
    // Rev96: Chart tab lifecycle - kick off a fetch on entry, stop the
    // auto-refresh timer when the user navigates away.
    if (id === "chart") chartOnTabEnter();
    else chartOnTabLeave();
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
  // Rev130 (Carlos): each Setup card shows what is currently
  // configured. The tab feels less like a wall of forms and more like
  // a status dashboard. Called at boot (after /status resolves), on
  // language change, after paths render, and whenever the user tweaks
  // a slider (so the calibration date badge stays live).
  const CAL_STAMP_KEY = "pypilot-newui.calLastAdjust";
  function _stampCalAdjust() {
    try { localStorage.setItem(CAL_STAMP_KEY, String(Date.now())); } catch { /* silent */ }
    _refreshSetupBadges();
  }
  function _fmtStampShort(ms) {
    if (!ms || !isFinite(ms)) return "";
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function _langLabel(code) {
    const map = { en: "English", es: "Español", de: "Deutsch", fr: "Français" };
    return map[code] || code || "?";
  }
  function _countActiveSentences() {
    // Rev136 (Carlos): report "N active / M available", where M is
    // the full plugin-mapped catalog (every non-reserved pypilot key
    // is mappable to an SK path). The user's intuition is that the
    // chip should tell them what fraction of the plugin's optional
    // sentences they've turned on - so we show M as the total.
    if (!Array.isArray(_lastPathsItems) || _lastPathsItems.length === 0) return null;
    let active = 0;
    for (const it of _lastPathsItems) {
      if (it.essential) { active++; continue; }
      const explicit = _lastEnabledMap[it.pypilotName];
      if (_publishOnlyEssentials) {
        if (explicit === true) active++;
      } else {
        if (explicit !== false) active++;
      }
    }
    return { active, total: _lastPathsItems.length };
  }
  function _refreshSetupBadges() {
    // Language
    try {
      const code = localStorage.getItem(LANG_KEY) || (state.lang || "en");
      const label = _langLabel(code);
      const el = document.getElementById("setup-status-language");
      if (el) el.innerHTML = `${t("setup.status.language") || "Active:"} <b>${label}</b>`;
      _updateSetupSummary("language", label, "good");
    } catch { /* silent */ }
    // Pypilot host
    {
      const h = document.getElementById("cfg-host");
      const p = document.getElementById("cfg-port");
      const host = h && h.value ? h.value.trim() : "";
      const port = p && p.value ? p.value.trim() : "";
      const el = document.getElementById("setup-status-conn");
      if (host) {
        const hp = `${host}${port ? ":" + port : ""}`;
        if (el) el.innerHTML = `${t("setup.status.host") || "TinyPilot:"} <b>${hp}</b>`;
        _updateSetupSummary("connection", hp, "good");
      } else {
        if (el) el.textContent = "";
        _updateSetupSummary("connection", t("setup.status.hostMissing") || "not configured", "warn");
      }
    }
    // Remote / SSH. Rev134 (Carlos): no more red/amber when the SSH
    // creds are not saved - the console is optional, not a warning.
    {
      const su = document.getElementById("cfg-ssh-user");
      const user = su && su.value ? su.value.trim() : "";
      const el = document.getElementById("setup-status-remote");
      if (user) {
        // Rev135 (Carlos): don't expose the SSH username in the chip,
        // just say it's configured. The user is still visible inside
        // the card for editing.
        if (el) el.innerHTML = `${t("setup.status.sshConfigured") || "SSH configured"}`;
        _updateSetupSummary("emergency", t("setup.status.sshConfigured") || "SSH configured", "good");
      } else {
        if (el) el.textContent = "";
        // Neutral chip (no level): matches the "..." look of other
        // tiles that carry no status yet.
        _updateSetupSummary("emergency", t("setup.status.sshMissing") || "SSH not configured", "");
      }
    }
    // Paths / sentences. Rev134 (Carlos): show only the active count.
    // The "/ total" was reporting the whole pypilot catalog (~181),
    // which is confusing - almost none of those are meant to be
    // published, so the ratio was meaningless.
    {
      const c = _countActiveSentences();
      const el = document.getElementById("setup-status-paths");
      if (c) {
        if (el) el.innerHTML = `${t("setup.status.sentences") || "Active sentences:"} <b>${c.active}</b> / ${c.total}`;
        _updateSetupSummary("paths", `${c.active} / ${c.total}`, c.active > 0 ? "good" : "warn");
      } else {
        if (el) el.textContent = "";
      }
    }
    // Calibration last-adjust
    {
      let ms = 0;
      try { ms = parseInt(localStorage.getItem(CAL_STAMP_KEY) || "0", 10); } catch { ms = 0; }
      const el = document.getElementById("setup-status-cal");
      if (ms) {
        const stamp = _fmtStampShort(ms);
        if (el) el.innerHTML = `${t("setup.status.calLast") || "Last adjustment:"} <b>${stamp}</b>`;
        _updateSetupSummary("calibration", stamp, "good");
      } else {
        if (el) el.innerHTML = `<span style="opacity:0.7">${t("setup.status.calNever") || "No adjustments recorded yet."}</span>`;
        _updateSetupSummary("calibration", t("setup.status.calNeverShort") || "not adjusted yet", "warn");
      }
    }
  }

  // Rev129 (Carlos): on the first gain change of an unlock session,
  // ask whether to keep tweaking the current profile or fork a copy
  // (`tune-YYYYMMDD-HHMM`) — same pattern as Doctor. Non-modal blocking
  // is intentional: the write already went through; the modal decides
  // where it landed. If the user chooses "new", we tell pypilot
  // `profile=<newname>` which clones the current profile (writing an
  // unknown name creates it from the active profile), so the last
  // change is preserved in the fork.
  function _maybePromptTuneFork(ctx) {
    if (_tuneForkAsked.v) return;
    _tuneForkAsked.v = true;
    // Rev132: remember the change context so Cancel can undo it.
    // Every subsequent tweak within the same unlock session updates
    // this to point at the LATEST change, so Cancel always undoes
    // "the last thing I did" even after the modal was dismissed once
    // (a nice property, though today the modal only fires once).
    _tuneLastChange = ctx || null;
    const pilot = state.pilot || "";
    if (!pilot) return;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const forkName = `tune-${stamp}`;
    let m = document.getElementById("tune-fork-modal");
    if (!m) {
      m = document.createElement("div");
      m.id = "tune-fork-modal";
      m.className = "tune-fork-backdrop";
      m.innerHTML =
        `<div class="modal-card">` +
        `  <h3 data-i18n="tune.fork.title">Save gain changes</h3>` +
        `  <p data-i18n="tune.fork.body">You just tweaked a gain. Where should the change live?</p>` +
        `  <div class="tune-fork-actions">` +
        `    <button type="button" id="tune-fork-new" class="primary"></button>` +
        `    <button type="button" id="tune-fork-keep" class="secondary"></button>` +
        `    <button type="button" id="tune-fork-cancel" class="ghost"></button>` +
        `  </div>` +
        `  <div id="tune-fork-note" style="font-size:12px;color:var(--fg-dim);margin-top:8px"></div>` +
        `</div>`;
      document.body.appendChild(m);
    }
    const keepBtn = m.querySelector("#tune-fork-keep");
    const newBtn = m.querySelector("#tune-fork-new");
    const cancelBtn = m.querySelector("#tune-fork-cancel");
    const note = m.querySelector("#tune-fork-note");
    keepBtn.textContent = (t("tune.fork.keep") || "Keep in '{pilot}'").replace("{pilot}", pilot);
    newBtn.textContent = (t("tune.fork.new") || "Save in new '{name}'").replace("{name}", forkName);
    if (cancelBtn) cancelBtn.textContent = t("tune.fork.cancel") || "Cancel";
    if (note) note.textContent = t("tune.fork.hint") || "";
    m.hidden = false;
    m.classList.add("open");
    const close = () => { m.hidden = true; m.classList.remove("open"); };
    keepBtn.onclick = () => { close(); };
    newBtn.onclick = () => {
      try { pluginRaw("profile", forkName); } catch { /* silent */ }
      close();
    };
    if (cancelBtn) cancelBtn.onclick = () => {
      // Rev132 (Carlos): Cancel must REVERT the change, not just
      // close. Snap the slider back to the frozen baseline and push
      // it to pypilot so the SK path reverts too.
      const c = _tuneLastChange;
      if (c && c.baselineKey && _tuneBaselines.has(c.baselineKey)) {
        const b = _tuneBaselines.get(c.baselineKey);
        try {
          if (c.rng) c.rng.value = String(b);
          if (c.val) c.val.textContent = Number(b).toFixed(4);
          if (c.pypilotKey) pluginRaw(c.pypilotKey, b);
        } catch { /* silent */ }
      }
      close();
    };
  }

  function _setTuneLocked(locked) {
    const unlockCb = $("#tune-unlock");
    if (unlockCb) unlockCb.checked = !locked;
    // Rev129: every lock/unlock cycle re-arms the fork prompt so the
    // question is asked once per editing session.
    _tuneForkAsked.v = false;
    const containers = [$("#gains-container"), $("#config-sliders")];
    for (const cont of containers) {
      if (!cont) continue;
      cont.classList.toggle("locked", !!locked);
      cont.querySelectorAll(".gain-row").forEach((row) => {
        const rng = row.querySelector("input[type=range]");
        const baselineEl = row.querySelector(".baseline");
        const decimals = parseInt(row.dataset.decimals || "3", 10);
        row.querySelectorAll("input[type=range], .nudge-btn, .tune-reset-btn").forEach((el) => {
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
          // Rev134 (Carlos): also seed the Tune baseline map with the
          // value the user actually sees at unlock time. Without this
          // ↺ and Cancel had nothing to snap back to when the initial
          // render happened before pypilot values arrived (the Map
          // was populated only via the async refreshPypilotValues, which
          // could race with the first slider tweak).
          const gKey = row.dataset.pypilot;
          if (Number.isFinite(now) && gKey && gKey.startsWith("ap.pilot.")) {
            const parts = gKey.split(".");
            if (parts.length >= 4) {
              const pilotName = parts[2];
              const shortName = parts.slice(3).join(".");
              _tuneBaselines.set(`${pilotName}::${shortName}`, now);
            }
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
    // Rev48/65: long-press opens the corner-selector popup. Short tap on
    // a corner whose current mapping is "wind" flips the label between
    // AWA/AWS and TWA/TWS, pinning the user's choice so subsequent AP
    // mode changes stop auto-flipping it (see _syncWindCornerFromMode).
    _dashLoadCfg();
    _dashPopulateSelectors();
    _dashRenderCorners();
    // Rev66 / 2.0.4 - long-press / short-tap handler with PER-CELL state.
    // The previous Rev65 version leaked shared timer / timestamp / wasLong
    // flags across all 4 cells, so a touchstart on one cell overwrote the
    // in-flight state of another. Short-tap detection race-flipped and the
    // AWS/TWS toggle stopped working reliably. Wrapping the state inside
    // each cell's forEach closure gives us clean isolation - each cell
    // owns its own timer and its own last-press timestamp.
    const attachLongTap = (el, onShortTap) => {
      let timer = null;
      let pressStartedAt = 0;
      let wasLong = false;
      const openSelector = (e) => {
        e && e.preventDefault();
        wasLong = true;
        _dashPopulateSelectors();
        const pop = document.getElementById("dash-help-pop");
        if (pop) pop.classList.add("open");
      };
      const startPress = (e) => {
        pressStartedAt = Date.now();
        wasLong = false;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => openSelector(e), 500);
      };
      const endPress = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (wasLong) return;
        const elapsed = Date.now() - pressStartedAt;
        if (elapsed >= 500) return;
        onShortTap();
      };
      const cancelPress = () => {
        if (timer) { clearTimeout(timer); timer = null; }
      };
      el.addEventListener("touchstart", startPress, { passive: true });
      el.addEventListener("touchend",   endPress,   { passive: true });
      el.addEventListener("touchmove",  () => { cancelPress(); wasLong = true; }, { passive: true });
      el.addEventListener("touchcancel", cancelPress, { passive: true });
      el.addEventListener("contextmenu", openSelector);
      el.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        startPress(e);
      });
      el.addEventListener("mouseup",   endPress);
      el.addEventListener("mouseleave", cancelPress);
    };
    // 4 corner cells: short-tap on a cell mapped to "wind" toggles AWS/TWS.
    $$(".dash-rose .dash-cell[data-corner]").forEach((cell) => {
      attachLongTap(cell, () => {
        if (_dashCornerCfg[cell.dataset.corner] === "wind") _toggleWindCornerShow();
      });
    });
    // Rev81: boat sprite (rose-boat) also opens the corner selector on
    // long-press, so the user does not have to hunt for a corner cell.
    // Short-tap on the boat does nothing. Carlos Rev80 QA: "que el
    // selecto pueda ser tambien activado hacidndo long press en el
    // barco".
    const boatSprite = document.getElementById("rose-boat");
    if (boatSprite) {
      boatSprite.style.cursor = "pointer";
      attachLongTap(boatSprite, () => { /* no short-tap action */ });
    }
    // Rev72: short-tap-only handler on the wind chip. Previously used
    // attachLongTap, but the 500 ms timer inside it opened the corner
    // selector popup - unwanted on the chip (it is not a corner). Also
    // stops touch/pointer propagation so the global <main> tab-swipe
    // listener does not treat a chip tap as a horizontal swipe (Carlos
    // Rev71: "el chip se desliza a la derecha e incluso a veces abre el
    // menu de esquinas"). Uses pointerdown/pointerup as primary and
    // touch stop-propagation as belt-and-suspenders. Fires the AWS/TWS
    // toggle only if elapsed < 400 ms AND finger did not move.
    const speedChip = document.getElementById("rose-speed-chip");
    if (speedChip) {
      let chipDownTs = 0;
      let chipDownX = 0, chipDownY = 0;
      let chipMoved = false;
      const CHIP_TAP_MAX_MS = 400;
      const CHIP_MOVE_TOLERANCE_PX = 8;
      speedChip.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        chipDownTs = Date.now();
        chipDownX = e.clientX;
        chipDownY = e.clientY;
        chipMoved = false;
        e.stopPropagation();
      });
      speedChip.addEventListener("pointermove", (e) => {
        if (!chipDownTs) return;
        const dx = e.clientX - chipDownX;
        const dy = e.clientY - chipDownY;
        if (Math.abs(dx) > CHIP_MOVE_TOLERANCE_PX || Math.abs(dy) > CHIP_MOVE_TOLERANCE_PX) {
          chipMoved = true;
        }
      });
      speedChip.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        if (!chipDownTs) return;
        const elapsed = Date.now() - chipDownTs;
        chipDownTs = 0;
        if (chipMoved) return;
        if (elapsed > CHIP_TAP_MAX_MS) return;
        _toggleWindCornerShow();
      });
      // Kill the synthesised click that follows pointer events so it
      // cannot bubble up and trigger anything else on <main>.
      speedChip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      // Belt-and-suspenders: stop touch propagation too so main's
      // touchmove-based swipe never fires from a chip drag.
      speedChip.addEventListener("touchstart",  (e) => e.stopPropagation(), { passive: true });
      speedChip.addEventListener("touchmove",   (e) => e.stopPropagation(), { passive: true });
      speedChip.addEventListener("touchend",    (e) => e.stopPropagation(), { passive: true });
    }
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
    // Rev129 (Carlos): swipe DOWN from the top of the viewport (when
    // nav is hidden in Control mode) reveals the tab bar. Keeps the
    // dashboard full-screen 99% of the time but avoids hunting for the
    // toggle button when you actually want to change tabs.
    let _swipeY0 = null;
    document.addEventListener("touchstart", (ev) => {
      if (!document.body.classList.contains("nav-hidden")) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      // Only track swipes that started near the top of the viewport
      // (top 60 px) so we do not fight scroll gestures elsewhere.
      if (t.clientY > 60) return;
      _swipeY0 = t.clientY;
    }, { passive: true });
    document.addEventListener("touchmove", (ev) => {
      if (_swipeY0 == null) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      const dy = t.clientY - _swipeY0;
      // > 50 px down = show nav.
      if (dy > 50) {
        _navShow();
        _swipeY0 = null;
        if (_navAutoHideTimer) { clearTimeout(_navAutoHideTimer); _navAutoHideTimer = null; }
        // Re-arm auto-hide so it fades again after a few seconds if
        // the user does not tap a tab.
        _navScheduleAutoHide();
      }
    }, { passive: true });
    document.addEventListener("touchend", () => { _swipeY0 = null; }, { passive: true });
    document.addEventListener("touchcancel", () => { _swipeY0 = null; }, { passive: true });
  }

  // ============================================================
  // Rev104: Pypilot Doctor (Setup card)
  // ============================================================
  // Polls /doctor/status every 1 s while the Setup tab is visible. The
  // start / cancel / apply / apply-all buttons are the only writers -
  // everything else is a re-render from the status snapshot.
  const _doc = { timer: null, last: null };
  // Rev135 (Carlos): frontend-side "hide" set. The backend keeps its
  // own dismissed state, but this is what removes an already-applied
  // (or already-dismissed) card from the UI so the list stays clean.
  const DOC_HIDDEN_KEY = "pypilot-newui.doctorHidden";
  const _docHiddenIds = new Set(
    (() => { try { return JSON.parse(localStorage.getItem(DOC_HIDDEN_KEY) || "[]"); } catch { return []; } })()
  );
  async function _docFetch() {
    try {
      const r = await fetch(`/plugins/${PLUGIN_ID}/doctor/status`);
      if (!r.ok) return;
      _doc.last = await r.json();
      _docRender();
    } catch { /* silent */ }
  }
  function _docFmtDur(s) {
    if (typeof s !== "number" || !isFinite(s) || s < 0) return "--";
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return m > 0 ? `${m}m ${String(ss).padStart(2,"0")}s` : `${ss}s`;
  }
  function _docStartBtn() { return document.getElementById("doctor-start-btn"); }
  function _docCancelBtn() { return document.getElementById("doctor-cancel-btn"); }
  function _docProgressWrap() { return document.getElementById("doctor-progress-wrap"); }
  function _docResult() { return document.getElementById("doctor-result"); }
  function _docRender() {
    const st = _doc.last;
    if (!st) return;
    // Rev105: collapsed summary reflects the state at a glance.
    let sumTxt = "", sumLvl = "";
    if (st.state === "running") { sumTxt = `${st.elapsedSec}/${st.targetDurationSec}s`; sumLvl = "warn"; }
    else if (st.state === "analyzing") { sumTxt = t("setup.doctor.analyzing.short"); sumLvl = "warn"; }
    else if (st.state === "completed" && st.result) {
      // Rev136 (Carlos): hidden-locally suggestions/findings also
      // vanish from the chip counter, so once the user has cleared
      // them all the tile goes back to "healthy" instead of stubborn
      // ly saying "1 suggested" forever.
      const nsug = (st.result.suggestions || []).filter((s) => !_docHiddenIds.has(s.id)).length;
      const nfind = (st.result.findings || []).length;
      if (nsug > 0) sumTxt = t("setup.doctor.suggested").replace("{n}", nsug);
      else if (nfind > 0) sumTxt = t("setup.doctor.noted").replace("{n}", nfind);
      else sumTxt = t("setup.doctor.healthy");
      sumLvl = nsug > 0 ? "warn" : "good";
    } else {
      sumTxt = t("setup.doctor.idle");
    }
    _updateSetupSummary("doctor", sumTxt, sumLvl);
    const startBtn = _docStartBtn();
    const cancelBtn = _docCancelBtn();
    const progWrap = _docProgressWrap();
    const progLabel = document.getElementById("doctor-progress-label");
    const progFill = document.getElementById("doctor-progress-fill");
    const progTime = document.getElementById("doctor-progress-time");
    const resultBox = _docResult();
    const running = st.state === "running" || st.state === "analyzing";
    if (startBtn) { startBtn.hidden = running; startBtn.disabled = running; }
    if (cancelBtn) cancelBtn.hidden = !running;
    if (progWrap) progWrap.hidden = !running;
    if (progLabel) progLabel.textContent = st.state === "analyzing"
      ? t("setup.doctor.analyzing")
      : t("setup.doctor.recording");
    if (progFill) progFill.style.width = `${Math.round((st.progressPct || 0) * 100)}%`;
    if (progTime) progTime.textContent = `${_docFmtDur(st.elapsedSec)} / ${_docFmtDur(st.targetDurationSec)}`;
    if (resultBox) {
      if (st.state === "completed" && st.result) {
        resultBox.hidden = false;
        _docRenderResult(resultBox, st.result);
      } else if (st.state === "idle") {
        resultBox.hidden = true;
        resultBox.textContent = "";
      }
    }
  }
  function _docRenderResult(root, r) {
    root.textContent = "";
    // Summary bar
    const sum = document.createElement("div");
    sum.className = "doctor-summary";
    if (r.suggestions.length === 0 && r.findings.length === 0) sum.classList.add("pc-ready");
    else if (r.findings.some((f) => f.severity === "critical")) sum.classList.add("pc-fail");
    else if (r.findings.length > 0) sum.classList.add("pc-caveats");
    // Rev136 (Carlos): translate the "N issue(s) detected..." summary
    // using the summaryKey the backend now emits (fallbacks to the
    // English string it also sends for legacy consumers).
    const summaryText = _tSub(r.summaryKey, r.summaryArgs) || r.summary;
    sum.textContent = `${summaryText}  ·  ${t("setup.doctor.samplesSummary").replace("{engaged}", r.engagedSamples).replace("{total}", r.samplesAnalyzed).replace("{pilot}", r.pilotId)}`;
    root.appendChild(sum);
    // Rev120 (Carlos): new-profile banner shown as soon as any suggestion
    // has been applied. Tells the user the original profile is safe and
    // where the changes actually landed.
    if (r.newProfileName) {
      const pn = document.createElement("div");
      pn.className = "doctor-profile-banner";
      const orig = r.originalProfile || "?";
      pn.innerHTML = `${t("setup.doctor.forkedProfile")
        .replace("{new}", `<b>${r.newProfileName}</b>`)
        .replace("{orig}", `<b>${orig}</b>`)}`;
      root.appendChild(pn);
    }
    // Findings
    if (r.findings.length > 0) {
      const t1 = document.createElement("div");
      t1.className = "doctor-section-title";
      t1.textContent = t("setup.doctor.findings");
      root.appendChild(t1);
      const list = document.createElement("div");
      list.className = "doctor-findings";
      for (const f of r.findings) {
        const row = document.createElement("div");
        row.className = "doctor-finding f-" + f.severity;
        const icon = document.createElement("div");
        icon.className = "pc-item-icon";
        icon.textContent = f.severity === "critical" ? "!!" : f.severity === "warn" ? "!" : "i";
        const body = document.createElement("div");
        body.className = "doctor-finding-body";
        const msg = document.createElement("div");
        msg.className = "doctor-finding-msg";
        // Rev136: same pattern as suggestions - use the i18n key when
        // the backend sends one, fall back to English text otherwise.
        msg.textContent = _tSub(f.messageKey, f.messageArgs) || f.message;
        const met = document.createElement("div");
        met.className = "doctor-finding-metric";
        met.textContent = f.metric;
        body.appendChild(msg);
        body.appendChild(met);
        const cat = document.createElement("div");
        cat.className = "pc-item-status";
        cat.textContent = f.category.toUpperCase();
        row.appendChild(icon);
        row.appendChild(body);
        row.appendChild(cat);
        list.appendChild(row);
      }
      root.appendChild(list);
    }
    // Suggestions
    if (r.suggestions.length > 0) {
      const t2 = document.createElement("div");
      t2.className = "doctor-section-title";
      t2.textContent = t("setup.doctor.suggestions");
      root.appendChild(t2);
      const list = document.createElement("div");
      list.className = "doctor-suggestions";
      for (const s of r.suggestions) {
        // Rev135: locally-hidden suggestions stay collapsed. The user
        // asked to be able to clear stale advice from the list even
        // after applying it.
        if (_docHiddenIds.has(s.id)) continue;
        list.appendChild(_docRenderSuggestion(s));
      }
      root.appendChild(list);
      // Apply all button (only if any unapplied)
      if (r.suggestions.some((s) => !s.applied)) {
        const all = document.createElement("button");
        all.className = "doctor-apply-all";
        all.type = "button";
        all.textContent = t("setup.doctor.applyAll");
        all.addEventListener("click", async () => {
          if (!confirm(t("setup.doctor.applyAllConfirm"))) return;
          try {
            await fetch(`/plugins/${PLUGIN_ID}/doctor/apply-all`, { method: "POST" });
            _docFetch();
          } catch { /* silent */ }
        });
        root.appendChild(all);
      }
    }
  }
  // Rev121: template substitution for suggestion reason/effect that
  // come from the backend as key + args (localized). Falls back to the
  // English `reason` / `expectedEffect` strings if no key is provided
  // (older backend, no i18n entry).
  function _tSub(key, args) {
    if (!key) return null;
    let s = t(key);
    if (!s || s === key) return null;   // no translation, use fallback
    if (args && typeof args === "object") {
      for (const [k, v] of Object.entries(args)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  }
  function _docRenderSuggestion(s) {
    const card = document.createElement("div");
    let cls = "doctor-suggestion";
    if (s.applied) cls += " applied";
    if (s.dismissed) cls += " dismissed";
    card.className = cls;
    const header = document.createElement("div");
    header.className = "doctor-sug-header";
    const title = document.createElement("div");
    title.className = "doctor-sug-title";
    const catKey = "doctor.cat." + s.category;
    const catLbl = t(catKey);
    title.textContent = `${s.gainKey}  ·  ${(catLbl === catKey ? s.category : catLbl).toUpperCase()}`;
    const conf = document.createElement("span");
    conf.className = "doctor-sug-confidence " + s.confidence;
    const confKey = "doctor.conf." + s.confidence;
    const confLbl = t(confKey);
    conf.textContent = `${t("setup.doctor.confidence")}: ${(confLbl === confKey ? s.confidence : confLbl).toUpperCase()}`;
    header.appendChild(title);
    header.appendChild(conf);
    card.appendChild(header);
    // Values row
    const vals = document.createElement("div");
    vals.className = "doctor-sug-values";
    vals.innerHTML = `${Number(s.currentValue).toFixed(5)}<span class="arrow">→</span>${Number(s.suggestedValue).toFixed(5)}<span class="doctor-sug-delta">${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct.toFixed(0)}%</span>`;
    card.appendChild(vals);
    // Reason + effect (i18n key preferred, English fallback)
    const reasonText = _tSub(s.reasonKey, s.reasonArgs) || s.reason || "";
    const effectText = _tSub(s.effectKey, s.effectArgs) || s.expectedEffect || "";
    if (reasonText) {
      const reason = document.createElement("div");
      reason.className = "doctor-sug-reason";
      reason.textContent = reasonText;
      card.appendChild(reason);
    }
    if (effectText) {
      const effect = document.createElement("div");
      effect.className = "doctor-sug-effect";
      effect.textContent = effectText;
      card.appendChild(effect);
    }
    // Actions - Apply + Discard side by side
    const actions = document.createElement("div");
    actions.className = "doctor-sug-actions";
    // Rev135 (Carlos): the Discard/Hide button used to disappear as
    // soon as a suggestion was applied or dismissed, leaving the card
    // stuck on the list with no way to clear it. Show it in every
    // state: on a pristine suggestion it calls the backend dismiss
    // endpoint (server-side ignore); on an already-applied /
    // dismissed one it hides the card locally so the list stays
    // tidy without touching backend state.
    {
      const discard = document.createElement("button");
      discard.className = "doctor-sug-discard";
      discard.type = "button";
      const hidden = _docHiddenIds.has(s.id);
      discard.textContent = (s.applied || s.dismissed || hidden)
        ? (t("setup.doctor.hide") || "Hide")
        : t("setup.doctor.discard");
      discard.addEventListener("click", async () => {
        discard.disabled = true;
        try {
          if (!s.applied && !s.dismissed) {
            await fetch(`/plugins/${PLUGIN_ID}/doctor/dismiss/${s.id}`, { method: "POST" });
          }
          _docHiddenIds.add(s.id);
          try { localStorage.setItem(DOC_HIDDEN_KEY, JSON.stringify([..._docHiddenIds])); } catch { /* silent */ }
          _docFetch();
        } catch { /* silent */ }
      });
      actions.appendChild(discard);
    }
    const apply = document.createElement("button");
    apply.className = "doctor-sug-apply";
    apply.type = "button";
    if (s.dismissed)      apply.textContent = t("setup.doctor.discarded");
    else if (s.applied)   apply.textContent = t("setup.doctor.applied");
    else                  apply.textContent = t("setup.doctor.apply");
    apply.disabled = !!(s.applied || s.dismissed);
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      apply.textContent = "...";
      try {
        await fetch(`/plugins/${PLUGIN_ID}/doctor/apply/${s.id}`, { method: "POST" });
        _docFetch();
      } catch { /* silent */ }
    });
    actions.appendChild(apply);
    card.appendChild(actions);
    return card;
  }
  function wireDoctor() {
    const startBtn = _docStartBtn();
    if (startBtn) startBtn.addEventListener("click", async () => {
      const sel = document.getElementById("doctor-duration");
      const dur = sel && sel.value ? Number(sel.value) : 180;
      try {
        const r = await fetch(`/plugins/${PLUGIN_ID}/doctor/start?duration=${dur}`, { method: "POST" });
        const j = await r.json();
        if (!j.ok) alert(j.message || "Doctor start refused.");
        _docFetch();
      } catch { /* silent */ }
    });
    const cancelBtn = _docCancelBtn();
    if (cancelBtn) cancelBtn.addEventListener("click", async () => {
      try {
        await fetch(`/plugins/${PLUGIN_ID}/doctor/cancel`, { method: "POST" });
        _docFetch();
      } catch { /* silent */ }
    });
  }
  function doctorOnTabEnter() {
    _docFetch();
    if (_doc.timer) clearInterval(_doc.timer);
    _doc.timer = setInterval(_docFetch, 1000);
  }
  function doctorOnTabLeave() {
    if (_doc.timer) { clearInterval(_doc.timer); _doc.timer = null; }
  }

  // ============================================================
  // Rev102: Autopilot pre-departure check (Setup card)
  // ============================================================
  const _pc = { timer: null, last: null };
  async function _pcFetchAndRender() {
    try {
      const r = await fetch(`/plugins/${PLUGIN_ID}/prechecks`);
      if (!r.ok) return;
      _pc.last = await r.json();
      _pcRender();
    } catch { /* silent */ }
  }
  function _pcVerdictKey(v) {
    if (v === "ready") return "pc-ready";
    if (v === "ready-with-caveats") return "pc-caveats";
    if (v === "do-not-engage") return "pc-fail";
    return "pc-unknown";
  }
  function _pcVerdictLabel(v) {
    if (v === "ready") return t("setup.precheck.verdict.ready");
    if (v === "ready-with-caveats") return t("setup.precheck.verdict.caveats");
    if (v === "do-not-engage") return t("setup.precheck.verdict.fail");
    return t("setup.precheck.unknown");
  }
  function _pcItemIcon(s) {
    return s === "pass" ? "✓" : s === "warn" ? "!" : s === "fail" ? "✕" : "?";
  }
  function _pcRender() {
    const verdict = document.getElementById("pc-verdict");
    const counts = document.getElementById("pc-counts");
    const items = document.getElementById("pc-items");
    if (!verdict || !items || !_pc.last) return;
    const snap = _pc.last;
    verdict.className = "pc-verdict " + _pcVerdictKey(snap.overall);
    const lab = verdict.querySelector(".pc-verdict-label");
    if (lab) lab.textContent = _pcVerdictLabel(snap.overall);
    if (counts) counts.textContent = `${snap.passCount} ✓ · ${snap.warnCount} ! · ${snap.failCount} ✕`;
    // Rev105: sync the collapsed summary text so a user with the block
    // closed still sees the verdict at a glance.
    const lvl = snap.overall === "do-not-engage" ? "fail"
              : snap.overall === "ready-with-caveats" ? "warn"
              : snap.overall === "ready" ? "good" : "";
    _updateSetupSummary("precheck", `${snap.passCount}✓ ${snap.warnCount}! ${snap.failCount}✕`, lvl);
    items.textContent = "";
    for (const it of snap.items) {
      const row = document.createElement("div");
      row.className = "pc-item pc-" + it.status;
      const icon = document.createElement("div");
      icon.className = "pc-item-icon";
      icon.textContent = _pcItemIcon(it.status);
      const body = document.createElement("div");
      body.className = "pc-item-body";
      const lab2 = document.createElement("div");
      lab2.className = "pc-item-label";
      lab2.textContent = it.label;
      const det = document.createElement("div");
      det.className = "pc-item-detail";
      det.textContent = it.detail;
      body.appendChild(lab2);
      body.appendChild(det);
      if (it.hint) {
        const hint = document.createElement("div");
        hint.className = "pc-item-hint";
        hint.textContent = it.hint;
        body.appendChild(hint);
      }
      const st = document.createElement("div");
      st.className = "pc-item-status";
      st.textContent = it.status.toUpperCase();
      row.appendChild(icon);
      row.appendChild(body);
      row.appendChild(st);
      items.appendChild(row);
    }
  }
  function pcOnTabEnter() {
    _pcFetchAndRender();
    if (_pc.timer) clearInterval(_pc.timer);
    _pc.timer = setInterval(_pcFetchAndRender, 3000);
  }
  function pcOnTabLeave() {
    if (_pc.timer) { clearInterval(_pc.timer); _pc.timer = null; }
  }
  function wirePrecheck() {
    const btn = document.getElementById("pc-refresh-btn");
    if (btn) btn.addEventListener("click", _pcFetchAndRender);
  }

  // ============================================================
  // Rev101: Alarm banner + config panel + browser audio
  // ============================================================
  // Single poll of /alarms/state every 2 s drives both the sticky
  // banner at the top of the app AND the config panel in Setup.
  // Audio uses WebAudio + speechSynthesis (no external assets, no Pi
  // config needed). Audio in Pi speakers via espeak lands in Rev102.

  const _al = {
    timer: null,
    state: { active: [], recent: [] },
    rules: [],
    audioCtx: null,
    seenActiveIds: new Set(),      // ids we already tried to sound off for
    lastReplayTs: 0,
    // Rev121: ruleIds the user has explicitly dismissed from the banner
    // in this session. Cleared automatically when the underlying alarm
    // stops firing, so a fresh trigger of the same rule shows again.
    dismissedIds: new Set(),
  };
  const AL_REPLAY_SEC = 25;         // repeat unacked alarm sound every N s

  async function _alFetch() {
    try {
      const [stateRes, rulesRes] = await Promise.all([
        fetch(`/plugins/${PLUGIN_ID}/alarms/state`),
        fetch(`/plugins/${PLUGIN_ID}/alarms/rules`),
      ]);
      if (stateRes.ok) _al.state = await stateRes.json();
      if (rulesRes.ok) _al.rules = (await rulesRes.json()).rules || [];
      _alRenderBanner();
      _alRenderConfig();
      _alMaybePlaySound();
    } catch { /* silent */ }
  }
  function _alSeverityIcon(sev) {
    return sev === "alarm" ? "!" : sev === "warn" ? "⚠" : "ℹ";
  }
  // Rev135 (Carlos): the alarm engine builds the message string on
  // the backend in English. Instead of duplicating the whole rule
  // set to i18n it we parse the numeric args back out here, look up
  // "alarm.rule.<id>.msg" and interpolate. If no translation is
  // registered we fall back to the backend English string, so old
  // rules keep working without a frontend change.
  function _alExtractArgs(id, msg) {
    const out = {};
    if (id === "heading-deviation") {
      const r = /error ([\d.]+)/.exec(msg);
      if (r) out.deg = r[1];
    } else if (id === "unable-to-steer") {
      const r = /: ([\d.]+)° error, servo ([\d.]+)%/.exec(msg);
      if (r) { out.deg = r[1]; out.duty = r[2]; }
    } else if (id === "servo-overcurrent") {
      const r = /([\d.]+) A/.exec(msg);
      if (r) out.amp = r[1];
    } else if (id === "servo-temp-high") {
      const r = /([\d.]+) °C/.exec(msg);
      if (r) out.temp = r[1];
    } else if (id === "low-voltage") {
      const r = /([\d.]+) V/.exec(msg);
      if (r) out.volt = r[1];
    } else if (id === "sensor-lost") {
      const r = /lost: (.*)$/.exec(msg);
      if (r) out.list = r[1];
    } else if (id === "pypilot-disconnected") {
      const r = /(\d+)s/.exec(msg);
      if (r) out.sec = r[1];
    }
    return out;
  }
  function _alTranslate(a) {
    const labelKey = `alarm.rule.${a.ruleId}.label`;
    const labelT = t(labelKey);
    const label = (labelT === labelKey) ? a.label : labelT;
    const msgKey = `alarm.rule.${a.ruleId}.msg`;
    const msgT = t(msgKey);
    if (msgT === msgKey) return { label, message: a.message };
    const args = _alExtractArgs(a.ruleId, a.message || "");
    let msg = msgT;
    for (const [k, v] of Object.entries(args)) msg = msg.replaceAll(`{${k}}`, v);
    return { label, message: msg };
  }
  function _alRenderBanner() {
    const el = document.getElementById("alarm-banner");
    if (!el) return;
    const activeAll = _al.state.active || [];
    // Rev121: prune dismissedIds whose rule is no longer firing so a
    // future trigger shows again in the banner.
    const stillActiveIds = new Set(activeAll.map((a) => a.ruleId));
    for (const id of Array.from(_al.dismissedIds)) {
      if (!stillActiveIds.has(id)) _al.dismissedIds.delete(id);
    }
    const active = activeAll.filter((a) => !_al.dismissedIds.has(a.ruleId));
    if (active.length === 0) {
      el.hidden = true;
      el.textContent = "";
      _al.seenActiveIds.clear();
      return;
    }
    el.hidden = false;
    el.textContent = "";
    for (const a of active) {
      const row = document.createElement("div");
      row.className = "alarm-row " + (a.severity === "alarm" ? "alarm" : "warn");
      if (a.ackedAtMs) row.classList.add("acked");
      const icon = document.createElement("span");
      icon.className = "alarm-icon";
      icon.textContent = _alSeverityIcon(a.severity);
      const txt = document.createElement("div");
      txt.className = "alarm-txt";
      const trans = _alTranslate(a);
      const lab = document.createElement("div");
      lab.className = "alarm-label";
      lab.textContent = trans.label;
      const msg = document.createElement("div");
      msg.className = "alarm-msg";
      msg.textContent = trans.message;
      txt.appendChild(lab); txt.appendChild(msg);
      const ackBtn = document.createElement("button");
      ackBtn.className = "alarm-ack";
      ackBtn.type = "button";
      ackBtn.textContent = a.ackedAtMs ? t("alarm.acked") : t("alarm.ack");
      ackBtn.disabled = !!a.ackedAtMs;
      ackBtn.addEventListener("click", () => {
        fetch(`/plugins/${PLUGIN_ID}/alarms/ack/${a.ruleId}`, { method: "POST" })
          .then(() => _alFetch())
          .catch(() => {});
      });
      // Rev121: X button - dismiss locally (hides until the underlying
      // alarm stops firing and a fresh trigger arrives). Also ACKs the
      // rule so the sound stops.
      const closeBtn = document.createElement("button");
      closeBtn.className = "alarm-close";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", () => {
        _al.dismissedIds.add(a.ruleId);
        if (!a.ackedAtMs) {
          fetch(`/plugins/${PLUGIN_ID}/alarms/ack/${a.ruleId}`, { method: "POST" })
            .then(() => _alFetch())
            .catch(() => {});
        } else {
          _alRenderBanner();
        }
      });
      row.appendChild(icon);
      row.appendChild(txt);
      row.appendChild(ackBtn);
      row.appendChild(closeBtn);
      el.appendChild(row);
    }
  }
  function _alRenderConfig() {
    const el = document.getElementById("alarms-config");
    if (!el) return;
    // Rev107 (Carlos feedback): summary shows BOTH counts always so the
    // user reads active vs healthy at a glance without expanding.
    // Format: "A act · O OK" (+ optional " · M silen" if any muted / " · X off" if any off).
    const nowMs = Date.now();
    let active = 0, muted = 0, off = 0, ok = 0;
    for (const r of _al.rules) {
      if (!r.enabled) off += 1;
      else if (r.mutedUntilMs && r.mutedUntilMs > nowMs) muted += 1;
      else if (r.active) active += 1;
      else ok += 1;
    }
    // Rev108 (Carlos semantic fix): "activa" was ambiguous - Carlos
    // distinguishes rule ENABLED ("activada") from alarm FIRING
    // ("sonando/disparada"). New wording:
    //   {n} sonando  = alarms currently firing
    //   {n} vigilando = enabled + not firing + not muted
    const parts = [
      `${active} ${t("alarm.summary.firingShort")}`,
      `${ok} ${t("alarm.summary.watchingShort")}`,
    ];
    if (muted > 0) parts.push(`${muted} ${t("alarm.summary.mutedShort")}`);
    if (off > 0)   parts.push(`${off} ${t("alarm.summary.offShort")}`);
    const sumTxt = parts.join(" · ");
    const sumLvl = active > 0 ? "fail" : (muted > 0 ? "warn" : "good");
    _updateSetupSummary("alarms", sumTxt, sumLvl);
    el.textContent = "";
    for (const r of _al.rules) {
      const row = document.createElement("div");
      row.className = "ac-row";
      // Toggle
      const toggle = document.createElement("label");
      toggle.className = "ac-toggle";
      toggle.setAttribute("aria-label", r.label);
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!r.enabled;
      cb.addEventListener("change", () => {
        fetch(`/plugins/${PLUGIN_ID}/alarms/enable/${r.id}?on=${cb.checked ? 1 : 0}`, { method: "POST" })
          .then(() => _alFetch())
          .catch(() => {});
      });
      toggle.appendChild(cb);
      // Body (label + description)
      const body = document.createElement("div");
      body.className = "ac-body";
      const lab = document.createElement("div");
      lab.className = "ac-label";
      lab.textContent = r.label;
      const desc = document.createElement("div");
      desc.className = "ac-desc";
      desc.textContent = r.description;
      body.appendChild(lab); body.appendChild(desc);
      // Status pill
      const status = document.createElement("span");
      status.className = "ac-status ";
      const nowMs = Date.now();
      const muted = r.mutedUntilMs && r.mutedUntilMs > nowMs;
      if (!r.enabled) { status.classList.add("off"); status.textContent = t("alarm.off"); }
      else if (muted) { status.classList.add("muted"); status.textContent = `${t("alarm.muted")} ${Math.ceil((r.mutedUntilMs - nowMs) / 60000)}m`; }
      else if (r.active) { status.classList.add("active"); status.textContent = t("alarm.active"); }
      else { status.classList.add("idle"); status.textContent = t("alarm.idle"); }
      // Mute button
      const muteBtn = document.createElement("button");
      muteBtn.className = "ac-mute-btn";
      muteBtn.type = "button";
      muteBtn.textContent = muted ? t("alarm.unmute") : t("alarm.mute15");
      muteBtn.addEventListener("click", () => {
        const url = muted
          ? `/plugins/${PLUGIN_ID}/alarms/mute/${r.id}?min=0.01`   // ~0.6s = clear mute
          : `/plugins/${PLUGIN_ID}/alarms/mute/${r.id}?min=15`;
        fetch(url, { method: "POST" }).then(() => _alFetch()).catch(() => {});
      });
      row.appendChild(toggle);
      row.appendChild(body);
      row.appendChild(status);
      row.appendChild(muteBtn);
      el.appendChild(row);
    }
  }
  function _alEnsureAudioCtx() {
    if (_al.audioCtx) return _al.audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _al.audioCtx = new AC();
    } catch { return null; }
    return _al.audioCtx;
  }
  function _alBeep(freq, durationMs, gain) {
    const ctx = _alEnsureAudioCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g).connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      osc.start(now);
      osc.stop(now + durationMs / 1000 + 0.05);
    } catch { /* silent */ }
  }
  function _alSpeak(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0; u.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* silent */ }
  }
  function _alMaybePlaySound() {
    const active = (_al.state.active || []).filter((a) => !a.ackedAtMs);
    if (active.length === 0) return;
    // Any brand-new (never sounded) alarm plays immediately. Otherwise
    // replay the current worst-severity one every AL_REPLAY_SEC seconds.
    const highest = active.reduce((acc, a) => (
      !acc || (a.severity === "alarm" && acc.severity !== "alarm") ? a : acc
    ), null);
    const nowMs = Date.now();
    const newIds = active.filter((a) => !_al.seenActiveIds.has(a.ruleId));
    if (newIds.length > 0) {
      for (const a of newIds) _al.seenActiveIds.add(a.ruleId);
      _alPlayForSeverity(highest);
      _al.lastReplayTs = nowMs;
      return;
    }
    if (nowMs - _al.lastReplayTs > AL_REPLAY_SEC * 1000) {
      _alPlayForSeverity(highest);
      _al.lastReplayTs = nowMs;
    }
  }
  function _alPlayForSeverity(a) {
    if (!a) return;
    // Rev135: speak the translated message so DE/ES/FR users hear it
    // in their language, not the raw English backend string.
    const spoken = _alTranslate(a).message;
    if (a.severity === "alarm") {
      // Triple high-pitch beep + spoken message.
      _alBeep(1200, 180, 0.35);
      setTimeout(() => _alBeep(1200, 180, 0.35), 250);
      setTimeout(() => _alBeep(1200, 180, 0.35), 500);
      setTimeout(() => _alSpeak(spoken), 850);
    } else {
      _alBeep(800, 250, 0.25);
      setTimeout(() => _alSpeak(spoken), 350);
    }
  }
  function alarmsStart() {
    if (_al.timer) return;
    _alFetch();
    _al.timer = setInterval(_alFetch, 2000);
  }

  // ============================================================
  // Rev97: Sensor Quality panel (Setup tab)
  // ============================================================
  // Polled from /plugins/.../quality every 3 s while the Setup tab is
  // visible. Backend does the heavy lifting - the frontend just renders
  // the rows with a colored pill per status.

  const _sq = { timer: null, lastData: null };
  // Rev135 (Carlos): per-path ignore list. A sensor the user has
  // marked as "not on this boat" keeps its row visible (with an
  // IGNORED pill and a Restore button) but stops contributing to the
  // Setup chip's red count.
  const SQ_IGNORED_KEY = "pypilot-newui.sqIgnored";
  const _sqIgnored = new Set(
    (() => { try { return JSON.parse(localStorage.getItem(SQ_IGNORED_KEY) || "[]"); } catch { return []; } })()
  );

  function _sqFormatValue(v) {
    if (v == null) return "--";
    if (typeof v === "number") return v.toFixed(3);
    if (typeof v === "object") {
      // navigation.attitude and navigation.position arrive as objects.
      const keys = Object.keys(v).slice(0, 3);
      return keys.map((k) => `${k}:${typeof v[k] === "number" ? v[k].toFixed(2) : v[k]}`).join(" ");
    }
    return String(v);
  }
  function _sqFormatAge(ms) {
    if (ms == null) return "--";
    if (ms < 1000) return `${ms | 0} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${(ms / 60000).toFixed(1)} m`;
  }
  function _sqFormatHz(hz) {
    if (hz == null) return "--";
    if (hz < 0.1) return hz.toFixed(3) + " Hz";
    if (hz < 10) return hz.toFixed(2) + " Hz";
    return hz.toFixed(1) + " Hz";
  }
  function _sqFormatJitter(ms) {
    if (ms == null) return "--";
    return `${ms | 0} ms`;
  }
  async function sqFetchAndRender() {
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/quality`);
      if (!res.ok) return;
      const data = await res.json();
      _sq.lastData = data;
      sqRender();
    } catch { /* silent - a failed poll is not worth spamming console */ }
  }
  function sqRender() {
    const tbody = document.querySelector("#sq-table tbody");
    if (!tbody || !_sq.lastData) return;
    const rows = _sq.lastData.items || [];
    // Rev135 (Carlos): sensors the user has explicitly acknowledged
    // as "not on this boat" (rudder sensor missing on a wheel-steer
    // setup, temp sensor absent, ...) count as OK in the chip and
    // stop turning it red. Persisted in localStorage; clearable per
    // row from the table (a "Restore" button on the ignored one).
    let g = 0, w = 0, l = 0, m = 0;
    for (const r of rows) {
      if (_sqIgnored.has(r.path)) { g += 1; continue; }
      if (r.level === "good") g += 1;
      else if (r.level === "degraded") w += 1;
      else if (r.level === "lost") l += 1;
      else if (r.level === "missing") m += 1;
    }
    const fail = l + m;
    const sumLvl = fail > 0 ? "fail" : w > 0 ? "warn" : "good";
    _updateSetupSummary("quality", `${g}✓ ${w}! ${fail}✕`, sumLvl);
    tbody.textContent = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      const ignored = _sqIgnored.has(r.path);
      const displayLevel = ignored ? "ignored" : (r.level || "");
      const cells = [
        r.label || r.path,
        _sqFormatValue(r.lastValue),
        _sqFormatAge(r.ageMs),
        _sqFormatHz(r.hz),
        _sqFormatJitter(r.jitterMs),
        r.source || "--",
        `<span class="sq-status ${displayLevel}">${displayLevel.toUpperCase()}</span>`,
      ];
      for (let i = 0; i < cells.length; i += 1) {
        const td = document.createElement("td");
        if (i === 6) td.innerHTML = cells[i];
        else td.textContent = cells[i];
        if (i === 1) td.className = "sq-value";
        tr.appendChild(td);
      }
      // Ignore/Restore action cell. Only meaningful for sensors that
      // are actually degraded/lost/missing - a healthy sensor doesn't
      // need to be silenced.
      const actionTd = document.createElement("td");
      actionTd.className = "sq-action";
      const canIgnore = (r.level === "missing" || r.level === "lost" || r.level === "degraded");
      if (ignored || canIgnore) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sq-ignore-btn";
        btn.textContent = ignored
          ? (t("sq.action.restore") || "Restore")
          : (t("sq.action.ignore") || "Ignore");
        btn.addEventListener("click", () => {
          if (_sqIgnored.has(r.path)) _sqIgnored.delete(r.path);
          else _sqIgnored.add(r.path);
          try { localStorage.setItem(SQ_IGNORED_KEY, JSON.stringify([..._sqIgnored])); } catch { /* silent */ }
          sqRender();
        });
        actionTd.appendChild(btn);
      }
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    }
  }
  function sqOnTabEnter() {
    sqFetchAndRender();
    if (_sq.timer) clearInterval(_sq.timer);
    _sq.timer = setInterval(sqFetchAndRender, 3000);
  }
  function sqOnTabLeave() {
    if (_sq.timer) { clearInterval(_sq.timer); _sq.timer = null; }
  }

  // ============================================================
  // Rev96: Chart tab (Trip Stats cards + telemetry canvas)
  // ============================================================
  // Trip Stats read live from the SK bus (steering.autopilot.pypilot.
  // stats.*) via the existing wildcard subscription. Canvas pulls
  // history slices from /plugins/.../history on window change / refresh
  // / tab entry - no continuous polling so Pi 4 hosts stay unloaded.

  const _statsCache = {
    startedTs: null, engagedSec: 0, distanceNm: 0, tacks: 0, gybes: 0,
    servoRuntimeSec: 0, energyAh: 0, maxServoA: 0,
    meanErrorRad: null, rmsErrorRad: null, p95ErrorRad: null, servoDutyPct: 0,
  };

  function _fmtDurSec(s) {
    if (typeof s !== "number" || !isFinite(s) || s < 0) return "--";
    const total = Math.floor(s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(ss).padStart(2, "0")}s`;
    return `${ss}s`;
  }
  function _fmtDegFromRad(r) {
    if (typeof r !== "number" || !isFinite(r)) return "--";
    return `${(r * RAD2DEG).toFixed(1)}°`;
  }
  function _setStatText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function _renderStatSessionLine() {
    const el = document.getElementById("chart-session-line");
    if (!el) return;
    if (!_statsCache.startedTs) { el.textContent = t("chart.session.empty"); return; }
    const ago = Math.max(0, Date.now() - _statsCache.startedTs);
    const startedDate = new Date(_statsCache.startedTs);
    const hh = String(startedDate.getHours()).padStart(2, "0");
    const mm = String(startedDate.getMinutes()).padStart(2, "0");
    el.textContent = `${t("chart.session.started")} ${hh}:${mm} (${_fmtDurSec(ago / 1000)} ${t("chart.session.ago")})`;
  }
  function _renderStatTacksGybes() {
    _setStatText("stat-tacksGybes", `${_statsCache.tacks} / ${_statsCache.gybes}`);
  }
  function _renderStatCard(key) {
    switch (key) {
      case "engagedSec":      _setStatText("stat-engaged",      _fmtDurSec(_statsCache.engagedSec)); break;
      case "distanceNm":      _setStatText("stat-distance",     `${_statsCache.distanceNm.toFixed(2)} nm`); break;
      case "energyAh":        _setStatText("stat-energy",       `${_statsCache.energyAh.toFixed(3)} Ah`); break;
      case "meanErrorRad":    _setStatText("stat-meanErr",      _fmtDegFromRad(_statsCache.meanErrorRad)); break;
      case "rmsErrorRad":     _setStatText("stat-rmsErr",       _fmtDegFromRad(_statsCache.rmsErrorRad)); break;
      case "p95ErrorRad":     _setStatText("stat-p95Err",       _fmtDegFromRad(_statsCache.p95ErrorRad)); break;
      case "servoRuntimeSec": _setStatText("stat-servoRuntime", _fmtDurSec(_statsCache.servoRuntimeSec)); break;
      case "maxServoA":       _setStatText("stat-maxServoA",    `${_statsCache.maxServoA.toFixed(1)} A`); break;
      case "tacks":
      case "gybes":           _renderStatTacksGybes(); break;
      case "startedTs":       _renderStatSessionLine(); break;
    }
  }
  // Rev99: Servo Health card. Fed from steering.autopilot.pypilot.
  // servo.health.* SK paths via the existing wildcard subscription.
  const _shCache = {
    status: null, baselineA: null, recentAvgA: null, deviationRatio: null,
    peakA: null, learnedFrac: null, tempC: null, voltageV: null,
  };
  function _fmtA(v)  { return typeof v === "number" && isFinite(v) ? `${v.toFixed(2)} A` : "--"; }
  function _fmtC(v)  { return typeof v === "number" && isFinite(v) ? `${v.toFixed(0)} °C` : "--"; }
  function _fmtV(v)  { return typeof v === "number" && isFinite(v) ? `${v.toFixed(1)} V` : "--"; }
  function _fmtDev(v) {
    if (typeof v !== "number" || !isFinite(v)) return "--";
    return `${v.toFixed(2)}×`;
  }
  function _renderServoHealth() {
    const el = document.getElementById("sh-status");
    const status = _shCache.status || "--";
    if (el) {
      el.textContent = status.toUpperCase();
      el.className = "sh-status " + (["good","learning","elevated","high","idle"].includes(status) ? status : "");
    }
    _setStatText("sh-baseline",  _fmtA(_shCache.baselineA));
    _setStatText("sh-recent",    _fmtA(_shCache.recentAvgA));
    _setStatText("sh-deviation", _fmtDev(_shCache.deviationRatio));
    _setStatText("sh-peak",      _fmtA(_shCache.peakA));
    _setStatText("sh-temp",      _fmtC(_shCache.tempC));
    _setStatText("sh-voltage",   _fmtV(_shCache.voltageV));
    // Learning progress bar: visible only while status == "learning".
    const wrap = document.getElementById("sh-progress-wrap");
    const fill = document.getElementById("sh-progress-fill");
    if (wrap && fill) {
      if (status === "learning" && typeof _shCache.learnedFrac === "number") {
        wrap.hidden = false;
        fill.style.width = `${Math.min(100, Math.max(0, _shCache.learnedFrac * 100)).toFixed(1)}%`;
      } else {
        wrap.hidden = true;
      }
    }
  }
  // Map SH path suffix -> cache key.
  const _SH_PATH_MAP = {
    "steering.autopilot.pypilot.servo.health.status":         "status",
    "steering.autopilot.pypilot.servo.health.baselineA":      "baselineA",
    "steering.autopilot.pypilot.servo.health.recentAvgA":     "recentAvgA",
    "steering.autopilot.pypilot.servo.health.deviationRatio": "deviationRatio",
    "steering.autopilot.pypilot.servo.health.peakA":          "peakA",
    "steering.autopilot.pypilot.servo.health.learnedFrac":    "learnedFrac",
    // Reuse the raw pypilot voltage / temp paths for the last two cells
    // - they are already published under steering.autopilot.pypilot.*
    // and cover the whole "battery + temperature" story.
    "steering.autopilot.pypilot.servo.voltage":               "voltageV",
    "steering.autopilot.pypilot.servo.controller_temp":       "tempC",
  };
  function _applyServoHealthPath(path, value) {
    const key = _SH_PATH_MAP[path];
    if (!key) return false;
    _shCache[key] = value;
    _renderServoHealth();
    return true;
  }

  // Map SK path suffix -> _statsCache key. Called from applyValue on any
  // steering.autopilot.pypilot.stats.* delta.
  const _STATS_PATH_MAP = {
    "steering.autopilot.pypilot.stats.session.startedTs":        "startedTs",
    "steering.autopilot.pypilot.stats.session.engagedSec":       "engagedSec",
    "steering.autopilot.pypilot.stats.session.distanceNm":       "distanceNm",
    "steering.autopilot.pypilot.stats.session.tacks":            "tacks",
    "steering.autopilot.pypilot.stats.session.gybes":            "gybes",
    "steering.autopilot.pypilot.stats.session.servoRuntimeSec":  "servoRuntimeSec",
    "steering.autopilot.pypilot.stats.session.energyAh":         "energyAh",
    "steering.autopilot.pypilot.stats.session.maxServoA":        "maxServoA",
    "steering.autopilot.pypilot.stats.error.meanRad":            "meanErrorRad",
    "steering.autopilot.pypilot.stats.error.rmsRad":             "rmsErrorRad",
    "steering.autopilot.pypilot.stats.error.p95Rad":             "p95ErrorRad",
    "steering.autopilot.pypilot.stats.servo.dutyPct":            "servoDutyPct",
  };
  function _applyStatsPath(path, value) {
    const key = _STATS_PATH_MAP[path];
    if (!key) return false;
    _statsCache[key] = value;
    _renderStatCard(key);
    return true;
  }

  // Chart canvas: pulls /history slices on demand and paints stacked
  // per-path bands. Each enabled path gets its own vertical band with
  // its own local min/max so paths of very different ranges (rad vs A
  // vs m/s) stay legible without mixing scales.
  const CHART_COLORS = {
    headingCmd:    "#4dd4ff",   // cyan
    headingActual: "#2ecc71",   // green
    rudder:        "#ffd54a",   // amber
    servoCurrent:  "#ff6a3d",   // red-orange
    awa:           "#e574d5",   // magenta
    tws:           "#5ce8c0",   // teal
    heel:          "#b58cff",   // purple
    sog:           "#ff8c1a",   // orange
  };
  const CHART_LABELS = {
    headingCmd:    "HDG cmd",
    headingActual: "HDG act",
    rudder:        "Rudder",
    servoCurrent:  "Servo A",
    awa:           "AWA",
    tws:           "TWS",
    heel:          "Heel",
    sog:           "SOG",
  };
  // A short formatter per path for the value label at the end of each
  // trace. Rad-valued angles go to degrees; speeds go to knots.
  function _fmtSampleValue(key, v) {
    if (v == null || typeof v !== "number") return "--";
    if (key === "headingCmd" || key === "headingActual" || key === "awa" || key === "heel" || key === "rudder") {
      return `${(v * RAD2DEG).toFixed(1)}°`;
    }
    if (key === "tws" || key === "sog") {
      return `${(v * 1.94384).toFixed(1)} kn`;
    }
    if (key === "servoCurrent") return `${v.toFixed(2)} A`;
    return v.toFixed(2);
  }

  const CHART_WINDOWS = { "30s": 30000, "2m": 120000, "10m": 600000 };
  const _chart = {
    window: "30s",
    enabled: new Set(["headingCmd", "headingActual", "awa"]),
    lastSamples: [],
    lastFetchTs: 0,
    autoTimer: null,
    canvas: null,
  };

  async function chartFetchAndDraw() {
    if (!_chart.canvas) _chart.canvas = document.getElementById("chart-canvas");
    if (!_chart.canvas) return;
    // Rev129 (Carlos): freeze auto-refresh while the user is hovering
    // a point. They are inspecting a specific instant and a redraw
    // would move the tooltip out from under the cursor.
    if (_chart.hoverActive) return;
    const wnd = _chart.window;
    const enabledArr = [..._chart.enabled];
    const pathsQ = enabledArr.length > 0 ? `&paths=${enabledArr.join(",")}` : "";
    try {
      const res = await fetch(`/plugins/${PLUGIN_ID}/history?window=${wnd}${pathsQ}`);
      if (!res.ok) return;
      const json = await res.json();
      _chart.lastSamples = json.samples || [];
      _chart.lastFetchTs = Date.now();
      const footer = document.getElementById("chart-footer-count");
      if (footer) footer.textContent = `${_chart.lastSamples.length} samples (window ${wnd})`;
      chartDraw();
    } catch { /* silent - a failed poll should not spam the console */ }
  }

  function chartDraw() {
    const canvas = _chart.canvas || document.getElementById("chart-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Match backing store to CSS size for crisp lines on Retina / phones.
    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 360;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clear.
    ctx.fillStyle = "#0e141b";
    ctx.fillRect(0, 0, cssW, cssH);
    // Enabled paths with at least one non-null value in the window.
    const enabled = [..._chart.enabled].filter((k) => {
      return _chart.lastSamples.some((s) => typeof s[k] === "number" && isFinite(s[k]));
    });
    const hint = document.getElementById("chart-empty-hint");
    if (enabled.length === 0 || _chart.lastSamples.length === 0) {
      if (hint) { hint.textContent = t("chart.empty"); hint.hidden = false; }
      return;
    }
    if (hint) hint.hidden = true;

    const nowTs = _chart.lastFetchTs || Date.now();
    const windowMs = CHART_WINDOWS[_chart.window] || 30000;
    const tMin = nowTs - windowMs;
    const tMax = nowTs;
    const marginL = 8, marginR = 60, marginT = 4, marginB = 20;
    const plotW = cssW - marginL - marginR;
    const plotH = cssH - marginT - marginB;
    const bandH = plotH / enabled.length;

    // X-axis time ticks at 0%, 50%, 100% of window.
    ctx.strokeStyle = "#2b3542";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#8b98a5";
    ctx.font = "10px ui-monospace, monospace";
    const timeLabels = [
      { frac: 0.0, txt: `-${_chart.window}` },
      { frac: 0.5, txt: `-${_halfLabel(_chart.window)}` },
      { frac: 1.0, txt: "NOW" },
    ];
    for (const tk of timeLabels) {
      const x = marginL + tk.frac * plotW;
      ctx.beginPath();
      ctx.moveTo(x, marginT);
      ctx.lineTo(x, marginT + plotH);
      ctx.stroke();
      ctx.textAlign = tk.frac === 0 ? "left" : tk.frac === 1 ? "right" : "center";
      ctx.fillText(tk.txt, x, cssH - 6);
    }

    // Per-band trace + Y scale ticks (Rev129).
    // Snapshot the band geometry so the hover handler can hit-test
    // without re-computing.
    _chart.bands = [];
    for (let bi = 0; bi < enabled.length; bi += 1) {
      const key = enabled[bi];
      const bandTop = marginT + bi * bandH;
      const bandBot = bandTop + bandH - 2;
      let vmin = Infinity, vmax = -Infinity;
      for (const s of _chart.lastSamples) {
        const v = s[key];
        if (typeof v === "number" && isFinite(v)) {
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
      }
      if (vmin === Infinity) continue;
      if (vmax - vmin < 1e-9) { vmin -= 0.5; vmax += 0.5; }
      _chart.bands.push({ key, bandTop, bandBot, vmin, vmax });
      // Band separator line.
      if (bi > 0) {
        ctx.strokeStyle = "#1c2632";
        ctx.beginPath();
        ctx.moveTo(marginL, bandTop);
        ctx.lineTo(marginL + plotW, bandTop);
        ctx.stroke();
      }
      // Trace.
      ctx.strokeStyle = CHART_COLORS[key] || "#e6edf3";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (const s of _chart.lastSamples) {
        const v = s[key];
        if (typeof v !== "number" || !isFinite(v)) { started = false; continue; }
        const x = marginL + ((s.ts - tMin) / (tMax - tMin)) * plotW;
        const y = bandBot - ((v - vmin) / (vmax - vmin)) * (bandBot - bandTop);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Rev129 (Carlos): Y-scale ticks (min / mid / max) inside the
      // right-side gutter so the user reads absolute values, not
      // just a shape.
      ctx.fillStyle = "#8b98a5";
      ctx.textAlign = "left";
      ctx.font = "9px ui-monospace, monospace";
      const mid = (vmin + vmax) / 2;
      ctx.textBaseline = "top";
      ctx.fillText(_fmtSampleValue(key, vmax), marginL + plotW + 4, bandTop + 22);
      ctx.textBaseline = "middle";
      ctx.fillText(_fmtSampleValue(key, mid), marginL + plotW + 4, (bandTop + bandBot) / 2 + 2);
      ctx.textBaseline = "bottom";
      ctx.fillText(_fmtSampleValue(key, vmin), marginL + plotW + 4, bandBot - 2);
      // Label on the right side: name + last value.
      const last = [..._chart.lastSamples].reverse().find((s) => typeof s[key] === "number" && isFinite(s[key]));
      const lastV = last ? last[key] : null;
      ctx.fillStyle = CHART_COLORS[key] || "#e6edf3";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(CHART_LABELS[key], marginL + plotW + 4, bandTop + 8);
    }
    // Cache geometry for hover.
    _chart.geom = { marginL, marginR, marginT, marginB, plotW, plotH, tMin, tMax, cssW, cssH };

    // Rev129: if hover is active, draw crosshair + tooltip on top.
    if (_chart.hoverActive && _chart.hoverTs != null) {
      _chartDrawHover(ctx, cssW, cssH);
    }
  }

  // Rev129 (Carlos): hover crosshair + tooltip. Snaps the vertical
  // line to the closest sample timestamp so the user reads exact
  // recorded values, not interpolated ones.
  function _chartDrawHover(ctx, cssW, cssH) {
    const g = _chart.geom;
    if (!g || _chart.hoverTs == null) return;
    // Find nearest sample to _chart.hoverTs.
    let nearestIdx = -1;
    let nearestDt = Infinity;
    for (let i = 0; i < _chart.lastSamples.length; i += 1) {
      const dt = Math.abs(_chart.lastSamples[i].ts - _chart.hoverTs);
      if (dt < nearestDt) { nearestDt = dt; nearestIdx = i; }
    }
    if (nearestIdx < 0) return;
    const sample = _chart.lastSamples[nearestIdx];
    const x = g.marginL + ((sample.ts - g.tMin) / (g.tMax - g.tMin)) * g.plotW;
    // Vertical crosshair.
    ctx.strokeStyle = "#4dd4ff";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, g.marginT);
    ctx.lineTo(x, g.marginT + g.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    // Tooltip box.
    const lines = [];
    const ageS = Math.max(0, (Date.now() - sample.ts) / 1000);
    lines.push(`-${ageS.toFixed(1)} s`);
    for (const b of (_chart.bands || [])) {
      const v = sample[b.key];
      if (typeof v === "number" && isFinite(v)) {
        lines.push(`${CHART_LABELS[b.key] || b.key}: ${_fmtSampleValue(b.key, v)}`);
      }
    }
    ctx.font = "11px ui-monospace, monospace";
    let w = 0;
    for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
    const boxW = w + 12;
    const boxH = lines.length * 14 + 8;
    let boxX = x + 8;
    if (boxX + boxW > cssW - 4) boxX = x - boxW - 8;
    const boxY = g.marginT + 4;
    ctx.fillStyle = "rgba(11,15,20,0.92)";
    ctx.strokeStyle = "#4dd4ff";
    ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let ly = boxY + 4;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillStyle = i === 0 ? "#8b98a5" : "#e6edf3";
      ctx.fillText(lines[i], boxX + 6, ly);
      ly += 14;
    }
  }
  function _halfLabel(w) {
    if (w === "30s") return "15s";
    if (w === "2m") return "1m";
    if (w === "10m") return "5m";
    return "";
  }

  async function chartResetSession() {
    if (!confirm(t("chart.session.confirm"))) return;
    try {
      await fetch(`/plugins/${PLUGIN_ID}/session/reset`, { method: "POST" });
      // Optimistic zero-out so UI reflects the reset even before the
      // next SK delta cycle lands.
      Object.assign(_statsCache, {
        engagedSec: 0, distanceNm: 0, tacks: 0, gybes: 0,
        servoRuntimeSec: 0, energyAh: 0, maxServoA: 0,
      });
      Object.keys(_STATS_PATH_MAP).forEach((p) => {
        const k = _STATS_PATH_MAP[p];
        _renderStatCard(k);
      });
    } catch { /* silent */ }
  }

  function wireChart() {
    // Window buttons (30s / 2m / 10m).
    document.querySelectorAll(".chart-window-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".chart-window-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        _chart.window = btn.dataset.window || "30s";
        chartFetchAndDraw();
      });
    });
    // Path chips.
    document.querySelectorAll(".chart-path-chip input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.path;
        if (!key) return;
        if (cb.checked) _chart.enabled.add(key);
        else _chart.enabled.delete(key);
        chartFetchAndDraw();
      });
    });
    // Refresh + reset buttons.
    const rb = document.getElementById("chart-refresh-btn");
    if (rb) rb.addEventListener("click", chartFetchAndDraw);
    const rs = document.getElementById("chart-reset-btn");
    if (rs) rs.addEventListener("click", chartResetSession);
    // Re-draw on window resize so the canvas hi-res backing store
    // rescales without stretching (throttle to 250 ms).
    let _resizeTimer = null;
    window.addEventListener("resize", () => {
      if (_resizeTimer) clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => chartDraw(), 250);
    });
    // Rev129 (Carlos): hover / touch on the canvas snaps a vertical
    // crosshair to the closest sample and shows all values in a
    // tooltip. Auto-refresh freezes while hovering so the user can
    // read the exact value.
    const canvas = document.getElementById("chart-canvas");
    if (canvas) {
      const _hover = (clientX) => {
        if (!_chart.geom || _chart.lastSamples.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const relX = clientX - rect.left;
        const cssW = canvas.clientWidth || rect.width;
        const g = _chart.geom;
        // Map pixel X to timestamp inside the plot area.
        const scale = cssW / (g.cssW || cssW);
        const x = relX / scale;   // in canvas CSS pixels
        if (x < g.marginL || x > g.marginL + g.plotW) return;
        const frac = (x - g.marginL) / g.plotW;
        _chart.hoverTs = g.tMin + frac * (g.tMax - g.tMin);
        _chart.hoverActive = true;
        chartDraw();
      };
      canvas.addEventListener("mousemove", (ev) => _hover(ev.clientX));
      canvas.addEventListener("mouseleave", () => {
        _chart.hoverActive = false;
        _chart.hoverTs = null;
        chartDraw();
      });
      canvas.addEventListener("touchstart", (ev) => {
        const t = ev.touches && ev.touches[0];
        if (t) _hover(t.clientX);
      }, { passive: true });
      canvas.addEventListener("touchmove", (ev) => {
        const t = ev.touches && ev.touches[0];
        if (t) _hover(t.clientX);
      }, { passive: true });
      canvas.addEventListener("touchend", () => {
        // Keep the freeze visible for 3 s after touch ends so the
        // user can read it, then release.
        setTimeout(() => {
          _chart.hoverActive = false;
          _chart.hoverTs = null;
          chartDraw();
        }, 3000);
      }, { passive: true });
    }
  }

  // Called from _tabPostActivate when the user enters/leaves the Chart
  // tab. On entry we do a fresh fetch + start a 2 s auto-refresh timer;
  // on leave we clear the timer so background traffic stays quiet.
  function chartOnTabEnter() {
    chartFetchAndDraw();
    if (_chart.autoTimer) clearInterval(_chart.autoTimer);
    _chart.autoTimer = setInterval(chartFetchAndDraw, 2000);
  }
  function chartOnTabLeave() {
    if (_chart.autoTimer) { clearInterval(_chart.autoTimer); _chart.autoTimer = null; }
  }

  // ============================================================
  // Rev105: Setup card reordering + collapsibles
  // ============================================================
  // Every .setup-block inside #tab-setup carries a data-setup-order
  // integer that decides its position AT BOOT time (JS re-appends in
  // sorted order). Blocks also become collapsibles: click the section
  // title to hide the body, state persists in localStorage per block.
  // Default collapse state: top-of-list navigation tools open, the
  // rest closed. Reduces the wall-of-config the user complained about.

  function reorderSetupBlocks() {
    const setup = document.getElementById("tab-setup");
    if (!setup) return;
    const blocks = Array.from(setup.querySelectorAll(":scope > .setup-block"));
    blocks.sort((a, b) => {
      const oa = Number(a.dataset.setupOrder || 999);
      const ob = Number(b.dataset.setupOrder || 999);
      return oa - ob;
    });
    for (const b of blocks) setup.appendChild(b);
  }

  // Rev108/109: Setup as a launcher grid. Every .setup-block is a tile;
  // tap opens fullscreen with a compact X in the header (Rev109: was a
  // floating 46×46 button that stole vertical space). ESC also closes.
  // Only one tile can be fullscreen at a time. While a tile is
  // fullscreen the body is scroll-locked so the launcher grid behind
  // does not rubber-band under the finger.
  // Rev110: PORTAL. .tab-panel carries a translateX() during tab
  // animation, which turns any descendant with position:fixed into a
  // position:absolute relative to the panel - so a "fullscreen" card
  // inherited the setup scroll offset and only covered part of the
  // viewport in landscape. Fix: move the card node to <body> when
  // opening fullscreen, and restore it to its original position when
  // closing. Now position:fixed anchors to the true viewport.
  function _setupFullscreenOn(block) {
    // Close any other fullscreen tile first (they may be siblings of
    // block in the grid, or already portaled onto body).
    document.querySelectorAll('.setup-block[data-fullscreen="1"]').forEach((b) => {
      if (b !== block) _setupFullscreenOff(b);
    });
    // Snapshot position for restore-on-close.
    block._portalOrigParent = block.parentNode;
    block._portalOrigNext = block.nextSibling;
    document.body.appendChild(block);
    block.dataset.fullscreen = "1";
    block.scrollTop = 0;
    document.body.classList.add("setup-fullscreen-active");
  }
  function _setupFullscreenOff(block) {
    if (!block) {
      document.querySelectorAll('.setup-block[data-fullscreen="1"]').forEach((b) => _setupFullscreenOff(b));
      return;
    }
    block.removeAttribute("data-fullscreen");
    // Portal back to the grid at the same position we took it from.
    if (block._portalOrigParent && block._portalOrigParent.isConnected) {
      if (block._portalOrigNext && block._portalOrigNext.isConnected && block._portalOrigNext.parentNode === block._portalOrigParent) {
        block._portalOrigParent.insertBefore(block, block._portalOrigNext);
      } else {
        block._portalOrigParent.appendChild(block);
      }
    }
    block._portalOrigParent = null;
    block._portalOrigNext = null;
    if (!document.querySelector('.setup-block[data-fullscreen="1"]')) {
      document.body.classList.remove("setup-fullscreen-active");
    }
  }
  function initSetupTiles() {
    const setup = document.getElementById("tab-setup");
    if (!setup) return;
    const blocks = setup.querySelectorAll(":scope > .setup-block");
    blocks.forEach((block) => {
      if (block.querySelector(":scope > .setup-block-fs-header")) return;   // dedupe
      // Live-summary pill for tile view.
      const sum = document.createElement("span");
      sum.className = "setup-block-summary";
      sum.dataset.blockKey = block.dataset.blockKey || "";
      // Header row that appears ONLY in fullscreen: [X] [Title]. In tile
      // mode CSS hides this and shows the existing .section-title /
      // .pc-header directly, so the tile layout stays clean.
      const fsHeader = document.createElement("div");
      fsHeader.className = "setup-block-fs-header";
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "setup-block-close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _setupFullscreenOff(block);
      });
      // Also mirror the title into the fs-header so both tile+fullscreen
      // read consistently. In fullscreen the ORIGINAL .section-title is
      // hidden (below in CSS via pc-header handling), and this mirror is
      // the visible one.
      const titleMirror = document.createElement("div");
      titleMirror.className = "section-title";
      const origTitle = block.querySelector(":scope > .section-title") || block.querySelector(":scope > .pc-header > .section-title");
      if (origTitle) titleMirror.textContent = origTitle.textContent;
      // If original title uses data-i18n, mirror that too so language
      // switches reach the fullscreen header.
      if (origTitle && origTitle.dataset.i18n) titleMirror.dataset.i18n = origTitle.dataset.i18n;
      fsHeader.appendChild(closeBtn);
      fsHeader.appendChild(titleMirror);
      // Insert fsHeader as the FIRST child so it renders at the top.
      block.insertBefore(fsHeader, block.firstChild);
      // Insert the summary right after the original header for tile view.
      const header = block.querySelector(":scope > .pc-header") || origTitle;
      if (header) {
        header.parentNode.insertBefore(sum, header.nextSibling);
      } else {
        block.appendChild(sum);
      }
      // Hide the fs-header when NOT fullscreen. Done in JS on top of CSS
      // to guarantee layout regardless of load order.
      fsHeader.style.display = "none";
      // Click on the tile opens fullscreen. Skip if the tile is already
      // fullscreen or the click came from a control.
      block.addEventListener("click", (ev) => {
        if (block.dataset.fullscreen === "1") return;
        const tgt = ev.target;
        if (tgt && tgt.closest && tgt.closest("button, input, select, textarea, label")) return;
        _setupFullscreenOn(block);
        fsHeader.style.display = "";
      });
      // Watch data-fullscreen attribute to sync fsHeader visibility.
      const mo = new MutationObserver(() => {
        fsHeader.style.display = block.dataset.fullscreen === "1" ? "" : "none";
        // When we close a fullscreen tile, also clear the body class if
        // no other tile is fullscreen.
        if (block.dataset.fullscreen !== "1") {
          if (!setup.querySelector('.setup-block[data-fullscreen="1"]')) {
            document.body.classList.remove("setup-fullscreen-active");
          }
        }
      });
      mo.observe(block, { attributes: true, attributeFilter: ["data-fullscreen"] });
    });
    // ESC closes any open fullscreen tile.
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      _setupFullscreenOff(null);
    });
    // Rev133 (Carlos): once the summary pills exist, paint the tiles
    // that carry static status (language, host, ssh, calibration
    // stamp) so the launcher grid is populated on first paint - not
    // only after /status resolves.
    if (typeof _refreshSetupBadges === "function") _refreshSetupBadges();
  }

  // Update the small summary text next to each section title (only shown
  // when the block is collapsed - CSS could hide when expanded but we
  // keep it visible for context). Called from poll cycles.
  function _updateSetupSummary(blockKey, text, level) {
    const el = document.querySelector(`.setup-block-summary[data-block-key="${blockKey}"]`);
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("good", "warn", "fail");
    if (level === "good") el.classList.add("good");
    else if (level === "warn") el.classList.add("warn");
    else if (level === "fail") el.classList.add("fail");
  }

  // Rev96: one-shot boot helper - physically relocate the #tab-paths
  // subtree into the #paths-mount slot inside Setup. Keeps IDs so the
  // existing renderPathsTable / paths-search wiring keeps working.
  function movePathsIntoSetup() {
    const mount = document.getElementById("paths-mount");
    const src = document.getElementById("tab-paths");
    if (!mount || !src) return;
    // Move each child (excluding the section wrapper itself).
    while (src.firstChild) mount.appendChild(src.firstChild);
    // The empty section still has display:none via .tab-panel and no
    // nav-btn activates it - safe to drop entirely.
    src.remove();
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", async () => {
    wireTabs();
    wireControl();
    wireTune();
    wireSetup();
    wireInfo();
    wireRegata();
    // Rev96: relocate paths block BEFORE wireChart / setup wiring so the
    // moved DOM is ready when the existing paths handlers touch it.
    movePathsIntoSetup();
    // Rev105/108: reorder Setup cards by data-setup-order AFTER paths
    // mount, then turn every block into a launcher tile that opens
    // fullscreen on click (Rev108 replaced the in-place collapsible).
    reorderSetupBlocks();
    initSetupTiles();
    wireChart();
    // Rev101: kick off the alarm poll (banner + config panel + audio).
    alarmsStart();
    // Rev102: wire the pre-departure check refresh button. Poll starts
    // when the user enters Setup (pcOnTabEnter).
    wirePrecheck();
    // Rev104: wire the Doctor start / cancel buttons. Poll starts when
    // the user enters Setup (doctorOnTabEnter).
    wireDoctor();
    // Rev118: wire the Calibration "Unlock sliders" checkbox.
    wireCalibUnlock();
    wireInfoBar();
    applyI18n();
    renderEngage();
    renderNudgeLabels();
    renderRudder(null);   // Rev66: pinta los labels ±70 aunque no haya rudder aun

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
    // Rev87: verify (or acquire) a permanent SK device token so the
    // AP mutations (engage / mode / target) do not silently 401 after
    // the SK server restarts.
    ensureAccessOnBoot().catch(() => {});
  });
})();

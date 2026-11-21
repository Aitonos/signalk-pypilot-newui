// Rev707: the machine pypilot runs on is not always a TinyPilot. On
// OpenPlotter / Raspberry Pi OS pypilot runs under systemd, often on the
// Signal K machine itself; the TinyPilot (piCore) uses runit.

/** pypilot's address is this Signal K machine: "localhost", a loopback
 *  address, or a name/IP that resolved to one of our own addresses
 *  (`resolvedIps` from withLocalAliases already carries the loopback then). */
export function isLocalPypilotHost(host: string, resolvedIps: string[]): boolean {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "::1" || /^127\./.test(h)) return true;
  return resolvedIps.includes("127.0.0.1");
}

/** SSH user to try when none is saved: TinyPilot ships with "tc"; on
 *  Raspberry Pi OS the usual user is "pi". */
export function defaultSshUser(local: boolean): string {
  return local ? "pi" : "tc";
}

// TinyPilot (runit). Kept as it was since Rev66: TERM, wait, start again,
// and pkill as a safety net for a python child that ignores TERM.
const RUNIT_ALL = [
  "sudo sv restart /etc/sv/pypilot /etc/sv/pypilot_web /etc/sv/pypilot_hat 2>&1 || true",
  "sleep 2",
  "sudo pkill -9 -f 'python.*pypilot --version' 2>&1 || true",
  "sleep 1",
  "sudo sv up /etc/sv/pypilot /etc/sv/pypilot_web /etc/sv/pypilot_hat 2>&1 || true",
].join(" ; ");
const RUNIT_WEB = "sudo sv restart /etc/sv/pypilot_web 2>&1 && echo OK";

/** Restart pypilot ("all") or only its web server ("web") on runit or
 *  systemd, whichever the machine has. Under systemd only the units that
 *  are running are restarted (pypilot and pypilot_boatimu are
 *  alternatives on OpenPlotter), and it exits non-zero when none is
 *  running or a restart fails, so the visor never reports a restart that
 *  did not happen. */
export function pypilotRestartCommand(which: "all" | "web"): string {
  const runit = which === "all" ? RUNIT_ALL : RUNIT_WEB;
  const units = which === "all" ? "pypilot pypilot_boatimu pypilot_web pypilot_hat" : "pypilot_web";
  const systemd =
    `n=0; for u in ${units}; do if systemctl is-active --quiet $u; then ` +
    `sudo systemctl restart $u 2>&1 || exit 1; echo "restarted $u"; n=$((n+1)); fi; done; ` +
    `[ $n -gt 0 ] || { echo "no pypilot service is running on this machine (${units})"; exit 3; }`;
  // The runit service folder is enough to tell a TinyPilot: `sv` may not be
  // on the PATH of a non-login SSH session, and sudo finds it anyway.
  return `if [ -d /etc/sv/pypilot ]; then ${runit}; ` +
    `elif command -v systemctl >/dev/null 2>&1; then ${systemd}; ` +
    `else echo "neither runit nor systemd found"; exit 3; fi`;
}

/** Rev732: the TinyPilot image of July 2026 (pypilot 0.71) has the Python
 *  packages pypilot's Signal K client needs on the SD card
 *  (tce/optional), but its boot script never loads them: it asks for
 *  "websocket-client" (the file is "websocket") and requests has no .dep
 *  for urllib3, idna, certifi and chardet. This loads them, adds them to
 *  onboot.lst so they load at every boot, checks that Python imports them
 *  and restarts pypilot. No internet needed. Each step stops with its own
 *  exit code and message, so the visor can tell what failed.
 *  Remove when the next TinyPilot image is out. */
export function tinypilot071FixCommand(): string {
  return [
    `PY=python$(cat /opt/python 2>/dev/null || echo 3.11)`,
    `TCE=$(readlink -f /etc/sysconfig/tcedir 2>/dev/null)`,
    `[ -n "$TCE" ] && [ -d "$TCE/optional" ] || { echo "This is not a TinyPilot (no tce folder)."; exit 3; }`,
    `PKGS="urllib3 idna certifi chardet requests websocket"`,
    `for p in $PKGS; do [ -f "$TCE/optional/$PY-$p.tcz" ] || { echo "Missing on the SD card: $PY-$p.tcz"; exit 4; }; done`,
    `for p in $PKGS; do tce-load -i $PY-$p >/dev/null 2>&1; done`,
    `$PY -c 'import requests, websocket' 2>&1 || { echo "Loaded, but Python cannot import requests and websocket."; exit 5; }`,
    `for p in $PKGS; do grep -qx "$PY-$p.tcz" "$TCE/onboot.lst" 2>/dev/null || echo "$PY-$p.tcz" >> "$TCE/onboot.lst" || { echo "Cannot write $TCE/onboot.lst"; exit 6; }; done`,
    `echo "Packages loaded and added to onboot.lst. Restarting pypilot."`,
    RUNIT_ALL,
    `echo OK`,
  ].join("\n");
}

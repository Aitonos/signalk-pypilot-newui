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

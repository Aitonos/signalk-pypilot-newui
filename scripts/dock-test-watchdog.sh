#!/bin/bash
# Dock test of the gain watchdog (Rev571, auto-Doctor phase 4).
#
# What it does, with the autopilot OFF:
#   1. asks the plugin to switch pypilot to a test profile under a lease;
#   2. freezes Signal K (SIGSTOP) as in the 2026-10-23 hang;
#   3. checks that the watchdog, outside Signal K, switches pypilot back
#      to the original profile (expected after ~15-20 s);
#   4. unfreezes Signal K (always, even if something fails).
#
# Run on the Pi:  bash ~/signalk-pypilot-newui/scripts/dock-test-watchdog.sh [testProfile]
# It asks for your Signal K user and password (normal login).

set -u
TEST_PROFILE="${1:-default}"
SK="http://localhost:3000"
PYPILOT_HOST=$(python3 -c 'import json;print(json.load(open("'"$HOME"'/.signalk/plugin-config-data/signalk-pypilot-newui.json"))["configuration"].get("host","localhost"))')
WD_DIR="$HOME/.signalk/plugin-config-data/signalk-pypilot-newui/gain-watchdog"

getprof() {
  timeout 6 python3 - "$PYPILOT_HOST" <<'PY'
import socket, json, time, sys
s = socket.create_connection((sys.argv[1], 23322), timeout=2)
s.sendall(b'watch={"profile":true}\n')
b = b""; t = time.time()
while time.time() - t < 4 and b"profile=" not in b:
    try: b += s.recv(4096)
    except socket.timeout: pass
print(json.loads([x for x in b.split(b"\n") if x.startswith(b"profile=")][0][8:]))
PY
}

AP=$(curl -s "$SK/signalk/v1/api/vessels/self/steering/autopilot/state/value")
if [ "$AP" != '"disabled"' ] && [ "$AP" != '"standby"' ]; then
  echo "The autopilot is $AP. Disengage it first."; exit 1
fi

read -r -p "Signal K user: " SKUSER
read -r -s -p "Signal K password: " SKPASS; echo
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"username":sys.argv[1],"password":sys.argv[2]}))' "$SKUSER" "$SKPASS")" \
  "$SK/signalk/v1/auth/login" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))')
[ -n "$TOKEN" ] || { echo "Login failed."; exit 1; }

NODEPID=$(pgrep -f "^node .*signalk-server/bin/signalk-server" | head -1)
[ -n "$NODEPID" ] || { echo "Signal K node process not found."; exit 1; }
trap 'sudo kill -CONT $NODEPID 2>/dev/null' EXIT

ORIG=$(getprof); echo "original profile: [$ORIG]"
echo "dock-test: $(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"testProfile\":\"$TEST_PROFILE\"}" "$SK/plugins/signalk-pypilot-newui/gain-guard/dock-test")"
sleep 4
echo "profile now: [$(getprof)]"
echo "watchdog: $(pgrep -af 'gain-watchdog.js' | grep -v pgrep || echo NONE)"

T0=$(date +%s)
sudo kill -STOP "$NODEPID"; echo "$(date +%T) Signal K frozen (pid $NODEPID)"
OK=0
for _ in $(seq 1 45); do
  sleep 1
  P=$(getprof)
  if [ "$P" = "$ORIG" ]; then echo "$(date +%T) restored after $(( $(date +%s) - T0 )) s: [$P]"; OK=1; break; fi
done
[ $OK = 1 ] || echo "NOT restored in 45 s (profile: [$P])"
sudo kill -CONT "$NODEPID"; echo "$(date +%T) Signal K running again"

sleep 5
echo "Signal K answers: HTTP $(curl -s -m 5 -o /dev/null -w '%{http_code}' "$SK/signalk")"
echo "--- watchdog.log"; tail -6 "$WD_DIR/watchdog.log"
echo "--- lease"; cat "$WD_DIR/lease.json"; echo
echo "final profile: [$(getprof)]"
[ $OK = 1 ] && echo "RESULT: PASS" || echo "RESULT: FAIL"

#!/bin/bash
# os-config-snapshot.sh - 2026-11-09 (Carlos: backup of the OS settings).
#
# Copies the operating system's CONFIGURATION (not a disk image) into
# ~/.signalk/os-config/, which signalk-backup already includes in every
# backup (local + Google Drive). Enough to rebuild the Pi from a clean
# OpenPlotter image: which packages, which serial-port rules, which cron
# jobs and services, boot settings, OpenPlotter's own settings.
#
# Never copied (secrets): Wi-Fi / NetworkManager connections, SSH keys,
# /etc/shadow, tokens. Run daily from pi's crontab; safe to run by hand.
set -u
OUT="$HOME/.signalk/os-config"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp_if() { [ -r "$1" ] && mkdir -p "$TMP/$(dirname "$2")" && cp -p "$1" "$TMP/$2"; }

# Boot and base system
cp_if /boot/firmware/config.txt  boot/config.txt
cp_if /boot/firmware/cmdline.txt boot/cmdline.txt
cp_if /etc/hostname  etc/hostname
cp_if /etc/hosts     etc/hosts
cp_if /etc/fstab     etc/fstab
cp_if /etc/timezone  etc/timezone

# Serial-port names (ttyOP_*), dongles, permissions
for f in /etc/udev/rules.d/*.rules; do cp_if "$f" "etc/udev/rules.d/$(basename "$f")"; done

# Scheduled jobs and the services added by hand (regular files only;
# the symlinks there are just the enabled state of packaged units)
for f in /etc/cron.d/*; do [ -f "$f" ] && cp_if "$f" "etc/cron.d/$(basename "$f")"; done
crontab -l > "$TMP/crontab-pi.txt" 2>/dev/null || true
for f in /etc/systemd/system/*.service; do [ -f "$f" ] && [ ! -L "$f" ] && cp_if "$f" "etc/systemd/system/$(basename "$f")"; done
systemctl list-unit-files --state=enabled --no-pager > "$TMP/systemd-enabled.txt" 2>/dev/null || true

# OpenPlotter settings
cp_if "$HOME/.openplotter/openplotter.conf" openplotter/openplotter.conf

# Software installed
dpkg --get-selections > "$TMP/packages-all.txt" 2>/dev/null || true
apt-mark showmanual   > "$TMP/packages-manual.txt" 2>/dev/null || true
command -v docker >/dev/null && docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$TMP/docker-containers.txt" 2>/dev/null || true
{ uname -a; cat /etc/os-release 2>/dev/null; } > "$TMP/system.txt"

cat > "$TMP/README.txt" <<EOF
OS configuration of $(hostname), taken $(date -Iseconds).
Made by ~/bin/os-config-snapshot.sh (pi's crontab, daily 03:15) and
included by signalk-backup in every backup.
Contents: boot/, etc/ (hostname, hosts, fstab, udev rules, cron.d,
hand-made systemd units), crontab-pi.txt, openplotter/, packages-*.txt
(reinstall with: sudo apt-get install \$(cat packages-manual.txt)),
docker-containers.txt, systemd-enabled.txt, system.txt.
NOT included on purpose: Wi-Fi / NetworkManager connections, SSH keys,
passwords, tokens.
EOF

# Swap in atomically so a backup never sees half a folder
rm -rf "$OUT.new" && cp -a "$TMP" "$OUT.new" && rm -rf "$OUT" && mv "$OUT.new" "$OUT"
chmod -R go-rwx "$OUT"

// Rev656 (forum 2026-11-07): the LAN scan covers every IPv4 interface, not
// only the first one (on AvNav the first is often its own Wi-Fi hotspot).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { localSubnets, MAX_SUBNETS } from "../scanner";

const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "", cidr: null }) as any;

describe("localSubnets (Rev656)", () => {
  it("every interface, deduplicated, container bridges and link-local skipped", () => {
    const got = localSubnets({
      lo: [v4("127.0.0.1", true)],
      wlan0: [v4("192.168.30.1")],          // AvNav hotspot, listed first
      eth0: [v4("192.168.1.20")],           // the boat network with the TinyPilot
      docker0: [v4("172.17.0.1")],
      tailscale0: [{ ...v4("100.64.0.7"), netmask: "255.255.255.255" }],
      eth1: [v4("169.254.10.2")],
      wlan1: [v4("192.168.1.21")],          // same /24 as eth0
    } as any);
    assert.deepEqual(got.map((x) => x.subnet), ["192.168.30.0/24", "192.168.1.0/24"]);
    assert.equal(got[1].iface, "eth0");
  });

  it("caps the number of subnets so a scan stays short", () => {
    const many: any = {};
    for (let i = 0; i < 10; i++) many[`eth${i}`] = [v4(`10.0.${i}.5`)];
    assert.equal(localSubnets(many).length, MAX_SUBNETS);
  });
});

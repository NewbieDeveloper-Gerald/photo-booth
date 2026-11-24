/** The shape of `os.networkInterfaces()` this module needs, so it can be tested without a NIC. */
export type NetworkInterfaces = Record<string, Array<{ address: string; family: string | number; internal: boolean } | undefined> | undefined>;

/** Adapter names that are almost never the Wi-Fi a tablet sits on. */
const VIRTUAL_ADAPTER = /(vEthernet|vethernet|docker|vbox|vmnet|virtual|hyper-v|tailscale|zerotier|loopback)/i;

/** Bigger is a better guess: a home or venue network is nearly always 192.168 or 10.x. */
function addressScore(address: string, name: string): number {
  if (address.startsWith('169.254.')) return -100; // no DHCP: link-local, not routable to a tablet
  let score = 0;
  if (address.startsWith('192.168.')) score += 3;
  else if (address.startsWith('10.')) score += 2;
  else if (address.startsWith('172.')) {
    const second = Number(address.split('.')[1]);
    score += second >= 16 && second <= 31 ? 1 : 0;
  }
  if (VIRTUAL_ADAPTER.test(name)) score -= 4;
  return score;
}

/**
 * The address to print on the tablet link (F22). A private IPv4 on a real interface is what a
 * tablet on the same Wi-Fi can reach; 127.0.0.1 and virtual adapters are useless for it, so
 * they are only a last resort.
 */
export function pickLanAddress(interfaces: NetworkInterfaces): string | null {
  let best: { address: string; score: number } | null = null;
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      const score = addressScore(entry.address, name);
      if (!best || score > best.score) best = { address: entry.address, score };
    }
  }
  return best?.address ?? null;
}

/** The URL the operator types on the tablet, token included so the page can authenticate. */
export function remoteGuestUrl(address: string, port: number, token: string): string {
  return `http://${address}:${port}/remote/${token}/`;
}

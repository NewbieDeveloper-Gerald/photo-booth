import { describe, expect, it } from 'vitest';
import { pickLanAddress, remoteGuestUrl } from './lan-address';

describe('the tablet link address (F22)', () => {
  it('prefers a private IPv4 address a tablet on the Wi-Fi can reach', () => {
    expect(pickLanAddress({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      'vEthernet (WSL)': [{ address: '172.30.4.1', family: 'IPv4', internal: false }],
      'Wi-Fi': [{ address: '192.168.1.24', family: 'IPv4', internal: false }],
    })).toBe('192.168.1.24');
  });

  it('skips loopback, link-local adapters and IPv6', () => {
    expect(pickLanAddress({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      'Wi-Fi': [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '169.254.10.2', family: 'IPv4', internal: false },
        { address: '10.0.0.7', family: 'IPv4', internal: false },
      ],
    })).toBe('10.0.0.7');
  });

  it('falls back to whatever is available, and reports nothing when there is nothing', () => {
    expect(pickLanAddress({ eth0: [{ address: '203.0.113.9', family: 'IPv4', internal: false }] })).toBe('203.0.113.9');
    expect(pickLanAddress({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] })).toBeNull();
    expect(pickLanAddress({})).toBeNull();
  });

  it('builds the URL the operator types on the tablet', () => {
    expect(remoteGuestUrl('192.168.1.24', 47_626, 'abcDEF1234567890_-xyZ')).toBe('http://192.168.1.24:47626/remote/abcDEF1234567890_-xyZ/');
  });
});

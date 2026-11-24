import { describe, expect, it } from 'vitest';
import {
  deviceGuidance, describeAdbFailure, launchArgs, listDevicesArgs, parseAdbDevices, parseReverseList,
  pickUsbDevice, removeReverseArgs, reverseArgs, reverseListArgs, usbGuestUrl,
} from './adb';

describe('android USB link commands (F22 extension)', () => {
  it('asks adb for its devices, the mapped ports and the screen', () => {
    expect(listDevicesArgs()).toEqual(['devices']);
    expect(reverseListArgs()).toEqual(['reverse', '--list']);
    expect(reverseArgs(47626)).toEqual(['reverse', 'tcp:47626', 'tcp:47626']);
    expect(removeReverseArgs()).toEqual(['reverse', '--remove', 'tcp:47626']);
    expect(launchArgs('http://127.0.0.1:47626/remote/token/')).toEqual([
      'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'http://127.0.0.1:47626/remote/token/',
    ]);
  });

  it('reads the device table, keeping the cable apart from wireless devices', () => {
    const stdout = [
      'List of devices attached',
      'R58M12345\tdevice',
      '0123456789ABCDEF\tunauthorized',
      '192.168.1.9:5555\tdevice',
      '',
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
    ].join('\r\n');
    expect(parseAdbDevices(stdout)).toEqual([
      { serial: 'R58M12345', state: 'device', usb: true },
      { serial: '0123456789ABCDEF', state: 'unauthorized', usb: true },
      { serial: '192.168.1.9:5555', state: 'device', usb: false },
    ]);
    expect(parseAdbDevices('')).toEqual([]);
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([]);
  });

  it('only ever picks a trusted cable device', () => {
    expect(pickUsbDevice([{ serial: 'wifi:5555', state: 'device', usb: false }])).toBeNull();
    expect(pickUsbDevice([{ serial: 'R58M', state: 'unauthorized', usb: true }])).toBeNull();
    expect(pickUsbDevice([{ serial: 'R58M', state: 'offline', usb: true }, { serial: 'ABC', state: 'device', usb: true }]))
      .toEqual({ serial: 'ABC', state: 'device', usb: true });
  });

  it('reads mapped ports out of "adb reverse --list"', () => {
    expect(parseReverseList('host-31 tcp:47626 tcp:47626\n')).toEqual([47626]);
    expect(parseReverseList('host-31 tcp:47625 tcp:47625\nhost-32 tcp:47626 tcp:47626')).toEqual([47625, 47626]);
    expect(parseReverseList('')).toEqual([]);
  });

  it('tells the operator what to tap when the phone is not trusted yet', () => {
    expect(deviceGuidance([{ serial: 'A', state: 'unauthorized', usb: true }])).toContain('Allow USB debugging');
    expect(deviceGuidance([{ serial: 'A', state: 'offline', usb: true }])).toContain('kill-server');
    expect(deviceGuidance([{ serial: 'A', state: 'no permissions', usb: true }])).toContain('USB driver');
    expect(deviceGuidance([{ serial: 'A', state: 'device', usb: true }])).toBeNull();
  });

  it('explains a missing or stuck adb', () => {
    expect(describeAdbFailure(Object.assign(new Error('spawn adb ENOENT'), { code: 'ENOENT' }))).toContain('platform-tools');
    expect(describeAdbFailure(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toContain('Unplug the cable');
    expect(describeAdbFailure(new Error('odd'))).toContain('data cable');
  });

  it('points the device at its own loopback, not at a network address', () => {
    expect(usbGuestUrl(47626, 'abcDEF1234567890_-xyZ')).toBe('http://127.0.0.1:47626/remote/abcDEF1234567890_-xyZ/');
  });
});

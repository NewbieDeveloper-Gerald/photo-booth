import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANDROID_APP_ACTIVITY, ANDROID_APP_PACKAGE } from './adb';

const root = process.cwd();
const appDir = join(root, 'android', 'booth-screen');
const manifest = readFileSync(join(appDir, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const apk = readFileSync(join(appDir, 'BoothScreen-debug.apk'));

/**
 * Reads the APK's entries without a zip library, so the test sees the shipped file itself: the
 * central directory gives the names and the methods, and each local header gives the payload.
 */
function zipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(eocd + 10);
  let cd = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(cd + 10);
    const compressedSize = buffer.readUInt32LE(cd + 20);
    const nameLength = buffer.readUInt16LE(cd + 28);
    const extraLength = buffer.readUInt16LE(cd + 30);
    const commentLength = buffer.readUInt16LE(cd + 32);
    const localOffset = buffer.readUInt32LE(cd + 42);
    const name = buffer.subarray(cd + 46, cd + 46 + nameLength).toString('utf8');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(payload) : payload);
    cd += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('the booth screen app (Android)', () => {
  it('is landscape-only and belongs to the package the cable link starts', () => {
    expect(manifest).toContain(`package="${ANDROID_APP_PACKAGE}"`);
    expect(manifest).toContain('android:screenOrientation="sensorLandscape"');
    expect(manifest).toContain(`android:name="${ANDROID_APP_ACTIVITY}"`);
    expect(manifest).toContain('android:exported="true"');
  });

  it('keeps its traffic on the cable', () => {
    // Clear text for 127.0.0.1 only, and no permission beyond INTERNET.
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifest).toMatch(/android:usesCleartextTraffic="true"/);
    expect(manifest.match(/<uses-permission/g) ?? []).toHaveLength(1);
    expect(manifest).toContain('android.permission.INTERNET');
    const security = readFileSync(join(appDir, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'), 'utf8');
    expect(security).toContain('cleartextTrafficPermitted="false"');
    expect(security).toContain('127.0.0.1');
  });

  it('ships an APK that Android can install and verify', () => {
    // A real, signed APK is committed so it can be installed without a build machine.
    const entries = zipEntries(apk);
    for (const name of ['AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'META-INF/CERT.SF', 'META-INF/MANIFEST.MF']) {
      expect([...entries.keys()]).toContain(name);
    }
    // v2/v3 signatures live in the APK Signing Block, right before the central directory.
    expect(apk.includes(Buffer.from('APK Sig Block 42'))).toBe(true);
    // The compiled manifest and the dex both carry the package the cable link launches.
    // aapt2 keeps the manifest's strings in the binary XML string pool as UTF-16.
    expect(entries.get('AndroidManifest.xml')!.includes(Buffer.from(ANDROID_APP_PACKAGE, 'utf16le'))).toBe(true);
    const dex = entries.get('classes.dex')!;
    expect(dex.subarray(0, 4).toString('binary')).toBe('dex\n');
    expect(dex.includes(Buffer.from(`L${ANDROID_APP_ACTIVITY.replace(/\./g, '/')};`))).toBe(true);
    expect(dex.includes(Buffer.from('http://127.0.0.1:47626'))).toBe(true);
  });

  it('declares the app in the Java source that the APK is built from', () => {
    const java = readFileSync(join(appDir, 'app', 'src', 'main', 'java', 'ph', 'photobooth', 'screen', 'MainActivity.java'), 'utf8');
    expect(java).toContain('package ph.photobooth.screen;');
    expect(java).toContain('setJavaScriptEnabled(true)');
    expect(java).toContain('FLAG_KEEP_SCREEN_ON');
  });
});

#!/usr/bin/env python3
"""Build the Booth Screen APK without Gradle and without the Android SDK.

Three things are needed and none of them is the SDK:

  aapt2          compiles res/ and links AndroidManifest.xml into a binary manifest + resources.arsc
                 (``pip install aapt2`` ships a Linux/macOS/Windows build)
  android.jar    the framework stubs aapt2 links against (any platform jar, API 21 or newer)
  apkforge       pure-Python APK signing (``pip install apkforge``); only its signing module is used

The code is assembled by ``booth_dex.py`` because this environment has no JDK to run ``javac``/``d8``.
On a machine with Android Studio, build with Gradle instead — same Java source, same manifest:

    cd android/booth-screen && ./gradlew assembleDebug

Example:

    build_apk.py --aapt2 ~/aapt2 --android-jar ~/android.jar --out BoothScreen-debug.apk
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
MAIN = os.path.join(APP, "app", "src", "main")

sys.path.insert(0, HERE)
import booth_dex  # noqa: E402


def run(cmd, **kw):
    result = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if result.returncode != 0:
        sys.exit("%s failed:\n%s%s" % (" ".join(map(str, cmd)), result.stdout, result.stderr))
    return result


def build(aapt2, android_jar, out, min_sdk, target_sdk):
    work = tempfile.mkdtemp(prefix="booth-apk-")
    try:
        flat = os.path.join(work, "res.flata")
        run([aapt2, "compile", "--dir", os.path.join(MAIN, "res"), "-o", flat])
        base = os.path.join(work, "base.apk")
        run([aapt2, "link", "-o", base, "-I", android_jar,
             "--manifest", os.path.join(MAIN, "AndroidManifest.xml"),
             "-R", flat, "--auto-add-overlay",
             "--min-sdk-version", str(min_sdk), "--target-sdk-version", str(target_sdk)])

        dex = booth_dex.main_activity()
        if len(dex) < 0x70 or dex[:4] != b"dex\n":
            sys.exit("the assembled dex is not a dex file")

        try:
            from apkforge import signing, zipw
        except ImportError:
            sys.exit("apkforge is needed for signing: pip install apkforge")

        signer = _signer(signing)
        # resources.arsc must be stored and 4-byte aligned, the way zipalign leaves it.
        zb = zipw.ZipBuilder()
        with zipfile.ZipFile(base) as zf:
            for info in zf.infolist():
                zb.add(info.filename, zf.read(info.filename),
                       store=info.filename == "resources.arsc",
                       align=4 if info.filename == "resources.arsc" else 0)
        zb.add("classes.dex", dex)
        blob = signing.sign_zip(zb, signer, v1=True, v2=True, v3=True)
        with open(out, "wb") as fh:
            fh.write(blob)

        report = signing.verify_apk(out)
        if report.get("problems"):
            sys.exit("the signed APK does not verify: %s" % report["problems"])
        print("built %s (%d bytes) — signatures: v1=%s v2=%s v3=%s, cert %s" % (
            out, len(blob), report.get("v1"), report.get("v2"), report.get("v3"),
            (report.get("cert_sha256") or "")[:16]))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _signer(signing):
    """A PEM key + certificate if given, else a fresh throwaway debug key (stable per checkout)."""
    key = os.environ.get("BOOTH_KEYSTORE")
    if key:
        cert = os.environ.get("BOOTH_CERT", key)
        with open(key) as fh:
            key_pem = fh.read()
        with open(cert) as fh:
            cert_pem = fh.read()
        return signing.signer_from_pem(key_pem, cert_pem)
    path = os.path.join(APP, ".debug-signing")
    key_pem_file = os.path.join(path, "key.pem")
    cert_pem_file = os.path.join(path, "cert.pem")
    if not (os.path.exists(key_pem_file) and os.path.exists(cert_pem_file)):
        _make_debug_key(key_pem_file, cert_pem_file)
    with open(key_pem_file) as fh:
        key_pem = fh.read()
    with open(cert_pem_file) as fh:
        cert_pem = fh.read()
    return signing.signer_from_pem(key_pem, cert_pem)


def _make_debug_key(key_file, cert_file):
    import datetime
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Booth Screen debug"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Photo Booth")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    os.makedirs(os.path.dirname(key_file), exist_ok=True)
    with open(key_file, "wb") as fh:
        fh.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                   serialization.NoEncryption()))
    with open(cert_file, "wb") as fh:
        fh.write(cert.public_bytes(serialization.Encoding.PEM))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--aapt2", required=True, help="path to an aapt2 binary")
    parser.add_argument("--android-jar", required=True, help="path to android.jar (API %d)" % 34)
    parser.add_argument("--out", default=os.path.join(APP, "BoothScreen-debug.apk"))
    parser.add_argument("--min-sdk", type=int, default=21)
    parser.add_argument("--target-sdk", type=int, default=34)
    args = parser.parse_args()
    build(args.aapt2, args.android_jar, args.out, args.min_sdk, args.target_sdk)


if __name__ == "__main__":
    main()

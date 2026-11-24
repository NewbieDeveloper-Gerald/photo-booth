/**
 * The port the booth's tablet screen listens on (F22) — and the same port `adb reverse` maps for
 * the USB cable, so the phone's `127.0.0.1:47626` is the booth's server. It lives here, in a
 * renderer-safe module, because the server file imports `node:http` and must never be pulled into
 * the browser bundle through a constant.
 */
export const REMOTE_GUEST_PORT = 47_626;

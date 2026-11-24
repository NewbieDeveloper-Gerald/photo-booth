export { createRemoteServer, MAX_CLIENT_FRAME_BYTES, REMOTE_GUEST_HOST, REMOTE_GUEST_PORT, REMOTE_MAX_CLIENTS } from './data/remote-server';
export type { RemoteHub, RemoteServer, RemoteServerOptions } from './data/remote-server';
export { ensureRemoteToken, isRemoteToken, readRemoteEnabled, readRemoteToken, rotateRemoteToken, setRemoteEnabled } from './data/remote-settings';
export { pickLanAddress, remoteGuestUrl } from './domain/lan-address';
export type { NetworkInterfaces } from './domain/lan-address';
export { MJPEG_BOUNDARY, MJPEG_CONTENT_TYPE, mjpegHeaders, mjpegPart } from './data/mjpeg';
export { REMOTE_APP_JS, renderRemotePage } from './remote-page-html';
export { acceptKey, decodeClientFrames, encodeCloseFrame, encodePingFrame, encodePongFrame, encodeTextFrame, WebSocketProtocolError } from './data/websocket-frame';
// The USB cable link (F22 extension): adb commands, their output and the link service.
export {
  ADB_PROGRAM, USB_SCREEN_PORT, deviceGuidance, describeAdbFailure, launchArgs, listDevicesArgs, parseAdbDevices,
  parseReverseList, pickUsbDevice, removeReverseArgs, reverseArgs, reverseListArgs, usbGuestUrl,
  type AdbDevice, type AdbDeviceState,
} from './usb-link/adb';
export { createUsbLinkService, type AdbRun, type UsbLinkOptions, type UsbLinkService, type UsbLinkStatus } from './usb-link/link-service';

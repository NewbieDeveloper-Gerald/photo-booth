/** Renderer-safe surface of the tablet guest screen; the server itself lives in ./node.ts. */
export { allowedRemoteCommands, buildRemoteView, isRemoteCommandAllowed, offRemoteView, parseRemoteCommand, remoteViewSignature } from './domain/remote-view';
export { pickLanAddress, remoteGuestUrl } from './domain/lan-address';
export type { NetworkInterfaces } from './domain/lan-address';
export type { RemoteCommand, RemoteServerInfo, RemoteSlot, RemoteStage, RemoteView } from '../../shared/types/remote-guest';
// Renderer-safe parts of the USB cable link (F22 extension): the status shape and the URL helper.
export { USB_SCREEN_PORT, usbGuestUrl, type AdbDevice, type AdbDeviceState } from './usb-link/adb';
export type { UsbLinkStatus } from './usb-link/link-service';

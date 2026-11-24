/**
 * Browser-only helpers (never imported by the main process): IPC carries bytes,
 * the DOM carries Blobs, and these two convert between them.
 */
export function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export function bytesToJpegBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'image/jpeg' });
}

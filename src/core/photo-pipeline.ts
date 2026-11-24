import { GUEST_COPY_JPEG_QUALITY, GUEST_COPY_MAX_EDGE_PX, ORIGINAL_JPEG_QUALITY } from '../shared/constants/limits';

export type ImageDimensions = { width: number; height: number };

export function fitDimensions(width: number, height: number, maxEdge = GUEST_COPY_MAX_EDGE_PX): ImageDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || maxEdge < 1) {
    throw new RangeError('Image dimensions must be positive integers');
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function captureOriginalJpeg(video: HTMLVideoElement): Promise<{ blob: Blob; width: number; height: number }> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The camera preview has no image yet');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the photo frame');
  context.drawImage(video, 0, 0, width, height);
  return { blob: await toJpeg(canvas, ORIGINAL_JPEG_QUALITY), width, height };
}

export async function createDownloadCopy(original: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(original);
  try {
    const dimensions = fitDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the download copy');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    // Canvas re-encoding produces a fresh JPEG without copying source metadata.
    return { blob: await toJpeg(canvas, GUEST_COPY_JPEG_QUALITY), ...dimensions };
  } finally {
    bitmap.close();
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the photo as JPEG'));
    }, 'image/jpeg', quality);
  });
}

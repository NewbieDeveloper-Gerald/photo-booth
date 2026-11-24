/**
 * Decodes an image once so a long capture sequence does not reload the logo for every shot.
 * Rejects on a broken data URL instead of leaving the promise pending forever.
 */
export function loadImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the event logo for the watermark'));
    image.src = source;
  });
}

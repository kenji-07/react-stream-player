import { playerError } from '../errors.js';

/**
 * Draws the current frame of `video` into a temporary canvas and returns a PNG
 * Blob owned by the caller. No object URL is created and nothing is uploaded or
 * downloaded. The canvas is released before returning.
 */
export async function captureVideoFrame(video: HTMLVideoElement, options: { protected: boolean }): Promise<Blob | null> {
  if (options.protected || video.mediaKeys) {
    throw playerError('capture-protected', 'capture');
  }
  if (typeof document === 'undefined') throw playerError('capture-unsupported', 'capture');
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height || video.readyState < 2) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.toBlob !== 'function') throw playerError('capture-unsupported', 'capture');
    ctx.drawImage(video, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve, reject) => {
      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'SecurityError') throw playerError('capture-tainted', 'capture', { cause: error });
    if ((error as { name?: string })?.name === 'PlayerError') throw error;
    throw playerError('capture-unsupported', 'capture', { cause: error });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

import { nativeImage } from 'electron';
import { brandPixels } from './core/brand.js';

// A code-drawn tray glyph stays crisp without a remote image or font dependency.
export function trayIcon() {
  const size = 32; const pixels = brandPixels(size);
  // Electron bitmap pixels use BGRA on Windows; swap R/B for the native bitmap.
  if (process.platform === 'win32') for (let i = 0; i < pixels.length; i += 4) { const r = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = r; }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

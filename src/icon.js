import { nativeImage } from 'electron';
import { brandPixels } from './core/brand.js';

// A code-drawn tray glyph stays crisp without a remote image or font dependency.
export function trayIcon({ menuBar = false } = {}) {
  if (menuBar) {
    // A monochrome template lets macOS adapt the menu-bar glyph to light/dark backgrounds.
    const size = 36, pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + .5) * 32 / size, v = (y + .5) * 32 / size;
      if ([10, 21].some(cx => Math.abs(Math.hypot((u - cx) / 7, (v - 18) / 9) - 1) < .16) || Math.hypot(u - 27, v - 5) < 3) pixels[(y * size + x) * 4 + 3] = 255;
    }
    const image = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
    image.setTemplateImage(true);
    return image;
  }
  const size = 32; const pixels = brandPixels(size);
  // Electron bitmap pixels use BGRA on Windows; swap R/B for the native bitmap.
  if (process.platform === 'win32') for (let i = 0; i < pixels.length; i += 4) { const r = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = r; }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

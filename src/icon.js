import { nativeImage } from 'electron';

// A code-drawn tray glyph stays crisp without a remote image or font dependency.
export function trayIcon() {
  const size = 32; const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - 15.5, dy = y - 15.5; const r = Math.hypot(dx, dy);
    const index = (y * size + x) * 4;
    if (r > 15) continue;
    const white = (r > 9 && r < 10.7) || (Math.abs(dx) < 1 && dy >= -6 && dy <= 1) || (dy >= 0 && dy <= 4 && Math.abs(dx - dy) < 1.3);
    pixels[index] = white ? 255 : 65; pixels[index + 1] = white ? 255 : 105; pixels[index + 2] = white ? 255 : 225; pixels[index + 3] = 255;
  }
  // Electron bitmap pixels use BGRA on Windows; swap R/B for the native bitmap.
  if (process.platform === 'win32') for (let i = 0; i < pixels.length; i += 4) { const r = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = r; }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

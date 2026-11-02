// LoNo: two linked loops and one notification dot, in the college palette.
export function brandPixels(size = 48) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const u = (x + (sx + .5) / samples) * 32 / size;
      const v = (y + (sy + .5) / samples) * 32 / size;
      const dx = Math.max(0, Math.abs(u - 16) - 8), dy = Math.max(0, Math.abs(v - 16) - 8);
      if (dx * dx + dy * dy > 64) continue;
      let color = [136, 30, 85];
      if ([11.5, 20.5].some(cx => Math.abs(Math.hypot((u - cx) / 7, (v - 17) / 9) - 1) < .12)) color = [255, 255, 255];
      const dot = Math.hypot(u - 26, v - 7);
      if (dot < 3.6) color = dot > 2.6 ? [255, 255, 255] : [226, 125, 190];
      for (let c = 0; c < 3; c++) sum[c] += color[c]; sum[3]++;
    }
    const index = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) pixels[index + c] = sum[3] ? Math.round(sum[c] / sum[3]) : 0;
    pixels[index + 3] = Math.round(sum[3] / (samples * samples) * 255);
  }
  return pixels;
}

export function brandIco(size = 48) {
  const pixels = brandPixels(size), maskStride = Math.ceil(size / 32) * 4;
  const dib = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const source = (y * size + x) * 4, target = 40 + ((size - 1 - y) * size + x) * 4;
    dib[target] = pixels[source + 2]; dib[target + 1] = pixels[source + 1]; dib[target + 2] = pixels[source]; dib[target + 3] = pixels[source + 3];
  }
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = size; header[7] = size; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(dib.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, dib]);
}

import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia, renderStill } from '@remotion/renderer';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const output = path.resolve('artifacts/demo');
const assets = path.resolve('.runtime/demo-public'); mkdirSync(assets, { recursive: true });
copyFileSync(path.join(output, 'lono-exchange-demo.webm'), path.join(assets, 'app.webm'));
copyFileSync(path.resolve('src/ui/brand.svg'), path.join(assets, 'brand.svg'));
const timeline = JSON.parse(readFileSync(path.join(output, 'timeline.json'), 'utf8'));
// Keep real UI action footage, trim idle intervals, and reserve readable captions.
const scenes = timeline.slice(1).map(s => ({ ...s, start: s.start + .5, duration: Math.max(2, s.hold - .5) }));
const inputProps = { scenes };
writeFileSync(path.join(output, 'remotion-scenes.json'), JSON.stringify(inputProps, null, 2));
const serveUrl = await bundle({ entryPoint: path.resolve('demo/index.jsx'), publicDir: assets });
const composition = await selectComposition({ serveUrl, id: 'LoNoDemo', inputProps });
const file = path.join(output, 'LoNo-Exchange与工作记忆-Demo.mp4');
let last = -1;
await renderMedia({ serveUrl, composition, inputProps, outputLocation: file, codec: 'h264', crf: 20, pixelFormat: 'yuv420p', concurrency: 4, onProgress: p => { const percent = Math.floor(p.progress * 10) * 10; if (percent !== last) { last = percent; console.log(`Remotion ${percent}%`); } } });
await renderStill({ serveUrl, composition, inputProps, output: path.join(output, 'remotion-cover.png'), frame: 60 });
await renderStill({ serveUrl, composition, inputProps, output: path.join(output, 'remotion-ui.png'), frame: 240 });
console.log(JSON.stringify({ file, seconds: composition.durationInFrames / composition.fps, frames: composition.durationInFrames }));

import { bundle } from '@remotion/bundler';
import { openBrowser, selectComposition, renderMedia, renderStill, getVideoMetadata } from '@remotion/renderer';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeScore } from './score.mjs';
import { chapters, DURATION, FPS } from './timeline.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2), mode=args.includes('--stills')?'stills':args.includes('--preview')?'preview':'final';
const output=path.resolve(args.find(a=>a.startsWith('--out='))?.slice(6)||path.join(root,'artifacts/showcase-v0.3.13'));
const publicDir=path.join(root,'.runtime/showcase-public');
mkdirSync(publicDir,{recursive:true});mkdirSync(output,{recursive:true});
copyFileSync(path.join(root,'src/ui/brand.svg'),path.join(publicDir,'brand.svg'));
console.log('Original score',makeScore(path.join(publicDir,'score.wav')));
const serveUrl=await bundle({entryPoint:path.join(root,'demo/showcase/index.jsx'),publicDir,onProgress:p=>{if(p===100)console.log('Composition bundled');}});
const browser=await openBrowser('chrome');
try {
  const composition=await selectComposition({serveUrl,id:'LoNoShowcase',puppeteerInstance:browser});
  if(mode==='stills') {
    for(const ch of chapters) {
      const file=path.join(output,`${ch.id}.png`);
      await renderStill({serveUrl,composition,frame:Math.round(ch.still*FPS),output:file,puppeteerInstance:browser});
      console.log('Still:',ch.id);
    }
    for(const [label,t] of [['agent-create',32.5],['capture-saved',27.5],['memory-before',54],['outro-last',71.9]]) {
      await renderStill({serveUrl,composition,frame:Math.round(t*FPS),output:path.join(output,`${label}.png`),puppeteerInstance:browser});
    }
  } else {
    const file=path.join(output,mode==='preview'?'LoNo-0.3.13-Preview.mp4':'LoNo-0.3.13-Showcase.mp4');
    let last=-1,lastReport=0;
    await renderMedia({serveUrl,composition,puppeteerInstance:browser,outputLocation:file,codec:'h264',crf:mode==='preview'?23:18,scale:mode==='preview'?.5:1,pixelFormat:'yuv420p',colorSpace:'bt709',imageFormat:'png',audioCodec:'aac',audioBitrate:'192k',concurrency:6,x264Preset:'medium',
      onProgress:p=>{const value=Math.floor(p.progress*100);if(value!==last&&(Date.now()-lastReport>10000||value===100)){last=value;lastReport=Date.now();console.log(`Rendering ${value}% (${p.renderedFrames}/${composition.durationInFrames} frames)`);}}});
    const metadata=await getVideoMetadata(file);
    if(metadata.width!==(mode==='preview'?960:1920)||metadata.height!==(mode==='preview'?540:1080)||Math.abs(metadata.durationInSeconds-DURATION)>.15)throw new Error('Output dimensions/duration do not match the composition');
    writeFileSync(path.join(output,`${mode}-metadata.json`),JSON.stringify({file,metadata,chapters,appVersion:'0.3.13',fps:FPS,syntheticData:true},null,2));
    console.log(JSON.stringify({file,metadata}));
    if(mode==='final') {
      await renderStill({serveUrl,composition,frame:Math.round(24.5*FPS),output:path.join(output,'LoNo-Showcase-Cover.png'),puppeteerInstance:browser});
    }
  }
} finally {await browser.close({silent:true});}

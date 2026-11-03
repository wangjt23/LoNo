import { writeFileSync } from 'node:fs';
import { DURATION, chapters } from './timeline.mjs';

// Original procedural score: 100 BPM, Dmaj9 / F#m7 / Amaj9 / Eadd9.
// No third-party samples, network services, or generative music dependencies.
export function makeScore(file) {
  const rate=48000, count=DURATION*rate, left=new Float32Array(count),right=new Float32Array(count);
  const TAU=Math.PI*2, beat=.6, frequency=n=>440*2**((n-69)/12);
  let seed=821;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/2147483648-1;};
  function note(start,duration,midi,level,pan=0,kind='key') {
    const from=Math.round(start*rate), length=Math.min(Math.round(duration*rate),count-from), hz=frequency(midi);
    for(let j=0;j<length;j++) {
      const t=j/rate, p=TAU*hz*t;
      let wave,env;
      if(kind==='pad') {env=Math.min(1,t/1.4)*Math.min(1,(duration-t)/1.5);wave=(Math.sin(p)+.33*Math.sin(p*1.0017)+.16*Math.sin(p*2))/1.5;}
      else if(kind==='bass') {env=Math.min(1,t/.02)*Math.exp(-t*2.8)*Math.min(1,(duration-t)/.1);wave=Math.sin(p)+.12*Math.sin(2*p);}
      else {env=Math.min(1,t/.008)*Math.exp(-t*2.5);wave=Math.sin(p+.48*Math.sin(p*2)*Math.exp(-t*4))+.16*Math.sin(p*3)*Math.exp(-t*7);}
      const v=level*env*wave;
      left[from+j]+=v*(1-pan*.55);right[from+j]+=v*(1+pan*.55);
    }
  }
  const harmony=[[50,57,61,64,69],[54,61,64,69,73],[45,57,61,64,71],[52,59,64,66,71]];
  for(let bar=0;bar<15;bar++) {
    const start=bar*8*beat, chord=harmony[bar%4];
    chord.slice(1).forEach((n,i)=>note(start,6.2,n,.029,(i-1.5)*.4,'pad'));
    if(start<66)for(let k=0;k<8;k++) {
      const pattern=[1,3,2,4,2,3,1,4];
      note(start+k*beat+.02,2.4,chord[pattern[k]]+12,k%2===0?.051:.031,(k%3-1)*.55);
      if(start>=4.8)note(start+k*beat,beat*.85,chord[0]-12,k%2===0?.074:.034,0,'bass');
    }
  }
  // Warm restrained pulse. Side detail is intentionally softer than the UI cues.
  for(let b=8;b<110;b++) {
    const start=b*beat, from=Math.round(start*rate);
    if(b%2===0)for(let j=0;j<rate*.25;j++) {const t=j/rate,v=.12*Math.sin(TAU*(45*t+3*(1-Math.exp(-t*25))))*Math.exp(-t*20);left[from+j]+=v;right[from+j]+=v;}
    for(let j=0;j<rate*.055;j++){const t=j/rate,v=noise()*.013*Math.exp(-t*95);left[from+j]+=v*.8;right[from+j]+=v;}
    if(b%4===2)for(let j=0;j<rate*.14;j++){const t=j/rate,v=noise()*.025*Math.exp(-t*35)*Math.min(1,t/.003);left[from+j]+=v;right[from+j]+=v*.8;}
  }
  for(const t of [26.1,33.3,40.5,50.2,55.4]){note(t,1.6,81,.045,-.2);note(t+.075,1.4,88,.027,.2);}
  // Soft air swells follow editorial transitions, without harsh whooshes.
  for(const ch of chapters.slice(1)) {
    const start=ch.from-.35, from=Math.round(start*rate);let low=0;
    for(let j=0;j<rate*.85;j++){const t=j/rate;low=.94*low+.06*noise();const v=low*.1*Math.sin(Math.PI*t/.85)**2;left[from+j]+=v;right[from+j]+=v*.85;}
  }
  // Stereo cross-delay gives the keys a small, spacious tail.
  for(let i=Math.round(rate*.3);i<count;i++){left[i]+=right[i-Math.round(rate*.3)]*.11;right[i]+=left[i-Math.round(rate*.225)]*.1;}
  const pcm=Buffer.alloc(count*4);let peak=0,sum=0;
  for(let i=0;i<count;i++) {
    const t=i/rate,fade=Math.min(1,t/1.8)*Math.min(1,(DURATION-t)/2.4);
    const l=Math.tanh(left[i]*1.4)*fade,r=Math.tanh(right[i]*1.4)*fade;
    peak=Math.max(peak,Math.abs(l),Math.abs(r));sum+=(l*l+r*r)/2;
    pcm.writeInt16LE(Math.round(l*32767),i*4);pcm.writeInt16LE(Math.round(r*32767),i*4+2);
  }
  const head=Buffer.alloc(44);head.write('RIFF');head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(2,22);head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*4,28);head.writeUInt16LE(4,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);
  writeFileSync(file,Buffer.concat([head,pcm]));
  return {peakDb:20*Math.log10(peak),rmsDb:20*Math.log10(Math.sqrt(sum/count)),seconds:DURATION};
}

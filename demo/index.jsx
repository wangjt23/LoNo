import React from 'react';
import { AbsoluteFill, Composition, OffthreadVideo, Sequence, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const font = '"Segoe UI", "Microsoft YaHei", sans-serif';
const Background = () => <AbsoluteFill style={{ background: '#f2f5fa', overflow: 'hidden' }}><div style={{ position: 'absolute', width: 1000, height: 1000, left: -250, top: -600, borderRadius: '50%', background: '#b8d7ff', filter: 'blur(140px)', opacity: .65 }}/><div style={{ position: 'absolute', width: 900, height: 900, right: -350, bottom: -550, borderRadius: '50%', background: '#d7cbfa', filter: 'blur(150px)', opacity: .6 }}/></AbsoluteFill>;
function Title({ closing = false }) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 22, stiffness: 90 } });
  return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: font, color: '#15243b' }}>
    <Background />
    <div style={{ position: 'relative', textAlign: 'center', opacity: entrance, transform: `translateY(${(1 - entrance) * 30}px)` }}>
      <div style={{ display: 'inline-flex', width: 98, height: 98, borderRadius: 28, background: '#ffffffb0', alignItems: 'center', justifyContent: 'center', boxShadow: '0 14px 50px #3967ab18', color: '#0675f9', fontSize: 60, marginBottom: 30 }}>✓</div>
      <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: 8, color: '#75859d', marginBottom: 20 }}>拾光 · SHIGUANG</div>
      <h1 style={{ fontSize: 82, letterSpacing: -3, fontWeight: 650, margin: '0 0 24px' }}>{closing ? '记住重要的事，也记住做事的方法。' : '从一封邮件，到懂你的助理。'}</h1>
      <p style={{ color: '#6f7f95', fontSize: 30, margin: 0 }}>{closing ? '本地记录 · 可追溯的记忆 · 由你掌握' : '自动整理待办，让经验成为下一次的帮助。'}</p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 60 }}>{(closing ? ['Exchange 已接通', '提醒自动生成', '记忆持续积累'] : ['邮件', '待办', '提醒', '工作记忆']).map((label, i) => <div key={label} style={{ padding: '15px 28px', borderRadius: 30, border: '1px solid #fff', background: '#ffffff90', fontSize: 22, color: '#426384' }}>{label}{!closing && i < 3 ? '  →' : ''}</div>)}</div>
    </div>
    <div style={{ position: 'absolute', bottom: 38, color: '#8a97ab', fontSize: 17 }}>真实 App 操作录屏 · 模拟邮箱与模型 · 非真实工作数据</div>
  </AbsoluteFill>;
}
function Clip({ scene, index, total }) {
  const f = useCurrentFrame();
  const fade = interpolate(f, [0, 9], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ fontFamily: font, color: '#1c2b42', opacity: fade }}>
    <Background />
    <div style={{ position: 'absolute', top: 30, left: 68, fontSize: 24, fontWeight: 600 }}>拾光 <span style={{ fontWeight: 400, color: '#8291a5', marginLeft: 14 }}>智能提醒与工作记忆</span></div>
    <div style={{ position: 'absolute', top: 33, right: 68, color: '#8795a7', fontSize: 18 }}>演示数据 / {String(index + 1).padStart(2, '0')}</div>
    <div style={{ position: 'absolute', width: 1320, height: 890, left: 300, top: 82, borderRadius: 22, boxShadow: '0 22px 75px #274e7c20', overflow: 'hidden', border: '1px solid #ffffff', background: '#fff' }}>
      <OffthreadVideo muted src={staticFile('app.webm')} trimBefore={Math.round(scene.start * 24)} style={{ width: '100%', height: '100%', objectFit: 'contain' }}/>
    </div>
    <div style={{ position: 'absolute', left: 70, right: 70, bottom: 35, display: 'flex', alignItems: 'center', gap: 30 }}>
      <div style={{ fontSize: 24, fontWeight: 600, whiteSpace: 'nowrap' }}>{scene.title.replace(/^\d+ \/ /, '')}</div>
      <div style={{ width: 1, height: 28, background: '#cbd4df' }}/>
      <div style={{ color: '#728299', fontSize: 19, lineHeight: 1.5 }}>{scene.subtitle}</div>
    </div>
    <div style={{ position: 'absolute', bottom: 0, left: 0, width: `${(index + 1) / total * 100}%`, height: 4, background: '#1883ff' }}/>
  </AbsoluteFill>;
}
function Demo({ scenes }) {
  let start = 120;
  return <AbsoluteFill>
    <Sequence durationInFrames={120}><Title /></Sequence>
    {scenes.map((s, index) => {
      const duration = Math.round(s.duration * 24); const from = start; start += duration;
      return <Sequence key={s.title} from={from} durationInFrames={duration}><Clip scene={s} index={index} total={scenes.length}/></Sequence>;
    })}
    <Sequence from={start} durationInFrames={120}><Title closing /></Sequence>
  </AbsoluteFill>;
}
registerRoot(() => <Composition id="ShiguangDemo" component={Demo} width={1920} height={1080} fps={24} durationInFrames={1200} defaultProps={{ scenes: [] }} calculateMetadata={({ props }) => ({ durationInFrames: 240 + props.scenes.reduce((n, s) => n + Math.round(s.duration * 24), 0) })}/>);

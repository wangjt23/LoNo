import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { chapters, FPS } from './timeline.mjs';
import './style.css';

const BERRY = '#881e55';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const ramp = (f, start, duration = 25) => interpolate(f, [start, start + duration], [0, 1], clamp);
const ease = (f, start = 0) => spring({ frame: Math.max(0, f-start), fps: FPS, config: { damping: 24, stiffness: 110, mass: .9 } });
const enter = (f, delay = 0, y = 35) => ({ opacity: ramp(f, delay, 17), transform: `translateY(${(1-ease(f,delay))*y}px)` });
const abs = (left, top, width, extra = {}) => ({ position: 'absolute', left, top, width, ...extra });

function Icon({ type = 'spark', size = 26, style = {} }) {
  const paths = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
    chat: <><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h8M7 13h5"/></>,
    spark: <><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
    plus: <path d="M12 4v16M4 12h16"/>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    edit: <><path d="m14 4 6 6M4 20l5-1L21 7l-4-4L5 15Z"/></>,
    layers: <><path d="m12 2 10 6-10 6L2 8Zm-9 11 9 5 9-5M3 18l9 5 9-5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,...style}}>{paths[type] || paths.spark}</svg>;
}
function Logo({ size = 56 }) { return <Img src={staticFile('brand.svg')} style={{ width:size, height:size, flexShrink:0 }}/>; }
function Tag({ children, green = false, dark = false }) { return <span className={`tag ${green?'green':''} ${dark?'on-dark':''}`}>{children}</span>; }
function Button({ children, done = false, secondary = false, style = {} }) { return <div className={`button ${done?'done':''} ${secondary?'secondary':''}`} style={style}>{done && <Icon type="check" size={21}/>} {children}</div>; }
function Eyebrow({ children, light = false }) { return <div className={`eyebrow ${light?'light':''}`}>{children}</div>; }
function Backdrop({ dark = false }) {
  const f = useCurrentFrame();
  return <AbsoluteFill className={`backdrop ${dark?'dark':''}`}>
    <div className="aura a" style={{transform:`translate(${Math.sin(f/150)*70}px,${Math.cos(f/130)*35}px)`}}/>
    <div className="aura b" style={{transform:`translate(${Math.cos(f/170)*70}px,${Math.sin(f/180)*60}px)`}}/>
    <div className="fine-grid"/>
  </AbsoluteFill>;
}
function BrandLine({ dark = false, chapter }) {
  return <div className={`brand-line ${dark?'inverse':''}`}><div><Logo size={35}/><b>LoNo</b><span>LOOP NOTIFY</span></div><span>{chapter}</span></div>;
}
function ChapterNote({ children, dark = false }) {return <div className={`chapter-note ${dark?'inverse':''}`}>{children}</div>;}
function Cursor({ f, start, x, y }) {
  const a = ease(f,start), pulse = ramp(f,start+24,7)*(1-ramp(f,start+31,17));
  return <div style={{...abs(x+110*(1-a), y+80*(1-a),35), opacity:ramp(f,start,8)*(1-ramp(f,start+50,10)), zIndex:20}}>
    <div style={{position:'absolute',left:-14,top:-14,width:55,height:55,border:'3px solid #d14aa4',borderRadius:'50%',opacity:pulse,transform:`scale(${1+pulse})`}}/>
    <svg width="32" height="39" viewBox="0 0 32 39" style={{filter:'drop-shadow(0 3px 3px #0004)'}}><path d="M3 2v30l8-8 6 12 6-3-6-11h12Z" fill="#28222c" stroke="white" strokeWidth="2"/></svg>
  </div>;
}
function Loops({ f, dark = false, large = false }) {
  const p = ramp(f,0,75);
  return <svg width="1300" height="900" viewBox="0 0 1300 900" style={{position:'absolute',left:large?310:630,top:large?80:180,opacity:dark?.7:.45,transform:`rotate(${-16+Math.sin(f/150)*5}deg)`}}>
    <defs><linearGradient id={dark?'loopDark':'loopLight'} x1="0" y1="0" x2="1" y2="1"><stop stopColor={dark?'#eec8e0':'#881e55'}/><stop offset=".48" stopColor="#cc73aa"/><stop offset="1" stopColor={dark?'#472e46':'#eedce7'}/></linearGradient></defs>
    {[0,1].map(i=><ellipse key={i} cx={470+i*310} cy="450" rx="265" ry="340" fill="none" stroke={`url(#${dark?'loopDark':'loopLight'})`} strokeWidth={large?2:1.5} pathLength="1" strokeDasharray="1" strokeDashoffset={1-p}/>)}</svg>;
}

function Intro() {
  const f=useCurrentFrame(); const reveal=ramp(f,67,30);
  return <AbsoluteFill className="scene inverse"><Backdrop dark/><Loops f={f} dark large/><BrandLine dark chapter="PRODUCT FILM / 0.3.13"/>
    <div style={{...abs(0,310,1920),textAlign:'center',opacity:1-reveal,transform:`translateY(${-reveal*35}px)`}}>
      <div className="intro-muted" style={enter(f,8)}>邮件。消息。一闪而过的想法。</div>
      <h1 style={{fontSize:100,marginTop:25,...enter(f,23)}}>信息很多。<span style={{color:'#ecc3df'}}>精力有限。</span></h1>
    </div>
    <div style={{...abs(0,245,1920),textAlign:'center',opacity:reveal,transform:`translateY(${(1-reveal)*40}px)`}}>
      <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:28}}><Logo size={100}/><span className="wordmark">LoNo</span></div>
      <h1 style={{fontSize:94,margin:'50px 0 28px'}}>把信息，变成行动。</h1>
      <div style={{fontSize:28,color:'#c4b4c1',letterSpacing:4}}>你的桌面智能提醒助手</div>
    </div>
    <div style={{...abs(0,920,1920),textAlign:'center',color:'#9c8596',fontSize:17,letterSpacing:6,opacity:ramp(f,100)}}>LESS NOISE. MORE CLARITY.</div>
  </AbsoluteFill>;
}

function Sources() {
  const f=useCurrentFrame(); const connect=ramp(f,80,80);
  const cards=[{x:760,y:195,angle:-7,icon:'mail',name:'学院邮箱',small:'Exchange / EWS',text:'请于周五 17:00 前提交项目材料',delay:15},
    {x:1265,y:235,angle:7,icon:'mail',name:'个人邮箱',small:'IMAP / TLS',text:'项目讨论 · 本周五上午 10:00',delay:29},
    {x:1050,y:450,angle:-2,icon:'chat',name:'企业微信',small:'授权桥接',text:'活动地点与准备事项已更新',delay:43}];
  return <AbsoluteFill className="scene"><Backdrop/><BrandLine chapter="01 / CONNECT"/>
    <div style={abs(120,285,580)}><Eyebrow>让信息，回到同一个地方</Eyebrow><h1 style={{fontSize:73,lineHeight:1.3,...enter(f,5)}}>来源不同。<br/>安排有序。</h1><p className="lead" style={enter(f,20)}>多个邮箱、授权消息与随手输入，<br/>汇成你看得清的每一件事。</p><div style={{marginTop:45,...enter(f,45)}}><Tag>多邮箱独立配置</Tag><Tag>保留消息来源</Tag></div></div>
    <svg width="1920" height="1080" style={{position:'absolute'}}><g fill="none" stroke="#b6799b" strokeWidth="1.5" strokeDasharray="5 9" opacity={connect*.6}><path d="M940 350Q950 650 1240 750M1430 390Q1430 650 1240 750M1240 580V750"/></g></svg>
    {cards.map(c=><div key={c.name} className="glass source-float" style={{...abs(c.x,c.y,420),...enter(f,c.delay),transform:`translateY(${(1-ease(f,c.delay))*80+Math.sin(f/50+c.delay)*5}px) rotate(${c.angle*(1-.3*connect)}deg)`}}><div className="source-head"><div className="icon-tile"><Icon type={c.icon}/></div><div><b>{c.name}</b><small>{c.small}</small></div></div><div style={{fontSize:23,lineHeight:1.6,marginTop:22}}>{c.text}</div></div>)}
    <div className="glass source-result" style={{...abs(900,735,760),...enter(f,112)}}><Logo size={56}/><div><b>提交项目材料</b><div className="metadata"><Tag>学院邮箱</Tag><span>周五 17:00</span><span className="priority">● 重要</span></div></div><div className="checked"><Icon type="check"/></div></div>
    <ChapterNote>默认每 10 分钟同步 · 企业微信需授权数据桥接</ChapterNote>
  </AbsoluteFill>;
}

const courses=[['11/04','模型自动训练与推理'],['11/05','算子自动开发与优化'],['11/11','模型自动适配与调优'],['11/12','多卡并行的模型训推']];
function Capture() {
  const f=useCurrentFrame(); const expanded=ease(f,90), saved=f>=318;
  const text='这份课表，每节课提前 30 分钟提醒我。';
  return <AbsoluteFill className="scene"><Backdrop/><BrandLine chapter="02 / CAPTURE"/>
    <div style={{...abs(120,155,1450),...enter(f)}}><Eyebrow>从一段输入，到多条提醒</Eyebrow><h1 style={{fontSize:68,marginTop:14}}>一份课表。<span className="berry">四条安排。</span></h1></div>
    <div className="glass capture-source" style={{...abs(120,350,660),...enter(f,12),transform:`translateY(${(1-ease(f,12))*50}px) rotate(${-2*(1-expanded)}deg)`}}>
      <div className="source-head"><div className="icon-tile"><Icon type="layers"/></div><div><b>昇腾系列微课程 · 第二期</b><small>课程安排 / 示例数据</small></div></div>
      <div className="course-old"><span>10/28</span> 基础软硬件平台 <Tag>已过期</Tag></div>
      {courses.map(([day,title],i)=><div className="course-line" key={day} style={{opacity:ramp(f,24+i*8,15)}}><span>{day}</span><b>{title}</b><span>14:30</span></div>)}
      <div className="source-foot">B401 · 中文授课 · 请自备笔记本电脑</div>
      <div className="capture-prompt"><Icon type="spark" size={25}/><span>{text.slice(0,Math.floor(ramp(f,40,48)*text.length))}<span style={{opacity:f<100?1:0}}>|</span></span></div>
    </div>
    <div style={{...abs(810,570,90),color:BERRY,opacity:expanded}}><Icon type="arrow" size={64}/></div>
    <div className="glass capture-preview" style={{...abs(930,335,860),opacity:expanded,transform:`perspective(1800px) rotateY(${(1-expanded)*-16}deg) translateX(${(1-expanded)*120}px)`}}>
      <div className="preview-header"><div><Icon type="spark"/><b>提醒预览</b></div><Tag green={saved}>{saved?'已保存 4 条提醒':'已识别 4 条 · 可逐条调整'}</Tag></div>
      {courses.map(([date,title],i)=><div className="preview-course" key={date} style={enter(f,104+i*12,20)}><div className="checkbox"><Icon type="check" size={16}/></div><div className="date-chip"><b>{date.slice(3)}</b><small>11 月</small></div><div style={{flex:1}}><b>{title}</b><div className="metadata"><span>14:30 开始</span><span>14:00 提醒</span><Tag>普通</Tag></div></div><Icon type="edit" size={19}/></div>)}
      <div className="preview-footer"><small>{saved?'已加入未来安排':'已跳过 10 月 28 日的过去场次'}</small><Button done={saved}>{saved?'已添加':'添加 4 条提醒'}</Button></div>
    </div>
    <div style={{...abs(120,1007,650),display:'flex',gap:14,alignItems:'center',...enter(f,45)}}><kbd>Ctrl / ⌘</kbd><kbd>Shift</kbd><kbd>Space</kbd><span style={{fontSize:21,color:'#847681',marginLeft:10}}>随时唤起，统一确认</span></div>
    <Cursor f={f} start={287} x={1660} y={944}/>
  </AbsoluteFill>;
}

function Operation({ type, title, children, f, delay = 0, applied = false }) {
  return <div className={`operation ${type}`} style={enter(f,delay,25)}><div className="op-heading"><span><Icon type={type==='create'?'plus':type==='delete'?'trash':'edit'} size={20}/>{type==='create'?'新建事项':type==='delete'?'删除事项':'修改建议'}</span><small>{applied?'已应用':'等待确认'}</small></div><b>{title}</b><div className="op-details">{children}</div></div>;
}
function Agent() {
  const f=useCurrentFrame(); const phase2=f>=178, confirm1=f>=143, confirm2=f>=357;
  return <AbsoluteFill className="scene inverse"><Backdrop dark/><BrandLine dark chapter="03 / AGENT"/>
    <div style={abs(120,245,490)}><Eyebrow light>让助理，真正帮上忙</Eyebrow><h1 style={{fontSize:72,lineHeight:1.28,...enter(f,7)}}>能对话。<br/><span style={{color:'#e9aad2'}}>也能行动。</span></h1><p className="lead" style={{color:'#b9a9b7',...enter(f,22)}}>创建、编辑、删除。<br/>你说需求，LoNo 整理建议。</p><div className="agent-capabilities" style={enter(f,40)}>{['创建新事项','调整时间与内容','清理重复事项'].map((s,i)=><div key={s}><span>0{i+1}</span>{s}</div>)}</div></div>
    <div className="glass agent-window" style={{...abs(670,160,1130),...enter(f,15,65)}}>
      <div className="agent-title"><Logo size={43}/><b>LoNo Agent</b><span>● 已启用模型</span></div>
      <div className="agent-thread">
        <div className="user-bubble" style={enter(f,32)}>周五上午 10 点项目讨论，帮我记一下。</div>
        {!phase2?<>
          <div className="assistant-text" style={enter(f,61)}>已整理为一条提醒。确认后，加入你的安排。</div>
          <Operation type="create" title="参加项目讨论" f={f} delay={77} applied={confirm1}><div><span>开始时间</span><b>11 月 6 日 10:00</b></div><div><span>提醒时间</span><b>11 月 6 日 09:30</b></div></Operation>
          <div className="agent-action-footer" style={enter(f,96)}><small>{confirm1?'操作已保存':'1 项操作待确认'}</small><Button done={confirm1}>{confirm1?'已创建':'确认创建'}</Button></div>
          <Cursor f={f} start={111} x={1000} y={432}/>
        </>:<>
          <div className="applied-line"><Icon type="check" size={18}/> 已创建「参加项目讨论」</div>
          <div className="user-bubble" style={enter(f,178)}>改为提前 1 小时提醒，再删掉重复的报名事项。</div>
          <div className="assistant-text" style={enter(f,200)}>找到相关记录。以下两项变更，等你确认。</div>
          <div className="operations-grid"><Operation type="edit" title="参加项目讨论" f={f} delay={218} applied={confirm2}><div><span>提醒时间</span><b><s>09:30</s> → 09:00</b></div></Operation><Operation type="delete" title="重复的课程报名提醒" f={f} delay={231} applied={confirm2}><p>删除事项，保留原始消息<br/>与本次操作记录。</p></Operation></div>
          <div className="agent-action-footer" style={enter(f,249)}><small>{confirm2?'两项操作已保存':'2 项操作待确认'}</small><Button done={confirm2}>{confirm2?'已应用全部':'确认全部（含删除）'}</Button></div>
          <Cursor f={f} start={325} x={990} y={537}/>
        </>}
      </div>
      <div className="agent-input"><span>问问 LoNo，或告诉我你想改变什么…</span><div className="send"><Icon type="arrow" size={22}/></div></div>
    </div>
    <ChapterNote dark>先展示变更，再由你确认 · 支持逐条或批量应用</ChapterNote>
  </AbsoluteFill>;
}

function Review() {
  const f=useCurrentFrame(), transformed=ease(f,70), applied=f>=261;
  return <AbsoluteFill className="scene"><Backdrop/><BrandLine chapter="04 / UNDERSTAND"/>
    <div style={{...abs(120,150,1600),...enter(f)}}><Eyebrow>AI 整理</Eyebrow><h1 style={{fontSize:70,marginTop:14}}>不是照抄标题。<span className="berry">是读懂事情。</span></h1></div>
    <div className="glass original-mail" style={{...abs(120,345,660),...enter(f,15),transform:`perspective(1600px) rotateY(${transformed*6}deg)`}}><div className="source-head"><div className="icon-tile"><Icon type="mail"/></div><div><b>学院邮箱 · 原始信息</b><small>项目办公室 / 示例通知</small></div></div><h3>答复：关于项目阶段材料提交的补充通知</h3><p>请各项目组在 11 月 6 日 17:00 前提交阶段材料。电子版需包含成果概述与预算明细，并提前交由负责人审核。</p><p>材料请发送至项目办公室，逾期不予受理。</p><div className="mail-rule"/><div className="metadata"><Tag>原文保留</Tag><span>随时回看依据</span></div></div>
    <div style={{...abs(812,582,90),color:BERRY,opacity:transformed}}><Icon type="spark" size={53}/></div>
    <div className="glass review-result" style={{...abs(940,335,855),opacity:transformed,transform:`translateX(${(1-transformed)*100}px)`}}>
      <div className="preview-header"><div><Icon type="spark"/><b>AI 整理预览</b></div><Tag green={applied}>{applied?'已保存':'建议修改 3 项'}</Tag></div>
      <div className="review-title"><small>事项标题</small><s>答复：关于项目阶段材料提交的补充通知</s><b>审核并提交项目阶段材料</b></div>
      <div className="review-fields"><div><small>截止时间</small><b>11 月 6 日 17:00</b></div><div><small>提醒时间</small><b>11 月 5 日 09:00</b></div><div><small>重要程度</small><b className="priority">● 重要</b></div></div>
      <div className="summary"><b>重点已经为你提炼</b>{['提交成果概述与预算明细。','先由负责人审核，再发送至项目办公室。','提前一天准备，避免错过截止时间。'].map((t,i)=><div key={t} style={enter(f,111+i*17,12)}><span>0{i+1}</span>{t}</div>)}</div>
      <div className="preview-footer"><small>核对建议与原文</small><Button done={applied}>{applied?'修改已保存':'修改并保存'}</Button></div>
    </div>
    <Cursor f={f} start={229} x={1670} y={930}/>
    <ChapterNote>标题 · 时间 · 重要程度 · 摘要，一次整理</ChapterNote>
  </AbsoluteFill>;
}

function Memory() {
  const f=useCurrentFrame(), approved=f>=116;
  const flows=[{x:175,y:740,name:'邮件分析',icon:'mail',sub:'结合相关工作流程'}, {x:760,y:795,name:'快捷记录',icon:'spark',sub:'参考你的提醒偏好'}, {x:1345,y:740,name:'Agent 对话',icon:'chat',sub:'带着上下文继续协作'}];
  return <AbsoluteFill className="scene"><Backdrop/><BrandLine chapter="05 / REMEMBER"/>
    <div style={{...abs(0,145,1920),textAlign:'center',...enter(f)}}><Eyebrow>全局记忆</Eyebrow><h1 style={{fontSize:72,marginTop:12}}>记住事情。<span className="berry">也记住你的方式。</span></h1></div>
    <svg width="1920" height="1080" style={{position:'absolute'}}><g fill="none" stroke="#ba86a5" strokeWidth="1.5" opacity={ramp(f,120,60)*.7}><path d="M960 690Q960 725 365 740M960 690V795M960 690Q960 725 1535 740" strokeDasharray="6 8"/></g></svg>
    <div className="glass memory-core" style={{...abs(505,350,910),...enter(f,20)}}>
      <div className="source-head"><Logo size={55}/><div><b>值得记住</b><small>来自与你的对话</small></div><Tag green={approved}>{approved?'已确认 · 全局共享':'待你确认'}</Tag></div>
      <div style={{fontSize:30,margin:'30px 0',lineHeight:1.6}}>“重要会议请提前一天提醒我，<br/>材料提交前，先留出审核时间。”</div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{color:'#8b7a86',fontSize:20}}>由你确认、编辑，也能随时删除</span><Button done={approved}>{approved?'已记住':'确认记住'}</Button></div>
    </div>
    {flows.map((item,i)=><div key={item.name} className="glass memory-destination" style={{...abs(item.x,item.y,400),...enter(f,136+i*13)}}><div className="icon-tile"><Icon type={item.icon}/></div><b>{item.name}</b><small>{item.sub}</small></div>)}
    <Cursor f={f} start={84} x={1290} y={630}/>
    <ChapterNote>已确认的相关记忆，在不同入口中复用</ChapterNote>
  </AbsoluteFill>;
}

function AppWindow({ mac = false }) {
  return <div className="app-window">
    <div className="app-sidebar">{mac&&<div className="traffic"><i/><i/><i/></div>}<div className="app-brand"><Logo size={51}/><div><b>LoNo</b><small>Loop Notify</small></div></div><div className="app-new"><Icon type="plus" size={21}/>快速记录<span>{mac?'⌘':'Ctrl'} ⇧ ␣</span></div><small className="nav-label">我的提醒</small>{['提醒总览','今日安排','未来安排','已过期','待确认','已完成'].map((name,i)=><div className={`app-nav ${i===2?'selected':''}`} key={name}><Icon type={['grid','sun','clock','clock','clock','check'][i]} size={21}/>{name}{i===2&&<span>4</span>}</div>)}<small className="nav-label">管理</small>{['Agent 对话','全局记忆','信息来源','偏好设置'].map((name,i)=><div className="app-nav" key={name}><Icon type={['chat','grid','mail','layers'][i]} size={21}/>{name}</div>)}<div className="app-local"><i/>记录保存在此设备</div></div>
    <div className="app-workspace"><div className="app-top"><span>未来安排</span><span>11 月 3 日 星期二</span>{!mac&&<span className="win-controls">─　□　×</span>}</div><div className="app-body"><div className="app-heading"><div><h2>未来安排</h2><p>把未来的事，提前安排妥当。</p></div><div className="small-sync">⟳ 同步</div></div><div className="app-task-list"><div className="app-task-head"><b>我的提醒 <small>4 项</small></b><span>⌕　搜索事项</span></div>{courses.map(([date,title])=><div className="app-task" key={date}><div className="task-circle"/><div><b>{title}</b><div><Tag>快捷记录</Tag><Tag>AI 分析</Tag><span>{date} 14:30 · B401</span></div></div><span>● 普通　 →</span></div>)}</div><div className="app-bottom"><Icon type="lock" size={17}/> 本地记录 · 可连接你选择的模型服务</div></div></div>
  </div>;
}
function Platforms() {
  const f=useCurrentFrame(); const turn=ramp(f,99,27); const mac=f>=114;
  const angle=interpolate(turn,[0,.5,1],[-5,7,-3]);
  return <AbsoluteFill className="scene"><Backdrop/><BrandLine chapter="06 / YOUR DESKTOP"/>
    <div style={{...abs(105,165,440),...enter(f)}}><Eyebrow>同一个 LoNo</Eyebrow><h1 style={{fontSize:67,lineHeight:1.3}}>一份专注。<br/>随处延续。</h1><p className="lead">Windows 与 macOS<br/>各自熟悉的桌面体验。</p><div className="platform-badges"><span className={!mac?'active':''}>Windows</span><span className={mac?'active':''}>macOS</span></div><div className="platform-small"><Icon type="lock" size={20}/> 记录保存在各自设备</div></div>
    <div style={{...abs(610,220,1210),height:765,transform:`perspective(2000px) rotateY(${angle}deg) rotateX(3deg) translateY(${Math.sin(f/65)*5}px)`,...{opacity:ramp(f,8,25)}}}><AppWindow mac={mac}/></div>
    <ChapterNote>Windows 安装版 / 免安装版 · macOS Apple Silicon / Intel</ChapterNote>
  </AbsoluteFill>;
}
function Outro() {
  const f=useCurrentFrame();
  return <AbsoluteFill className="scene inverse"><Backdrop dark/><Loops f={f+100} dark large/>
    <div style={{...abs(0,205,1920),textAlign:'center',...enter(f,4,20)}}><div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:25}}><Logo size={112}/><span className="wordmark">LoNo</span></div><h1 style={{fontSize:77,margin:'47px 0 24px'}}>让每一件重要的事，都有着落。</h1><div style={{color:'#bca6b6',fontSize:26,letterSpacing:4}}>Loop Notify · 智能提醒，清晰行动</div><div className="outro-link">github.com/wangjt23/LoNo <Icon type="arrow" size={23}/></div><div style={{fontSize:19,color:'#9f8698',marginTop:28}}>v0.3.13　 /　 Windows + macOS　 /　 MIT</div></div>
    <div className="end-disclosure">功能动效演示 · 使用虚构数据 · AI 功能需配置模型服务</div>
  </AbsoluteFill>;
}

const components={intro:Intro,sources:Sources,capture:Capture,agent:Agent,review:Review,memory:Memory,platforms:Platforms,outro:Outro};
function TransitionScene({ id }) {
  const f=useCurrentFrame(); const Component=components[id];
  return <AbsoluteFill style={{opacity:ramp(f,0,14),transform:`scale(${interpolate(ramp(f,0,25),[0,1],[1.018,1])})`}}><Component/></AbsoluteFill>;
}
export function Showcase() {
  return <AbsoluteFill style={{background:'#1b111d'}}>
    <Audio src={staticFile('score.wav')} volume={.8}/>
    {chapters.map(ch=><Sequence key={ch.id} from={Math.round(ch.from*FPS)} durationInFrames={Math.round((ch.to-ch.from)*FPS)}><TransitionScene id={ch.id}/></Sequence>)}
  </AbsoluteFill>;
}

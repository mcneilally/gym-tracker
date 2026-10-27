'use strict';
// ===== Storage (hx_ keys only) =====
const K={days:'hx_days',wk:'hx_workouts',prof:'hx_profile',hr:'hx_hr'};
const ld=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}};
const sv=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
let DAYS=ld(K.days,{}),WK=ld(K.wk,[]),PROF=Object.assign({weight:96.5,bf:22,height:179,dobYear:1983,pb5k:'25:00'},ld(K.prof,{}));
const save=()=>{sv(K.days,DAYS);sv(K.wk,WK);sv(K.prof,PROF)};
const AGE=()=>new Date().getFullYear()-PROF.dobYear;
const MAXHR=()=>Math.round(208-0.7*AGE());

// ===== Parsing helpers =====
const MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
function parseDate(s){
  if(s==null||s==='')return null; if(typeof s==='number')return new Date(s>1e12?s:s*1000);
  s=String(s).trim().replace(/\u202f|\u00a0/g,' ');
  if(/^\d{4}-\d\d-\d\d/.test(s)){const d=new Date(s.replace(' ','T'));if(!isNaN(d))return d}
  let h=0,mi=0,se=0;const tm=s.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?/i);
  let ds=s;if(tm){h=+tm[1];mi=+tm[2];se=+(tm[3]||0);const ap=(tm[4]||'').toLowerCase();if(ap.startsWith('p')&&h<12)h+=12;if(ap.startsWith('a')&&h==12)h=0;ds=s.slice(0,tm.index)}
  ds=ds.replace(/\bat\b|,/gi,' ').trim();let y,m,d,mm;
  if(mm=ds.match(/(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})/i)){d=+mm[1];m=MON[mm[2].slice(0,4).toLowerCase()]??MON[mm[2].slice(0,3).toLowerCase()];y=+mm[3]}
  else if(mm=ds.match(/([a-z]{3,})\.?\s+(\d{1,2})\s+(\d{4})/i)){m=MON[mm[1].slice(0,3).toLowerCase()];d=+mm[2];y=+mm[3]}
  else if(mm=ds.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)){d=+mm[1];m=+mm[2]-1;y=+mm[3];if(y<100)y+=2000;if(m>11){[d,m]=[m+1,d-1]}}
  else if(/today/i.test(ds)||/yesterday/i.test(ds)){const t=new Date();if(/yesterday/i.test(ds))t.setDate(t.getDate()-1);y=t.getFullYear();m=t.getMonth();d=t.getDate()}
  else {const x=new Date(s);return isNaN(x)?null:x}
  if(m==null||isNaN(m))return null;return new Date(y,m,d,h,mi,se);
}
const num=v=>{if(typeof v==='number')return v;const m=String(v??'').replace(/,(?=\d{3}\b)/g,'').match(/-?\d+(?:[.,]\d+)?/);return m?parseFloat(m[0].replace(',','.')):NaN};
// duration: "45:12", "1:02:03", "45 min", "3600" (s)
function dur(v){if(typeof v==='number')return v;const s=String(v||'');let m;if(m=s.match(/^(\d+):(\d\d)(?::(\d\d))?$/))return m[3]!=null?(+m[1])*3600+(+m[2])*60+(+m[3]):(+m[1])*60+(+m[2]);
  let t=0;s.replace(/([\d.]+)\s*(h|hr|hour|m|min|minute|s|sec)/gi,(_,n,u)=>{u=u[0].toLowerCase();t+=n*(u=='h'?3600:u=='m'?60:1)});return t||num(s)}
const dkey=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
const splitList=v=>Array.isArray(v)?v:String(v??'').split(/\r?\n|;|\|/).map(x=>x.trim()).filter(Boolean);

// Parse "#key" sectioned text (what the Shortcut sends) or JSON → {key:[...]}
function parsePayload(raw){
  raw=String(raw||'').trim();if(!raw)return {};
  for(let i=0;i<2&&/%[0-9A-F]{2}/i.test(raw);i++){try{raw=decodeURIComponent(raw.replace(/\+/g,' '))}catch(e){break}}
  if(/^[A-Za-z0-9+/=_-]{40,}$/.test(raw)){try{raw=decodeURIComponent(escape(atob(raw.replace(/-/g,'+').replace(/_/g,'/'))))}catch(e){}}
  if(raw[0]=='{'){try{const o=JSON.parse(raw);if(o.days||o.workouts)return {__backup:o};const r={};for(const k in o)r[k.toLowerCase()]=splitList(o[k]);return r}catch(e){}}
  const r={};let cur=null;
  for(let line of raw.split(/\r?\n/)){line=line.trim();if(!line)continue;
    const m=line.match(/^#\s*([a-z0-9_]+)\s*[:=]?\s*(.*)$/i);
    if(m){cur=m[1].toLowerCase();r[cur]=r[cur]||[];if(m[2])r[cur].push(...m[2].split(/\s*;\s*/).filter(Boolean));}
    else if(cur)r[cur].push(line);}
  return r;
}
const pairs=(r,k,dk)=>{const v=r[k]||[],d=r[dk||k+'_d']||[];return v.map((x,i)=>({v:num(x),d:parseDate(d[i])})).filter(p=>!isNaN(p.v)&&p.d)};

function mergePayload(r){
  if(r.__backup){const o=r.__backup;Object.assign(DAYS,o.days||{});mergeWk(o.workouts||[]);if(o.profile)Object.assign(PROF,o.profile);save();return Object.keys(o.days||{}).length}
  const touched=new Set();const day=k=>(touched.add(k),DAYS[k]=DAYS[k]||{});
  const avgInto=(key,field,ok)=>{const g={};for(const p of pairs(r,key)){if(ok&&!ok(p.v))continue;(g[dkey(p.d)]=g[dkey(p.d)]||[]).push(p.v)}for(const k in g)day(k)[field]=+(g[k].reduce((a,b)=>a+b,0)/g[k].length).toFixed(1)};
  const minInto=(key,field)=>{const g={};for(const p of pairs(r,key)){const k=dkey(p.d);g[k]=Math.min(g[k]??1e9,p.v)}for(const k in g)day(k)[field]=g[k]};
  const sumInto=(key,field,mul=1)=>{const g={};for(const p of pairs(r,key)){const k=dkey(p.d);g[k]=(g[k]||0)+p.v*mul}for(const k in g)day(k)[field]=Math.round(g[k]*100)/100};
  avgInto('hrv','hrv',v=>v>5&&v<300);minInto('rhr','rhr');avgInto('rr','rr');avgInto('vo2','vo2');avgInto('whr','whr');
  sumInto('steps','steps');sumInto('kcal','kcal');sumInto('dist','km');
  for(const [k,f] of [['wt','weight'],['bf','bf'],['lbm','lbm']]){const ps=pairs(r,k).sort((a,b)=>a.d-b.d);for(const p of ps){let v=p.v;if(f=='bf'&&v<=1)v*=100;day(dkey(p.d))[f]=+v.toFixed(1)}if(ps.length&&f!='lbm')PROF[f]=+(f=='bf'&&ps.at(-1).v<=1?ps.at(-1).v*100:ps.at(-1).v).toFixed(1)}
  if(r.ht&&r.ht.length){let h=num(r.ht.at(-1));if(h<3)h*=100;if(h>100)PROF.height=Math.round(h)}
  // Sleep: values like "Core"/"Deep"/"REM"/"Asleep"/"In Bed"/"Awake" with start/end
  const sv_=r.sl||[],ss=r.sl_s||[],se=r.sl_e||[];const sg={};
  sv_.forEach((v,i)=>{const s=parseDate(ss[i]),e=parseDate(se[i]);if(!s||!e||e<=s)return;const h=(e-s)/36e5;if(h>16)return;
    const k=dkey(new Date(e.getTime()+0));const st=String(v).toLowerCase();const o=sg[k]=sg[k]||{inbed:0,asleep:0,core:0,deep:0,rem:0,awake:0,start:null,end:null,segs:[]};
    let t=/bed/.test(st)?'inbed':/deep/.test(st)?'deep':/rem/.test(st)?'rem':/core|light/.test(st)?'core':/awake/.test(st)?'awake':/asleep|unspec|sleep/.test(st)?'asleep':(num(v)===0?'inbed':num(v)===2?'awake':num(v)===3?'core':num(v)===4?'deep':num(v)===5?'rem':'asleep');
    const key=s.getTime()+'-'+e.getTime()+t;if(o.segs.includes(key))return;o.segs.push(key);o[t]+=h;
    if(t!='inbed'&&t!='awake'){o.start=o.start&&o.start<s?o.start:s;o.end=o.end&&o.end>e?o.end:e}});
  for(const k in sg){const o=sg[k];const staged=o.core+o.deep+o.rem;const asleep=staged>0?staged:o.asleep;if(!asleep)continue;
    const d=day(k);d.sleep=+asleep.toFixed(2);d.inbed=+(Math.max(o.inbed,asleep+o.awake)).toFixed(2);if(staged){d.deep=+o.deep.toFixed(2);d.rem=+o.rem.toFixed(2);d.core=+o.core.toFixed(2)}
    if(o.start){d.bed=o.start.getHours()+o.start.getMinutes()/60;d.wake=o.end.getHours()+o.end.getMinutes()/60}}
  // HR samples (optional, for zones)
  const hr=pairs(r,'hr').map(p=>[p.d.getTime(),p.v]);if(hr.length){const old=ld(K.hr,[]);const cut=Date.now()-60*864e5;const m=new Map(old.filter(x=>x[0]>cut).map(x=>[x[0],x[1]]));hr.forEach(x=>m.set(x[0],x[1]));sv(K.hr,[...m].sort((a,b)=>a[0]-b[0]))}
  // Workouts
  const wt=r.wk||[];const ws=[];wt.forEach((t,i)=>{const s=parseDate((r.wk_s||[])[i]);if(!s)return;let e=parseDate((r.wk_e||[])[i]);let sec=r.wk_dur?dur(r.wk_dur[i]):NaN;
    if(e&&isNaN(sec))sec=(e-s)/1000;if(!e&&!isNaN(sec))e=new Date(s.getTime()+sec*1000);if(!e||!(sec>0))return;
    let km=num((r.wk_km||[])[i]);const ku=String((r.wk_km||[])[i]||'');if(/\bm\b|metre|meter/i.test(ku)&&!/km/i.test(ku))km/=1000;if(/mi/i.test(ku)&&!/min/i.test(ku))km*=1.609;
    ws.push({type:String(t).trim(),start:s.getTime(),end:e.getTime(),sec:Math.round(sec),km:isNaN(km)||!km?null:+km.toFixed(2),kcal:num((r.wk_kcal||[])[i])||null,avg:num((r.wk_hr||[])[i])||null,max:num((r.wk_max||[])[i])||null})});
  mergeWk(ws);ws.forEach(w=>touched.add(dkey(w.start)));
  save();return touched.size;
}
function mergeWk(ws){for(const w of ws){const i=WK.findIndex(x=>Math.abs(x.start-w.start)<120000);if(i>=0)WK[i]=Object.assign(WK[i],w);else WK.push(w)}WK.sort((a,b)=>a.start-b.start)}

// ===== Scores (estimates) =====
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const keys=()=>Object.keys(DAYS).sort();
const addDays=(k,n)=>{const d=new Date(k+'T12:00');d.setDate(d.getDate()+n);return dkey(d)};
function base(field,k,n=30){const v=[];for(let i=1;i<=n;i++){const x=DAYS[addDays(k,-i)];if(x&&x[field]!=null)v.push(x[field])}return v.length?{m:v.reduce((a,b)=>a+b,0)/v.length,n:v.length}:null}
const kind=t=>{t=String(t||'').toLowerCase();return /run/.test(t)?'run':/walk|hik/.test(t)?'walk':/strength|weight|functional|core|cross|hiit|lift/.test(t)?'strength':'other'};
function hrZones(w){const hr=ld(K.hr,[]).filter(x=>x[0]>=w.start&&x[0]<=w.end);if(hr.length<3)return null;
  const rhr=(base('rhr',dkey(w.start),14)||{m:60}).m,mx=MAXHR(),z=[0,0,0,0,0];
  for(let i=0;i<hr.length;i++){const dt=i<hr.length-1?Math.min(60,(hr[i+1][0]-hr[i][0])/1000):5;const f=(hr[i][1]-rhr)/(mx-rhr);const zi=f<.6?0:f<.7?1:f<.8?2:f<.9?3:4;z[zi]+=dt}
  const avg=hr.reduce((a,b)=>a+b[1],0)/hr.length,max=Math.max(...hr.map(x=>x[1]));return {z,avg:Math.round(avg),max}}
function trimp(w){const rhr=(base('rhr',dkey(w.start),14)||{m:60}).m,mx=MAXHR();const zz=hrZones(w);const avg=w.avg||(zz&&zz.avg);
  if(avg){const f=clamp((avg-rhr)/(mx-rhr),0,1);return w.sec/60*f*0.64*Math.exp(1.92*f)}
  if(w.kcal)return w.kcal/4;return w.sec/60*({run:1.2,strength:.7,walk:.35,other:.6}[kind(w.type)])}
const strainOf=t=>+(21*(1-Math.exp(-t/190))).toFixed(1);
function dayStrain(k){const ws=WK.filter(w=>dkey(w.start)==k);let t=ws.reduce((a,w)=>a+trimp(w),0);const d=DAYS[k]||{};
  if(d.kcal){const wkK=ws.reduce((a,w)=>a+(w.kcal||0),0);t+=Math.max(0,d.kcal-wkK)/12}else if(d.steps)t+=d.steps/1500;
  return (ws.length||d.kcal||d.steps)?strainOf(t):null}
function sleepNeed(k){const s=dayStrain(addDays(k,-1))||0;return 8+Math.max(0,s-10)*0.08}
function sleepPerf(k){const d=DAYS[k];if(!d||!d.sleep)return null;return Math.round(clamp(d.sleep/sleepNeed(k)*100,0,100))}
function recovery(k){const d=DAYS[k];if(!d||d.hrv==null)return null;const hb=base('hrv',k);if(!hb||hb.n<3)return {cal:true};
  const parts=[[clamp(50+(d.hrv/hb.m-1)*200,0,100),.5]];const rb=base('rhr',k);if(d.rhr&&rb)parts.push([clamp(50-(d.rhr/rb.m-1)*400,0,100),.2]);
  const sp=sleepPerf(k);if(sp!=null)parts.push([sp,.2]);const qb=base('rr',k);if(d.rr&&qb)parts.push([clamp(50-(d.rr-qb.m)*40,0,100),.1]);
  const w=parts.reduce((a,p)=>a+p[1],0);return {v:Math.round(parts.reduce((a,p)=>a+p[0]*p[1],0)/w)}}
const recCol=v=>v>=67?'#16ec06':v>=34?'#ffde00':'#ff3b30';

// ===== Training plan tips =====
const PLAN=['Rest / walk','Push A (+leg extension)','Pull A (+leg curl)','Easy run','Push B (+leg press)','Pull B (+calf/hip thrust)','Easy run'];
const LEGDAY=[0,1,1,0,1,1,0];
function tip(k,rec){const dow=new Date(k+'T12:00').getDay(),tom=(dow+1)%7;const plan=PLAN[dow];const r=rec&&rec.v;let t='';
  if(r==null)t='Today: '+plan+'.';
  else if(r<34)t=LEGDAY[dow]?`Red. Do ${plan.split(' (')[0]} but drop a set. Keep the leg finisher very light.`:dow==0?'Red. Rest and walk today.':plan.includes('run')?'Red. Walk instead of run today.':'Red. Take it easy.';
  else if(r<67)t=`Yellow. ${plan}. Normal weights, no PB attempts.`;else t=`Green. ${plan}. Good day to push a bit.`;
  if(plan.includes('run')&&LEGDAY[tom])t+=' Keep the run short and easy: legs tomorrow.';
  const acwr=load().ratio;if(acwr>1.5)t+=' Load is ramping fast. Go easy.';return t}

// ===== Activities / running analysis =====
const pace=(sec,km)=>km?fmtT(sec/km):'–';
function fmtT(s){s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')}
const toSec=s=>{const p=String(s).split(':').map(Number);return p.length==3?p[0]*3600+p[1]*60+p[2]:p[0]*60+(p[1]||0)};
function load(){const now=Date.now();let a=0,c=0;for(const w of WK){const age=(now-w.start)/864e5;const t=trimp(w);if(age<=7)a+=t;if(age<=28)c+=t/4}
  const rk=(d0,d1)=>WK.filter(w=>kind(w.type)=='run'&&(now-w.start)/864e5>=d0&&(now-w.start)/864e5<d1).reduce((s,w)=>s+(w.km||0),0);
  const hist=WK.length&&(now-WK[0].start)/864e5>=21;return {acute:Math.round(a),chronic:Math.round(c),ratio:hist&&c>0?+(a/c).toFixed(2):null,km7:+rk(0,7).toFixed(1),km28:+(rk(0,28)/4).toFixed(1)}}
function runNote(w){const z=hrZones(w),avg=w.avg||(z&&z.avg),mx=MAXHR(),rhr=(base('rhr',dkey(w.start),14)||{m:60}).m;const n=[];
  if(w.km&&w.sec){const p=w.sec/w.km;n.push(`5K at this pace: ${fmtT(p*5)}.`)}
  if(avg){const f=(avg-rhr)/(mx-rhr);if(f<.7)n.push('Nice and easy. This builds your base.');else if(f<.8)n.push('Steady effort. Slow down a little for true easy runs.');else n.push('Hard effort. Keep most runs easier than this.')}
  const prev=WK.filter(x=>kind(x.type)=='run'&&x.start<w.start&&w.start-x.start<864e5*1.5);if(prev.length)n.push('Back-to-back run days. Watch the knee.');
  const dow=new Date(w.start).getDay();if(LEGDAY[(dow+1)%7])n.push('Leg work tomorrow, so keep it short.');return n.join(' ')}
function effTrend(){// pace per km at zone-2 HR (speed per heartbeat proxy)
  const mx=MAXHR();return WK.filter(w=>kind(w.type)=='run'&&w.km&&w.sec).map(w=>{const z=hrZones(w);const avg=w.avg||(z&&z.avg);if(!avg)return null;const rhr=(base('rhr',dkey(w.start),14)||{m:60}).m;
    const f=(avg-rhr)/(mx-rhr);// adjust pace to zone-2 midpoint (65% HRR) assuming ~2.5%/beat
    const z2hr=rhr+.65*(mx-rhr);const p=w.sec/w.km*(1+(avg-z2hr)*0.012);return {d:dkey(w.start),v:p,f}}).filter(Boolean)}
function est5k(){const rs=WK.filter(w=>kind(w.type)=='run'&&w.km>=2&&w.sec).slice(-10);if(!rs.length)return null;
  return Math.min(...rs.map(w=>{const t=w.sec*Math.pow(5/w.km,1.06);const z=hrZones(w);const avg=w.avg||(z&&z.avg);const f=avg?(avg-60)/(MAXHR()-60):.8;return t*clamp(1-(0.9-f)*0.35,.8,1)}))}

// ===== Body / ageing estimates =====
const VO2N=[[25,54.4],[35,49],[45,47.7],[55,42.6],[65,39],[75,35.2]];// NTNU/HUNT men average
function vo2Norm(a){if(a<=25)return 54.4;for(let i=1;i<VO2N.length;i++)if(a<=VO2N[i][0]){const[a0,v0]=VO2N[i-1],[a1,v1]=VO2N[i];return v0+(v1-v0)*(a-a0)/(a1-a0)}return 35.2}
function fitAge(v){for(let a=18;a<=90;a+=.5)if(vo2Norm(a)<=v)return Math.round(a);return 90}
function latest(f){const ks=keys();for(let i=ks.length-1;i>=0;i--)if(DAYS[ks[i]][f]!=null)return DAYS[ks[i]][f];return null}
function body(){const a=AGE(),w=latest('weight')??PROF.weight,bf=latest('bf')??PROF.bf,h=PROF.height;const lbm=latest('lbm')??w*(1-bf/100);
  const mif=10*w+6.25*h-5*a+5,km=370+21.6*lbm;const bmr=Math.round((mif+km)/2);
  const act=avgOf('kcal',14);const tdee=Math.round(bmr*1.1+(act??400));
  const metAge=Math.round(clamp(a+(mif-km)/20+(bf-20)*0.4,18,90));
  const vo2=latest('vo2');return {a,w,bf,h,lbm:+lbm.toFixed(1),bmi:+(w/(h/100)**2).toFixed(1),bmr,mif:Math.round(mif),km:Math.round(km),tdee,act,metAge,vo2,fit:vo2?fitAge(vo2):null}}
function avgOf(f,n){const ks=keys().slice(-n);const v=ks.map(k=>DAYS[k][f]).filter(x=>x!=null);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null}
function pace_(){const a=AGE(),f=[];const hrv=avgOf('hrv',30),rhr=avgOf('rhr',30),vo2=latest('vo2'),st=avgOf('steps',30);
  if(hrv)f.push(['HRV',clamp((70-0.6*a-hrv)/30,-.5,.5)]);if(rhr)f.push(['Resting HR',clamp((rhr-64)/20,-.5,.5)]);
  if(vo2)f.push(['VO2 max',clamp((vo2Norm(a)-vo2)/12,-.5,.5)]);if(st)f.push(['Steps',clamp((8000-st)/8000,-.5,.5)]);
  const beds=keys().slice(-14).map(k=>DAYS[k].bed).filter(x=>x!=null).map(x=>x<12?x+24:x);if(beds.length>=4){const m=beds.reduce((a,b)=>a+b,0)/beds.length;const sd=Math.sqrt(beds.reduce((s,x)=>s+(x-m)**2,0)/beds.length);f.push(['Sleep routine',clamp((sd-0.75)/1.5,-.5,.5)])}
  if(f.length<2)return null;return {v:+clamp(1+f.reduce((s,x)=>s+x[1],0)/f.length*1.4,0.4,2).toFixed(2),f}}

// ===== UI =====
const $=s=>document.querySelector(s);const V=$('#view');
function ring(pct,col,label,val,size=200,stroke=16){const r=(size-stroke)/2,c=2*Math.PI*r;const p=clamp(pct||0,0,1);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#222a33" stroke-width="${stroke}"/>
  <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c*p} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/>
  <text x="50%" y="48%" text-anchor="middle" fill="#fff" font-size="${size/5}" font-weight="700" dominant-baseline="middle">${val}</text>
  <text x="50%" y="68%" text-anchor="middle" fill="#8a96a3" font-size="${size/14}">${label}</text></svg>`}
function arrow(v,b,goodUp){if(v==null||!b)return '';const d=v-b.m;if(Math.abs(d)<b.m*0.03)return '<span class="flat">→</span>';const good=(d>0)==goodUp;return `<span class="${good?'up':'down'}">${d>0?'↑':'↓'}</span>`}
function chart(data,{col='#19b3ff',h=120,fmt=v=>Math.round(v),bars=false,colorFn}={}){if(!data.length)return '<div class="sub">No data yet</div>';
  const W=340,pad=24,vs=data.map(d=>d.v),mn=bars?0:Math.min(...vs),mx=Math.max(...vs),rg=(mx-mn)||1;const X=i=>pad+(data.length==1?0.5:i/(data.length-1))*(W-2*pad),Y=v=>h-18-(v-mn)/rg*(h-36);
  let s=`<svg viewBox="0 0 ${W} ${h}" width="100%">`;
  if(bars){const bw=(W-2*pad)/data.length*.7;data.forEach((d,i)=>{const x=pad+(i+.15)*(W-2*pad)/data.length;s+=`<rect x="${x}" y="${Y(d.v)}" width="${bw}" height="${h-18-Y(d.v)}" rx="3" fill="${colorFn?colorFn(d.v):col}"/>`})}
  else{s+=`<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${data.map((d,i)=>X(i)+','+Y(d.v)).join(' ')}"/>`;data.forEach((d,i)=>s+=`<circle cx="${X(i)}" cy="${Y(d.v)}" r="3" fill="${colorFn?colorFn(d.v):col}"/>`)}
  s+=`<text x="2" y="12" fill="#6c7783" font-size="11">${fmt(mx)}</text><text x="2" y="${h-20}" fill="#6c7783" font-size="11">${fmt(mn)}</text>`;
  s+=`<text x="${pad}" y="${h-3}" fill="#6c7783" font-size="10">${data[0].d.slice(5)}</text><text x="${W-pad}" y="${h-3}" fill="#6c7783" font-size="10" text-anchor="end">${data.at(-1).d.slice(5)}</text></svg>`;return s}
const EST='<div class="est">Estimates from your Apple Watch data. Not Whoop, not medical advice.</div>';
const hm=h=>h==null?'–':Math.floor(h)+'h '+String(Math.round(h%1*60)).padStart(2,'0')+'m';

function today(){const ks=keys();if(!ks.length)return V.innerHTML=`<h1>Health</h1><div class="card">No data yet.<br><br><button class="b" onclick="demo()">Load demo data</button><button class="b g" onclick="show('setup')">Set up the Shortcut</button></div>`;
  const k=ks.at(-1),d=DAYS[k],rec=recovery(k),st=dayStrain(k),sp=sleepPerf(k),hb=base('hrv',k),rb=base('rhr',k);
  const recV=rec&&rec.v!=null?rec.v:null;
  V.innerHTML=`<h1>${new Date(k+'T12:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</h1>
  <div class="card big" id="recRing">${rec&&rec.cal?ring(.15,'#6c7783','CALIBRATING','…'):ring(recV/100,recV!=null?recCol(recV):'#6c7783','RECOVERY',recV!=null?recV+'%':'–')}
  ${rec&&rec.cal?'<div class="sub">Needs ~4 days of HRV to set your baseline.</div>':''}</div>
  <div class="card tip" id="tip">${tip(k,rec)}</div>
  <div class="row"><div class="card big">${ring((st||0)/21,'#19b3ff','STRAIN',st!=null?st:'–',140,12)}</div>
  <div class="card big">${ring((sp||0)/100,'#a78bfa','SLEEP',sp!=null?sp+'%':'–',140,12)}<div class="sub">${hm(d.sleep)} / need ${hm(sleepNeed(k))}</div></div></div>
  <div class="row"><div class="card"><div class="ringlbl">HRV</div><div class="num">${d.hrv??'–'} ${arrow(d.hrv,hb,true)}</div><div class="sub">avg ${hb?Math.round(hb.m):'–'} ms</div></div>
  <div class="card"><div class="ringlbl">Resting HR</div><div class="num">${d.rhr??'–'} ${arrow(d.rhr,rb,false)}</div><div class="sub">avg ${rb?Math.round(rb.m):'–'} bpm</div></div></div>
  <div class="row"><div class="card"><div class="ringlbl">Steps</div><div class="num">${d.steps!=null?Math.round(d.steps).toLocaleString():'–'}</div></div>
  <div class="card"><div class="ringlbl">Active kcal</div><div class="num">${d.kcal!=null?Math.round(d.kcal):'–'}</div></div></div>
  ${d.deep!=null?`<div class="card sub">Deep ${hm(d.deep)} · REM ${hm(d.rem)} · Core ${hm(d.core)} · In bed ${hm(d.inbed)}</div>`:''}${EST}`}
function series(f,n,fn){return keys().slice(-n).map(k=>({d:k,v:fn?fn(k):DAYS[k][f]})).filter(x=>x.v!=null&&!isNaN(x.v))}
let trN=7;
function trends(){const n=trN;const rc=series(null,n,k=>{const r=recovery(k);return r&&r.v!=null?r.v:null});
  V.innerHTML=`<h1>Trends</h1><div class="row" style="margin-bottom:10px"><button class="b ${n==7?'':'g'}" onclick="trN=7;trends()">7 days</button><button class="b ${n==30?'':'g'}" onclick="trN=30;trends()">30 days</button></div>
  <h2>Recovery %</h2><div class="card">${chart(rc,{bars:true,colorFn:recCol})}</div>
  <h2>HRV (ms)</h2><div class="card">${chart(series('hrv',n),{col:'#16ec06'})}</div>
  <h2>Resting HR</h2><div class="card">${chart(series('rhr',n),{col:'#ff6b6b'})}</div>
  <h2>Strain</h2><div class="card">${chart(series(null,n,dayStrain),{bars:true,fmt:v=>v.toFixed(1)})}</div>
  <h2>Sleep (hours)</h2><div class="card">${chart(series('sleep',n),{bars:true,col:'#a78bfa',fmt:v=>v.toFixed(1)})}</div>
  <h2>Weight (kg)</h2><div class="card">${chart(series('weight',n*3),{col:'#ffde00',fmt:v=>v.toFixed(1)})}</div>${EST}`}
function activities(){const L=load(),e5=est5k(),eff=effTrend();const ws=WK.slice().reverse().slice(0,40);
  const warn=L.ratio>1.5?'<div class="card tip" style="border-color:#ff3b30">Load is up fast vs your usual. Ease off to protect the knee.</div>':L.ratio>1.3?'<div class="card tip" style="border-color:#ffde00">Load is creeping up. Keep the next run easy.</div>':'';
  V.innerHTML=`<h1>Activities</h1>${warn}
  <div class="row"><div class="card"><div class="ringlbl">Run km 7d</div><div class="num">${L.km7}</div><div class="sub">usual ${L.km28}/wk</div></div>
  <div class="card"><div class="ringlbl">Load</div><div class="num">${L.ratio??'–'}</div><div class="sub">week vs month. Aim 0.8–1.3</div></div></div>
  <div class="card"><div class="ringlbl">5K estimate</div><div class="num">${e5?fmtT(e5):'–'}</div><div class="sub">PB ${PROF.pb5k}. Goal: easy (zone 2) 5K under 30:00${eff.length?' · now ~'+fmtT(eff.at(-1).v*5):''}</div></div>
  <h2>Easy pace at same HR (lower is fitter)</h2><div class="card">${chart(eff.map(x=>({d:x.d,v:x.v})),{col:'#16ec06',fmt:fmtT})}</div>
  <h2>Log</h2>${ws.map(w=>{const z=hrZones(w),k=kind(w.type),avg=w.avg||(z&&z.avg),mx=w.max||(z&&z.max);const tz=z?z.z.reduce((a,b)=>a+b,0):0;
    return `<div class="card"><div class="kv"><b>${{run:'🏃',walk:'🚶',strength:'🏋️',other:'⚡'}[k]} ${w.type}</b><span class="sub">${new Date(w.start).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</span></div>
    <div class="sub">${fmtT(w.sec)}${w.km?` · ${w.km} km · ${pace(w.sec,w.km)}/km`:''}${avg?` · avg ${avg}`:''}${mx?` / max ${mx} bpm`:''} · strain ${strainOf(trimp(w))}</div>
    ${z?`<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin:8px 0">${z.z.map((s,i)=>`<div style="width:${s/tz*100}%;background:${['#4b5563','#19b3ff','#16ec06','#ffde00','#ff3b30'][i]}"></div>`).join('')}</div><div class="sub">Zones 1–5: ${z.z.map(s=>Math.round(s/60)+'m').join(' · ')}</div>`:''}
    ${k=='run'?`<div style="margin-top:6px">${runNote(w)}</div>`:''}</div>`}).join('')||'<div class="card sub">No workouts yet.</div>'}${EST}`}
function bodyV(){const b=body(),p=pace_();
  V.innerHTML=`<h1>Body</h1>
  <div class="row"><div class="card"><div class="ringlbl">Metabolic age</div><div class="num">${b.metAge}</div><div class="sub">you are ${b.a}</div></div>
  <div class="card"><div class="ringlbl">Fitness age</div><div class="num">${b.fit??'–'}</div><div class="sub">${b.vo2?'VO2 max '+b.vo2:'needs VO2 max'}</div></div></div>
  <div class="card"><div class="ringlbl">Pace of ageing</div><div class="num" style="color:${p?(p.v<0.9?'#16ec06':p.v<=1.1?'#ffde00':'#ff3b30'):'#fff'}">${p?p.v+'x':'–'}</div>
  <div class="sub">${p?(p.v<1?'Ageing slower than average. Keep it up.':p.v<=1.1?'About average.':'Faster than average. Sleep, steps and easy cardio help most.'):'Needs more data.'}</div>
  ${p?p.f.map(f=>`<div class="kv"><span>${f[0]}</span><span class="${f[1]<0?'up':f[1]>0.1?'down':'flat'}">${f[1]<0?'better than avg':f[1]>0.1?'worse than avg':'average'}</span></div>`).join(''):''}</div>
  <div class="card">${[['Weight',b.w+' kg'],['Body fat',b.bf+' %'],['Lean mass',b.lbm+' kg'],['BMI',b.bmi],['BMR',b.bmr+' kcal'],['Daily burn (TDEE)',b.tdee+' kcal'],['Fat loss target',(b.tdee-500)+' kcal/day']].map(x=>`<div class="kv"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>
  <h2>Manual (if no watch data)</h2><div class="card">
  <label class="sub">Weight kg</label><input id="pw" inputmode="decimal" value="${PROF.weight}"><label class="sub">Body fat %</label><input id="pb" inputmode="decimal" value="${PROF.bf}">
  <label class="sub">Height cm</label><input id="ph" inputmode="numeric" value="${PROF.height}"><label class="sub">Birth year</label><input id="py" inputmode="numeric" value="${PROF.dobYear}">
  <label class="sub">5K PB (mm:ss)</label><input id="p5" value="${PROF.pb5k}"><button class="b" onclick="saveProf()">Save</button></div>
  <h2>Weight trend</h2><div class="card">${chart(series('weight',90),{col:'#ffde00',fmt:v=>v.toFixed(1)})}</div>
  <h2>Body fat trend</h2><div class="card">${chart(series('bf',90),{col:'#ff9f43',fmt:v=>v.toFixed(1)})}</div>
  <div class="est">Metabolic age compares your lean-mass BMR to an average man. Fitness age uses NTNU VO2 max norms. All rough estimates.</div>`}
function saveProf(){const w=num($('#pw').value),bf=num($('#pb').value),h=num($('#ph').value),y=num($('#py').value);Object.assign(PROF,{weight:w||PROF.weight,bf:bf||PROF.bf,height:h||PROF.height,dobYear:y||PROF.dobYear,pb5k:$('#p5').value||PROF.pb5k});
  const k=dkey(new Date());DAYS[k]=DAYS[k]||{};if(w)DAYS[k].weight=w;if(bf)DAYS[k].bf=bf;save();toast('Saved');bodyV()}
const SETUP=[['hrv','Heart Rate Variability'],['rhr','Resting Heart Rate'],['rr','Respiratory Rate'],['vo2','Cardio Fitness (VO2 max)'],['whr','Walking Heart Rate Average'],['wt','Weight (Body Mass)'],['bf','Body Fat Percentage'],['lbm','Lean Body Mass']];
function setup(){V.innerHTML=`<h1>Shortcut setup</h1><div class="card">Takes ~15 min once. Then one tap each morning.</div>
  <h2>1. Find the data</h2><div class="card"><ol>
  <li>Open <b>Shortcuts</b> → <b>+</b>. Name it <b>Health Sync</b>.</li>
  <li>Add <b>Find Health Samples</b>. Tap <i>Type</i> → <b>Heart Rate Variability</b>. Add filter <b>Start Date</b> <i>is in the last</i> <b>2 days</b>.</li>
  <li>Long-press it → <b>Duplicate</b>. Change the Type. Do this for:<br>${SETUP.slice(1).map(s=>'• '+s[1]).join('<br>')}<br>• <b>Sleep Analysis</b><br>• <b>Steps</b>, <b>Active Energy</b> and <b>Walking + Running Distance</b>: set <i>Group By</i> → <b>Day</b><br>• <b>Workouts</b><br>• <b>Height</b> (no date filter, Limit 1)<br>• Optional: <b>Heart Rate</b> (for run zones; makes it slower)</li></ol></div>
  <h2>2. One Text block</h2><div class="card"><ol start="4">
  <li>Add <b>Text</b>. Type the lines below. Where it says <code>[HRV › Value]</code>, tap the variable bar, pick that Find step, then tap it and choose <b>Value</b> (or Start Date etc).</li></ol>
  <textarea rows="14" readonly>${TEMPLATE}</textarea></div>
  <h2>3. Send it</h2><div class="card"><ol start="5"><li>Add <b>URL Encode</b> (input: Text).</li>
  <li>Add <b>Text</b>: <code>${location.origin+location.pathname}#import=</code> then the <b>URL Encoded Text</b> variable.</li>
  <li>Add <b>Open URLs</b>. Run it once. Allow Health access. Tap <b>Allow</b> on any prompts.</li>
  <li>Every morning: <b>Automation</b> tab → <b>+</b> → <b>Time of Day</b> 7:00 → <b>Run Immediately</b> → Health Sync. iOS may still ask to open the link, tap it.</li></ol></div>
  <div class="card sub">Missing a metric? Just leave those lines out. Lists can be in any order; dates in any normal format.</div>`}
const TEMPLATE=`#hrv
[HRV › Value]
#hrv_d
[HRV › Start Date]
#rhr
[Resting HR › Value]
#rhr_d
[Resting HR › Start Date]
#rr  (Respiratory Rate, same as above)
#rr_d
#vo2  (Cardio Fitness)
#vo2_d
#whr  (Walking HR Average)
#whr_d
#wt  (Weight)
#wt_d
#bf  (Body Fat %)
#bf_d
#lbm  (Lean Body Mass)
#lbm_d
#steps
[Steps › Value]
#steps_d
[Steps › Start Date]
#kcal  (Active Energy)
#kcal_d
#dist  (Walking+Running Distance)
#dist_d
#ht
[Height › Value]
#sl
[Sleep › Value]
#sl_s
[Sleep › Start Date]
#sl_e
[Sleep › End Date]
#wk
[Workouts › Type]
#wk_s
[Workouts › Start Date]
#wk_e
[Workouts › End Date]
#wk_km
[Workouts › Distance]
#wk_kcal
[Workouts › Energy]
#wk_hr
[Workouts › Avg Heart Rate]
#hr  (optional)
[Heart Rate › Value]
#hr_d
[Heart Rate › Start Date]`.replace(/  \(.*\)/g,'');
function dataV(){V.innerHTML=`<h1>Data</h1><div class="card"><div class="sub">${keys().length} days · ${WK.length} workouts</div>
  <h2>Paste import</h2><textarea id="paste" rows="6" placeholder="Paste Shortcut text, a URL or a backup"></textarea><button class="b" onclick="imp($('#paste').value.replace(/^.*#import=/s,''))">Import</button>
  <h2>Backup</h2><button class="b g" onclick="exportJ()">Export backup (JSON)</button><button class="b g" onclick="demo()">Load demo data</button>
  <button class="b g" style="color:#ff6b6b" onclick="if(confirm('Delete all health data?')){['hx_days','hx_workouts','hx_hr'].forEach(k=>localStorage.removeItem(k));DAYS={};WK=[];show('today')}">Clear data</button></div>`}
function exportJ(){const s=JSON.stringify({days:DAYS,workouts:WK,profile:PROF});const b=new Blob([s],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='health-backup-'+dkey(new Date())+'.json';a.click();
  if(navigator.clipboard)navigator.clipboard.writeText(s).catch(()=>{});toast('Exported')}
function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',2500)}
function imp(raw){try{const n=mergePayload(parsePayload(raw));toast(n?`Synced ✓ ${n} day${n>1?'s':''}`:'Nothing found');show('today');return n}catch(e){console.error(e);toast('Import failed')}}
const VIEWS={today,trends,body:bodyV,acts:activities,setup,data:dataV};let cur='today';
function show(t){cur=t;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.t==t));VIEWS[t]();scrollTo(0,0)}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.t));
function checkHash(){const h=location.hash;const m=h.match(/^#import=(.*)$/s);if(m){history.replaceState(null,'',location.pathname);imp(m[1])}}
window.addEventListener('hashchange',checkHash);

// ===== Demo data (35 days) =====
function demo(){const now=new Date();let seed=7;const rnd=()=>(seed=(seed*9301+49297)%233280)/233280;const L={};const add=(k,v,d)=>{(L[k]=L[k]||[]).push(String(v));(L[k+'_d']=L[k+'_d']||[]).push(d)};
  const fmt=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+' at '+d.toTimeString().slice(0,5);
  L.sl=[];L.sl_s=[];L.sl_e=[];L.wk=[];L.wk_s=[];L.wk_e=[];L.wk_km=[];L.wk_hr=[];L.wk_kcal=[];
  for(let i=34;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);d.setHours(6,30,0,0);const tr=(34-i)/34;
    add('hrv',Math.round(38+tr*6+rnd()*14-(i==0?0:0))+' ms',fmt(d));add('rhr',Math.round(60-tr*2+rnd()*5),fmt(d));add('rr',(15+rnd()).toFixed(1),fmt(d));
    add('steps',Math.round(6000+rnd()*6000),fmt(d));add('kcal',Math.round(450+rnd()*400),fmt(d));if(i%7==0){add('wt',(97.6-tr*1.1+rnd()*.3).toFixed(1),fmt(d));add('bf',(22.6-tr*.6).toFixed(1),fmt(d))}
    if(i%10==0)add('vo2',(37.5+tr*1.5).toFixed(1),fmt(d));
    const bed=new Date(d);bed.setDate(bed.getDate()-1);bed.setHours(22,30+Math.round(rnd()*40),0);let t=bed.getTime();
    for(const [st,m] of [['Core',90],['Deep',50],['Core',60],['REM',45],['Core',70],['Deep',25],['REM',50],['Core',20+rnd()*40]]){const e=t+m*6e4;L.sl.push(st);L.sl_s.push(fmt(new Date(t)));L.sl_e.push(fmt(new Date(e)));t=e}
    const dow=d.getDay(),ws=new Date(d);ws.setHours(7,15,0,0);
    if([1,2,4,5].includes(dow)){const we=new Date(ws.getTime()+(55+rnd()*15)*6e4);L.wk.push('Traditional Strength Training');L.wk_s.push(fmt(ws));L.wk_e.push(fmt(we));L.wk_km.push('0 km');L.wk_hr.push(Math.round(108+rnd()*12));L.wk_kcal.push(Math.round(320+rnd()*80))}
    if([3,6].includes(dow)){const km=4+rnd()*2.5,p=(395-tr*20+rnd()*20);const we=new Date(ws.getTime()+km*p*1000);L.wk.push('Running');L.wk_s.push(fmt(ws));L.wk_e.push(fmt(we));L.wk_km.push(km.toFixed(2)+' km');L.wk_hr.push(Math.round(140+rnd()*10));L.wk_kcal.push(Math.round(km*95))}}
  L.ht=['179 cm'];const txt=Object.entries(L).map(([k,v])=>'#'+k+'\n'+v.join('\n')).join('\n');imp(txt)}

// Nav: add Activities tab label
(function(){const n=$('#tabs');const b=document.createElement('button');b.dataset.t='acts';b.textContent='Activity';b.onclick=()=>show('acts');n.insertBefore(b,n.children[2])})();
show('today');checkHash();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js',{scope:'./'}).catch(()=>{});

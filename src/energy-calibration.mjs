// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
// Candidate screening of public longitudinal behaviour. Thermal/electric split
// is not identifiable; never use these scores to claim calibrated SOC accuracy.
export const CALIBRATION_VERSION='2.0';
const med=xs=>{const a=xs.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[a.length>>1]:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const key=p=>[Math.min(23,Math.floor(p[0]*24)),p[2],Math.floor(p[1]/20),p[3]<40?0:p[3]<95?1:2,[10,12,14].includes(p[5])?1:0].join('|');
export function candidateMass(parameters,lapIndex=0){return Math.max(parameters.massKg-60,parameters.massKg-parameters.fuelKgPerLap*Math.max(0,lapIndex));}
export function longitudinalPower(p,parameters,lapIndex=0){const v=p[1]/3.6,m=candidateMass(parameters,lapIndex);return (m*v*p[6]+.6*parameters.dragArea*v**3+.015*m*9.81*v)/940;}
export function candidateAcceleration(p,parameters,power,lapIndex=0){const v=Math.max(5,p[1]/3.6),m=candidateMass(parameters,lapIndex);return (power*940-.6*parameters.dragArea*v**3-.015*m*9.81*v)/(m*v);}
function rows(runs){return runs.flatMap(r=>r.laps.map((l,index)=>({...l,runIndex:index})));}
export function calibrateParameters(training,heldOut,{year=2026}={}){
 const train=rows(training),test=rows(heldOut),candidates=[];
 if(!train.length||!test.length)return {available:false,version:CALIBRATION_VERSION,reason:'insufficient-whole-runs',candidates:[],selected:[],energyIdentified:false};
 for(const massKg of [790,835,890])for(const dragArea of [.8,1.1,1.4])for(const fuelKgPerLap of [0,1.5]){
  const parameters={massKg,dragArea,fuelKgPerLap},cells={},all=[];
  for(const l of train)for(const p of l.points){if(p[4]!==0||p[3]<20)continue;const power=longitudinalPower(p,parameters,l.runIndex);(cells[key(p)]??=[]).push(power);all.push(power)}
  const reference=Object.fromEntries(Object.entries(cells).filter(([,a])=>a.length>=4).map(([k,a])=>[k,med(a)])),errors=[],validationErrors=[];let impossible=0,count=0,matched=0;
  for(const l of train)for(const p of l.points){const power=reference[key(p)];if(!Number.isFinite(power))continue;errors.push(Math.abs(candidateAcceleration(p,parameters,power,l.runIndex)-p[6]));count++;if(power>460*Math.pow(p[3]/100,1.35)+(year>=2026?350:120)+25||power< -350)impossible++}
  for(const l of test)for(const p of l.points){const power=reference[key(p)];if(!Number.isFinite(power))continue;matched++;validationErrors.push(Math.abs(candidateAcceleration(p,parameters,power,l.runIndex)-p[6]))}
  const high=all.filter(v=>v>0).sort((a,b)=>a-b),p90=high[Math.floor(high.length*.9)]??0;
  // ICE, recovery efficiency and harvested fraction remain explicit alternatives.
  candidates.push({...parameters,id:`${massKg}/${dragArea}/${fuelKgPerLap}`,trainError:med(errors),validationError:med(validationErrors),matched,coverage:matched/Math.max(1,test.reduce((n,l)=>n+l.points.length,0)),infeasibleFraction:count?impossible/count:1,p90,reference});
 }
 const ranked=candidates.filter(c=>c.matched>=30&&c.coverage>=.4&&c.infeasibleFraction<=.1&&Number.isFinite(c.trainError)).sort((a,b)=>a.trainError-b.trainError||a.massKg-b.massKg||a.dragArea-b.dragArea),best=ranked[0]?.trainError;
 // Selection uses training scores. Later runs only accept/reject the shortlist.
 const short=ranked.filter(c=>c.trainError<=best+.15),diverse=[];
 for(const mass of [790,835,890]){const c=short.find(x=>x.massKg===mass);if(c)diverse.push(c)}
 for(const c of short)if(diverse.length<6&&!diverse.includes(c))diverse.push(c);
 const selected=diverse.filter(c=>c.validationError<=Math.max(.5,c.trainError*1.5+.15)).map((c,i)=>({...c,iceKW:clamp(c.p90*[.55,.7,.85][i%3],300,470),iceShare:[.45,.6,.75][i%3],harvestShare:[.25,.4,.55][i%3],weight:1}));
 const available=selected.length>=3;
 return {version:CALIBRATION_VERSION,available,reason:available?'multiple-feasible-candidates':'candidate-validation-insufficient',energyIdentified:false,candidateCount:candidates.length,selected:available?selected.map(({reference,...c})=>c):[],candidates:candidates.map(({reference,...c})=>c),validation:{method:'training shortlist; later whole-run rejection; median absolute acceleration error',matched:selected[0]?.matched||0},note:'Candidate agreement is not identification of mass, drag, ICE or SOC. Fuel burn is a run-relative nuisance scenario.'};
}
export function buildSegmentProfile(training){
 const laps=rows(training),segments=[];
 for(let i=0;i<24;i++){
  const points=laps.flatMap(l=>(l.profilePoints||l.points).filter(p=>Math.min(23,Math.floor(p[0]*24))===i));
  if(points.length<4){segments.push(null);continue}
  const speed=med(points.map(p=>p[1])),acceleration=med(points.map(p=>p[6])),throttle=med(points.map(p=>p[3])),distance=med(laps.map(l=>l.distance));
  segments.push({index:i,speed,acceleration,throttle,braking:points.filter(p=>p[4]===100).length/points.length,duration:clamp(distance/24/Math.max(8,speed/3.6),.3,15),samples:points.length});
 }
 const coverage=segments.filter(Boolean).length/24;
 return {available:coverage>=.8,coverage,segments,trackDistance:med(laps.map(l=>l.distance)),lapSeconds:med(laps.map(l=>l.duration)),source:'training-runs-only',reason:coverage>=.8?'ready':'segment-coverage-insufficient'};
}

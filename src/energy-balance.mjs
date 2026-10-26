// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
import {POWER_ASSUMPTIONS,storePower} from './power-domains.mjs';
import {stewardsMessage} from './event-filter.mjs';
import {candidateMass} from './energy-calibration.mjs';
// A scenario observer, not a measurement of the team's battery or engine map.
// Positive P_K discharges the store; negative P_K charges it. E is bounded
// inside the regulatory usable window, not the pack's chemical capacity.
import {practicePrediction} from './practice-fit.mjs';
const ebClamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const ENERGY_BALANCE_METHOD={
 version:'0.5',equation:'dE/dt = −P_K/η_discharge (deploy); −P_K·η_charge (harvest)',
 sources:[['FIA 2026 Technical Regulations','https://www.fia.com/regulation/category/110'],['Hybrid power-unit optimisation thesis','https://unitesi.unimore.it/handle/20.500.14251/3760'],['F1 energy management research','https://arxiv.org/abs/2405.11032']],
 assumptions:'暖胎圈起点设为可用能量窗口100%；质量、阻力、内燃机功率、回收比例与效率均为模型假设，未取得车队参数。正赛与冲刺赛使用能量余量反馈的功率分配先验；绿旗储备与SC/VSC回充偏好为未标定假设，非论文给出的真实SOC目标。'
};
export function energyLimits(year,policy={}){const base=year>=2027?{windowMJ:4.5,deployKW:300,harvestKW:375}:year>=2026?{windowMJ:4,deployKW:350,harvestKW:350}:{windowMJ:4,deployKW:120,harvestKW:120};return {...base,deployKW:Math.min(base.deployKW,policy.maxDeployKW??base.deployKW),harvestKW:Math.min(base.harvestKW,policy.maxHarvestKW??base.harvestKW)};}
export function modelMotorPower(p,old,year=2026,policy={},context={}){
 const limit=energyLimits(year,policy),dt=(p.time-old.time)/1000;
 if(dt<=0||dt>2||![p.speed,old.speed,p.throttle,p.brake,p.n_gear].every(Number.isFinite))return null;
 const v=Math.max(0,(p.speed+old.speed)/7.2),a=(p.speed-old.speed)/3.6/dt;
 if(v<2)return {kw:0,low:0,high:0,state:'IDLE'};
 const params=policy.scenarioParameters||{},mass=Number.isFinite(params.fuelKgPerLap)?candidateMass(params,context.runLapIndex??0):params.massKg??(year>=2026?825:850),rho=1.2,cdA=params.dragArea??(year<2026&&[10,12,14].includes(p.drs)?.85:1.1),harvestShare=params.harvestShare??.35;
 const wheel=(mass*v*a+.5*rho*cdA*v*v*v+.015*mass*9.81*v)/1000;
 // Reject a demand outside this uncalibrated model's plausible envelope.
 // This is a data-quality check, not a claimed regulatory ICE power limit.
 if(p.brake===0&&wheel>900)return null;
 let kw,state;
 if(p.brake===100){kw=-Math.min(limit.harvestKW,Math.max(0,-mass*v*a/1000)*harvestShare);state='HARVEST_POSSIBLE';}
 else if(p.throttle<20&&a<-.1){kw=-Math.min(limit.harvestKW,Math.max(0,-wheel)*harvestShare);state='HARVEST_POSSIBLE';}
 else if(p.throttle>=20){
  const ice=(params.iceKW??(year>=2026?420:550))*Math.pow(p.throttle/100,1.35);
  const speedCap=year===2026?(p.speed<340?Math.min(350,1800-5*p.speed):p.speed<345?6900-20*p.speed:0):limit.deployKW;
  const fullHarvest=policy.fullThrottleHarvestKW??(year===2026&&p.time<Date.parse('2026-04-30T00:00:00Z')?250:limit.harvestKW);
  kw=ebClamp(wheel/POWER_ASSUMPTIONS.drivetrainCentral-ice,-Math.min(limit.harvestKW,p.throttle>=95?fullHarvest:limit.harvestKW),Math.max(0,Math.min(limit.deployKW,speedCap)));
  if(year>=2026&&/^(Race|Sprint)$/i.test(context.sessionName||'')&&Number.isFinite(context.soc)){
   // A regularised causal power-split prior, not a solved lap-time OCP or a
   // team ICE map. The old fixed-ICE residual implicitly charged whenever
   // demand fell below maximum ICE power, including many full-throttle turns.
   // Higher SOC makes electrical energy cheaper; low SOC favours recharge.
   // SC/VSC changes that preference only after an explicit race-control event.
   const neutralized=['SC','VSC'].includes(context.phase),target=neutralized?98:params.reserve??(/^Sprint$/i.test(context.sessionName)?40:50);
   const practice=context.practiceReference;
   const referencePower=practice?(mass*v*practice.acceleration+.5*rho*cdA*v**3+.015*mass*9.81*v)/940:null;
   // The training-only total-power reference shapes the allocation PRIOR.
   // Its thermal fraction remains an explicit scenario, never a learned label.
   const referenceICE=Number.isFinite(referencePower)&&referencePower>0?ebClamp(referencePower*(params.iceShare??.6),ice*.3,ice):ice*.68;
   const preferredICE=ebClamp(referenceICE+ice*.38*Math.tanh((target-context.soc)/22),ice*.3,ice);
   const demand=Math.max(0,wheel/POWER_ASSUMPTIONS.drivetrainCentral),deployCap=Math.max(0,Math.min(limit.deployKW,speedCap,demand));
   // Engine-driven recharge competes with fuel/lap-time cost. In green
   // running its nominal preference fades once reserve is available; braking
   // recovery is unaffected and can still bring the store all the way to full.
   const rechargePreference=neutralized?1:ebClamp((target-context.soc)/20,0,1);
   const harvestCap=Math.min(limit.harvestKW,p.throttle>=95?fullHarvest:limit.harvestKW,Math.max(0,ice-demand))*rechargePreference;
   kw=ebClamp(demand-preferredICE,-harvestCap,deployCap);
   // Do not manufacture an impossible ICE/electrical split to hide a demand
   // larger than both assumed supplies. Keep the reading unknown instead.
   if(demand>ice+deployCap+25)return null;
  }
  if(context.allocation&&Number.isFinite(context.allocation.kw)){const demand=Math.max(0,wheel/POWER_ASSUMPTIONS.drivetrainCentral),cap=Math.max(0,Math.min(limit.deployKW,speedCap,demand)),harvestCap=Math.min(limit.harvestKW,p.throttle>=95?fullHarvest:limit.harvestKW,Math.max(0,ice-demand));if(demand>ice+cap+25)return null;kw=ebClamp(context.allocation.kw,Math.max(-harvestCap,demand-ice),cap);}
  state=kw>20?'DEPLOY':kw< -20?(p.throttle>=95?'SUPER_CLIPPING':'HARVEST_POSSIBLE'):'NEUTRAL';
 }else{kw=0;state='NEUTRAL';}
 // The nominal ICE/drag split is unobserved. Shift transients and pre-2026
 // MGU-H transfers widen the envelope rather than becoming precise SOC.
 const uncertainty=p.brake===100?Math.max(25,Math.abs(kw)*.65):Math.max(year<2026?120:100,Math.abs(kw)*.65);
 return {kw,low:ebClamp(kw-uncertainty,-limit.harvestKW,limit.deployKW),high:ebClamp(kw+uncertainty,-limit.harvestKW,limit.deployKW),state:old.n_gear!==p.n_gear?'UNKNOWN':state,acceleration:a,wheelKW:wheel,managementPhase:context.phase||'GREEN'};
}
export function createEnergyBalance({year=2026,start,initialSoc=100,initialSocRange=[initialSoc,initialSoc],policy={},sessionName='',practiceModel=null,allocationProvider=null}={}){
 const lim=energyLimits(year,policy),capacity=lim.windowMJ*1000,initial=ebClamp(initialSoc,0,100)/100*capacity;
 let energy=initial,low=Math.min(initial,ebClamp(initialSocRange[0],0,100)/100*capacity),high=Math.max(initial,ebClamp(initialSocRange[1],0,100)/100*capacity),at=start,old=null,observed=0,missing=0,latest=null,lap=null,harvested=0;const recent=[];
 const batteryRate=storePower;
 function gap(seconds){if(seconds<=0)return;missing+=seconds;low=ebClamp(low-lim.deployKW/.94*seconds,0,capacity);high=ebClamp(high+lim.harvestKW*.85*seconds,0,capacity);}
 function ingest(p){if(!Number.isFinite(p.time)||p.time<start||Number.isFinite(at)&&p.time<=at)return false;
  if(p.lap_number!==undefined&&p.lap_number!==lap){lap=p.lap_number;harvested=0}
  const dt=(p.time-(old?.time??start))/1000;recent.push(p);while(recent.length>1&&recent[0].time<p.time-1600)recent.shift();const smoothed=recent.find(q=>q.time<=p.time-750)||old,power=old&&dt<=2?modelMotorPower(p,smoothed,year,policy,{sessionName,soc:energy/capacity*100,phase:old.energyPhase||'GREEN',practiceReference:practiceModel?.available?practicePrediction(practiceModel,p):null,runLapIndex:Math.max(0,(p.lap_number||1)-1),allocation:allocationProvider?.(p,energy/capacity*100,old.energyPhase||'GREEN')}):null;
  if(power){
   // Feasible store flux over this interval; never clip E then continue to
   // report deployment from an empty store or recharge into a full one.
   power.kw=ebClamp(power.kw,-(capacity-energy)/(.85*Math.max(dt,.001)),energy*.94/Math.max(dt,.001));
   if(Math.abs(power.kw)<1&&power.state!=='IDLE'&&power.state!=='UNKNOWN')power.state='NEUTRAL';
  }
  if(power&&power.kw<0&&Number.isFinite(policy.harvestPerLapMJ)&&lap!==null){const allowed=Math.max(0,policy.harvestPerLapMJ*1000-harvested);power.kw=-Math.min(-power.kw,allowed/Math.max(dt,.001));harvested+=-power.kw*dt;if(!allowed)power.state='NEUTRAL';}
  if(power){energy=ebClamp(energy-batteryRate(power.kw)*dt,0,capacity);low=ebClamp(Math.min(energy,low-batteryRate(power.high)*dt),0,capacity);high=ebClamp(Math.max(energy,high-batteryRate(power.low)*dt),0,capacity);observed+=dt;latest=power;}
  else{gap(dt);latest=null;}
  old=p;at=p.time;return true;
 }
 function snapshot(cursor=at){const tail=Math.max(0,(cursor-(at??start))/1000),lo=ebClamp(low-lim.deployKW/.94*tail,0,capacity),hi=ebClamp(high+lim.harvestKW*.85*tail,0,capacity),total=observed+missing+tail;
  return {measured:false,estimate:energy/capacity*100,low:lo/capacity*100,high:hi/capacity*100,initialSoc,sessionName,start,asOf:at,windowMJ:lim.windowMJ,observedSeconds:observed,missingSeconds:missing+tail,coverage:total?observed/total:1,state:tail>3?'UNKNOWN':latest?.state||'UNKNOWN',motorPower:tail>3?null:latest,managementPhase:old?.energyPhase||'GREEN',modelVersion:ENERGY_BALANCE_METHOD.version,assumed:true,policy,method:ENERGY_BALANCE_METHOD};
 }
 function exportState(){return {version:ENERGY_BALANCE_METHOD.version,year,start,initialSoc,energy,low,high,at,old,observed,missing,latest,lap,harvested,recent:[...recent]}}
 function restore(s){if(s?.version!==ENERGY_BALANCE_METHOD.version||s.year!==year||s.start!==start||![s.energy,s.low,s.high,s.at,s.observed,s.missing,s.harvested].every(Number.isFinite)||s.energy<0||s.energy>capacity||s.low<0||s.high>capacity||s.low>s.energy||s.high<s.energy)return false;({energy,low,high,at,old,observed,missing,latest,lap,harvested}=s);recent.splice(0,recent.length,...(s.recent||[]).slice(-12));return true}
 return {ingest,snapshot,exportState,restore};
}
// Explicit, timestamped state transitions only. A local yellow or pit-exit
// green must not change the global SC/VSC state. ENDING is still neutralized.
export function energyPhaseTimeline(messages=[]){
 const rows=[];for(const m of messages){const time=Date.parse(m.date||m.Utc||''),text=String(m.message||m.Message||'').toUpperCase(),flag=String(m.flag||m.Flag||'').toUpperCase(),scope=String(m.scope||m.Scope||'').toUpperCase();if(!Number.isFinite(time)||stewardsMessage(text))continue;let phase=null;
  if(/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/.test(text))phase='VSC';
  else if(/SAFETY CAR DEPLOYED/.test(text))phase='SC';
  else if(/VIRTUAL SAFETY CAR ENDED|VSC ENDED|SAFETY CAR WITHDRAWN/.test(text)||flag==='GREEN'&&scope==='TRACK'||/^(GREEN FLAG|TRACK CLEAR)$/.test(text))phase='GREEN';
  if(phase)rows.push({time,phase});
 }rows.sort((a,b)=>a.time-b.time);return time=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].time<=time)lo=mid+1;else hi=mid}return rows[lo-1]?.phase||'GREEN'};
}
export function formationAnchor(session,messages=[]){
 // A restart or extra formation lap continues the original energy ledger.
 // OpenF1 may omit the initial formation message and retain only the extra one.
 const firstInterruption=Math.min(Infinity,...messages.filter(m=>/^(?:RED FLAG|(?:RACE|SESSION) SUSPENDED)/i.test(m.message||m.Message||'')).map(m=>Date.parse(m.date||m.Utc)).filter(Number.isFinite));
 const marker=messages.filter(m=>{const text=String(m.message||m.Message||'');return /^(?:FORMATION LAP|FORMATION\s+START)/i.test(text)&&!/(?:EXTRA|ADDITIONAL|RESTART|RESUMPTION)/i.test(text)&&Date.parse(m.date||m.Utc)<firstInterruption}).map(m=>Date.parse(m.date||m.Utc)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
 const scheduled=energySessionStart(session);
 return {start:marker??scheduled,basis:marker?'赛会暖胎圈消息':'原定场次开始（暖胎圈时间未提供）'};
}
export function energySessionStart(session){const value=session?.date_start||session?.StartDate;if(typeof value!=='string')return NaN;if(/(?:Z|[+-]\d\d:\d\d)$/.test(value))return Date.parse(value);const m=String(session.GmtOffset||'').match(/^([+-]?)(\d\d):(\d\d)(?::(\d\d))?$/);if(!m)return NaN;const offset=(+m[2]*3600 + +m[3]*60 + +(m[4]||0))*1000*(m[1]==='-'?-1:1);return Date.parse(value+'Z')-offset;}

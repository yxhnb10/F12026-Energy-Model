// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
// A bounded, discrete energy-allocation surrogate. The objective approximates
// local time benefit and fuel/recharge cost; it is not a full vehicle OCP.
export const PLANNER_VERSION='1.0';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),caches=new WeakMap();
export function deploymentCap(speed,year,limit){return Math.max(0,Math.min(limit,year===2026?(speed<340?Math.min(350,1800-5*speed):speed<345?6900-20*speed:0):limit));}
export function segmentAllocation(profile,parameters,{year=2026,sessionName='Race',phase='GREEN',lapPhase='Flying Lap',intent='normal',remainingLaps=null,limits={windowMJ:4,deployKW:350,harvestKW:350},policy={}}={}){
 if(!profile?.available||!profile.segments?.length)return null;
 let cache=caches.get(profile);if(!cache)caches.set(profile,cache=new Map());
 const signature=JSON.stringify([parameters,year,sessionName,phase,lapPhase,intent,remainingLaps===1,limits,policy.harvestPerLapMJ,policy.fullThrottleHarvestKW]);if(cache.has(signature))return cache.get(signature);
 const capacity=limits.windowMJ*1000,bins=40,step=capacity/bins,qualifying=/qualifying/i.test(sessionName),prep=qualifying&&lapPhase!=='Flying Lap',neutral=['SC','VSC'].includes(phase),laps=qualifying?(prep?2:1):remainingLaps===1?1:2,n=24*laps,values=Array.from({length:n+1},()=>new Float64Array(bins+1)),actions=Array.from({length:n},()=>new Float64Array(bins+1));
 const plan=profile.segments.map(s=>{if(!s)return null;const v=Math.max(8,s.speed/3.6),mass=parameters.massKg,ice=parameters.iceKW*Math.pow(s.throttle/100,1.35),demand=Math.max(0,(mass*v*s.acceleration+.6*parameters.dragArea*v**3+.015*mass*9.81*v)/940),deploy=Math.min(deploymentCap(s.speed,year,limits.deployKW),demand),recover=s.braking>.3?Math.min(limits.harvestKW,Math.max(0,-mass*v*s.acceleration/1000)*parameters.harvestShare):Math.min(limits.harvestKW,Math.max(0,ice-demand),s.throttle>=95?policy.fullThrottleHarvestKW??limits.harvestKW:limits.harvestKW);
  const quotaPerSection=Number.isFinite(policy.harvestPerLapMJ)?policy.harvestPerLapMJ*1000/24/Math.max(.1,s.duration):limits.harvestKW;
  return {...s,mass,v,demand,ice,deploy,recover:Math.min(recover,quotaPerSection),min:Math.max(-recover,demand-ice),benefit:Math.min(.008,1000*(profile.trackDistance/24)/(mass*v**3))};});
 const openingNeed=plan.slice(0,6).reduce((e,s)=>e+(s?Math.max(0,s.demand-s.ice)*s.duration/.94-s.recover*s.duration*.85:0),0),reserve=neutral?capacity*.95:qualifying?0:clamp(openingNeed,0,capacity*.8),shadow=qualifying?.015:intent==='attack'?.08:intent==='save'?.8:.3;
 for(let b=0;b<=bins;b++){const e=b*step;values[n][b]=Math.max(0,reserve-e)/1000*3-e/1000*(neutral?2:shadow);}
 for(let j=n-1;j>=0;j--)for(let b=0;b<=bins;b++){
  const s=plan[j%24],e=b*step;if(!s){values[j][b]=values[j+1][b];continue}
  const preparation=prep&&j<24,choices=s.braking>.3?[-s.recover]:[Math.max(0,s.min),0,s.deploy*.25,s.deploy*.5,s.deploy,-s.recover*.5,-s.recover],cap=neutral||preparation?s.deploy*.25:s.deploy;let best=Infinity,action=0;
  for(const power of choices){if(power>cap+.01||power< -s.recover-.01||power<s.min-25)continue;const raw=e-(power>=0?power/.94:power*.85)*s.duration;if(raw<0||raw>capacity)continue;
   // Round energy down: never create usable energy through state quantisation.
   const next=Math.max(0,Math.min(bins,Math.floor((raw+1e-8)/step))),consumed=power*s.duration/1000,timeGain=power>0?Math.log1p(consumed)*s.benefit*1000:0,rechargeCost=power<0?-consumed*.35:0,effort=(neutral||preparation)&&power>0?consumed*2:0;
   let cost=values[j+1][next]-timeGain+rechargeCost+effort;
   if(preparation&&j===23)cost+=Math.max(0,capacity*.9-raw)/1000*4;
   if(cost<best){best=cost;action=power}
  }
  // If assumed supplies cannot meet reference demand, retain a penalised
  // neutral transition. Actual samples still enforce feasibility separately.
  if(!Number.isFinite(best)){best=values[j+1][b]+10;action=0}values[j][b]=best;actions[j][b]=action;
 }
 const result={version:PLANNER_VERSION,actions,values,segments:plan,capacity,bins,terminalReserve:reserve/capacity*100,horizonLaps:laps,approximate:true,objective:'discrete local time-benefit/fuel-cost surrogate; terminal energy soft cost'};
 if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(signature,result);return result;
}
export function plannedPower(plan,progress,soc){if(!plan||!Number.isFinite(progress)||!Number.isFinite(soc))return null;const index=Math.max(0,Math.min(23,Math.floor(progress*24))),bin=Math.max(0,Math.min(plan.bins,Math.floor(soc/100*plan.bins)));return {kw:plan.actions[index][bin],index,terminalReserve:plan.terminalReserve,horizonLaps:plan.horizonLaps,approximate:true};}
export function updateLapPhase(state,p,sessionName){
 if(!/qualifying|practice|^day\s*\d+$/i.test(sessionName))return 'Race';
 if(p.inPit){state.phase='Pit';state.hardSeconds=0;return state.phase}
 if(p.inLap){state.phase='Cooldown Lap';return state.phase}
 if(state.lap!==p.lap_number){state.lap=p.lap_number;state.hardSeconds=0;state.phase=p.isPitOut?'Out Lap':'Unknown';}
 const dt=state.at?Math.max(0,Math.min(1,(p.time-state.at)/1000)):0;state.at=p.time;
 state.hardSeconds=p.throttle>=90&&p.speed>=100?Math.min(8,(state.hardSeconds||0)+dt):Math.max(0,(state.hardSeconds||0)-dt);
 if(p.isPitOut)state.phase='Out Lap';else if(p.lapPhase==='Flying Lap'||state.hardSeconds>=3)state.phase='Flying Lap';else if(p.lapPhase==='Cooldown Lap')state.phase='Cooldown Lap';
 return state.phase||'Unknown';
}

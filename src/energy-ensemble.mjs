// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
import {ensembleFlow} from './power-domains.mjs';
import {createEnergyBalance,energyLimits} from './energy-balance.mjs';
import {segmentAllocation,plannedPower,updateLapPhase} from './energy-planner.mjs';
import {practicePrediction} from './practice-fit.mjs';
export const ENERGY_ENSEMBLE_VERSION='0.7';
// Keep the shared history API while restoring the pre-practice-change model.
export const energyModelVersion=()=>ENERGY_ENSEMBLE_VERSION;
export function sessionEnergyPrior(name){return /qualifying/i.test(name||'')?{initialSoc:90,initialSocRange:[75,100]}:{initialSoc:100,initialSocRange:[100,100]};}
const fallback=[{massKg:780,dragArea:.85,iceKW:380,harvestShare:.25},{massKg:825,dragArea:1.1,iceKW:420,harvestShare:.35},{massKg:920,dragArea:1.4,iceKW:460,harvestShare:.5}];
export function createEnergyEnsemble(options={}){
 const fit=options.practiceModel,screened=fit?.available&&fit.calibration?.available&&fit.parameterScenarios?.length>=3,parameters=screened?fit.parameterScenarios:fallback,enabled=screened&&fit.plannerReady&&options.allocationPolicy!=='legacy',intents=enabled?['save','normal','attack']:['legacy-low','legacy-high'],phaseState={},specs=parameters.flatMap((p,i)=>intents.map((intent,j)=>({parameters:{...p,iceShare:p.iceShare??[.45,.6,.75][i%3],reserve:j?65:35},intent})));let at=options.start,losses=specs.map(()=>0),weights=specs.map(()=>1/specs.length),lastWeightAt=options.start,phase='Unknown',latestAllocation=null,progressState={lap:null,distance:0,anchored:false,previous:null};
 const signature=JSON.stringify([options.year,options.start,options.initialSoc??100,options.initialSocRange||[],options.sessionName||'',options.totalLaps??null,options.policy||{},enabled,specs,fit?.version,fit?.preparedAt,fit?.sourceCompletedAt,fit?.cells,fit?.profile]);
 const ledgers=specs.map(spec=>{let activePlan=null,planKey='';return createEnergyBalance({...options,policy:{...options.policy,scenarioParameters:spec.parameters},allocationProvider:enabled?(p,soc,managementPhase)=>{const nextKey=managementPhase+'|'+phase+'|'+(Number.isFinite(+(p.total_laps??options.totalLaps))&&+(p.total_laps??options.totalLaps)===p.lap_number);if(nextKey!==planKey){planKey=nextKey;activePlan=segmentAllocation(fit.profile,spec.parameters,{year:options.year,sessionName:options.sessionName,phase:managementPhase,lapPhase:phase,intent:spec.intent,remainingLaps:Number.isFinite(+(p.total_laps??options.totalLaps))&&Number.isFinite(p.lap_number)?+(p.total_laps??options.totalLaps)-p.lap_number+1:null,limits:energyLimits(options.year,options.policy),policy:options.policy});}const plan=activePlan;const result=plannedPower(plan,p.progress,soc);if(result)latestAllocation={enabled:true,version:plan.version,horizonLaps:result.horizonLaps,approximate:true,lapPhase:phase};return result}:null});});
 function ingest(input){
  if(!Number.isFinite(input.time)||input.time<=at)return false;const p={...input};
  if(Number.isFinite(p.lap_number)&&progressState.lap!==p.lap_number){progressState.anchored=progressState.lap!==null||Number.isFinite(p.lap_start)&&p.time-p.lap_start<=1500;progressState.lap=p.lap_number;progressState.distance=0;}
  else if(progressState.previous){const dt=(p.time-progressState.previous.time)/1000;if(dt>0&&dt<=2&&Number.isFinite(p.speed)&&Number.isFinite(progressState.previous.speed))progressState.distance+=(p.speed+progressState.previous.speed)/7.2*dt;else progressState.anchored=false;}
  if(!Number.isFinite(p.progress)&&progressState.anchored&&fit?.trackDistance>1000)p.progress=Math.min(.999,progressState.distance/fit.trackDistance);
  phase=updateLapPhase(phaseState,p,options.sessionName||'');
  // Compatibility weights use training-only acceleration predictions. Evidence
  // cannot uniquely separate intentions; keep a non-zero floor for every path.
  const previous=progressState.previous,dt=previous?(p.time-previous.time)/1000:0,reference=enabled?practicePrediction(fit,p):null;
  if(reference&&previous&&dt>.1&&dt<=2&&p.time-lastWeightAt>=1000&&p.throttle>=90&&p.brake===0&&previous.n_gear===p.n_gear){
   const observed=(p.speed-previous.speed)/3.6/dt,v=Math.max(8,p.speed/3.6),limit=energyLimits(options.year,options.policy),decay=Math.exp(-(p.time-lastWeightAt)/30000);
   for(let i=0;i<specs.length;i++){const params=specs[i].parameters,s=ledgers[i].snapshot(at),required=(params.massKg*v*reference.acceleration+.6*params.dragArea*v**3+.015*params.massKg*9.81*v)/940,available=params.iceKW+Math.min(limit.deployKW,s.estimate/100*limit.windowMJ*1000*.94/Math.max(.5,dt)),deficit=Math.max(0,required-available),predicted=reference.acceleration-deficit*940/(params.massKg*v),error=Math.min(9,((observed-predicted)/Math.max(.5,(reference.high-reference.low)/4))**2);losses[i]=losses[i]*decay+error*(1-decay)}
   const raw=losses.map(x=>Math.exp(-Math.min(6,x)/2)),sum=raw.reduce((a,b)=>a+b,0);weights=raw.map(x=>.2/specs.length+.8*x/sum);lastWeightAt=p.time;
  }
  progressState.previous={time:p.time,speed:p.speed,n_gear:p.n_gear};let ok=false;for(const l of ledgers)ok=l.ingest(p)||ok;if(ok)at=p.time;return ok;
 }
 function snapshot(cursor=at){
  const rows=ledgers.map(l=>l.snapshot(cursor)),base=rows[Math.floor(rows.length/2)],estimate=rows.reduce((n,r,i)=>n+r.estimate*weights[i],0),scenarioLow=Math.min(...rows.map(r=>r.estimate)),scenarioHigh=Math.max(...rows.map(r=>r.estimate)),intentWeights=Object.fromEntries(intents.map(intent=>[intent,specs.reduce((n,s,i)=>n+(s.intent===intent?weights[i]:0),0)])),disagreement=scenarioHigh-scenarioLow;
  return {...base,estimate,low:Math.min(...rows.map(r=>r.low)),high:Math.max(...rows.map(r=>r.high)),scenarioLow,scenarioHigh,modelVersion:ENERGY_ENSEMBLE_VERSION,ensembleSize:rows.length,states:[...new Set(rows.map(r=>r.state))],state:rows.every(r=>r.state===rows[0].state)?rows[0].state:'UNKNOWN',motorPower:null,batteryFlow:ensembleFlow(rows,weights),intentWeights,disagreement,allocation:latestAllocation||{enabled:false,reason:enabled?'waiting-for-lap-distance':fit?.audit?.fallbackReasons?.join(',')||'practice-parameters-unvalidated'},lapPhase:phase,practice:{status:fit?.status||'unavailable',validated:fit?.available===true,parameterValidated:screened===true,trainingLaps:fit?.trainingLaps||0,validationLaps:fit?.validationLaps||0,validation:fit?.validation||null,audit:fit?.audit||null,sourceSessions:fit?.sourceSessions||[],candidateCount:fit?.calibration?.candidateCount||0,retainedCandidates:parameters.length,note:'Compatibility weights retain alternatives; no measured SOC labels. Wide scenario disagreement must reach strategy advice.'}};
 }
 function exportState(){return {version:ENERGY_ENSEMBLE_VERSION,signature,options,ledgers:ledgers.map(l=>l.exportState()),progressState,phaseState:{...phaseState},losses,weights,lastWeightAt,phase,latestAllocation,at}}
 function restore(state){
  if(state?.version!==ENERGY_ENSEMBLE_VERSION||state.signature!==signature||state.ledgers?.length!==ledgers.length||!Number.isFinite(state.at)||!Array.isArray(state.weights)||state.weights.length!==specs.length||state.weights.some(x=>!Number.isFinite(x)||x<0)||Math.abs(state.weights.reduce((a,b)=>a+b,0)-1)>1e-6||state.losses?.length!==specs.length||state.losses.some(x=>!Number.isFinite(x)||x<0))return false;
  const previous=ledgers.map(l=>l.exportState());for(let i=0;i<ledgers.length;i++)if(!ledgers[i].restore(state.ledgers[i])){for(let j=0;j<i;j++)ledgers[j].restore(previous[j]);return false;}
  at=state.at;progressState=state.progressState||{lap:null,distance:0,anchored:false,previous:null};losses=[...state.losses];weights=[...state.weights];lastWeightAt=state.lastWeightAt;phase=state.phase;latestAllocation=state.latestAllocation;Object.assign(phaseState,state.phaseState||{});return true;
 }
 return {ingest,snapshot,exportState,restore};
}

// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
import {createEnergyEnsemble,sessionEnergyPrior} from './energy-ensemble.mjs';

export const MODEL_CARD=Object.freeze({
  primaryUse:'Race and Sprint energy-store scenario research',
  qualifying:'experimental; known weaker simulation',
  practice:'experimental; longitudinal fit does not validate SOC',
  measuredSOC:false,
  raceAssessment:'Maintainer observation only; no ground-truth SOC accuracy benchmark',
  scenarioEnvelope:'Not a statistical confidence interval'
});

// Guarded public entry point. The original numerical modules are retained for
// reproducibility, including historical branches not endorsed by this release.
export function createEnergyModel({year=2026,start,sessionName='Race',initialSoc,initialSocRange,policy={},practiceModel=null,totalLaps=null,allocationPolicy}={}){
  if(year!==2026)throw new RangeError('This research release supports year=2026 only; other branches are unreviewed.');
  if(!Number.isFinite(start))throw new TypeError('start must be an explicit timestamp in milliseconds.');
  if(typeof sessionName!=='string'||!sessionName.trim())throw new TypeError('sessionName is required.');
  const prior=sessionEnergyPrior(sessionName),soc=initialSoc??prior.initialSoc;
  const range=initialSocRange??(initialSoc===undefined?prior.initialSocRange:[soc,soc]);
  if(!Number.isFinite(soc)||soc<0||soc>100||!Array.isArray(range)||range.length!==2||range.some(x=>!Number.isFinite(x)||x<0||x>100)||range[0]>soc||range[1]<soc)throw new RangeError('SOC and its initial scenario bounds must be ordered within 0..100.');
  const allowedPolicy=new Set(['maxDeployKW','maxHarvestKW','harvestPerLapMJ','fullThrottleHarvestKW']);
  for(const [key,value]of Object.entries(policy))if(!allowedPolicy.has(key)||!Number.isFinite(value)||value<0)throw new TypeError('Unsupported or invalid policy field: '+key);
  if(totalLaps!==null&&(!Number.isInteger(totalLaps)||totalLaps<1))throw new RangeError('totalLaps must be a positive integer.');
  const options={year,start,sessionName,initialSoc:soc,initialSocRange:[...range],policy:{...policy},practiceModel:practiceModel===null?null:structuredClone(practiceModel),totalLaps,allocationPolicy};
  const engine=createEnergyEnsemble(options);
  return {
    ingest(sample){
      if(!sample||!Number.isFinite(sample.time))throw new TypeError('sample.time must be milliseconds.');
      for(const [key,max]of [['speed',500],['throttle',100],['n_gear',8]])if(sample[key]!==null&&(!Number.isFinite(sample[key])||sample[key]<0||sample[key]>max))throw new RangeError('Invalid '+key+'; supply a number or null for unknown.');
      if(![true,false,0,100,null].includes(sample.brake))throw new TypeError('brake is a binary observation (0/100, boolean, or null), not brake pressure.');
      if(sample.energyPhase!==undefined&&!['GREEN','SC','VSC'].includes(sample.energyPhase))throw new TypeError('Invalid energyPhase.');
      const p={...sample,brake:sample.brake===true?100:sample.brake===false?0:sample.brake};
      return engine.ingest(p);
    },
    snapshot(cursor){
      const at=engine.snapshot().asOf??start;
      if(cursor!==undefined&&(!Number.isFinite(cursor)||cursor<at))throw new RangeError('Historical snapshots require replaying a prefix or restoring an earlier checkpoint.');
      return {...structuredClone(engine.snapshot(cursor)),modelCard:MODEL_CARD};
    },
    exportState:()=>structuredClone(engine.exportState()),
    restore:state=>engine.restore(structuredClone(state))
  };
}

export {ENERGY_ENSEMBLE_VERSION} from './energy-ensemble.mjs';
export {energyPhaseTimeline,formationAnchor,energySessionStart,energyLimits} from './energy-balance.mjs';
export {practiceLapFeatures,fitPracticeDriver,causalPracticeModels} from './practice-fit.mjs';

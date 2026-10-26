import {createEnergyModel} from '../src/index.mjs';
import {syntheticRace,SYNTHETIC_START} from './synthetic-race.mjs';

const model=createEnergyModel({start:SYNTHETIC_START,sessionName:'Race',initialSoc:75,initialSocRange:[60,90],totalLaps:4});
let lap=1;
const rows=[];
for(const point of syntheticRace()){
  if(point.lap_number!==lap){const s=model.snapshot();rows.push({lap,estimatedPercent:+s.estimate.toFixed(2),scenarioLow:+s.scenarioLow.toFixed(2),scenarioHigh:+s.scenarioHigh.toFixed(2),measured:s.measured});lap=point.lap_number;}
  model.ingest(point);
}
const final=model.snapshot();rows.push({lap,estimatedPercent:+final.estimate.toFixed(2),scenarioLow:+final.scenarioLow.toFixed(2),scenarioHigh:+final.scenarioHigh.toFixed(2),measured:final.measured});
console.log('SYNTHETIC EXAMPLE ONLY. No event data; these outputs do not establish SOC accuracy.');
console.table(rows);

import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnergyModel,energyPhaseTimeline,formationAnchor,fitPracticeDriver} from '../src/index.mjs';
import {createEnergyBalance} from '../src/energy-balance.mjs';
import {storePower} from '../src/power-domains.mjs';
import {syntheticRace,SYNTHETIC_START as start} from '../examples/synthetic-race.mjs';

test('mechanical power uses the correct store energy direction and efficiencies',()=>{
  assert.equal(storePower(94),100);
  assert.equal(storePower(-100),-85);
  assert.equal(storePower(0),0);
});
test('finite bounded energy for complete synthetic multi-lap race; outputs remain estimates',()=>{
  const model=createEnergyModel({start,initialSoc:70,totalLaps:12});
  let changed=false;
  for(const p of syntheticRace({laps:12})){
    assert.equal(model.ingest(p),true);
    const s=model.snapshot();changed||=Math.abs(s.estimate-70)>.01;
    assert.equal(s.measured,false);assert.equal(s.modelCard.measuredSOC,false);
    for(const k of ['estimate','low','high','scenarioLow','scenarioHigh'])assert(Number.isFinite(s[k])&&s[k]>=0&&s[k]<=100,k);
    assert(s.low<=s.estimate+1e-10&&s.high>=s.estimate-1e-10);
  }
  assert(changed,'A constant placeholder would fail this scenario.');
});
test('continuous ledger does not reset at lap boundaries; stale/duplicate samples cannot rewrite it',()=>{
  const m=createEnergyModel({start,initialSoc:65});
  const p={time:start+250,speed:180,throttle:60,brake:0,n_gear:5,lap_number:1};
  m.ingest(p);const before=m.snapshot();
  assert.equal(m.ingest(p),false);assert.equal(m.ingest({...p,time:start-1}),false);assert.deepEqual(m.snapshot(),before);
  m.ingest({...p,time:start+500,lap_number:2});assert.notEqual(m.snapshot().estimate,100);
});
test('missing interval holds the central state and widens the envelope; future query becomes unknown',()=>{
  const m=createEnergyModel({start,initialSoc:55});const ps=[...syntheticRace()];
  ps.slice(0,20).forEach(p=>m.ingest(p));const before=m.snapshot();
  const p={...ps[19],time:ps[19].time+10000};m.ingest(p);const after=m.snapshot();
  assert.equal(after.estimate,before.estimate);assert(after.missingSeconds>before.missingSeconds);
  assert(after.low<=before.low&&after.high>=before.high);assert.equal(after.state,'UNKNOWN');
  const future=m.snapshot(p.time+5000);assert.equal(future.state,'UNKNOWN');assert.equal(future.batteryFlow.available,false);
  assert.throws(()=>m.snapshot(start),/Historical/);
});
test('empty/full stores constrain reported power, not just displayed SOC',()=>{
  const empty=createEnergyBalance({year:2026,start,initialSoc:0,sessionName:'Race'});
  const full=createEnergyBalance({year:2026,start,initialSoc:100,sessionName:'Race'});
  for(let i=1;i<=8;i++){
    empty.ingest({time:start+i*250,speed:280+i,throttle:100,brake:0,n_gear:8});
    full.ingest({time:start+i*250,speed:300-i*12,throttle:0,brake:100,n_gear:5});
  }
  assert.equal(full.snapshot().estimate,100);assert.equal(Math.abs(full.snapshot().motorPower.kw),0);
  const e=empty.snapshot();assert(e.estimate>=0);assert(e.motorPower.kw<=e.estimate/100*4000*.94/.25+1e-8);
});
test('checkpoint round-trip is identical to uninterrupted causal integration',()=>{
  const options={start,initialSoc:74,initialSocRange:[60,90]},a=createEnergyModel(options),b=createEnergyModel(options),ps=[...syntheticRace()];
  ps.slice(0,200).forEach(p=>a.ingest(p));const checkpoint=JSON.parse(JSON.stringify(a.exportState()));
  assert.equal(b.restore(checkpoint),true);
  for(const p of ps.slice(200)){a.ingest(p);b.ingest(p)}
  assert.deepEqual(b.snapshot(),a.snapshot());
  const wrong=createEnergyModel({...options,initialSoc:50,initialSocRange:[40,60]});assert.equal(wrong.restore(checkpoint),false);
});
test('only explicit timestamped global SC/VSC messages affect phases; restarts preserve anchor',()=>{
  const date=t=>new Date(start+t).toISOString();
  const phase=energyPhaseTimeline([{date:date(2000),message:'SAFETY CAR DEPLOYED'},{date:date(2500),message:'INCIDENT NOTED SAFETY CAR DEPLOYED'},{date:date(3000),flag:'GREEN',scope:'SECTOR'},{date:date(4000),flag:'GREEN',scope:'TRACK'}]);
  assert.equal(phase(start+1999),'GREEN');assert.equal(phase(start+2000),'SC');assert.equal(phase(start+3000),'SC');assert.equal(phase(start+4000),'GREEN');
  const anchor=formationAnchor({date_start:date(0)},[{date:date(60000),message:'RED FLAG - RACE SUSPENDED'},{date:date(120000),message:'EXTRA FORMATION LAP'}]);
  assert.equal(anchor.start,start);
});
test('qualifying is explicitly experimental; insufficient training does not claim identified SOC',()=>{
  const m=createEnergyModel({start,sessionName:'Qualifying'}),s=m.snapshot();
  assert.equal(s.initialSoc,90);assert.match(s.modelCard.qualifying,/weaker/);
  const fit=fitPracticeDriver([],{driver:1,year:2026});assert.equal(fit.available,false);assert.equal(fit.energyIdentified,false);
  const race=createEnergyModel({start,practiceModel:fit});assert.equal(race.snapshot().allocation.enabled,false);
});
test('entry point rejects ambiguous units/ranges and exposes no mutable snapshot state',()=>{
  assert.throws(()=>createEnergyModel(),/start/);assert.throws(()=>createEnergyModel({start,year:2027}),/2026/);
  assert.throws(()=>createEnergyModel({start,initialSoc:120}),/SOC/);
  const m=createEnergyModel({start});assert.throws(()=>m.ingest({time:start,speed:180,throttle:50,brake:40,n_gear:5}),/binary/);
  const s=m.snapshot();s.policy.maxDeployKW=0;assert.equal(m.snapshot().policy.maxDeployKW,undefined);
});

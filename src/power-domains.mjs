// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
// Independent modelling assumptions, never measured team efficiencies.
export const POWER_ASSUMPTIONS=Object.freeze({mechanicalPeakKW:750,drivetrainEfficiency:[.90,.95],drivetrainCentral:.94,dischargeEfficiency:.94,chargeEfficiency:.85,measured:false,basis:'user-supplied illustrative mechanical peak'});
export const wheelPeakRange=()=>POWER_ASSUMPTIONS.drivetrainEfficiency.map(e=>e*POWER_ASSUMPTIONS.mechanicalPeakKW);
// Positive store-terminal power withdraws energy. MGU-K shaft power is mechanical.
export const storePower=kw=>kw>=0?kw/POWER_ASSUMPTIONS.dischargeEfficiency:kw*POWER_ASSUMPTIONS.chargeEfficiency;
export function ensembleFlow(rows,weights){
 const available=rows.length>0&&rows.every(r=>r.motorPower&&[r.motorPower.kw,r.motorPower.low,r.motorPower.high].every(Number.isFinite));
 if(!available)return {available:false,direction:'UNKNOWN',measured:false};
 const powers=rows.map(r=>r.motorPower),kw=powers.reduce((s,p,i)=>s+storePower(p.kw)*weights[i],0),low=Math.min(...powers.map(p=>storePower(p.low))),high=Math.max(...powers.map(p=>storePower(p.high))),direction=kw>2?'DISCHARGE':kw< -2?'CHARGE':'BALANCED',wheel=powers.map(p=>p.wheelKW).filter(Number.isFinite),peak=wheelPeakRange();
 return {available:true,measured:false,domain:'store-terminal',kw,low,high,direction,directionCertain:direction==='DISCHARGE'?low>2:direction==='CHARGE'?high< -2:low>=-2&&high<=2,assumedPeakKW:peak,wheelDemandKW:wheel.length?[Math.min(...wheel),Math.max(...wheel)]:null,aboveAssumedPeak:wheel.some(p=>p>peak[1]),note:'Energy-flow estimate; changes in scenario weights can revise SOC independently. Peak is a diagnostic assumption, not a telemetry clamp.'};
}

// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
// Entirely invented piecewise speed traces, not a real event or a labelled SOC dataset.
export const SYNTHETIC_START=Date.UTC(2026,0,1);
export function* syntheticRace({laps=4,start=SYNTHETIC_START}={}){
  let tick=0;
  const phases=[
    {seconds:12,from:100,to:290,throttle:100,brake:0,gear:7},
    {seconds:8,from:290,to:305,throttle:100,brake:0,gear:8},
    {seconds:5,from:305,to:100,throttle:0,brake:100,gear:4},
    {seconds:10,from:100,to:100,throttle:35,brake:0,gear:4}
  ];
  for(let lap=1;lap<=laps;lap++)for(const phase of phases)for(let i=1;i<=phase.seconds*4;i++)yield {
    time:start+(++tick)*250,
    speed:phase.from+(phase.to-phase.from)*i/(phase.seconds*4),
    throttle:phase.throttle,brake:phase.brake,n_gear:phase.gear,
    lap_number:lap,total_laps:laps,energyPhase:'GREEN'
  };
}

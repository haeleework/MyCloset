// Recommendations use a few coarse conditions, not a detailed route diary.
export function weatherPlan(weather,ctx){
 const unknown={known:false,actions:['날씨 확인이 필요해요'],outerNeeded:ctx.cooling,cold:!!ctx.cooling,baseTarget:null,outerTarget:1,umbrella:null,snow:null,slots:[]};
 if(!weather||!Number.isFinite(weather.min)||!Number.isFinite(weather.max))return unknown;
 const hours=ctx.routine?[8,9,18,19]:[10,12,15,18];
 if(/저녁|약속|식사/.test(ctx.text))hours.push(20,21);
 const events=ctx.events||[];
 for(const e of events){if(!e.allDay){hours.push(Math.max(0,e.hour-1),e.hour,Math.min(23,e.endHour));}}
 const wanted=new Set(hours);
 const valid=(weather.hourly||[]).filter(h=>Number.isFinite(h.temp));
 const slots=valid.filter(h=>wanted.has(h.hour));
 // For supported cities named in an event, use that location around its time.
 for(const e of events){
  const forecast=(weather.forecasts||[]).find(f=>e.location?.includes(f.place.split(' · ')[0]));
  if(!forecast||forecast.place===weather.place)continue;
  const eventHours=e.allDay?hours:[Math.max(0,e.hour-1),e.hour,e.endHour];
  for(const h of forecast.hourly||[])if(eventHours.includes(h.hour)&&Number.isFinite(h.temp))slots.push({...h,place:forecast.place});
 }
 // Also retain hours during an explicitly outdoor calendar activity.
 for(const e of events.filter(e=>/산책|야외|등산|도보/.test(e.title)))for(const h of valid)if(h.hour>=e.hour&&h.hour<=e.endHour&&!slots.includes(h))slots.push(h);
 const temps=slots.length?slots.map(h=>h.temp):[weather.min,weather.max];
 const regionFallbacks=(weather.forecasts||[]).filter(f=>!(f.hourly||[]).some(h=>wanted.has(h.hour)&&Number.isFinite(h.temp)));
 for(const f of regionFallbacks)if(Number.isFinite(f.min)&&Number.isFinite(f.max))temps.push(f.min,f.max);
 const low=Math.min(...temps),high=Math.max(...temps);
 const sensitivities=Array.isArray(ctx.sensitivities)?ctx.sensitivities:[ctx.sensitive];
 const outdoor=ctx.exposure==='outdoor'||/산책|야외|등산/.test(ctx.text);
 const cold=low<17||ctx.cooling||sensitivities.includes('추위를 많이 타요');
 const outerNeeded=cold||low<20&&outdoor;
 let baseTarget=(high>=27?0:high>=20?1:2);
 if(ctx.exposure==='indoor'&&ctx.heating)baseTarget=Math.min(baseTarget,1);
 if(ctx.cooling&&high>=25)baseTarget=Math.min(baseTarget,1);
 if(sensitivities.includes('더위를 많이 타요')&&high>=20)baseTarget=Math.max(0,baseTarget-1);
 if(ctx.warmthBias)baseTarget=Math.max(0,Math.min(2,baseTarget+ctx.warmthBias));
 const outerTarget=low<5?2:low<12?2:1;
 const rainSlots=slots.length?slots:valid;
 const snow=(rainSlots.length?rainSlots.some(h=>[2,3,6,7].includes(h.pty)):weather.snow===true)||regionFallbacks.some(f=>f.snow===true);
 const hasPrecip=rainSlots.some(h=>h.pty>0)||regionFallbacks.some(f=>f.snow===true);
 const rainValues=[...rainSlots.map(h=>h.rain),...regionFallbacks.map(f=>f.rain)].filter(Number.isFinite);
 const rain=rainValues.length?Math.max(...rainValues):weather.rain;
 const umbrella=hasPrecip||Number.isFinite(rain)&&rain>=40;
 const actions=[umbrella?'우산 챙기세요':Number.isFinite(rain)||rainSlots.length?'현재 예보로는 우산 필요성이 낮아요':'강수 정보는 직접 확인해주세요'];
 if(snow)actions.push('눈·진눈깨비 예보: 미끄럼에 주의하세요');
 else if(weather.snow===false||rainSlots.some(h=>Number.isFinite(h.pty)))actions.push('활동 시간대에 눈 예보가 없어요');
 if(outerNeeded)actions.push(low<12?'따뜻한 겉옷을 입고 실내에서는 벗으세요':ctx.cooling?'실내 냉방에 대비해 가벼운 겉옷을 챙기세요':'아침·저녁에 걸칠 겉옷을 준비하세요');
 else actions.push(high>=27?'얇은 옷으로 준비하세요':'별도 겉옷 필요성이 낮아요');
 if(low<5)actions.push('현재 옷장에 겨울용 겉옷이 있는지 확인하세요');
 if((weather.forecasts||[]).length>1)actions.push('여러 활동 지역을 함께 고려했어요. 지역별 방문 시간은 아직 알 수 없어 같은 기본 활동 시간대를 적용해요.');
 if(sensitivities.includes('추위를 많이 타요')&&sensitivities.includes('더위를 많이 타요'))actions.push('추위와 더위를 모두 타는 편: 겉옷은 벗고 입기 쉽게 준비하세요');
 if(rainSlots.some(h=>h.wind>=8))actions.push('바람이 강한 시간대가 있어요');
 return {known:true,actions,outerNeeded,cold,baseTarget,outerTarget,umbrella,snow,slots,low,high,timeSpecific:slots.length>0&&!regionFallbacks.length,fallbackPlaces:regionFallbacks.map(f=>f.placeId||f.place)};
}

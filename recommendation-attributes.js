import {thicknessPreference} from './thickness-policy.js';
// Only explicitly confirmed material is physical evidence. Names are never material evidence.
export const finiteValue=value=>value==null||value===''||typeof value==='boolean'?null:Number.isFinite(Number(value))?Number(value):null;
export function garmentAttributes(item={}){
 const material=item.materialConfirmed===true&&typeof item.material==='string'?item.material.trim().toLowerCase():null;
 const thickness=finiteValue(item.thickness)??({very_thin:-0.5,very_thick:2.5,얇음:0,얇은:0,thin:0,보통:1,medium:1,두꺼움:2,두꺼운:2,thick:2}[item.thickness]??null);
 return {material,thickness,confirmedThickness:item.thicknessSource==='ai_estimate'?null:thickness,warmth:finiteValue(item.warmth),formal:finiteValue(item.formal),length:typeof item.length==='string'?item.length.toLowerCase():null,
  wool:material!==null&&/울|모직|wool/.test(material),linen:material!==null&&/린넨|리넨|linen/.test(material),fleece:material!==null&&/기모|fleece/.test(material)};
}
export const TEMPERATURE_RULE_DEFAULTS=Object.freeze({warmThreshold:23,coldThreshold:12});
export function assessTemperature(items,plan,context={},humidity=null,config=TEMPERATURE_RULE_DEFAULTS){
 const reasons=[],excluded=[],unknown=[],outer=items.find(i=>i.category==='outer');
 if(!plan.known)return {score:0,reasons,excluded,unknown:['날씨 정보가 없어 기온 적합성을 확인하지 못했어요.']};
 const sensitivity=context.sensitivities||[context.sensitive];
 const coldSensitive=sensitivity.includes('추위를 많이 타요'),hotSensitive=sensitivity.includes('더위를 많이 타요');
 const coldFloor=plan.low-(coldSensitive?2:0),hotCeiling=plan.high+(hotSensitive?2:0)+(humidity>=75?1:0);
 const range=plan.high-plan.low,hasCoolPeriod=plan.low<20||context.cooling||coldSensitive||range>=10;
 const outerAttrs=outer?garmentAttributes(outer):null;
 const protectiveOuter=!!outerAttrs&&(outerAttrs.warmth>=1||outerAttrs.confirmedThickness>=1);
 let score=0;
 for(const item of items){
  if(item.category==='shoe')continue;
  const a=garmentAttributes(item),kind=String(item.itemType||'').toLowerCase();
  const padded=/패딩|다운재킷|다운자켓|푸퍼|puffer/.test(kind),coat=/코트|coat/.test(kind);
  const shortSleeve=item.category==='top'&&(/반팔|민소매|short.sleeve|sleeveless/.test(kind)||/반팔|민소매|short.sleeve|sleeveless/.test(a.length||''));
  const shorts=item.category==='bottom'&&(/반바지|숏팬츠|쇼츠|shorts/.test(kind)||/짧|short/.test(a.length||''));
  const hotKind=padded||coat||a.wool||a.fleece;
  const definitelyHeavy=a.confirmedThickness>=2||a.warmth>=1.5;
  // A 23° daytime high alone never excludes a layer needed during a cold morning.
  if(hotCeiling>=config.warmThreshold&&hotKind){
   if(!hasCoolPeriod&&(definitelyHeavy||padded&&a.thickness!==0&&a.warmth!==0&&item.thicknessSource!=='ai_estimate'))excluded.push({code:'hot_heavy',itemId:item.id,reason:'활동 시간대가 덥고 보온성이 높은 종류·두께가 확인되어 제외했어요.'});
   else {score-=hasCoolPeriod?1:5;reasons.push(item.name+': 낮 더위에는 벗거나 조절할 필요가 있어요.');}
  }
  if(coldFloor<=config.coldThreshold&&(shortSleeve||shorts||a.linen)){
   const insulated=a.confirmedThickness>=2||a.warmth>=1.5;
   const protectedTop=shortSleeve&&protectiveOuter;
   const entireCold=plan.high<=config.coldThreshold;
   if(entireCold&&!insulated&&!protectedTop&&(shorts||shortSleeve||a.linen&&(a.confirmedThickness===0||a.warmth===0)))excluded.push({code:'cold_light',itemId:item.id,reason:'활동 시간대가 계속 춥고 짧거나 얇은 옷의 보온 보완이 확인되지 않아 제외했어요.'});
   else {score-=protectedTop?1:4;reasons.push(item.name+': 추운 시간대의 겹쳐 입기와 보온을 확인해주세요.');}
  }
  if(a.warmth!==null){const target=item.category==='outer'?plan.outerTarget:plan.baseTarget;score-=Math.abs(a.warmth-target)*(item.category==='outer'?4:2);}
  else {const preference=thicknessPreference(item,plan,context);score+=preference.score;if(preference.reason)reasons.push(preference.reason);else unknown.push(item.name+': 보온·두께가 아직 모름이에요.');}
  if(a.material===null&&/울|린넨|리넨|기모|wool|linen|fleece/i.test(String(item.name||'')+' '+String(item.material||'')))unknown.push(item.name+': 소재는 확인되지 않아 이름만으로 확정하거나 제외하지 않았어요.');
 }
 if(plan.outerNeeded&&!outer){score-=8;reasons.push('추운 시간대 또는 냉방에 대비할 겉옷을 확인해주세요.');}
 if(humidity>=75)reasons.push('높은 습도를 더위 부담의 보조 기준으로 고려했어요.');
 return {score,reasons,excluded,unknown};
}

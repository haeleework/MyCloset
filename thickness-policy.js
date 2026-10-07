// Product preference rules, not measured insulation. Do not write these into warmth.
export const thicknessOptions=[['very_thin','매우 얇음'],['thin','얇음'],['medium','보통'],['thick','두꺼움'],['very_thick','매우 두꺼움']];
export const thicknessLabel=value=>thicknessOptions.find(([key])=>key===value)?.[1]||'미확인';
export const thicknessIndex=value=>thicknessOptions.findIndex(([key])=>key===value);
export function thicknessMetadata(value,{analysis=null,previous=null,edited=false}={}){
 const field=analysis?.attributes?.thickness_visual;
 if(edited)return {thicknessSource:'user',thicknessEvidence:null};
 if(previous?.thicknessSource==='user'&&previous.thickness===value)return {thicknessSource:'user',thicknessEvidence:null};
 if(thicknessIndex(value)<0)return {thicknessSource:'unknown',thicknessEvidence:null};
 if(previous&&previous.thickness===value&&!previous.thicknessSource)return {thicknessSource:'user',thicknessEvidence:null};
 if(field?.value===value&&field.uncertainty==='추정'&&field.evidence?.trim())return {thicknessSource:'ai_estimate',thicknessEvidence:field.evidence.slice(0,160)};
 if(previous&&previous.thickness===value)return {thicknessSource:previous.thicknessSource,thicknessEvidence:previous.thicknessEvidence||null};
 return {thicknessSource:'user',thicknessEvidence:null};
}
// Inclusive lower temperature bounds. Each role competes within its own slot.
export const thicknessBands=[
 {min:25,base:[0,1],outer:[0,1]},
 {min:20,base:[1,2],outer:[0,1]},
 {min:15,base:[1,2],outer:[1,2]},
 {min:10,base:[2,3],outer:[1,2]},
 {min:5,base:[3,4],outer:[3,4]},
 {min:-Infinity,base:[3,4],outer:[4,4]},
];
export function thicknessPreference(item,plan,context={}){
 if(!plan?.known||item.category==='shoe')return {score:0,basis:'not_applicable',reason:null};
 const index=thicknessIndex(item.thickness);
 if(index<0)return {score:0,basis:'unknown',reason:null};
 const outer=item.category==='outer';
 let temperature=outer?plan.low:plan.high;
 if(!Number.isFinite(temperature))return {score:0,basis:'unknown',reason:null};
 const sensitivity=Array.isArray(context.sensitivities)?context.sensitivities:[context.sensitive];
 temperature+=sensitivity.includes('더위를 많이 타요')?2:0;
 temperature-=sensitivity.includes('추위를 많이 타요')?2:0;
 const band=thicknessBands.find(b=>temperature>=b.min);
 let [low,high]=outer?band.outer:band.base;
 if(!outer&&context.exposure==='indoor'&&context.heating){low=Math.min(low,2);high=Math.min(high,3);}
 if(outer&&context.cooling&&temperature>=20){low=1;high=2;}
 // A visible insulation cue only gives a modest provisional preference correction.
 // Multiple cues are never stacked and this is not an insulation measurement.
 const structureBonus=temperature<15&&['brushed_lining','padding_structure'].includes(item.insulationVisual)&&item.insulationSource==='ai_visual'&&typeof item.insulationEvidence==='string'&&item.insulationEvidence.trim()?1:0;
 const effectiveIndex=Math.min(4,index+structureBonus);
 const distance=Math.max(low-effectiveIndex,0,effectiveIndex-high);
 return {score:-4*distance,basis:item.thicknessSource==='ai_estimate'?'ai_estimate':'registered',target:[low,high],temperature,
  reason:`${item.name||'이 옷'}: ${item.thicknessSource==='ai_estimate'?'AI 추정':'등록된'} 두께 ${thicknessLabel(item.thickness)}를 ${outer?'겉옷':'상의·하의'}의 ${temperature}℃ 두께 우선순위에 반영했어요${structureBonus?' (보이는 보온 구조로 잠정 한 단계 보정)':''}${distance?' (목표 두께와 차이 있음)':''}.`};
}

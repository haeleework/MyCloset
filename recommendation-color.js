import {finiteValue} from './recommendation-attributes.js';
const aliases={검정:'black',블랙:'black',흰색:'white',화이트:'white',회색:'gray',그레이:'gray',grey:'gray',남색:'navy',네이비:'navy',베이지:'beige',빨강:'red',레드:'red',파랑:'blue',블루:'blue',초록:'green',그린:'green',노랑:'yellow',옐로:'yellow',보라:'purple',주황:'orange',분홍:'pink',갈색:'brown',브라운:'brown'};
const achromatic=new Set(['black','white','gray']);
export function colorAttributes(item){
 const raw=String(item.colorFamily||item.color||'').trim().toLowerCase(),family=aliases[raw]||raw;
 const hue=finiteValue(item.colorHue),lightness=finiteValue(item.colorLightness),chroma=finiteValue(item.colorChroma);
 return {family:['denim','데님','혼합','다색','unknown','모름',''].includes(family)?null:family,hue:hue!==null&&hue>=0&&hue<=360?hue:null,lightness:lightness!==null&&lightness>=0&&lightness<=100?lightness:null,chroma:chroma!==null&&chroma>=0&&chroma<=100?chroma:null};
}
const hueDistance=(a,b)=>Math.min(Math.abs(a-b),360-Math.abs(a-b));
/** One primary rule per look, in priority order. These are configurable heuristics, not measured aesthetic quality. */
export function scoreColor(items){
 const core=items.filter(i=>['top','bottom','dress','outer'].includes(i.category)),colors=core.map(colorAttributes);
 const details=colors.every(c=>c.hue!==null&&c.lightness!==null&&c.chroma!==null);
 const result=(score,rule,reason)=>({score,rule,reasons:[reason],precision:details?'registered-hsl':'color-family'});
 // Strong complementary overload needs three vivid colored garments and confirmed numeric hues/chroma.
 if(details&&colors.length>=3&&colors.filter(c=>c.chroma>=65).length>=3&&colors.some((a,i)=>colors.slice(i+1).some(b=>hueDistance(a.hue,b.hue)>=150)))return result(-30,'complementary_overload','확인된 색상각·채도에서 선명한 보색이 여러 옷에 반복되어 -30점을 적용했어요.');
 if(colors.some(c=>c.family==='navy')&&colors.some(c=>c.family==='beige')&&colors.every(c=>['navy','beige'].includes(c.family)||achromatic.has(c.family)))return result(25,'navy_beige','남색·베이지 색 계열 조합에 +25점을 적용했어요.');
 if(details&&colors.length>=2&&colors.every(c=>c.chroma>=10)&&colors.every(c=>hueDistance(c.hue,colors[0].hue)<=20)&&Math.max(...colors.map(c=>c.lightness))-Math.min(...colors.map(c=>c.lightness))>=10)return result(25,'tone_on_tone','확인된 색상각과 명도 차이가 있는 같은 계열 배색에 +25점을 적용했어요.');
 if(colors.length&&colors.every(c=>achromatic.has(c.family)))return result(20,'achromatic','상의·하의와 겉옷의 무채색 조합에 +20점을 적용했어요.');
 return result(0,'family_only',colors.some(c=>!c.family)?'색 계열 정보가 부족해 배색 점수를 더하지 않았어요. 데님은 색이 아닌 소재로 취급해요.':'등록된 색 계열만 참고했어요. 정밀 색 정보가 없어 톤온톤·보색을 확정하지 않았어요.');
}

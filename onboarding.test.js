import test from 'node:test';
import assert from 'node:assert/strict';
import {needsSetup,setupResult} from './onboarding.js';
import {fresh,normalizeState,demoState} from './persona.js';
import {contexts,recommend} from './engine.js';
import {createAppServer} from './app-server.mjs';

test('first-use survey applies to empty real wardrobe, not demo or returning owners',()=>{
 const state=fresh();assert.equal(needsSetup(state),true);assert.equal(needsSetup(state,'demo'),false);
 state.closet=[{id:'owned'}];assert.equal(needsSetup(state),false);
 state.closet=[];state.onboarding.completedAt='2026-10-07T00:00:00Z';assert.equal(needsSetup(state),false);
});
test('unknown responses stay null rather than fabricating cold tolerance or walking answers',()=>{
 const result=setupResult({},fresh().profile,'2026-10-07T00:00:00Z');
 for(const key of ['walking','dressCode','cooling','heating','exposure'])assert.equal(result.profile[key],null);
 assert.equal(result.profile.style,'');assert.deepEqual(result.profile.styles,[]);assert.equal(result.locationId,null);
 assert.equal(result.onboarding.completedAt,'2026-10-07T00:00:00Z');
});
test('explicit negative differs from unknown; weekday selection and multiple styles survive completion',()=>{
 const {profile}=setupResult({routine:'출근',days:['1','3','1','8'],cooling:'false',heating:'true',walking:'30',styles:['캐주얼','미니멀','캐주얼'],bodyNote:'  어깨가 끼면 불편해요  '});
 assert.deepEqual(profile.days,[1,3]);assert.equal(profile.cooling,false);assert.equal(profile.heating,true);
 assert.equal(profile.walking,30);assert.deepEqual(profile.styles,['캐주얼','미니멀']);assert.equal(profile.bodyNote,'어깨가 끼면 불편해요');
 assert.equal(contexts(profile,'', '2026-10-07').routine,'출근');
 assert.equal(contexts(profile,'오늘은 휴가','2026-10-07').walking,0);
});
test('normalizing legacy data preserves garments, feedback, historical calendar and survey drafts',()=>{
 const garment={id:'photo',photo:new Uint8Array([1,2])};const original={closet:[garment],calendar:[{title:'옛 달력'}],feedback:[{wore:true}],onboarding:{step:1,draft:{walking:'10'}}};
 const normalized=normalizeState(original);assert.deepEqual(normalized.closet,original.closet);
 assert.deepEqual(normalized.calendar,original.calendar);assert.equal(normalized.onboarding.step,1);assert.equal(normalized.onboarding.completedAt,null);
 assert.equal(needsSetup(normalized),false);assert.deepEqual(normalized.feedback,original.feedback);
});
test('optional unfilled preferences cannot reward equally blank garment attributes',()=>{
 const s=demoState();const profile={...s.profile,fit:'',style:'',styles:[]};
 const closet=s.closet.map(i=>({...i,fit:'',style:''}));const context=contexts(profile,'','2026-10-07');
 const a=recommend(closet,profile,context,null),b=recommend(closet.map(i=>({...i,fit:'unmatched',style:'unmatched'})),profile,context,null);
 assert.equal(a.signature,b.signature);
});
test('retired calendar API rejects imports before touching any dependency',async()=>{
 const server=createAppServer({root:process.cwd(),store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{throw new Error('unexpected collection');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{const response=await fetch(url+'/api/calendar',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:'{"text":"private calendar"}'});assert.equal(response.status,404);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('new style choices survive survey completion and can change outfit ranking',()=>{
 const {profile}=setupResult({styles:['스포티','내추럴','시크','스포티']});
 assert.deepEqual(profile.styles,['스포티','내추럴','시크']);assert.equal(profile.style,'스포티');
 const closet=[
  {id:'a',category:'top',style:'미니멀',color:'흰색',available:true},
  {id:'z',category:'top',style:'스포티',color:'흰색',available:true},
  {id:'b',category:'bottom',color:'검정',available:true},
  {id:'s',category:'shoe',color:'검정',available:true}
 ];
 const context=contexts(profile,'','2026-10-07');
 assert.equal(recommend(closet,profile,context,null).outfit.find(i=>i.category==='top').id,'z');
 // Explicitly clearing all choices must remove the old primary style's bonus.
 assert.equal(recommend(closet,{...profile,styles:[]},context,null).outfit.find(i=>i.category==='top').id,'a');
});
test('free text body memo stays stored without silently becoming a recommendation rule',()=>{
 const s=demoState();const profile={...s.profile,bodyNote:'어깨가 끼면 불편해요'};
 const context=contexts(profile,'','2026-10-07');
 assert.equal(recommend(s.closet,profile,context,null).signature,recommend(s.closet,{...profile,bodyNote:''},context,null).signature);
 assert.equal(setupResult({styles:['로맨틱','빈티지','스트리트'],bodyNote:profile.bodyNote}).profile.bodyNote,profile.bodyNote);
});

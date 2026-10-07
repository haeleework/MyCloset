import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {officialStyleGroups,moodOptions,moodPreferences,itemMoodMatch,garmentStyleMetadata,styleMoodEntries} from './style-taxonomy.js';
import {normalizeState,fresh} from './persona.js';
import {setupResult} from './onboarding.js';
import {contexts,recommend} from './engine.js';
import {createAppServer} from './app-server.mjs';

const closet=[
 {id:'a',category:'top',style:'미니멀',color:'흰색',formal:0,warmth:1,available:true},
 {id:'z',category:'top',style:'스포티',color:'흰색',formal:0,warmth:1,available:true},
 {id:'b',category:'bottom',color:'검정',formal:0,warmth:1,available:true},
 {id:'s',category:'shoe',color:'검정',formal:0,warmth:1,available:true}
];
const choose=(profile,items=closet,text='',weather=null)=>recommend(items,profile,contexts(profile,text,'2026-10-07'),weather);

test('official 10 groups / 23 unique styles and five optional product moods remain separate',async()=>{
 assert.equal(officialStyleGroups.length,10);
 const styles=officialStyleGroups.flatMap(g=>g.styles);assert.equal(styles.length,23);assert.equal(new Set(styles).size,23);
 assert.deepEqual(new Set(styles),new Set(styleMoodEntries.map(e=>e.style)));
 assert.equal(moodOptions.length,5);
 const json=JSON.parse(await readFile(new URL('./style-taxonomy.json',import.meta.url),'utf8'));
 assert.deepEqual(json.officialStyleGroups,officialStyleGroups);assert.deepEqual(json.styles,styleMoodEntries);
 assert.equal(json.basis.officialMoodMapping,false);assert.equal(json.selection.optional,true);
});
test('multiple valid mood IDs survive saving, invalid IDs and duplicates do not restore old styles',()=>{
 const profile={style:'미니멀',styles:['미니멀'],moodPreferences:['active','soft','active','invalid']};
 assert.deepEqual(moodPreferences(profile),['active','soft']);
 const saved=setupResult({moodPreferences:profile.moodPreferences},profile).profile;
 assert.deepEqual(saved.moodPreferences,['active','soft']);assert.equal(saved.style,'미니멀');assert.deepEqual(saved.styles,['미니멀']);
 assert.deepEqual(normalizeState({profile:saved}).profile.moodPreferences,['active','soft']);
 assert.deepEqual(moodPreferences({...profile,moodPreferences:['invalid']}),[]);
});
test('legacy records are preserved but new or explicitly empty moods use basic recommendations and truthful explanations',()=>{
 const old={style:'ス',styles:['미니멀']};
 const migrated=normalizeState({profile:old,closet});
 assert.equal(migrated.profile.style,'ス');assert.deepEqual(migrated.profile.styles,['미니멀']);assert.deepEqual(migrated.profile.moodPreferences,[]);
 for(const profile of [fresh().profile,{...old,moodPreferences:[]},{...old,moodPreferences:['invalid']}]){
  const result=choose(profile);assert.equal(result.outfit[0].id,'a');
  assert.equal(result.reasons.some(r=>r.includes('선호')||r.includes('고르신 느낌')),false);
 }
 const cleared=setupResult({moodPreferences:[]},{...old,moodPreferences:['active']}).profile;
 assert.deepEqual(cleared.moodPreferences,[]);assert.deepEqual(cleared.styles,old.styles);
});
test('genderless, ambiguous old tags, missing tags and conditional secondary connections are not automatic matches',()=>{
 const all={moodPreferences:moodOptions.map(m=>m.id)};
 for(const style of ['젠더리스','미니멀','내추럴','빈티지','',undefined])assert.equal(itemMoodMatch({style},all),false);
 assert.equal(itemMoodMatch({style:'프레피'},{moodPreferences:['active']}),false);
 assert.equal(itemMoodMatch({style:'프레피'},{moodPreferences:['neat','active']}),true);
 assert.deepEqual(garmentStyleMetadata('프레피'),{styleGroup:'트래디셔널',styleTaxonomy:'aihub-k-fashion-23'});
 assert.deepEqual(garmentStyleMetadata('젠더리스'),{styleGroup:'젠더플루이드',styleTaxonomy:'aihub-k-fashion-23'});
 assert.equal(garmentStyleMetadata('내추럴').styleTaxonomy,'legacy-unmapped');
});
test('moods break a basic-condition tie without overriding formality or weather suitability',()=>{
 const p={moodPreferences:['active','soft','active']};
 assert.equal(choose(p).outfit[0].id,'z');assert.equal(choose({...p,moodPreferences:[]}).outfit[0].id,'a');
 const formalItems=closet.map(i=>({...i,formal:i.id==='z'?0:2}));
 assert.equal(choose(p,formalItems,'면접').outfit[0].id,'a');
 const weatherItems=closet.map(i=>({...i,warmth:i.id==='z'?0:2}));
 assert.equal(choose(p,weatherItems,'',{min:3,max:8}).outfit[0].id,'a');
 assert.equal(choose(p).reasons.some(r=>r.includes('고르신 느낌')),true);
 assert.equal(choose(p,formalItems,'면접').reasons.some(r=>r.includes('고르신 느낌')),false);
});
test('draft, old garment photo and feedback survive new mood normalization',()=>{
 const photo=new Uint8Array([1,2,3]);const original={profile:{moodPreferences:['soft','neat']},closet:[{id:'photo',style:'빈티지',photo}],feedback:[{wore:true}],onboarding:{step:2,draft:{moodPreferences:[]}}};
 const normalized=normalizeState(original);assert.deepEqual(normalized.closet,original.closet);assert.deepEqual(normalized.feedback,original.feedback);assert.deepEqual(normalized.onboarding.draft,{moodPreferences:[]});
});
test('matching more separate garments does not multiply mood priority over a matching dress',()=>{
 const items=[
  {id:'a_dress',category:'dress',style:'클래식',color:'검정',formal:0},
  {id:'z_top',category:'top',style:'클래식',color:'검정',formal:1},
  {id:'z_bottom',category:'bottom',style:'클래식',color:'검정',formal:1},
  {id:'shoe',category:'shoe',style:'클래식',color:'검정',formal:0}
 ];
 const noMood=choose({moodPreferences:[]},items);
 assert.equal(noMood.outfit[0].id,'a_dress');
 assert.equal(choose({moodPreferences:['neat','natural','soft','active','expressive']},items).signature,noMood.signature);
});
test('the browser can load the new taxonomy module while source data files stay private',async()=>{
 const root=new URL('.',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
 const server=createAppServer({root:decodeURIComponent(root),store:{},readConfig:async()=>{},settings:()=>({}),kick:()=>{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  const module=await fetch(url+'/style-taxonomy.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);assert.match(await module.text(),/export const officialStyleGroups/);
  assert.equal((await fetch(url+'/style-taxonomy.json')).status,404);
  assert.equal((await fetch(url+'/.env')).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

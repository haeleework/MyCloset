import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from './app-server.mjs';
async function serve(t,options={}){
 const server=createAppServer({root:'.',readConfig:async()=>{},settings:()=>({provider:'data',keyPresent:false,geminiKeyPresent:false,supabaseUrl:'https://fixture.supabase.co',secret:'must-not-appear'}),kick:()=>{},...options});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;
}
test('cloud UI config exposes only target URL and stays disabled without repository',async t=>{
 const base=await serve(t);const response=await (await fetch(base+'/api/config')).json();assert.deepEqual(response.supabase,{enabled:false,url:null});assert.equal(response.geminiEnabled,false);assert.equal(JSON.stringify(response).includes('must-not-appear'),false);
 assert.equal((await fetch(base+'/api/weather-observation?place=seoul')).status,503);
});
test('configured cloud target handshake and explicit observation retain separate authority',async t=>{
 let calls=0;const base=await serve(t,{repository:{mode:'supabase'},observations:async({place})=>{calls++;return {observation:{kind:'observation',placeId:place.id,temperature:15,humidity:62}};}});
 const response=await (await fetch(base+'/api/config')).json();assert.deepEqual(response.supabase,{enabled:true,url:'https://fixture.supabase.co'});assert.equal(calls,0);
 const observed=await (await fetch(base+'/api/weather-observation?place=seoul')).json();assert.equal(observed.observation.kind,'observation');assert.equal(calls,1);
});

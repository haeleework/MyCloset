import {randomUUID} from 'node:crypto';
import {safeDetails} from './operation-log.mjs';
export function createTraceStore(limit=20,journal=null){
 const entries=new Map();
 return {
  start(proposedId){
   const id=typeof proposedId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposedId)&&!entries.has(proposedId)?proposedId:randomUUID();
   const start=performance.now(),record={requestId:id,startedAt:new Date().toISOString(),status:'running',timeline:[]};
   const trace={mark(stage,details={}){const elapsedMs=Math.round((performance.now()-start)*100)/100;const safe=safeDetails(details);record.timeline.push({stage,elapsedMs,...safe});journal?.event(stage,{elapsedMs,...safe},{requestId:id});},finish(status){record.status=status;record.elapsedMs=Math.round((performance.now()-start)*100)/100;journal?.event('analysis_completed',{status,elapsedMs:record.elapsedMs},{requestId:id});},snapshot(){return structuredClone(record);}};
   entries.set(id,trace);while(entries.size>limit)entries.delete(entries.keys().next().value);trace.mark('request_received');return trace;
  },
  get(id){const trace=id?entries.get(id):Array.from(entries.values()).at(-1);return trace?.snapshot()||null;},
  async saved(id){return this.get(id)||await journal?.trace(id)||null;}
 };
}

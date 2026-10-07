import {randomUUID} from 'node:crypto';
import {safeError} from './operation-log.mjs';
export class ForecastWorker{
 constructor(store,configuration,{now=()=>new Date(),journal=null}={}){this.journal=journal;this.store=store;this.configuration=configuration;this.now=now;this.running=null;this.requested=false;this.retryRequested=false;}
 request({retry=false}={}){
  this.requested=true;this.retryRequested||=retry;if(this.running)return this.running;
  this.running=(async()=>{
   do{
    const retry=this.retryRequested;this.requested=false;this.retryRequested=false;
    const configuration=await this.configuration();if(!configuration.keyPresent){this.journal?.event('weather_collection_skipped',{reason:'key_missing'});continue;}
    for(const place of await this.store.activePlaces(configuration.provider)){
     const requestId=randomUUID(),start=performance.now(),mark=(event,details={})=>this.journal?.event(event,{elapsedMs:performance.now()-start,...details},{requestId});
     mark('weather_refresh_started');try{const result=await this.store.refresh(place,configuration.provider,{now:this.now(),retry,mark});mark('weather_refresh_finished',{status:result.status,elapsedMs:performance.now()-start});}catch(error){mark('weather_refresh_failed',{...safeError(error),elapsedMs:performance.now()-start});}
    }
   }while(this.requested);
  })().catch(error=>{this.journal?.event('weather_worker_failed',safeError(error));throw error;}).finally(()=>{this.running=null;});
  return this.running;
 }
 start(){this.request().catch(()=>{});this.timer=setInterval(()=>this.request().catch(()=>{}),60000);this.timer.unref();}
 stop(){clearInterval(this.timer);}
}

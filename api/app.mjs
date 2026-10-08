import {getCache} from '@vercel/functions';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createAppServer} from '../app-server.mjs';
import {VercelForecastStore,createCachedHolidays} from '../vercel-cache.mjs';
import {collectForecast} from '../weather.mjs';
import {createRecommendationService} from '../recommendation-service.mjs';
import {createSavedWeatherProvider,createObservationProvider,collectObservation} from '../recommendation-weather.mjs';
import {createSupabaseWardrobeRepository} from '../wardrobe-repository.mjs';
import {SharedGeminiBudget} from '../shared-gemini-budget.mjs';
import {createVisionService} from '../wardrobe-vision.mjs';
import {createGeminiRecommender} from '../recommendation-gemini.mjs';
import {createCutoutService} from '../photo-cutout.mjs';
import {processCutout} from '../cutout-worker.mjs';

export const config={maxDuration:120};
const root=fileURLToPath(new URL('../',import.meta.url));
const geminiEnabled=process.env.CLOSET_ENABLE_GEMINI==='1'&&!!process.env.GEMINI_API_KEY&&!!process.env.CLOSET_BUDGET_API_URL&&!!process.env.CLOSET_BUDGET_API_TOKEN;
const budgetOptions={url:process.env.CLOSET_BUDGET_API_URL,token:process.env.CLOSET_BUDGET_API_TOKEN};
const budget=geminiEnabled?new SharedGeminiBudget(budgetOptions):null;
const vision=geminiEnabled?createVisionService({budget,getKey:async()=>process.env.GEMINI_API_KEY}):null;
const cutouts=createCutoutService({cacheDir:'/tmp/mycloset-cutouts-v27',processor:{process:processCutout}});
const settings=()=>({provider:process.env.KMA_PROVIDER||'data',keyPresent:!!process.env.KMA_SERVICE_KEY,geminiEnabled,geminiKeyPresent:geminiEnabled,supabaseUrl:process.env.SUPABASE_URL,supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY,supabaseAuthMode:'demo',features:{cutout:true,gemini:geminiEnabled,weatherCollection:'on-demand'}});
const cache=getCache({namespace:'mycloset-v26'});
const store=new VercelForecastStore(cache,(place,options)=>collectForecast(place,process.env.KMA_SERVICE_KEY||'',options));
const repository=createSupabaseWardrobeRepository({enabled:true,allowAnonymous:true,url:process.env.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY});
const recommendationOptions={mode:'local',repository,weatherProvider:createSavedWeatherProvider({store,settings})};
const rules=createRecommendationService(recommendationOptions);
const live=createRecommendationService({...recommendationOptions,gemini:createGeminiRecommender({enabled:geminiEnabled,allowNetwork:geminiEnabled,budget:geminiEnabled?new SharedGeminiBudget({...budgetOptions,purpose:'text-recommendation'}):null,getKey:async()=>process.env.GEMINI_API_KEY})});
const recommendations={async recommend(input,options){if(!options.accessToken)return rules.recommend(input,options);await repository.authenticate(options.accessToken);return live.recommend(input,options);}};
const observations=createObservationProvider({fetchObservation:({place})=>collectObservation(place,process.env.KMA_SERVICE_KEY||'',{provider:settings().provider})});
const seed=JSON.parse(await readFile(new URL('../holiday-seed.json',import.meta.url),'utf8'));
const holidays=createCachedHolidays({cache,seed,getKey:()=>process.env.KASI_SERVICE_KEY||(settings().provider==='data'?process.env.KMA_SERVICE_KEY:'')||''});
const productionOrigins=[process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL,process.env.VERCEL_BRANCH_URL].filter(Boolean).map(host=>'https://'+host);
for(const origin of (process.env.CLOSET_PUBLIC_ORIGINS||'').split(',').filter(Boolean)){
 const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin)throw Error('Invalid production origin');productionOrigins.push(origin);
}
const server=createAppServer({root,store,settings,readConfig:async()=>{},kick:()=>{},recommendations,repository,observations,holidays,productionOrigins,vision,cutouts,budget,authorizeProcessing:token=>repository.authenticate(token)});
export default server.listeners('request')[0];

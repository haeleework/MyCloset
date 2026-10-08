import {getCache} from '@vercel/functions';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createAppServer} from '../app-server.mjs';
import {VercelForecastStore,createCachedHolidays} from '../vercel-cache.mjs';
import {collectForecast} from '../weather.mjs';
import {createRecommendationService} from '../recommendation-service.mjs';
import {createSavedWeatherProvider,createObservationProvider,collectObservation} from '../recommendation-weather.mjs';
import {createSupabaseWardrobeRepository} from '../wardrobe-repository.mjs';

export const config={maxDuration:60};
const root=fileURLToPath(new URL('../',import.meta.url));
// Production deliberately has no import of the local ledger or image worker.
// Public deployments cannot enable Gemini until a durable shared budget is connected.
const settings=()=>({provider:process.env.KMA_PROVIDER||'data',keyPresent:!!process.env.KMA_SERVICE_KEY,geminiEnabled:false,geminiKeyPresent:false,supabaseUrl:process.env.SUPABASE_URL,supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY,supabaseAuthMode:'demo',features:{cutout:false,gemini:false,weatherCollection:'on-demand'}});
const cache=getCache({namespace:'mycloset-v26'});
const store=new VercelForecastStore(cache,(place,options)=>collectForecast(place,process.env.KMA_SERVICE_KEY||'',options));
const repository=createSupabaseWardrobeRepository({enabled:true,allowAnonymous:true,url:process.env.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY});
const recommendations=createRecommendationService({mode:'local',repository,weatherProvider:createSavedWeatherProvider({store,settings})});
const observations=createObservationProvider({fetchObservation:({place})=>collectObservation(place,process.env.KMA_SERVICE_KEY||'',{provider:settings().provider})});
const seed=JSON.parse(await readFile(new URL('../holiday-seed.json',import.meta.url),'utf8'));
const holidays=createCachedHolidays({cache,seed,getKey:()=>process.env.KASI_SERVICE_KEY||(settings().provider==='data'?process.env.KMA_SERVICE_KEY:'')||''});
const productionOrigins=[process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL,process.env.VERCEL_BRANCH_URL].filter(Boolean).map(host=>'https://'+host);
for(const origin of (process.env.CLOSET_PUBLIC_ORIGINS||'').split(',').filter(Boolean)){
 const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin)throw Error('Invalid production origin');productionOrigins.push(origin);
}
const server=createAppServer({root,store,settings,readConfig:async()=>{},kick:()=>{},recommendations,repository,observations,holidays,productionOrigins,vision:null,cutouts:null,budget:null});
export default server.listeners('request')[0];

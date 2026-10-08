import {HolidayStore} from './holiday-store.mjs';
import {createOperationLog,safeError} from './operation-log.mjs';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectForecast} from './weather.mjs';
import {ForecastStore} from './forecast-store.mjs';
import {ForecastWorker} from './forecast-worker.mjs';
import {createAppServer} from './app-server.mjs';
import {createVisionService} from './wardrobe-vision.mjs';
import {networkInterfaces} from 'node:os';
import {createCutoutService} from './photo-cutout.mjs';
import {SharedGeminiBudget} from './shared-gemini-budget.mjs';
import {GeminiBudget} from './gemini-budget.mjs';
import {createRecommendationService} from './recommendation-service.mjs';
import {createSavedWeatherProvider,createObservationProvider,collectObservation} from './recommendation-weather.mjs';
import {createGeminiRecommender} from './recommendation-gemini.mjs';
import {createSupabaseWardrobeRepository} from './wardrobe-repository.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||4331);
// New development servers are offline for Gemini, even when an older .env has a key.
const geminiEnabled=process.env.CLOSET_ENABLE_GEMINI==='1'&&process.env.CLOSET_TEST_MODE!=='1'; // Explicit live-demo opt-in; tests remain offline.
const backgroundEnabled=process.env.CLOSET_TEST_MODE!=='1';
const journal=createOperationLog(path.join(root,'.operation-logs'),{version:'0.25.0'});
process.on('uncaughtExceptionMonitor',(error,origin)=>journal.emergency('process_fatal',{...safeError(error),origin}));
journal.event('server_starting',{version:'0.25.0'});
const listenHost=process.env.CLOSET_LISTEN_HOST==='0.0.0.0'?'0.0.0.0':'127.0.0.1';
const lanAddresses=Object.values(networkInterfaces()).flat().filter(i=>i?.family==='IPv4'&&!i.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)).map(i=>i.address);
const envPath=process.env.CLOSET_ENV_FILE||path.join(root,'.env');
let config={};
async function readConfig(){try{config=parseEnv(await readFile(envPath,'utf8'));}catch(error){config={};journal.event('config_read_failed',safeError(error));}}
const key=()=>config.KMA_SERVICE_KEY||process.env.KMA_SERVICE_KEY||'';
const settings=()=>({provider:config.KMA_PROVIDER||process.env.KMA_PROVIDER||'data',keyPresent:!!key(),geminiKeyPresent:geminiEnabled&&!!(config.GEMINI_API_KEY||process.env.GEMINI_API_KEY),recommendationMode:process.env.CLOSET_STORAGE_MODE||'local',supabaseUrl:process.env.SUPABASE_URL||config.SUPABASE_URL||null,supabaseAuthMode:process.env.CLOSET_AUTH_MODE==='demo'?'demo':'account',supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||config.SUPABASE_PUBLISHABLE_KEY||null,geminiEnabled});
const store=new ForecastStore(path.join(root,'.weather-cache'),async(place,options)=>collectForecast(place,key(),options));
const worker=new ForecastWorker(store,async()=>{await readConfig();return settings();},{journal});
if(geminiEnabled&&!process.env.CLOSET_BUDGET_API_URL&&!process.env.CLOSET_BUDGET_DIR?.trim())throw new Error('Gemini 활성화 전 CLOSET_BUDGET_DIR에 기존 비용 기록 폴더를 지정해주세요.');
const budget=geminiEnabled?(process.env.CLOSET_BUDGET_API_URL?new SharedGeminiBudget({url:process.env.CLOSET_BUDGET_API_URL,token:process.env.CLOSET_BUDGET_API_TOKEN}):new GeminiBudget(path.resolve(root,process.env.CLOSET_BUDGET_DIR))):null;
if(budget)await budget.ready;
const getGeminiKey=async()=>{await readConfig();return config.GEMINI_API_KEY||process.env.GEMINI_API_KEY||'';};
const vision=geminiEnabled?createVisionService({budget,getKey:getGeminiKey}):null;
await readConfig();
const storageMode=process.env.CLOSET_STORAGE_MODE==='supabase'?'supabase':'local';
const repository=storageMode==='supabase'?createSupabaseWardrobeRepository({enabled:true,allowAnonymous:process.env.CLOSET_AUTH_MODE==='demo',url:process.env.SUPABASE_URL||config.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||config.SUPABASE_PUBLISHABLE_KEY}):null;
// Optional cloud backup must not require uploading a new garment before recommending it.
const recommendationMode=process.env.CLOSET_RECOMMENDATION_MODE==='local'?'local':storageMode;
const recommendations=createRecommendationService({mode:recommendationMode,repository,weatherProvider:createSavedWeatherProvider({store,readConfig,settings}),gemini:createGeminiRecommender({enabled:geminiEnabled,allowNetwork:geminiEnabled,budget,getKey:getGeminiKey})});
const observations=backgroundEnabled&&process.env.CLOSET_ENABLE_OBSERVATIONS==='1'?createObservationProvider({fetchObservation:async({place})=>{await readConfig();return collectObservation(place,key(),{provider:settings().provider});}}):null;
const cutouts=createCutoutService({cacheDir:path.join(root,'.cutout-cache')});
const holidays=new HolidayStore(path.join(root,'.holiday-cache'),{journal,seedFile:path.join(root,'holiday-seed.json')});
const getHolidayKey=async()=>{await readConfig();return config.KASI_SERVICE_KEY||process.env.KASI_SERVICE_KEY||((config.KMA_PROVIDER||process.env.KMA_PROVIDER||'data')==='data'?(config.KMA_SERVICE_KEY||process.env.KMA_SERVICE_KEY):'')||'';};
const server=createAppServer({journal,root,store,recommendations,repository,observations,holidays,holidayKick:()=>backgroundEnabled&&holidays.refresh(getHolidayKey,{retry:true}).catch(()=>{}),readConfig,settings,vision,cutouts,budget,allowedHosts:listenHost==='0.0.0.0'?lanAddresses:[],kick:options=>backgroundEnabled&&worker.request(options).catch(()=>{})});
if(backgroundEnabled){worker.start();holidays.start(getHolidayKey);}
const heartbeat=setInterval(()=>journal.event('server_heartbeat',{rssBytes:process.memoryUsage().rss,heapBytes:process.memoryUsage().heapUsed,uptimeSeconds:process.uptime(),...journal.health()}),60000);heartbeat.unref();
server.on('error',error=>{journal.emergency('server_failed',safeError(error));});
server.listen(port,listenHost,()=>{journal.event('server_ready');console.log('ClosetAgent MVP: http://127.0.0.1:'+port);if(listenHost==='0.0.0.0')for(const address of lanAddresses)console.log('같은 Wi-Fi 휴대폰 테스트: http://'+address+':'+port);});
server.on('close',()=>{worker.stop();holidays.stop();clearInterval(heartbeat);cutouts.close();});
let shuttingDown=false;
for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{if(shuttingDown)return;shuttingDown=true;journal.event('server_stopping',{reason:event});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await budget?.close();journal.event('server_stopped');await journal.flush();process.exit(0);});

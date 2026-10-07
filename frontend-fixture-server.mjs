// Isolated frontend fixture. No provider imports, credentials, or outbound requests.
import http from 'node:http';
import {readFile, appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {emptyRecommendationResponse} from './recommendation-contract.js';
import {demoState} from './persona.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export function fixtureRecommendation(request, scenario = 'two') {
  if(scenario==='comfort-one')scenario=request.options?.modifier==='comfort'?'one':'two';
  const result = emptyRecommendationResponse(request);
  const wardrobe = request.wardrobe || [];
  const tops = wardrobe.filter(x => x.category === 'top' && x.available !== false);
  const base = ['bottom', 'shoe', 'outer'].map(category => wardrobe.find(x => x.category === category && x.available !== false)).filter(Boolean);
  result.looks = scenario === 'zero' ? [] : tops.slice(0, scenario === 'one' ? 1 : 2).map((top, index) => ({candidateId:`fixture-${index + 1}`, itemIds:[top,...base].map(x=>x.id), stylingTip:`가상 추천 ${index + 1}: 등록한 옷만 함께 입어보세요.`, reasons:['실제 AI를 호출하지 않은 화면 검사 자료'], scores:{color:20-index,total:80-index}, scoreReasons:['가상 색 조합 점수']}));
  if(scenario === 'bad-id' && result.looks.length)result.looks[0].itemIds[0] = 'not-in-wardrobe';
  result.selectedLookId = result.looks[Number(request.options?.skip || 0) % (result.looks.length || 1)]?.candidateId ?? null;
  if(scenario==='reordered')result.selectedLookId=result.looks[1]?.candidateId??null;
  result.validCandidateCount = result.looks.length;
  result.weather = {kind:'forecast',temperatureMin:18,temperatureMax:24,humidity:65,issuedAt:'2026-10-08T05:00:00+09:00',fetchedAt:new Date().toISOString(),cached:true,stale:false};
  result.diagnostics = {candidatesGenerated:8,candidatesAfterFilter:result.looks.length,topKCount:result.looks.length,excludedCounts:{temperature:2},weatherProviderCalled:false,timingsMs:{server:4,weatherCacheRead:1,weatherProvider:null,gemini:null},gemini:{called:false,cached:false,model:null,usage:null}};
  result.warnings = ['외부 연결 없는 가상 시험 응답입니다.'];
  return result;
}

const fixturePage = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>프론트 격리 시험</title><body><h1>4332 전용 가상 옷장</h1><p>실제 4317 옷장과 별도 출처입니다. 외부 호출은 허용되지 않습니다.</p><button id="seed">가상 옷장 준비</button><p id="status" role="status"></p><a href="/">시험 앱 열기</a><script type="module">
import {demoState} from '/persona.js';
document.querySelector('#seed').onclick=async()=>{const r=indexedDB.open('closet-agent-preview-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('states');r.onsuccess=()=>{const db=r.result,tx=db.transaction('states','readwrite'),store=tx.objectStore('states');const real=demoState();real.closet=real.closet.slice(0,2).concat(real.closet.filter(x=>['bottom','shoe','outer'].includes(x.category)).filter((x,i,a)=>a.findIndex(y=>y.category===x.category)===i));real.closet.forEach(x=>{x.id='fixture-real-'+x.id;x.name='가상 '+x.name;});real.onboarding={version:1,completedAt:new Date().toISOString(),step:0,draft:null};real.history=[{date:'2000-01-01',ids:['preserved-history'],note:'보존 표식'}];real.feedback=[{date:'2000-01-01',ids:['preserved-history'],wore:true,feeling:'ok'}];store.put(real,'real');store.put(demoState(),'mvp-demo-v1');store.put('real','mvp-active-mode');tx.oncomplete=()=>{document.querySelector('#status').textContent='가상 5개 옷장과 기록 준비 완료';db.close();};};};
</script></body></html>`;

export function createFrontendFixture({logFile = null} = {}) {
  const requests = []; let scenario='two', delayMs=0;
  const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'");
    const chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>1024*1024){json(res,413,{error:'fixture body limit'});return;}}
    let body={};try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{json(res,400,{error:'invalid json'});return;}
    const entry={at:new Date().toISOString(),method:req.method,path:url.pathname,requestId:body.requestId??null,wardrobeCount:body.wardrobe?.length??null,scenario,mediaKeys:(body.wardrobe||[]).flatMap(x=>['photo','cutout','capture'].filter(key=>key in x))};requests.push(entry);if(logFile)await appendFile(logFile,JSON.stringify(entry)+'\n');
    if(url.pathname==='/__fixture/control'&&req.method==='POST'){scenario=body.scenario||'two';delayMs=Math.min(30000,Math.max(0,Number(body.delayMs)||0));json(res,200,{scenario,delayMs});return;}
    if(url.pathname==='/__fixture/requests'){json(res,200,{requests,outboundRequests:0});return;}
    if(url.pathname==='/__fixture'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixturePage);return;}
    if(['/api/garment-analysis','/api/photo-analysis','/api/photo-cutout','/api/analysis-trace'].includes(url.pathname)){json(res,403,{code:'FIXTURE_BLOCKED',error:'사진 분석 및 외부 연결은 시험 서버에서 차단했습니다.'});return;}
    if(url.pathname==='/api/recommendations'){
      const currentScenario=scenario;if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
      if(currentScenario==='error'){json(res,503,{code:'fixture_error',error:'가상 서버 오류입니다. 다시 시도해주세요.'});return;}
      json(res,200,fixtureRecommendation(body,currentScenario));return;
    }
    if(url.pathname==='/api/config'){json(res,200,{weatherKeyPresent:false,visionKeyPresent:false,places:[],supabase:{enabled:false}});return;}
    if(['/api/holidays','/api/holiday-refresh'].includes(url.pathname)){json(res,200,{version:1,years:{},status:'fixture'});return;}
    if(url.pathname==='/api/weather-regions'){json(res,200,{status:'saved'});return;}
    if(url.pathname==='/api/weather'){const weather=demoState().weather;json(res,200,{...weather,source:'가상 시험 날씨',humidity:65});return;}
    if(url.pathname==='/api/gemini-budget'){json(res,200,{canRequest:false,estimatedUsedWon:0,capWon:1000,uncertainAttempts:0,fixture:true});return;}
    if(url.pathname==='/api/client-events'){json(res,200,{ok:true});return;}
    if(url.pathname.startsWith('/api/')){json(res,404,{error:'fixture route not available'});return;}
    if(url.pathname==='/node_modules/exifr/dist/full.umd.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(path.join(root,'node_modules/exifr/dist/full.umd.js')));return;}
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname).slice(1);
    // Only public frontend assets, never .env, server code, package dependencies, or logs.
    if(relative.includes('..')||relative.startsWith('.')||relative.includes('/')||!['.html','.js','.css','.svg','.json'].includes(path.extname(relative))||relative.startsWith('package')){json(res,404,{error:'not public'});return;}
    try{const content=await readFile(path.join(root,relative));res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[path.extname(relative)]+'; charset=utf-8','Cache-Control':'no-store'});res.end(content);}catch{json(res,404,{error:'not found'});}
  });
  return {server,requests};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const logFile=path.join(root,`frontend-review-requests-${Date.now()}.jsonl`);
  const {server}=createFrontendFixture({logFile});server.listen(4332,'127.0.0.1',()=>console.log(JSON.stringify({port:4332,logFile,outboundRequests:0})));
}

import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validId} from './operation-log.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),directory=path.join(root,'.operation-logs');
const requested=process.argv.find(a=>a.startsWith('--request='))?.slice(10);
if(requested&&!validId(requested))throw new Error('요청 번호는 UUID 형식이어야 합니다.');
let files=[];try{files=(await readdir(directory)).filter(f=>f.endsWith('.jsonl')).sort();}catch{}
if(!files.length){console.log('아직 운영 로그가 없습니다. 이 버전의 서버를 실행한 뒤 확인해주세요.');process.exit(0);}
const records=[];let broken=0;
for(const file of files){for(const line of (await readFile(path.join(directory,file),'utf8')).split('\n')){if(!line)continue;try{const row=JSON.parse(line);if(!requested||row.requestId===requested)records.push(row);}catch{broken++;}}}
records.sort((a,b)=>a.at.localeCompare(b.at));
const counts=new Map(),status=new Map(),active=new Map();
for(const r of records){counts.set(r.event,(counts.get(r.event)||0)+1);if(r.event==='gemini_headers_received')status.set(r.details.httpStatus,(status.get(r.details.httpStatus)||0)+1);if(r.event==='http_request_started')active.set(r.requestId,r);if(r.event==='http_response_finished'||r.event==='http_client_disconnected')active.delete(r.requestId);}
console.log(JSON.stringify({files:files.length,events:records.length,unreadableLines:broken,geminiCalls:counts.get('gemini_request_started')||0,geminiHttpStatus:Object.fromEntries(status),unfinishedRequests:[...active.keys()],errors:[...counts].filter(([k])=>/failed|fatal|error|disconnect|rejected/.test(k))},null,2));
const time=r=>new Date(r.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
for(const r of requested?records:records.filter(r=>/failed|fatal|error|disconnect|rejected/.test(r.event)).slice(-30))console.log(time(r)+' '+(r.requestId||r.instanceId)+' '+r.event+' '+JSON.stringify(r.details));
console.log('미완료 요청은 강제 종료/접속 중단/현재 처리 중일 수 있습니다. 로그만으로 Google 내부 원인을 확정하지 않습니다.');

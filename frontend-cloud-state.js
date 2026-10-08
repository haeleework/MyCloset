// Complete state transfers are explicit. Tokens and photo bytes never enter JSON rows.
import {cloudWardrobeMetadata,fields} from './frontend-storage.js';
const types=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const extraFields=['colorDescription','pattern','surface','silhouette','lengthDescription','url','styleGroup','styleTaxonomy'];
const captureFields=['iso','date','epoch','hasZone','raw','model','make','flash','whiteBalance','timestamp','offset'];
const fail=code=>Object.assign(new Error(code),{code});
function cleanJSON(value,depth=0){
 if(depth>20)throw fail('INVALID_STATE');
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'){if(/^(data:|blob:)/i.test(value)||value.length>100000)throw fail('INVALID_STATE');return value;}
 if(Array.isArray(value))return value.map(v=>cleanJSON(v,depth+1));
 if(value&&typeof value==='object'&&!(value instanceof Blob))return Object.fromEntries(Object.entries(value).filter(([k,v])=>v!==undefined&&!/^(photo|password|token|access_token|refresh_token|apiKey|authorization|gps|latitude|longitude|__proto__|constructor|prototype)$/i.test(k)).map(([k,v])=>[k,cleanJSON(v,depth+1)]));
 throw fail('INVALID_STATE');
}
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,cleanJSON(o[k])]));
export async function photoDigest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function encodeCloudState(state,userId){
 if(!/^[0-9a-f-]{36}$/i.test(userId)||!state||!Array.isArray(state.closet))throw fail('INVALID_STATE');
 const attributes=cloudWardrobeMetadata(state.closet),photos=new Map(),closet=[];
 for(let i=0;i<attributes.length;i++){
  const item=state.closet[i],{id,...metadata}=attributes[i],media=[];
  // Refuse silent truncation of saved recommendation fields.
  for(const key of fields)if(item[key]!==undefined&&JSON.stringify(metadata[key])!==JSON.stringify(item[key]))throw fail('INVALID_STATE');
  for(const [role,blob] of [['original',item.photo],['cutout',item.cutout?.photo]]){
   if(blob==null)continue;
   if(!(blob instanceof Blob)||!types.has(blob.type)||!blob.size||blob.size>20971520)throw fail('INVALID_PHOTO');
   const sha256=await photoDigest(blob),object_path=`${userId}/${id}/${sha256}/${role}`;
   media.push({role,object_path,sha256,bytes:blob.size,mime_type:blob.type});photos.set(object_path,blob);
  }
  closet.push({id,attributes:metadata,display:{...pick(item,extraFields),cutout:item.cutout?cleanJSON(item.cutout):null,hasVision:!!item.vision},
   capture:pick(item.capture,captureFields),vision:item.vision?cleanJSON(item.vision):null,review:item.vision?.userReview?cleanJSON(item.vision.userReview):null,media});
 }
 const payload={closet,profile:cleanJSON(state.profile||{}),locationIds:cleanJSON(state.locationIds??(state.locationId?[state.locationId]:[])),onboarding:cleanJSON(state.onboarding||{}),schedule:cleanJSON(state.schedule||{}),history:cleanJSON(state.history||[]),feedback:cleanJSON(state.feedback||[]),answers:cleanJSON(state.answers||[]),confirmedGroups:cleanJSON(state.confirmedGroups||[]),preserved:{locationId:state.locationId??null}};
 if(new TextEncoder().encode(JSON.stringify(payload)).length>3500000)throw fail('STATE_TOO_LARGE');
 return {payload,photos};
}
export function checkCloudSnapshot(data,userId){
 if(data?.userId!==userId||!Number.isSafeInteger(data.revision)||data.revision<0)throw fail('ACCOUNT_MISMATCH');
 for(const key of ['garments','details','analyses','media','contexts','history','feedback']){
  if(!Array.isArray(data[key])||data[key].some(r=>r.user_id!==userId))throw fail('INVALID_RESPONSE');
 }
 for(const key of ['preferences','legacy'])if(data[key]&&data[key].user_id!==userId)throw fail('ACCOUNT_MISMATCH');
 cloudWardrobeMetadata(data.garments.map(g=>({...g.attributes,id:g.id})));
 return data;
}
export function snapshotMedia(data){
 const details=new Map(data.details.map(d=>[d.garment_id,d]));const byPath=new Map(data.media.map(m=>[m.object_path,m]));
 return data.garments.flatMap(g=>(details.get(g.id)?.review_state?.media||[]).map(ref=>{
  const m=byPath.get(ref.object_path);
  if(!m||m.garment_id!==g.id||m.role!==ref.role||!types.has(m.mime_type)||m.bytes!==ref.bytes||m.sha256!==ref.sha256||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>20971520||!/^[a-f0-9]{64}$/.test(m.sha256)||m.object_path!==`${data.userId}/${g.id}/${m.sha256}/${m.role}`)throw fail('INVALID_RESPONSE');
  return m;
 }));
}
export async function decodeCloudState(data,userId,download){
 checkCloudSnapshot(data,userId);const refs=snapshotMedia(data);
 if(refs.some(m=>m.status!=='ready'))throw fail('MEDIA_INCOMPLETE');
 const photos=new Map();
 for(const m of refs){const blob=await download(m);if(!(blob instanceof Blob)||blob.size!==m.bytes||await photoDigest(blob)!==m.sha256)throw fail('PHOTO_INTEGRITY');photos.set(m.object_path,new Blob([blob],{type:m.mime_type}));}
 const details=new Map(data.details.map(d=>[d.garment_id,d])),analyses=new Map(data.analyses.map(a=>[a.garment_id,a.analysis]));
 const closet=data.garments.map(g=>{
  const d=details.get(g.id),display=d?.display_metadata||{},refs=d?.review_state?.media||[];
  const item={...g.attributes,id:g.id,...pick(display,extraFields),capture:d?.capture_metadata||null,photo:null,cutout:null};
  if(display.hasVision&&analyses.has(g.id))item.vision=analyses.get(g.id);
  for(const ref of refs){if(ref.role==='original')item.photo=photos.get(ref.object_path);if(ref.role==='cutout')item.cutout={...(display.cutout||{}),photo:photos.get(ref.object_path)};}
  return item;
 });
 return {closet,profile:data.preferences?.profile||{},locationIds:data.preferences?.location_ids||[],locationId:data.preferences?.location_ids?.[0]??null,onboarding:data.preferences?.onboarding||{},schedule:data.contexts.at(-1)?.context||{},history:data.history.map(h=>h.snapshot),feedback:data.feedback.map(f=>({date:f.local_date,ids:f.item_ids,feeling:f.feeling,season:f.season,wore:f.wore})),answers:data.legacy?.answers||[],confirmedGroups:data.legacy?.confirmed_groups||[]};
}

// Bound, authenticated direct Storage transfer. Larger photos use TUS 6MiB chunks.
export async function uploadCloudPhoto({url,key,token,media,blob,fetchImpl=fetch,signal}){
 const auth={apikey:key,Authorization:'Bearer '+token};
 async function call(target,options){const r=await fetchImpl(target,{...options,signal,redirect:'error',credentials:'omit'});if(!r.ok)throw fail(r.status===401?'AUTH_REQUIRED':'PHOTO_UPLOAD_FAILED');return r;}
 const objectUrl=url+'/storage/v1/object/closet-media/'+media.object_path;
 // Content addressed paths: a retry never replaces another photo.
 const existing=await fetchImpl(url+'/storage/v1/object/authenticated/closet-media/'+media.object_path,{headers:auth,signal,redirect:'error',credentials:'omit'});
 if(existing.ok){const saved=await existing.blob();if(saved.size!==blob.size||await photoDigest(saved)!==media.sha256)throw fail('PHOTO_INTEGRITY');return;}
 if(![400,404].includes(existing.status))throw fail(existing.status===401?'AUTH_REQUIRED':'PHOTO_UPLOAD_FAILED');
 if(blob.size<=6*1024*1024){await call(objectUrl,{method:'POST',headers:{...auth,'Content-Type':blob.type,'x-upsert':'false'},body:blob});return;}
 const encode=v=>btoa(unescape(encodeURIComponent(v)));
 const metadata={bucketName:'closet-media',objectName:media.object_path,contentType:blob.type,cacheControl:'3600'};
 const r=await call(url+'/storage/v1/upload/resumable',{method:'POST',headers:{...auth,'Tus-Resumable':'1.0.0','Upload-Length':String(blob.size),'Upload-Metadata':Object.entries(metadata).map(([k,v])=>k+' '+encode(v)).join(',')}});
 const location=r.headers.get('location');if(!location)throw fail('PHOTO_UPLOAD_FAILED');
 const target=new URL(location,url);if(target.origin!==new URL(url).origin||!target.pathname.startsWith('/storage/v1/upload/resumable/'))throw fail('PHOTO_UPLOAD_FAILED');
 for(let offset=0;offset<blob.size;offset+=6*1024*1024){const chunk=blob.slice(offset,offset+6*1024*1024);await call(target.href,{method:'PATCH',headers:{...auth,'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:chunk});}
}

/** Server-only metadata adapter. Photos and provider credentials never enter rows.
 * A publishable key identifies the project; the user's verified access token and
 * database RLS authorize every operation. Never use a service_role/secret key.
 */
export class WardrobeRepositoryError extends Error{constructor(code,status=503){super(code);this.code=code;this.status=status;}}
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=['name','category','color','fit','officialSize','style','warmth','formal','comfort','available','officialColor','itemType','itemTypeSource','material','materialConfirmed','thickness','thicknessSource','thicknessEvidence','insulationVisual','insulationSource','insulationEvidence','length','colorFamily','colorLightness','colorChroma','colorHue','styleTags','moods','garmentKind','garmentKindConfirmed'];
export function garmentMetadata(item){
 if(!item||!idPattern.test(item.id??'')||!['top','bottom','dress','shoe','outer'].includes(item.category))throw new WardrobeRepositoryError('INVALID_GARMENT',400);
 const clean={id:item.id};
 for(const key of fields){const value=item[key];if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))clean[key]=value;else if(typeof value==='string'&&value.length<=200)clean[key]=value;else if(Array.isArray(value)&&value.length<=12&&value.every(v=>typeof v==='string'&&v.length<=80))clean[key]=[...value];}
 return clean;
}
export function createSupabaseWardrobeRepository({enabled=false,allowAnonymous=false,url='',publishableKey='',fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
 let origin;
 if(enabled){
  try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error();origin=parsed.origin;}catch{throw new WardrobeRepositoryError('SUPABASE_CONFIGURATION');}
  // Reject secret and legacy service-role keys, even when supplied accidentally.
  let legacyRole=null;try{legacyRole=JSON.parse(Buffer.from(publishableKey.split('.')[1]??'','base64url').toString()).role;}catch{}
  if(!publishableKey.startsWith('sb_publishable_')&&legacyRole!=='anon')throw new WardrobeRepositoryError('SUPABASE_PUBLISHABLE_KEY_REQUIRED');
 }
 async function request(path,accessToken,{method='GET',body,prefer}={}){
  if(!enabled)throw new WardrobeRepositoryError('SUPABASE_NOT_CONFIGURED');
  if(typeof accessToken!=='string'||!accessToken||accessToken.length>8192||/[\s\u0000-\u001f]/.test(accessToken))throw new WardrobeRepositoryError('AUTH_REQUIRED',401);
  const controller=new AbortController();let timer;
  try{
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new WardrobeRepositoryError('SUPABASE_TIMEOUT',504));},timeoutMs);});
   return await Promise.race([(async()=>{
    const response=await fetchImpl(origin+path,{method,redirect:'error',headers:{apikey:publishableKey,Authorization:'Bearer '+accessToken,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
    if(!response.ok)throw new WardrobeRepositoryError(response.status===401?'AUTH_REQUIRED':response.status===403?'FORBIDDEN':'SUPABASE_UNAVAILABLE',response.status===401?401:response.status===403?403:503);
    if(response.status===204)return null;
    return await response.json();
   })(),timeout]);
  }catch(error){if(error instanceof WardrobeRepositoryError)throw error;throw new WardrobeRepositoryError('SUPABASE_UNAVAILABLE');}finally{clearTimeout(timer);}
 }
 async function authenticate(accessToken){
  const user=await request('/auth/v1/user',accessToken);
  if(!uuidPattern.test(user?.id??'')||user?.is_anonymous===true&&!allowAnonymous)throw new WardrobeRepositoryError('AUTH_REQUIRED',401);
  return {id:user.id};
 }
 function unpack(rows,user,requestedIds=null){
  if(!Array.isArray(rows)||rows.length>500)throw new WardrobeRepositoryError('INVALID_WARDROBE_RESPONSE');
  const seen=new Set();return rows.map(row=>{
   if(row?.user_id!==user.id||!idPattern.test(row?.id??'')||seen.has(row.id)||(requestedIds&&!requestedIds.has(row.id)))throw new WardrobeRepositoryError('WARDROBE_OWNERSHIP_MISMATCH',403);
   seen.add(row.id);return garmentMetadata({...row.attributes,id:row.id});
  });
 }
 function validIds(ids){if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!idPattern.test(id))||new Set(ids).size!==ids.length)throw new WardrobeRepositoryError('INVALID_GARMENT_IDS',400);return ids;}
 async function listGarments({accessToken}={}){
  const user=await authenticate(accessToken),query=new URLSearchParams({select:'id,user_id,attributes',deleted_at:'is.null',user_id:'eq.'+user.id,order:'id.asc',limit:'501'});
  return {user,wardrobe:unpack(await request('/rest/v1/wardrobe_garments?'+query,accessToken),user)};
 }
 async function resolveGarments({accessToken,garmentIds}={}){
  const ids=validIds(garmentIds),user=await authenticate(accessToken);if(!ids.length)return {user,wardrobe:[]};
  // Bounded chunks avoid URL-length limits; ownership is checked in every row.
  const rows=[];for(let offset=0;offset<ids.length;offset+=50){const group=ids.slice(offset,offset+50),query=new URLSearchParams({select:'id,user_id,attributes',deleted_at:'is.null',user_id:'eq.'+user.id,id:'in.('+group.join(',')+')'});rows.push(...unpack(await request('/rest/v1/wardrobe_garments?'+query,accessToken),user,new Set(group)));}
  const byId=new Map(rows.map(item=>[item.id,item]));if(byId.size!==ids.length)throw new WardrobeRepositoryError('GARMENT_NOT_OWNED_OR_MISSING',403);
  return {user,wardrobe:ids.map(id=>byId.get(id))};
 }
 async function upsertGarments({accessToken,wardrobe}={}){
  if(!Array.isArray(wardrobe)||!wardrobe.length||wardrobe.length>500)throw new WardrobeRepositoryError('INVALID_WARDROBE',400);
  const clean=wardrobe.map(garmentMetadata);validIds(clean.map(item=>item.id));const user=await authenticate(accessToken);
  const body=clean.map(({id,...attributes})=>({id,user_id:user.id,attributes}));
  const rows=await request('/rest/v1/wardrobe_garments?on_conflict=user_id%2Cid',accessToken,{method:'POST',body,prefer:'resolution=merge-duplicates,return=representation'});
  const result=unpack(rows,user,new Set(clean.map(item=>item.id)));if(result.length!==clean.length)throw new WardrobeRepositoryError('INVALID_WARDROBE_RESPONSE');
  return {user,wardrobe:result};
 }
 async function deleteGarment({accessToken,garmentId}={}){
  validIds([garmentId]);const user=await authenticate(accessToken);const query=new URLSearchParams({user_id:'eq.'+user.id,id:'eq.'+garmentId});
  const rows=await request('/rest/v1/wardrobe_garments?'+query,accessToken,{method:'DELETE',prefer:'return=representation'});const removed=unpack(rows,user,new Set([garmentId]));
  if(removed.length!==1)throw new WardrobeRepositoryError('GARMENT_NOT_OWNED_OR_MISSING',403);return {user,deletedId:garmentId};
 }
 return {mode:enabled?'supabase':'disabled',authenticate,listGarments,resolveGarments,upsertGarments,deleteGarment};
}

// Five displayed levels retain the previous 0/1/2 recommendation scale.
export const warmthOptions=[['','아직 모름'],['0','1 · 매우 낮음'],['0.5','2 · 낮음'],['1','3 · 보통'],['1.5','4 · 높음'],['2','5 · 매우 높음']];
export const warmthValue=value=>value===''||value==null?null:warmthOptions.some(([v])=>v!==''&&Number(v)===Number(value))?Number(value):null;
export const displayColor=value=>value==='다색'?'혼합':value;
export const fitApplies=item=>item.category!=='shoe';
export function garmentSizing(category,{fit='',officialSize=''}={}){
 return {fit:category==='shoe'?'':fit.trim(),officialSize:officialSize.trim()};
}
export const sizeCaption=item=>item.category==='shoe'?(item.officialSize?'사이즈 '+item.officialSize:'사이즈 미정'):[item.fit||'핏 미정',item.officialSize?'사이즈 '+item.officialSize:''].filter(Boolean).join(' · ');
// Preserve manual values, including clearing a previous AI value on purpose.
export function mergeAnalysisDraft(current,previousAI,nextAI,{editedFields=[]}={}){
 const values={},preserved=[];const edited=new Set(editedFields);
 for(const [key,value] of Object.entries(nextAI)){
  const priorKnown=previousAI&&Object.hasOwn(previousAI,key);
  const manual=edited.has(key)||(priorKnown?current[key]!==previousAI[key]:current[key]!==''&&current[key]!=null);
  values[key]=manual?current[key]:value;if(manual&&current[key]!==value)preserved.push(key);
 }
 return {values,preserved};
}

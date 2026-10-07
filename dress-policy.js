// User's office preference: neat casual is allowed; garment formality is not
// a proxy for an office uniform. Explicit formal events still take precedence.
export function dressPolicy(context={}) {
 const text=String(context.text||'');
 const strict=/면접|결혼식|발표|중요한\s*미팅|정장\s*(?:필수|착용|의무)|격식\s*(?:필수|필요)/.test(text);
 const office=!context.remote&&!context.exception&&(context.routine==='출근'||/출근|회사|근무/.test(text)&&!/출근\s*안|휴가|쉬는 날|재택/.test(text));
 return {mode:strict?'formal-event':office?'neat-casual-office':'context',required:strict?Math.max(2,Number(context.formal)||0):Math.max(0,Number(context.formal)||0)};
}
export function assessDressItem(item,context={}) {
 const policy=dressPolicy(context);
 const raw=item.formal,formal=raw==null||raw===''||typeof raw==='boolean'||!Number.isFinite(Number(raw))?null:Number(raw);
 if(policy.mode==='neat-casual-office'){
  // Specific registered types win over free-form names; generic labels may use
  // the name as a clue, but never infer fabric, cleanliness or physical comfort.
  const type=String(item.itemType||'').trim();
  const text=(!type||/^(?:상의|하의|신발|겉옷|재킷|자켓|팬츠|바지|티셔츠)$/.test(type)?type+' '+(item.name||''):type).toLowerCase();
  let excluded=null;
  if(item.category==='shoe'&&/슬리퍼|쪼리|실내화|flip[ -]?flops?|\bslides?\b|slippers?/.test(text))excluded='office_slippers';
  if(item.category!=='shoe'&&/운동복|트레이닝|트랙\s*(?:팬츠|수트)|스웨트\s*팬츠|저지|러닝\s*(?:팬츠|쇼츠|타이츠)|스포츠\s*브라|sweatpants|tracksuit|jersey|gym\s*wear/.test(text))excluded='office_sportswear';
  return {excluded,unknown:false,penalty:0,policy:policy.mode};
 }
 return {excluded:formal!==null&&formal<policy.required?'required_formality':null,unknown:formal===null&&policy.required>0,penalty:formal===null?0:-Math.abs(formal-policy.required),policy:policy.mode};
}
export const officePolicyReason='출근은 깔끔한 캐주얼까지 허용해요. 청바지·운동화는 후보에 포함하고 슬리퍼·운동복은 제외해요.';

export const holidaySourceUrl='https://www.data.go.kr/data/15012690/openapi.do';
export const holidayRefreshMs=24*60*60*1000;
export function validDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const d=new Date(date+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date;
}
// A positive-only initial snapshot must never certify all other dates as workdays.
export function holidayOnDate(calendar,date,now=Date.now()){
 if(!validDate(date))return {date,known:false,isHoliday:null,names:[]};
 const record=calendar?.years?.[date.slice(0,4)];
 const matches=(record?.holidays||[]).filter(h=>h.date===date&&typeof h.name==='string');
 const age=now-Date.parse(record?.fetchedAt||'');
 const fresh=record?.complete===true&&Number.isFinite(age)&&age>=-60000&&age<=holidayRefreshMs*1.5;
 return {date,known:matches.length>0||fresh,isHoliday:matches.length?true:fresh?false:null,names:[...new Set(matches.map(h=>h.name))],source:record?.source||null,sourceUrl:record?.sourceUrl||holidaySourceUrl,fetchedAt:record?.fetchedAt||null,stale:!!record&&!fresh,limited:!!record&&record.complete!==true};
}

// Keep the original File for storage; send only a bounded, oriented copy to processing APIs.
export const photoUploadLimit=2500000;
export async function preparePhotoUpload(file,{createBitmap=globalThis.createImageBitmap,makeCanvas=()=>document.createElement('canvas'),read=readBase64}={}){
 if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>10*1024*1024)throw Error('JPEG·PNG·WebP 10MB 이하 사진을 선택해주세요.');
 const bitmap=await createBitmap(file,{imageOrientation:'from-image'});
 try{
  const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=makeCanvas();canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [.9,.78,.65]){
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
   if(blob&&blob.size<=photoUploadLimit)return {mimeType:'image/jpeg',data:await read(blob)};
  }
  throw Error('사진을 전송 크기에 맞추지 못했어요. 더 작은 사진을 선택해주세요.');
 }finally{bitmap.close?.();}
}
function readBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('사진을 읽지 못했어요.'));reader.readAsDataURL(blob);});}

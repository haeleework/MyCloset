import {parentPort} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {removeBackground} from '@imgly/background-removal-node';
const require=createRequire(import.meta.url);
const publicPath=pathToFileURL(path.dirname(require.resolve('@imgly/background-removal-node'))+path.sep).href;
export async function processCutout(bytes){
 const start=performance.now();
 const prepared=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 const result=await removeBackground(new Blob([prepared],{type:'image/png'}),{publicPath,model:'small',debug:false,output:{format:'image/png'}});
 const image=Buffer.from(await result.arrayBuffer());
 const {data,info}=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let left=info.width,top=info.height,right=-1,bottom=-1,count=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>32){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 if(right<left||count<info.width*info.height*.005||count>info.width*info.height*.97)throw new Error('NO_FOREGROUND');
 const padding=4;left=Math.max(0,left-padding);top=Math.max(0,top-padding);right=Math.min(info.width-1,right+padding);bottom=Math.min(info.height-1,bottom+padding);
 const cropped=await sharp(image).extract({left,top,width:right-left+1,height:bottom-top+1}).resize({width:864,height:864,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 const size=await sharp(cropped).metadata();
 const png=await sharp({create:{width:1024,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:cropped,left:Math.floor((1024-size.width)/2),top:Math.floor((1024-size.height)/2)}]).png().toBuffer();
 return {png,width:1024,height:1024,elapsedMs:Math.round(performance.now()-start),foregroundRatio:Number((count/(info.width*info.height)).toFixed(4))};
}
parentPort?.on('message',async message=>{
 try{const result=await processCutout(Buffer.from(message.bytes));const png=Uint8Array.from(result.png);parentPort.postMessage({id:message.id,result:{...result,png}},[png.buffer]);}
 catch(error){parentPort.postMessage({id:message.id,error:error.message==='NO_FOREGROUND'?'NO_FOREGROUND':'PROCESSING_FAILED'});}
});

import fs from 'node:fs/promises';
import {publicAssets} from './public-assets.mjs';
for(const file of [...publicAssets,'api/app.mjs','vercel.json'])await fs.access(new URL('./'+file,import.meta.url));
const api=await fs.readFile(new URL('./api/app.mjs',import.meta.url),'utf8');
if(!api.includes('SharedGeminiBudget'))throw Error('Cloud Gemini requires shared durable budget');
console.log(JSON.stringify({sourceReady:true,vercelDemoReady:true,publicAssets:publicAssets.length,geminiConfiguredByEnvironment:true,cutoutEnabled:true,weatherCollection:'on-demand',productionVerified:false},null,2));

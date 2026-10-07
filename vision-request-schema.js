import {visionSchema} from './vision-format.js';
// Current requests require the new visual fields; legacy saved records remain readable.
function providerSchema(value){if(Array.isArray(value))return value.map(providerSchema);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['additionalProperties','maxLength','maxItems'].includes(k)).map(([k,v])=>[k,providerSchema(v)]));return value;}
export const visionRequestSchema=providerSchema(visionSchema);
visionRequestSchema.properties.attributes.required=Object.keys(visionRequestSchema.properties.attributes.properties);

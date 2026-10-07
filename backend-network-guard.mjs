/** Test preload: deny every outbound network destination except literal loopback.
 * Run: node --import ./backend-network-guard.mjs --test
 * Dependency-injected mock fetch functions remain usable; real transports do not.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';

const key=Symbol.for('closet.backend.network.guard');
const loopback=host=>host==='localhost'||host==='::1'||host==='[::1]'||/^127(?:\.\d{1,3}){3}$/.test(host);
function hostOf(input,fallback='localhost') {
 if(input instanceof URL)return input.hostname;
 if(typeof input==='string') { try{return new URL(input).hostname;}catch{return input;} }
 if(input?.url)return hostOf(input.url);
 return String(input?.hostname||input?.host||fallback).replace(/^\[([^\]]+)\](?::\d+)?$/,'$1').replace(/^(127(?:\.\d{1,3}){3}|localhost):\d+$/,'$1');
}
export function installNetworkGuard() {
 if(globalThis[key])return globalThis[key];
 const state={blocked:[],allowed:0};
 function check(host,transport) {
  if(loopback(host)){state.allowed++;return;}
  state.blocked.push({transport,host});
  const error=new Error(`TEST_NETWORK_BLOCKED: ${transport} destination is not loopback`);
  error.code='TEST_NETWORK_BLOCKED';throw error;
 }
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async function(input,init){check(hostOf(input),'fetch');return originalFetch.call(this,input,init);};
 for(const [transport,module] of [['http',http],['https',https]])for(const method of ['request','get']) {
  const original=module[method];
  module[method]=function(...args){check(hostOf(args[0]),transport);if(args[1]&&typeof args[1]==='object')check(hostOf(args[1],hostOf(args[0])),transport);return original.apply(this,args);};
 }
 const connect=net.Socket.prototype.connect;
 net.Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  let host=typeof first==='object'?hostOf(first):typeof args[1]==='string'?args[1]:'localhost';
  if(first?.path||typeof first==='string'&&!/^\d+$/.test(first))host='non-network-socket';
  check(host,'socket');return connect.apply(this,args);
 };
 const tlsConnect=tls.connect;
 tls.connect=function(...args){const first=args[0];check(typeof first==='object'?hostOf(first):typeof args[1]==='string'?args[1]:'localhost','tls');return tlsConnect.apply(this,args);};
 globalThis[key]=state;syncBuiltinESMExports();return state;
}
export const networkGuard=installNetworkGuard();

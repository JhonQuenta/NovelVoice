import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';

// One owned localhost process. Cancel or a failed request discards its context;
// the next request reloads safely. Idle unloading releases the GPU for other apps.
export class ResidentEngine {
 constructor(root,{port=4319,idleMs=90000,binary,backend='Vulkan0'}={}){this.root=root;this.port=port;this.idleMs=idleMs;this.binary=binary;this.backend=backend;this.voices=new Map();}
 stop(){clearTimeout(this.idle);this.child?.kill();this.child=null;this.voices.clear();}
 async request(route,body){const r=await fetch(`http://127.0.0.1:${this.port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(route==='/health'?1000:600000)});if(!r.ok)throw Error(`Motor residente: ${r.status} ${await r.text()}`);return r;}
 async start(device,job){
  clearTimeout(this.idle);
  if(this.child&&this.device!==device)this.stop();
  if(this.child)return;
  // Never attach to a process we did not start.
  try{await fetch(`http://127.0.0.1:${this.port}/health`,{signal:AbortSignal.timeout(500)});throw Error('El puerto del motor residente ya está ocupado.');}catch(e){if(e.message.includes('ocupado'))throw e;}
  this.device=device;this.bootLog='';
  const binary=this.binary||path.join(this.root,'runtime','omnivoice-server.exe');
  const args=['--model',path.join(this.root,'models','omnivoice-base-Q8_0.gguf'),'--codec',path.join(this.root,'models','omnivoice-tokenizer-Q8_0.gguf'),'--host','127.0.0.1','--port',String(this.port),'--lang','Spanish','--device',device];
  this.token=randomBytes(32).toString('hex');
  const child=spawn(binary,args,{windowsHide:true,env:{...process.env,NOVELAVOZ_ENGINE_TOKEN:this.token},stdio:['ignore','pipe','pipe']});this.child=child;
  let failed;child.on('error',e=>{failed=e;});child.on('exit',()=>{if(this.child===child){this.child=null;this.voices.clear();}});
  const log=c=>{const s=c.toString('utf8');this.bootLog=(this.bootLog+s).slice(-12000);if(this.current)this.current.log=(this.current.log+s).slice(-6000);};child.stdout.on('data',log);child.stderr.on('data',log);
  const start=Date.now();
  while(Date.now()-start<120000){
   if(failed||child.exitCode!==null||job.status==='cancelled')throw failed||Error('El motor residente se cerró: '+this.bootLog.slice(-1500));
   try{await this.request('/health');return;}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  this.stop();throw Error('El motor residente no terminó de cargar.');
 }
 async generate(job,{rvq,transcript,out,text:targetText=job.text}){
  this.current=job;job.child={kill:()=>this.stop()};
  try{
   const start=Date.now(),wasLoaded=!!this.child;
   const device=job.device==='cpu'?'CPU':this.backend;
   await this.start(device,job);
   if(job.status==='cancelled'||job.timedOut)throw Error('Generación cancelada.');
   job.engineWarm=wasLoaded;job.loadElapsed=(Date.now()-start)/1000;job.compute=device;
   const ref=await fs.readFile(rvq),text=await fs.readFile(transcript,'utf8');
   const signature=createHash('sha256').update(ref).update(text).digest('hex');
   if(this.voices.get(job.profileId)!==signature){await this.request('/v1/audio/voices',{name:job.profileId,ref_text:text,rvq_b64:ref.toString('base64')});this.voices.set(job.profileId,signature);}
   const response=await this.request('/v1/audio/speech',{input:targetText,voice:job.profileId,language:'Spanish',seed:42,steps:job.steps,response_format:'wav'});
   const audio=Buffer.from(await response.arrayBuffer());
   if(job.status==='cancelled'||job.timedOut)throw Error('Generación cancelada.');
   await fs.writeFile(out,audio);
  }catch(e){this.stop();throw e;}
  finally{this.current=null;delete job.child;this.idle=setTimeout(()=>this.stop(),this.idleMs);this.idle.unref();}
 }
}

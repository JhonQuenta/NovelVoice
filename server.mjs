import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {inspectWav} from './audio.mjs';
import {createBookHandler} from './books.mjs';
import {createNarrationHandler} from './narration.mjs';
import {ResidentEngine} from './resident.mjs';
import {paragraphs,joinParagraphAudio} from './paragraph-audio.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=path.join(ROOT,'data'), BIN=path.join(ROOT,'runtime','omnivoice-tts.exe');
const CODEC=path.join(ROOT,'runtime','omnivoice-codec.exe');
const MODELS=path.join(ROOT,'models');
const resident=new ResidentEngine(ROOT);
process.on('exit',()=>resident.stop());
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{resident.stop();process.exit(0);});
const handleBooks=createBookHandler(ROOT);
await fs.mkdir(path.join(DATA,'voices'),{recursive:true});
await fs.mkdir(path.join(DATA,'renders'),{recursive:true});
const jobs=new Map();let active=null;
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const voicePath=id=>{if(!validId(id))throw Error('Perfil inválido.');return path.join(DATA,'voices',id);};
async function ready(){for(const f of [BIN,CODEC,path.join(MODELS,'omnivoice-base-Q8_0.gguf'),path.join(MODELS,'omnivoice-tokenizer-Q8_0.gguf')]){try{if((await fs.stat(f)).size<10000)return false;}catch{return false;}}return true;}
async function profiles(){const ids=await fs.readdir(path.join(DATA,'voices'));const list=[];for(const id of ids){if(!validId(id))continue;try{list.push(JSON.parse(await fs.readFile(path.join(voicePath(id),'profile.json'),'utf8')));}catch{}}return list.sort((a,b)=>b.created.localeCompare(a.created));}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)throw Error('El archivo supera el tamaño permitido.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function publicJob(job){const {child,...rest}=job;return rest;}
function runEngine(job,binary,args,input=''){
  if(job.status==='cancelled'||job.timedOut)throw Error('Prueba cancelada.');
  const child=spawn(binary,args,{cwd:path.dirname(binary),env:{...process.env},windowsHide:true,stdio:['pipe','pipe','pipe']});job.child=child;
  const append=c=>{const s=c.toString('utf8');job.log=(job.log+s).slice(-6000);const m=s.match(/LM backend: ([^\r\n(]+)/);if(m)job.compute=m[1].trim();};child.stderr.on('data',append);child.stdout.on('data',append);child.stdin.on('error',()=>{});child.stdin.end(input,'utf8');
  return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(job.timedOut?'La prueba superó 10 minutos. Prueba con un texto más corto.':job.status==='cancelled'?'Prueba cancelada.':'El motor no pudo generar el audio. Revisa el diagnóstico.')));});
}
async function cachedReference(job,vp){
  const ref=path.join(vp,'reference.wav'),rvq=path.join(vp,'reference.rvq'),meta=path.join(vp,'cache.json');
  const model=await fs.stat(path.join(MODELS,'omnivoice-tokenizer-Q8_0.gguf')),codec=await fs.stat(CODEC);
  const signature=createHash('sha256').update(await fs.readFile(ref)).update(JSON.stringify([model.size,model.mtimeMs,codec.size,codec.mtimeMs])).digest('hex');
  try{const saved=JSON.parse(await fs.readFile(meta,'utf8')),stat=await fs.stat(rvq);if(saved.signature===signature&&stat.size>0&&stat.size%11===0){job.cacheHit=true;job.log+='[Aplicación] Referencia preparada: reutilizando caché.\n';return rvq;}}catch{}
  job.cacheHit=false;job.phase='preparing';job.log+='[Aplicación] Preparando la referencia una sola vez.\n';
  const temp=path.join(vp,'cache-'+job.id+'.wav'),encoded=temp.replace(/\.wav$/,'.rvq'),start=Date.now();
  try{
    await fs.copyFile(ref,temp);
    const args=['--model',path.join(MODELS,'omnivoice-tokenizer-Q8_0.gguf'),'-i',temp];if(job.device==='cpu')args.push('--device','CPU');
    await runEngine(job,CODEC,args);
    if(job.status==='cancelled'||job.timedOut)throw Error('Prueba cancelada.');
    const stat=await fs.stat(encoded);if(!stat.size||stat.size%11!==0)throw Error('El motor no pudo preparar una referencia válida.');
    await fs.rename(encoded,rvq);await fs.writeFile(meta,JSON.stringify({signature,created:new Date().toISOString()}));job.prepareElapsed=(Date.now()-start)/1000;return rvq;
  }finally{await fs.rm(temp,{force:true});await fs.rm(encoded,{force:true});}
}
async function generate(job,profile){
  const start=Date.now(), vp=voicePath(profile.id), out=job._outPath||path.join(DATA,'renders',job.id+'.wav');
  const timer=setTimeout(()=>{job.timedOut=true;job.child?.kill();},600000);
  try {
    const ref=await cachedReference(job,vp);job.phase='generating';
    const args=['--model',path.join(MODELS,'omnivoice-base-Q8_0.gguf'),'--codec',path.join(MODELS,'omnivoice-tokenizer-Q8_0.gguf'),'-o',out,'--lang','Spanish','--seed','42','--steps',String(job.steps),'--ref-rvq',ref,'--ref-text',path.join(vp,'transcript.txt')];
    if(job.device==='cpu')args.push('--device','CPU');
    const parts=job.paragraphPauses?paragraphs(job.text):[job.text],files=[],buffers=[];
    job.paragraphTotal=parts.length;job.paragraphCompleted=0;
    let firstWarm,loadElapsed=0;
    try{
      for(let i=0;i<parts.length;i++){
        if(job.status==='cancelled'||job.timedOut)throw Error('Generación cancelada.');
        const target=parts.length>1?out+'.part-'+i+'.wav':out;
        if(parts.length>1){files.push(target);job.log+=`[Aplicación] Párrafo ${i+1}/${parts.length}; pausa añadida de 650 ms entre párrafos.\n`;}
        if(process.env.NOVELAVOZ_ENGINE==='cli'){const a=[...args];a[a.indexOf('-o')+1]=target;await runEngine(job,BIN,a,parts[i]+'\n');}
        else await resident.generate(job,{rvq:ref,transcript:path.join(vp,'transcript.txt'),out:target,text:parts[i]});
        if(i===0)firstWarm=job.engineWarm;loadElapsed+=job.loadElapsed||0;
        if(parts.length>1)buffers.push(await fs.readFile(target));job.paragraphCompleted=i+1;
      }
      job.engineWarm=firstWarm;job.loadElapsed=loadElapsed;
      if(parts.length>1)await fs.writeFile(out,joinParagraphAudio(buffers));
    }finally{for(const f of files)await fs.rm(f,{force:true});}
    if(job.status==='cancelled')return;
    const audio=await fs.readFile(out); const info=inspectWav(audio);
    if(info.duration<0.1||info.rms<0.0001)throw Error('El motor produjo audio vacío o silencioso.');
    if(job.kind==='chapter'){job.fragmentElapsed=(Date.now()-start)/1000;job.fragmentDuration=info.duration;return;}
    job.status='done';job.elapsed=(Date.now()-start)/1000;job.duration=info.duration;job.rtf=job.elapsed/info.duration;job.url='/audio/render/'+job.id;job.error=null;
    const previousTests=profile.tests||(profile.lastTest?[profile.lastTest]:[]);
    profile.lastTest={id:job.id,url:job.url,elapsed:job.elapsed,duration:info.duration,rtf:job.rtf,compute:job.compute,text:job.text,steps:job.steps,paragraphPauses:job.paragraphPauses===true,cacheHit:job.cacheHit,engineWarm:job.engineWarm,loadElapsed:job.loadElapsed,prepareElapsed:job.prepareElapsed||0,created:new Date().toISOString()};
    profile.tests=[profile.lastTest,...previousTests].slice(0,12);
    await fs.writeFile(path.join(vp,'profile.json'),JSON.stringify(profile,null,2));
  }catch(e){if(job.status!=='cancelled'){job.status='error';job.error=e.message;}}
  finally{clearTimeout(timer);delete job.child;if(job.kind!=='chapter')active=null;}
}
const narration=createNarrationHandler(ROOT,{jobs,getActive:()=>active,setActive:id=>{active=id;},generate,runEngine,voicePath});
await narration.load();
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host)){reply(res,403,{error:'Solo acceso local.'});return;}
  if(req.headers.origin&&!['http://'+host].includes(req.headers.origin)){reply(res,403,{error:'Origen no permitido.'});return;}
  const url=new URL(req.url,'http://'+host), p=url.pathname;
  try {
    if(await handleBooks(req,res,url))return;
    if(await narration.handle(req,res,url))return;
    if(req.method==='GET'&&p==='/api/status'){reply(res,200,{ready:await ready(),engine:'OmniVoice GGUF · Q8_0',active:jobs.get(active)?.kind==='chapter'?null:active,chapterActive:jobs.get(active)?.kind==='chapter'?active:null,profiles:await profiles()});return;}
    if(req.method==='POST'&&p==='/api/profiles'){
      const b=await body(req);const name=String(b.name||'').trim(),transcript=String(b.transcript||'').trim();
      if(!b.consent)throw Error('Confirma que la voz es tuya o tienes permiso para usarla.');
      if(!name||name.length>60)throw Error('Introduce un nombre de hasta 60 caracteres.');
      if(!transcript||transcript.length>2000)throw Error('Escribe la transcripción exacta de la muestra.');
      if(typeof b.wav!=='string')throw Error('Carga o graba una muestra.');
      const wav=Buffer.from(b.wav,'base64'), info=inspectWav(wav);
      if(info.duration<3||info.duration>20.05)throw Error('La muestra debe durar entre 3 y 20 segundos.');
      if(info.rms<0.004)throw Error('La grabación está prácticamente en silencio. Graba de nuevo.');
      const id=randomUUID(),dir=voicePath(id);await fs.mkdir(dir);
      const profile={id,name,transcript,created:new Date().toISOString(),...info};
      await fs.writeFile(path.join(dir,'reference.wav'),wav);await fs.writeFile(path.join(dir,'transcript.txt'),transcript,'utf8');await fs.writeFile(path.join(dir,'profile.json'),JSON.stringify(profile,null,2));reply(res,201,profile);return;
    }
    if(req.method==='DELETE'&&p.startsWith('/api/profiles/')){const id=p.split('/').pop();if(active&&jobs.get(active)?.profileId===id)throw Error('Espera a que termine la prueba antes de borrar la voz.');await fs.rm(voicePath(id),{recursive:true,force:true});reply(res,200,{ok:true});return;}
    if(req.method==='POST'&&p==='/api/generate'){
      const b=await body(req);if(active){reply(res,409,{error:'Ya hay una prueba en curso.'});return;}
      const text=String(b.text||'').trim();if(!text||text.length>1200)throw Error('Escribe entre 1 y 1200 caracteres para la prueba.');
      const steps=b.steps===undefined?16:b.steps;if(![32,24,16,8].includes(steps))throw Error('Elige 32, 24, 16 u 8 pasos.');
      if(!await ready())throw Error('El motor local todavía no está preparado.');
      const profile=JSON.parse(await fs.readFile(path.join(voicePath(b.profileId),'profile.json'),'utf8'));
      if(active){reply(res,409,{error:'Ya hay una generación en curso.'});return;}
      const job={id:randomUUID(),profileId:profile.id,text,steps,paragraphPauses:b.paragraphPauses===true,device:b.device==='cpu'?'cpu':'auto',status:'running',phase:'preparing',started:Date.now(),log:''};jobs.set(job.id,job);if(jobs.size>100)for(const [id,j]of jobs){if(j.status!=='running'){jobs.delete(id);break;}}active=job.id;
      generate(job,profile);reply(res,202,publicJob(job));return;
    }
    if(req.method==='GET'&&p.startsWith('/api/jobs/')){const j=jobs.get(p.split('/').pop());if(!j){reply(res,404,{error:'Prueba no encontrada.'});return;}reply(res,200,publicJob(j));return;}
    if(req.method==='POST'&&p.startsWith('/api/cancel/')){const j=jobs.get(p.split('/').pop());if(j?.status==='running'){j.status='cancelled';j.child?.kill();}reply(res,200,{ok:true});return;}
    if(req.method==='GET'&&p.startsWith('/audio/')){
      const parts=p.split('/'),id=parts[3];if(!validId(id))throw Error('Audio inválido.');
      let file;if(parts[2]==='reference')file=path.join(voicePath(id),'reference.wav');else if(parts[2]==='render')file=path.join(DATA,'renders',id+'.wav');else throw Error('Audio inválido.');
      const b=await fs.readFile(file);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':b.length,'Cache-Control':'no-store',...(url.searchParams.has('download')?{'Content-Disposition':'attachment; filename="prueba-voz.wav"'}:{})});res.end(b);return;
    }
    if(req.method==='GET'&&['/','/app.js','/style.css','/epub.html','/epub.js','/epub.css'].includes(p)){const name=p==='/'?'index.html':p.slice(1);const b=await fs.readFile(path.join(ROOT,name));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(b);return;}
    reply(res,404,{error:'No encontrado.'});
  }catch(e){reply(res,400,{error:e.code==='ENOENT'?'Archivo o perfil no encontrado.':e.message});}
});
const port=Number(process.env.NOVELVOICE_PORT||4318);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Puerto inválido.');
server.listen(port,'127.0.0.1',()=>console.log('NovelVoice: http://127.0.0.1:'+port));

import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {inspectWav} from './audio.mjs';
import {chapterChunks} from './paragraph-audio.mjs';
export function createNarrationHandler(root,engine){
 const storage=path.join(root,'data','chapter-jobs'),ffmpeg=path.join(root,'runtime','ffmpeg.exe');
 const valid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
 const folder=id=>{if(!valid(id))throw Error('Trabajo inválido.');return path.join(storage,id);};
 const elapsed=j=>j.runStarted?j.elapsedBefore+(Date.now()-j.runStarted)/1000:j.elapsedBefore||0;
 const publicJob=j=>{const {child,chapters,_outPath,text,runStarted,...out}=j;return {...out,elapsed:elapsed(j),chapters:chapters.map(c=>({id:c.id,title:c.title,words:c.words,total:c.chunks.filter(x=>x.text).length})),etaSeconds:j.completed>2&&j.completed<j.total?elapsed(j)/j.completed*(j.total-j.completed):null};};
 async function save(j){const {child,...state}=j;state.elapsedBefore=elapsed(j);state.runStarted=null;await fs.writeFile(path.join(folder(j.id),'state.tmp'),JSON.stringify(state));await fs.rename(path.join(folder(j.id),'state.tmp'),path.join(folder(j.id),'state.json'));}
 function silence(ms){const n=Math.round(24*ms),b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b;}
 async function fingerprint(vp){return createHash('sha256').update(await fs.readFile(path.join(vp,'reference.wav'))).update(await fs.readFile(path.join(vp,'transcript.txt'))).digest('hex');}
 async function run(j){
  j.status='running';j.runStarted=Date.now();j.error=null;delete j.timedOut;engine.setActive(j.id);
  try{
   const vp=engine.voicePath(j.profileId),profile=JSON.parse(await fs.readFile(path.join(vp,'profile.json'),'utf8'));
   if(await fingerprint(vp)!==j.voiceFingerprint)throw Error('La referencia cambió. Inicia una narración nueva con esa voz.');
   j.completed=0;let ci=0;
   for(const chapter of j.chapters){
    j.currentChapter=chapter.title;const files=[];let fi=0;const chapterStart=Date.now();
    for(const chunk of chapter.chunks){
     if(j.status==='cancelled')return;
     if(chunk.text){
      const file=`segments/c${ci}-f${fi++}.wav`;j._outPath=path.join(folder(j.id),file);j.text=chunk.text;let exists=false;
      try{const info=inspectWav(await fs.readFile(j._outPath));exists=info.rms>0.0001&&info.duration>0.1;}catch{}
      if(!exists){await engine.generate(j,profile);if(j.status==='cancelled')return;if(j.status==='error')throw Error(j.error);}
      files.push(`file '${file}'`);j.completed++;await save(j);
     }
     if(chunk.pauseAfterMs){const p=`pause-${chunk.pauseAfterMs}.wav`;await fs.writeFile(path.join(folder(j.id),p),silence(chunk.pauseAfterMs));files.push(`file '${p}'`);}
    }
    if(j.status==='cancelled')return;
    j.phase='encoding';const list=`concat-${ci}.txt`;await fs.writeFile(path.join(folder(j.id),list),files.join('\n'),'utf8');
    const wav=path.join(folder(j.id),`chapter-${ci}.wav`);
    await engine.runEngine(j,ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-f','concat','-safe','1','-i',path.join(folder(j.id),list),'-c:a','pcm_s16le',wav]);
    const output=path.join(folder(j.id),`chapter-${ci}.${j.format}`);
    const codec=j.format==='mp3'?['-c:a','libmp3lame','-b:a','96k']:j.format==='m4a'?['-c:a','aac','-b:a','96k','-movflags','+faststart']:['-c:a','libopus','-b:a','64k'];
    await engine.runEngine(j,ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-i',wav,...codec,output]);
    const info=inspectWav(await fs.readFile(wav));j.results[ci]={title:chapter.title,url:`/api/narrations/${j.id}/audio/${ci}`,duration:info.duration,bytes:(await fs.stat(output)).size};ci++;await save(j);
   }
   j.status='done';j.phase='done';j.audioDuration=j.results.reduce((a,r)=>a+r.duration,0);
  }catch(e){if(j.status!=='cancelled'){j.status='error';j.error=e.message;}}
  finally{j.elapsedBefore=elapsed(j);j.runStarted=null;delete j.child;engine.setActive(null);await save(j);}
 }
 return {
  async load(){await fs.mkdir(storage,{recursive:true});for(const id of await fs.readdir(storage)){if(!valid(id))continue;try{const j=JSON.parse(await fs.readFile(path.join(folder(id),'state.json'),'utf8'));if(j.status==='running')j.status='interrupted';j.runStarted=null;engine.jobs.set(id,j);}catch{}}},
  async handle(req,res,url){
   const p=url.pathname;const reply=(code,b)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(b));};
   if(req.method==='GET'&&p==='/api/narrations'){reply(200,[...engine.jobs.values()].filter(j=>j.kind==='chapter').map(publicJob).reverse());return true;}
   if(req.method==='POST'&&p==='/api/narrate'){
    if(engine.getActive()){reply(409,{error:'Ya hay una generación en curso.'});return true;}
    let data='',size=0;for await(const c of req){size+=c.length;if(size>100000)throw Error('Solicitud demasiado grande.');data+=c.toString('utf8');}const b=JSON.parse(data);
    if(!valid(b.bookId)||!valid(b.profileId))throw Error('Elige un libro y una voz.');if(![32,24,16,8].includes(b.steps))throw Error('Elige 32, 24, 16 u 8 pasos.');if(!['mp3','m4a','opus'].includes(b.format))throw Error('Formato inválido.');
    const book=JSON.parse(await fs.readFile(path.join(root,'data','books',b.bookId,'plan.json'),'utf8'));
    if(!Array.isArray(b.documentIds)||!b.documentIds.length||b.documentIds.some(id=>!book.documents.some(d=>d.id===id&&d.chars>0)))throw Error('Selecciona al menos un capítulo narrable.');
    const ids=new Set(b.documentIds),chapters=book.documents.filter(d=>ids.has(d.id)).map(d=>({id:d.id,title:d.title,words:d.words,chunks:chapterChunks(d,b.paragraphPauses===true)}));
    await fs.access(ffmpeg);const vp=engine.voicePath(b.profileId),voiceFingerprint=await fingerprint(vp);
    if(engine.getActive()){reply(409,{error:'Ya hay una generación en curso.'});return true;}
    const j={id:randomUUID(),kind:'chapter',bookId:b.bookId,bookTitle:book.title,profileId:b.profileId,voiceFingerprint,steps:b.steps,paragraphPauses:b.paragraphPauses===true,format:b.format,device:b.device==='cpu'?'cpu':'auto',chapters,status:'running',phase:'preparing',completed:0,total:chapters.reduce((a,c)=>a+c.chunks.filter(x=>x.text).length,0),results:[],elapsedBefore:0,created:new Date().toISOString(),log:''};
    engine.setActive(j.id);engine.jobs.set(j.id,j);try{await fs.mkdir(path.join(folder(j.id),'segments'),{recursive:true});await save(j);}catch(e){engine.setActive(null);engine.jobs.delete(j.id);throw e;}run(j).catch(e=>{j.status='error';j.error=e.message;if(engine.getActive()===j.id)engine.setActive(null);});reply(202,publicJob(j));return true;
   }
   const m=p.match(/^\/api\/narrations\/([a-f0-9-]+)(?:\/(resume|cancel|audio)(?:\/(\d+))?)?$/);if(!m)return false;const [,id,action,index]=m;const j=engine.jobs.get(id);if(!j||j.kind!=='chapter'){reply(404,{error:'Trabajo no encontrado.'});return true;}
   if(req.method==='GET'&&!action){reply(200,publicJob(j));return true;}
   if(req.method==='POST'&&action==='cancel'){if(j.status==='running'){j.status='cancelled';j.child?.kill();}reply(200,publicJob(j));return true;}
   if(req.method==='POST'&&action==='resume'){if(engine.getActive())throw Error('Espera a que termine la generación actual.');if(j.status==='done')throw Error('Este trabajo ya terminó.');engine.setActive(id);run(j).catch(e=>{j.status='error';j.error=e.message;if(engine.getActive()===id)engine.setActive(null);});reply(202,publicJob(j));return true;}
   if(req.method==='GET'&&action==='audio'){const i=Number(index);if(!Number.isInteger(i)||!j.results[i])throw Error('El audio todavía no está listo.');const buffer=await fs.readFile(path.join(folder(id),`chapter-${i}.${j.format}`));res.writeHead(200,{'Content-Type':j.format==='mp3'?'audio/mpeg':j.format==='m4a'?'audio/mp4':'audio/ogg','Content-Length':buffer.length,...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="capitulo-${i+1}.${j.format}"`}:{})});res.end(buffer);return true;}
   return false;
  }
 };
}

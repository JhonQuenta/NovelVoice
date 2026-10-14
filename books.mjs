import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
const bundledPython=path.join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
const PYTHON=process.env.NOVELVOICE_PYTHON||(await fs.access(bundledPython).then(()=>bundledPython).catch(()=>'python'));
export function createBookHandler(root){
 const books=path.join(root,'data','books');
 const json=(res,code,b)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(b));};
 const dir=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Libro inválido.');return path.join(books,id);};
 async function read(req,max=40*1024*1024){let n=0,parts=[];for await(const chunk of req){n+=chunk.length;if(n>max)throw Error('El EPUB supera 40 MB.');parts.push(chunk);}return Buffer.concat(parts);}
 async function parse(data,limit){
  if(![300,600,900].includes(limit))throw Error('Elige 300, 600 o 900 caracteres.');
  const child=spawn(PYTHON,[path.join(root,'prepare_epub.py'),String(limit)],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe']});
  return new Promise((resolve,reject)=>{let out=[],size=0,error='',tooLarge=false;const timer=setTimeout(()=>{child.kill();reject(Error('La preparación superó 60 segundos.'));},60000);child.stdout.on('data',c=>{size+=c.length;if(size>16*1024*1024){tooLarge=true;child.kill();}else out.push(c);});child.stderr.on('data',c=>{error=(error+c.toString('utf8')).slice(-2000);});child.stdin.on('error',()=>{});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(Error(tooLarge?'El texto del EPUB es demasiado grande para esta primera versión.':error||'No se pudo leer el EPUB.'));return;}try{resolve(JSON.parse(Buffer.concat(out).toString('utf8')));}catch{reject(Error('Respuesta de preparación no válida.'));}});child.stdin.end(data);});
 }
 function recalculate(b){const docs=b.documents.filter(d=>d.included);b.stats={chapters:docs.filter(d=>d.kind==='chapter').length,narrativeDocuments:docs.length,optionalDocuments:b.documents.length-docs.length,words:docs.reduce((a,d)=>a+d.words,0),chars:docs.reduce((a,d)=>a+d.chars,0),chunks:docs.reduce((a,d)=>a+d.chunks.length,0)};}
 async function save(b){await fs.writeFile(path.join(dir(b.id),'plan.json'),JSON.stringify(b));await fs.writeFile(path.join(dir(b.id),'summary.json'),JSON.stringify({id:b.id,title:b.title,stats:b.stats,chunkLimit:b.chunkLimit}));}
 return async(req,res,url)=>{
  const p=url.pathname;
  if(req.method==='GET'&&p==='/api/books'){await fs.mkdir(books,{recursive:true});let list=[];for(const id of await fs.readdir(books)){try{list.push(JSON.parse(await fs.readFile(path.join(dir(id),'summary.json'),'utf8')));}catch{}}json(res,200,list);return true;}
  if(req.method==='POST'&&p==='/api/epub'){
   const data=await read(req),plan=await parse(data,Number(url.searchParams.get('limit')||900));plan.id=randomUUID();plan.sourceSHA256=createHash('sha256').update(data).digest('hex');await fs.mkdir(dir(plan.id),{recursive:true});await fs.writeFile(path.join(dir(plan.id),'source.epub'),data);await save(plan);json(res,201,plan);return true;
  }
  const match=p.match(/^\/api\/books\/([a-f0-9-]+)(?:\/(selection|rechunk|text))?$/);
  if(!match)return false;
  const [,id,action]=match;let b=JSON.parse(await fs.readFile(path.join(dir(id),'plan.json'),'utf8'));
  if(req.method==='GET'&&!action){if(url.searchParams.has('download'))res.setHeader('Content-Disposition','attachment; filename="plan-narracion.json"');json(res,200,b);return true;}
  if(req.method==='GET'&&action==='text'){const text=b.documents.filter(d=>d.included).map(d=>d.text).join('\n\n\n');res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="texto-narracion.txt"','Cache-Control':'no-store'});res.end(text);return true;}
  if(req.method==='POST'&&action==='selection'){const input=JSON.parse((await read(req,100000)).toString('utf8'));if(!Array.isArray(input.ids)||input.ids.some(id=>typeof id!=='string'||!b.documents.some(d=>d.id===id&&d.chars>0)))throw Error('Selección de documentos inválida.');const ids=new Set(input.ids);for(const d of b.documents)d.included=ids.has(d.id);recalculate(b);await save(b);json(res,200,b);return true;}
  if(req.method==='POST'&&action==='rechunk'){const selected=new Set(b.documents.filter(d=>d.included).map(d=>d.id));const plan=await parse(await fs.readFile(path.join(dir(id),'source.epub')),Number(url.searchParams.get('limit')||900));b={...plan,id,sourceSHA256:b.sourceSHA256};for(const d of b.documents)d.included=selected.has(d.id);recalculate(b);await save(b);json(res,200,b);return true;}
  return false;
 };
}

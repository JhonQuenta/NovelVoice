import {inspectWav} from './audio.mjs';
export function paragraphs(text){return text.replace(/\r\n?/g,'\n').split(/\n[\t ]*\n(?:[\t ]*\n)*/).map(s=>s.trim()).filter(Boolean);}
export function chapterChunks(document,enabled){return document.chunks.map(c=>({...c,pauseAfterMs:enabled&&c.kind==='narration'&&document.blocks.some(b=>b.kind==='paragraph'&&b.text.endsWith(paragraphs(c.text).at(-1)))?650:c.pauseAfterMs}));}
export function joinParagraphAudio(wavs,pauseMs=650){
 const parts=[];
 for(let i=0;i<wavs.length;i++){
  const b=wavs[i],info=inspectWav(b);if(info.duration<0.1||info.rms<0.0001)throw Error('El motor produjo un párrafo vacío o silencioso.');let data;
  for(let n=12;n+8<=b.length;){const size=b.readUInt32LE(n+4);if(b.toString('ascii',n,n+4)==='data'){data=b.subarray(n+8,n+8+size);break;}n+=8+size+(size%2);}
  if(!data)throw Error('Audio incompleto.');
  if(i)parts.push(Buffer.alloc(Math.round(pauseMs*24)*2));
  parts.push(data);
 }
 const data=Buffer.concat(parts),header=Buffer.alloc(44);
 header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
 return Buffer.concat([header,data]);
}

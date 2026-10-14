import test from 'node:test';
import assert from 'node:assert/strict';
import {paragraphs,joinParagraphAudio,chapterChunks} from './paragraph-audio.mjs';
import {inspectWav} from './audio.mjs';
function wav(){const b=Buffer.alloc(44+4800);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4800,40);for(let n=44;n<b.length;n+=2)b.writeInt16LE(1000,n);return b;}
test('conserva comas y frases; separa solo líneas en blanco',()=>{assert.deepEqual(paragraphs('Maomao\r\n\r\nTexto, con comas.\nLínea continuada.\n\nJinshi'),['Maomao','Texto, con comas.\nLínea continuada.','Jinshi']);});
test('añade 650 ms de silencio sin eliminar muestras del audio',()=>{const a=wav(),b=joinParagraphAudio([a,a]);assert.equal(inspectWav(b).duration,.85);assert.deepEqual(b.subarray(44,4844),a.subarray(44));assert.ok(b.subarray(4844,4844+31200).every(v=>v===0));assert.deepEqual(b.subarray(4844+31200),a.subarray(44));});
test('respeta finales de párrafo entre fragmentos sin tratar cada corte como un párrafo',()=>{const doc={blocks:[{kind:'paragraph',text:'Primera frase. Segunda frase.'}],chunks:[{kind:'narration',text:'Primera frase.',pauseAfterMs:200},{kind:'narration',text:'Segunda frase.',pauseAfterMs:200}]};assert.deepEqual(chapterChunks(doc,true).map(c=>c.pauseAfterMs),[200,650]);assert.deepEqual(chapterChunks(doc,false),doc.chunks);});

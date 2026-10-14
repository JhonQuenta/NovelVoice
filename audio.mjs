export function inspectWav(b) {
  if (b.length < 44 || b.toString('ascii',0,4) !== 'RIFF' || b.toString('ascii',8,12) !== 'WAVE') throw Error('El archivo debe ser un WAV válido.');
  let fmt, data;
  for (let n=12; n+8<=b.length;) {
    const size=b.readUInt32LE(n+4), end=n+8+size;
    if(end>b.length) throw Error('El WAV está incompleto.');
    if(b.toString('ascii',n,n+4)==='fmt ') {
      if(size<16) throw Error('Cabecera de audio incompleta.');
      fmt={format:b.readUInt16LE(n+8),channels:b.readUInt16LE(n+10),rate:b.readUInt32LE(n+12),bits:b.readUInt16LE(n+22)};
    }
    if(b.toString('ascii',n,n+4)==='data') data=b.subarray(n+8,end);
    n=end+(size%2);
  }
  if(!fmt || !data || fmt.format!==1 || fmt.channels!==1 || fmt.rate!==24000 || fmt.bits!==16) throw Error('Se requiere WAV mono PCM de 16 bits a 24 kHz.');
  const count=data.length/2;
  if(!Number.isInteger(count)||!count) throw Error('El audio no contiene muestras válidas.');
  let sum=0, peak=0, clipped=0;
  for(let i=0;i<count;i++) {const v=Math.abs(data.readInt16LE(i*2)/32768);sum+=v*v;peak=Math.max(peak,v);if(v>=0.99)clipped++;}
  return {duration:count/fmt.rate,rms:Math.sqrt(sum/count),peak,clipped:clipped/count};
}

"""Read EPUB locally without extracting files or fetching external resources."""
import io,json,posixpath,re,sys,zipfile,xml.etree.ElementTree as ET
from urllib.parse import unquote,urlsplit
from html.parser import HTMLParser

def tag(e): return e.tag.rsplit('}',1)[-1].lower()
def clean(s): return re.sub(r'\s+',' ',s.replace('\u00ad','').replace('\u200b','').replace('\ufeff','')).strip()
def xml(raw):
    if b'<!ENTITY' in raw.upper(): raise ValueError('El EPUB contiene declaraciones de entidades no admitidas.')
    return ET.fromstring(raw)
def resolve(base,href):
    url=urlsplit(href)
    if url.scheme or url.netloc: raise ValueError('Referencia externa no admitida en el EPUB.')
    p=posixpath.normpath(posixpath.join(base,unquote(url.path)))
    if p.startswith('../') or p.startswith('/') or '\\' in p: raise ValueError('Ruta interna de EPUB inválida.')
    return p
def inner(e):
    if tag(e) in {'script','style','nav','svg','img','rt','rp'}: return ''
    out=e.text or ''
    for c in e: out+=(' ' if tag(c)=='br' else inner(c))+(c.tail or '')
    return out
class Fallback(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True);self.blocks=[];self.parts=[];self.current=None;self.skip=0
    def handle_starttag(self,t,a):
        if t in ['script','style','nav']: self.skip+=1
        if self.skip:return
        if t in ['p','h1','h2','h3','h4','li']:
            if self.current:self.flush()
            self.current=t;self.parts=[]
        if t=='br':self.parts.append(' ')
        if t=='hr':self.blocks.append({'kind':'scene','original':'','text':'','pauseAfterMs':900})
    def handle_endtag(self,t):
        if t in ['script','style','nav'] and self.skip:self.skip-=1;return
        if t==self.current:self.flush()
    def handle_data(self,d):
        if self.current and not self.skip:self.parts.append(d)
    def flush(self):
        text=clean(''.join(self.parts))
        if text:self.blocks.append({'kind':'heading' if self.current.startswith('h') else 'paragraph','original':text,'text':text,'pauseAfterMs':600 if self.current.startswith('h') else 200})
        self.current=None;self.parts=[]
def blocks_from(raw):
    warnings=[]
    try: root=xml(raw)
    except ET.ParseError:
        parser=Fallback();parser.feed(raw.decode('utf-8',errors='strict'));parser.flush();return parser.blocks,['XHTML no válido: extracción HTML alternativa; revisa este documento.'],0
    body=next((e for e in root.iter() if tag(e)=='body'),root)
    blocks=[]
    def walk(e):
        t=tag(e)
        if t in {'script','style','nav','svg','img','rt','rp'}:return
        if t=='hr':blocks.append({'kind':'scene','original':'','text':'','pauseAfterMs':900});return
        if t in {'p','h1','h2','h3','h4','li'} and not(t=='li' and any(tag(c)=='p' for c in e)):
            original=inner(e);text=clean(original)
            if not text:return
            scene=bool(re.fullmatch(r'[＊*·•◇◆✦✧\s—―-]{3,}',text))
            blocks.append({'kind':'scene' if scene else 'heading' if t.startswith('h') else 'paragraph','original':original,'text':'' if scene else text,'pauseAfterMs':900 if scene else 600 if t.startswith('h') else 200})
            return
        for c in e:walk(c)
    walk(body)
    if not blocks and clean(inner(body)):warnings.append('Documento con texto fuera de párrafos: requiere revisión.');blocks=[{'kind':'paragraph','original':inner(body),'text':clean(inner(body)),'pauseAfterMs':200}]
    if any('\ufffd' in b['text'] for b in blocks):warnings.append('Hay caracteres de sustitución: revisa la codificación del archivo original.')
    paras=[b['text'] for b in blocks if b['kind']=='paragraph']
    cuts=sum(bool(a and b and not re.search(r'[.!?…:;»”"\)]$',a) and b[0].islower()) for a,b in zip(paras,paras[1:]))
    if cuts:warnings.append(f'{cuts} posibles cortes de párrafo. Se conservan; no se unen automáticamente.')
    return blocks,warnings,sum(tag(e) in {'img','image'} for e in root.iter())
def sentences(text):
    protected=re.sub(r'\b(Sr|Sra|Srta|Dr|Dra|D|Dña|Ud|Uds|etc|aprox)\.',lambda m:m[0].replace('.','\ue000'),text,flags=re.I)
    return [s.replace('\ue000','.') for s in re.split(r'(?<=[.!?…])\s+(?=[¿¡«“"—–A-ZÁÉÍÓÚÜÑ0-9])',protected) if s]
def chunks_for(blocks,limit):
    chunks=[];parts=[];length=0;pause=0
    def flush():
        nonlocal parts,length,pause
        if parts:
            text=''.join(parts);chunks.append({'index':len(chunks)+1,'kind':'narration','text':text,'chars':len(text),'pauseAfterMs':pause,'overLimit':len(text)>limit});parts=[];length=0;pause=0
    for b in blocks:
        if b['kind']=='scene':flush();chunks.append({'index':len(chunks)+1,'kind':'pause','text':'','chars':0,'pauseAfterMs':b['pauseAfterMs'],'overLimit':False});continue
        if b['kind']=='heading':
            flush();chunks.append({'index':len(chunks)+1,'kind':'heading','text':b['text'],'chars':len(b['text']),'pauseAfterMs':b['pauseAfterMs'],'overLimit':len(b['text'])>limit});continue
        for i,sentence in enumerate(sentences(b['text'])):
            separator=('\n\n' if i==0 else ' ') if parts else ''
            if parts and length+len(separator)+len(sentence)>limit:flush();separator=''
            parts.append(separator+sentence);length+=len(separator)+len(sentence);pause=b['pauseAfterMs']
        if b['kind']=='heading':flush()
    flush();return chunks
def prepare(data,limit=900):
    if limit not in [300,600,900]:raise ValueError('El tamaño debe ser 300, 600 o 900 caracteres.')
    if len(data)>40*1024*1024:raise ValueError('El EPUB supera 40 MB.')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries=z.infolist()
        if len(entries)>3000 or sum(i.file_size for i in entries)>100*1024*1024 or any(i.file_size>15*1024*1024 for i in entries):raise ValueError('El EPUB supera los límites de lectura segura.')
        if len({i.filename for i in entries})!=len(entries):raise ValueError('El EPUB contiene rutas duplicadas.')
        container=xml(z.read('META-INF/container.xml'));opf=next(e.attrib['full-path'] for e in container.iter() if tag(e)=='rootfile');opf=resolve('',opf)
        pack=xml(z.read(opf));base=posixpath.dirname(opf)
        manifest={e.attrib['id']:e.attrib for e in pack.iter() if tag(e)=='item'};spine=[e.attrib for e in pack.iter() if tag(e)=='itemref']
        title=next((e.text for e in pack.iter() if tag(e)=='title' and e.text),'Sin título');lang=next((e.text for e in pack.iter() if tag(e)=='language'),'');toc={}
        for m in manifest.values():
            if 'nav' in m.get('properties','').split():
                navpath=resolve(base,m['href']);nav=xml(z.read(navpath))
                tocnav=next((e for e in nav.iter() if tag(e)=='nav' and 'toc' in ' '.join(e.attrib.values()).split()),None)
                for anchor in (tocnav if tocnav is not None else nav).iter():
                    if tag(anchor)=='a' and anchor.attrib.get('href'):
                        try:toc.setdefault(resolve(posixpath.dirname(navpath),anchor.attrib['href']),clean(inner(anchor)))
                        except ValueError:pass
        for m in manifest.values():
            if 'ncx' in m.get('media-type',''):
                tocpath=resolve(base,m['href']);nav=xml(z.read(tocpath))
                for n in nav.iter():
                    if tag(n)=='navpoint':
                        content=next((e for e in n if tag(e)=='content'),None);label=next((e for e in n if tag(e)=='navlabel'),None)
                        if content is not None and label is not None:
                            try:toc.setdefault(resolve(posixpath.dirname(tocpath),content.attrib['src']),clean(inner(label)))
                            except ValueError:pass
        documents=[]
        for order,item in enumerate(spine):
            m=manifest[item['idref']]
            if m.get('media-type') not in ['application/xhtml+xml','text/html']:continue
            p=resolve(base,m['href']);blocks,warnings,images=blocks_from(z.read(p));heads=[b['text'] for b in blocks if b['kind']=='heading'];label=toc.get(p) or next((h for h in heads if h),posixpath.basename(p));label=re.sub(r':(?=\S)',': ',label)
            match=re.search(r'\bcap[ií]tulo\s+(\d+)\b',label,re.I) or re.search(r'\bcap[ií]tulo\s+(\d+)\b',' '.join(heads),re.I)
            kind='chapter' if match else 'prologue' if re.search(r'pr[oó]logo',label,re.I) else 'epilogue' if re.search(r'ep[ií]logo',label,re.I) else 'supplement'
            narrative=kind in ['chapter','prologue','epilogue'];text='\n\n'.join(b['text'] for b in blocks if b['text']);chunks=chunks_for(blocks,limit)
            if sum(bool(re.search(r'\bcap[ií]tulo\b',h,re.I)) for h in heads)>1:warnings.append('Hay varios encabezados de capítulo en el mismo documento; revisa la separación.')
            if any(c['overLimit'] for c in chunks):warnings.append('Hay frases más largas que el tamaño elegido. Se conservan completas.')
            documents.append({'id':str(order+1),'order':order+1,'path':p,'paths':[p],'indexed':p in toc,'hasHeading':bool(heads),'title':label,'kind':kind,'chapterNumber':int(match[1]) if match else None,'included':narrative and bool(text),'reason':'Contenido narrativo' if narrative else 'Material adicional: selección opcional' if text else 'Documento visual sin texto narrable','images':images,'warnings':warnings,'paragraphs':sum(b['kind']=='paragraph' for b in blocks),'words':len(re.findall(r'\b\w+\b',text)),'chars':len(text),'text':text,'blocks':blocks,'chunks':chunks})
        # Adapted from NovelEpub's logical chapter grouping: an indexed
        # chapter may span several XHTML files. This does not join paragraphs.
        grouped=[]
        for d in documents:
            previous=grouped[-1] if grouped else None
            continuation=previous and previous['kind'] in ['chapter','prologue','epilogue'] and ((d['indexed'] and d['title']==previous['title']) or (not d['indexed'] and not d['hasHeading']))
            if continuation:
                previous['paths']+=d['paths'];previous['blocks']+=d['blocks'];previous['images']+=d['images'];previous['warnings']+=d['warnings'];previous['paragraphs']+=d['paragraphs'];previous['words']+=d['words'];previous['text']='\n\n'.join(b['text'] for b in previous['blocks'] if b['text']);previous['chars']=len(previous['text']);previous['chunks']=chunks_for(previous['blocks'],limit)
            else:grouped.append(d)
        documents=grouped
        selected=[d for d in documents if d['included']];numbers=[d['chapterNumber'] for d in selected if d['kind']=='chapter'];warnings=[]
        if len(set(numbers))!=len(numbers):warnings.append('Hay números de capítulo duplicados.')
        if numbers and numbers!=list(range(numbers[0],numbers[0]+len(numbers))):warnings.append('La numeración de capítulos presenta saltos o cambios de orden.')
        if lang and not lang.lower().startswith('es'):warnings.append('El idioma declarado no es español. Revisa antes de narrar.')
        return {'title':title,'language':lang,'chunkLimit':limit,'indexDetected':bool(toc),'indexEntries':len(toc),'documents':documents,'warnings':warnings,'stats':{'chapters':len(numbers),'narrativeDocuments':len(selected),'optionalDocuments':len(documents)-len(selected),'words':sum(d['words'] for d in selected),'chars':sum(d['chars'] for d in selected),'chunks':sum(len(d['chunks']) for d in selected)},'processing':['Índice EPUB 3 o NCX y orden de lectura detectados, siguiendo la lógica de NovelEpub.','Acentos, puntuación, párrafos y diálogos conservados.','No se repara, reescribe, resume ni traduce el contenido.','Ilustraciones no enviadas al motor de voz.','Fragmentos separados por frases completas; pausas aplicadas al unir el audio.']}
if __name__=='__main__':
    try:
        data=sys.stdin.buffer.read(41*1024*1024)
        result=prepare(data,int(sys.argv[1]) if len(sys.argv)>1 else 900)
        sys.stdout.buffer.write(json.dumps(result,ensure_ascii=False).encode('utf-8'))
    except Exception as e:
        sys.stderr.buffer.write(('No se pudo preparar el EPUB: '+str(e)).encode('utf-8'));sys.exit(1)

import unittest,zipfile,io,json,re
from pathlib import Path
from prepare_epub import prepare,blocks_from,chunks_for,clean
def fixture_epub():
 out=io.BytesIO()
 labels=['Prólogo']+[f'Capítulo {i}: Prueba {i}' for i in range(1,21)]+['Epílogo','Notas']
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('mimetype','application/epub+zip')
  z.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
  manifest=''.join(f'<item id="d{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(labels)))
  spine=''.join(f'<itemref idref="d{i}"/>' for i in range(len(labels)))
  z.writestr('OEBPS/content.opf',f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Prueba sintética</dc:title><dc:language>es</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{manifest}</manifest><spine>{spine}</spine></package>')
  links=''.join(f'<li><a href="c{i}.xhtml">{label}</a></li>' for i,label in enumerate(labels))
  z.writestr('OEBPS/nav.xhtml',f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>{links}</ol></nav></body></html>')
  for i,label in enumerate(labels):z.writestr(f'OEBPS/c{i}.xhtml',f'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>{label}</h1><p>Una historia de prueba, sin datos personales.</p><p>Otro párrafo para comprobar la conservación.</p></body></html>')
 return out.getvalue()
class EpubTests(unittest.TestCase):
 def test_synthetic_book_and_no_text_loss(self):
  b=prepare(fixture_epub(),600)
  self.assertEqual(b['stats']['chapters'],20)
  self.assertEqual(b['stats']['narrativeDocuments'],22)
  self.assertEqual([d['chapterNumber'] for d in b['documents'] if d['kind']=='chapter'],list(range(1,21)))
  for d in b['documents']:
   self.assertEqual(clean(' '.join(c['text'] for c in d['chunks'])),clean(d['text']),d['title'])
   self.assertTrue(all(c['chars']==len(c['text']) for c in d['chunks']))
  self.assertFalse(any(d['included'] for d in b['documents'] if d['kind']=='supplement'))
 def test_does_not_join_suspicious_paragraphs(self):
  blocks,warnings,_=blocks_from(b'<html><body><p>Esto parece un corte</p><p>en mitad de una frase.</p></body></html>')
  self.assertEqual(len(blocks),2);self.assertTrue(warnings)
 def test_preserves_long_sentences_and_scene_pause(self):
  blocks=[{'kind':'paragraph','text':'Una frase '+('larga '*100)+'.','pauseAfterMs':200},{'kind':'scene','text':'','pauseAfterMs':900}]
  c=chunks_for(blocks,300);self.assertTrue(c[0]['overLimit']);self.assertEqual(c[0]['text'],blocks[0]['text']);self.assertEqual(c[1]['kind'],'pause')
 def test_skips_scripts_and_ruby_readings(self):
  b,_,_=blocks_from(b'<html><body><p>Nombre <ruby>Elena<rt>lectura</rt></ruby> final.</p><script>Instrucciones ajenas</script></body></html>')
  self.assertEqual(b[0]['text'],'Nombre Elena final.')
 def test_rejects_entity_declarations(self):
  with self.assertRaises(ValueError):blocks_from(b'<!DOCTYPE html [<!ENTITY x "text">]><html><p>&x;</p></html>')
if __name__=='__main__':unittest.main()

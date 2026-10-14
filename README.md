# NovelVoice

Prototipo local para narrar EPUB en español con una voz de referencia, usando OmniVoice GGUF. **Proyecto en pausa**: este repositorio conserva el estado funcional actual, no una versión final.

## Funciones

- Cargar una grabación o grabar con el micrófono, recortar y guardar un perfil de voz con su transcripción.
- Probar narración con 8, 16, 24 o 32 pasos y comparar las últimas pruebas.
- Importar EPUB, detectar el índice, seleccionar prólogo/capítulos y revisar los fragmentos.
- Motor residente con Vulkan, referencia codificada en caché y tamaños orientativos de 300/600/900 caracteres.
- Exportar cada capítulo a MP3, M4A u Opus; cancelar y continuar fragmentos pendientes.
- Modo opcional de pausas entre párrafos: añade 650 ms, pero puede aumentar mucho el tiempo.

No repara, traduce ni reescribe el EPUB. No entrena una voz nueva: utiliza una referencia. La exportación por paquetes de 20 capítulos queda pendiente.

## Instalar en Windows x64

1. Instalar **Node.js 22 o posterior** y **Python 3.10 o posterior**; ambos deben estar en PATH.
2. Clonar o descargar este repositorio.
3. En la [versión v0.1.0](https://github.com/JhonQuenta/NovelVoice/releases/tag/v0.1.0), descargar `NovelVoice-runtime-windows-x64.zip` y extraerlo en la raíz del proyecto. Debe quedar `runtime/omnivoice-server.exe`, junto a los demás ejecutables y licencias.
4. Descargar los modelos ejecutando desde PowerShell:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Descargar-modelos.ps1
   ```

   El script descarga unos 945 MB, verifica SHA-256 y conserva los archivos correctos si ya existen. Las URLs y la revisión están fijadas en el script.
5. Abrir `Iniciar.cmd`, o ejecutar `npm start`, y visitar **http://127.0.0.1:4318**. Mantener abierto el proceso mientras se narra.

La compilación incluida utiliza CPU AVX2 y Vulkan. Requiere un controlador gráfico con Vulkan. No requiere CUDA ni un compilador para ejecutar la aplicación. Si se dispone del runtime de Codex instalado, el programa puede usar sus versiones locales de Node/Python; también funciona con instalaciones normales.

Variables opcionales:

- `NOVELVOICE_PYTHON`: ruta al ejecutable Python.
- `NOVELVOICE_PORT`: puerto del servidor; por defecto 4318.
- `NOVELAVOZ_ENGINE=cli`: ruta antigua de ejecución por fragmento, para diagnóstico. El valor habitual es el motor residente.

## Uso

Primero crear un perfil de voz con una grabación clara y su transcripción exacta. Después cargar el EPUB, pulsar el título para cambiar la vista previa y marcar sus casillas para seleccionar qué narrar. «Solo el mostrado» selecciona únicamente la entrada visible. «Narrar selección» inicia el trabajo; «Probar este fragmento» lleva solo ese fragmento al laboratorio.

Valores iniciales: 16 pasos, 900 caracteres orientativos, Vulkan y caché. Más pasos pueden mejorar la calidad; los tiempos y la entonación dependen del texto. Las pausas entre párrafos comienzan desactivadas y la elección se conserva en el navegador.

## Privacidad y archivos excluidos

El servidor escucha solo en 127.0.0.1. Las grabaciones, las transcripciones y los textos no se envían a un servicio de narración externo. Los datos se crean localmente en `data/`.

**Git no incluye** grabaciones, perfiles, referencias RVQ, EPUB, audios generados, mediciones personales, pesos GGUF ni ejecutables. Los ejecutables se conservan como un recurso separado de la versión; los modelos se descargan de su fuente original. Las pruebas de EPUB construyen un libro sintético en memoria, sin usar novelas privadas.

## Pruebas

Con un servidor del proyecto abierto:

```powershell
npm test
python test_epub.py
```

`tests.mjs` comprueba validación y protección de la API; `test_paragraphs.mjs` comprueba conservación de texto y silencios; `test_epub.py` comprueba índice y contenido de un EPUB sintético.

Para probar otra instancia: definir `NOVELVOICE_PORT` al iniciar el servidor y `NOVELVOICE_TEST_URL` al ejecutar los tests de API. Las pruebas no necesitan descargar modelos ni generar una narración real.

## Limitaciones conocidas

- En una GTX 1650 de portátil, la síntesis puede ser más lenta que escuchar el audio. El motor residente evita recargas, pero no elimina los cálculos del modelo.
- Los saltos de párrafo y las comas no garantizan una pausa con el modo rápido. Las pausas forzadas separan párrafos y aumentan el coste; no fuerzan las comas.
- La calidad y el parecido requieren revisión auditiva. Cambiar pasos, referencia o separación puede cambiar el resultado.
- Si se cierra el programa, los fragmentos completos se conservan; el fragmento en curso debe regenerarse.
- El motor se descarga tras 90 segundos sin generar para liberar memoria de la GPU.

## Motor y terceros

El motor procede de [ServeurpersoCom/omnivoice.cpp](https://github.com/ServeurpersoCom/omnivoice.cpp), revisión `2c32cd336881ef12fcf69245d0cedce2e4d19d6c`; GGML usa la revisión `2eddaf94a8cdbbf1c30017d28313cd661a9da543`. Las adaptaciones del servidor están en [runtime/NovelaVoz-native.patch](runtime/NovelaVoz-native.patch), y las opciones de compilación y checksums están en `runtime/ORIGEN.md` y `runtime/SHA256SUMS.txt`.

OmniVoice y GGML usan MIT. La ficha archivada de los pesos declara Apache 2.0 para OmniVoice y su códec; consultar [runtime/MODEL-CARD.md](runtime/MODEL-CARD.md) y las licencias de los archivos descargados. FFmpeg procede de BtbN, compilación Windows x64 LGPL; sus fuentes y construcción están documentadas en `runtime/FFMPEG-ORIGEN.md`. Estas licencias de terceros no conceden por sí mismas una licencia al código propio de NovelVoice.

# Motor incluido

Compilación local de omnivoice.cpp para Windows x64, con CPU AVX2 y Vulkan. Aceleración verificada sobre NVIDIA GeForce GTX 1650, driver 617.42. No requiere instalar CUDA ni el compilador.

- Fuente: https://github.com/ServeurpersoCom/omnivoice.cpp
- Revisión: 2c32cd336881ef12fcf69245d0cedce2e4d19d6c
- GGML: https://github.com/ServeurpersoCom/ggml, revisión 2eddaf94a8cdbbf1c30017d28313cd661a9da543
- Compilador: WinLibs MinGW-w64 GCC 16.2.0, C++17.
- `omnivoice-server.exe`: misma fuente y compilador. Adaptaciones en `NovelaVoz-native.patch`: pasos por petición (8/16/24/32), salida WAV con el mismo procesamiento final que la CLI, token privado entre aplicación y motor, y compatibilidad de cpp-httplib con MinGW. Modelo y códec permanecen cargados entre peticiones. Solo escucha en 127.0.0.1.
- Opciones: Release, GGML_VULKAN=ON, GGML_CUDA=OFF, GGML_NATIVE=OFF, GGML_OPENMP=OFF, BUILD_SHARED_LIBS=OFF, enlace estático. Vulkan usa el cargador de Windows ya instalado con el controlador gráfico.
- Herramientas de compilación: CMake, Ninja, Shaderc / glslang / SPIRV-Tools de conda-forge y cabeceras de Vulkan / SPIRV de Khronos. Estas herramientas no se incluyen ni se necesitan para ejecutar el programa.

Pesos descargados de Serveurperso/OmniVoice-GGUF, revisión 361609388ae572a820d085185bbbe2a2aac4b30e. SHA-256 verificado contra los objetos LFS del repositorio:

```
2882d887921798aea13d45236556bdf8012842ab6f8cd2690943eead6289f298  omnivoice-base-Q8_0.gguf
75204fa566a8e30984e7a1066da6557184c9fd099c8f1bc0cb5b9415edfec255  omnivoice-tokenizer-Q8_0.gguf
```

La ficha del modelo archivada en MODEL-CARD.md declara Apache 2.0 para el modelo y el códec. Consulta siempre las licencias de los pesos descargados. Atribución: OmniVoice por Xiaomi / k2-fsa; conversión GGUF por Serveurperso; códec Higgs Audio v2 por Boson AI. Las licencias del motor y de GGML se incluyen junto al ejecutable.

Comprobación del 13 de octubre de 2026: una referencia de voz sintética de 3,78 segundos produjo una narración distinta de 4,97 segundos en 27,214 segundos totales, con backend Vulkan0 sobre la GTX 1650. Esto valida el funcionamiento técnico, no el parecido con la voz del usuario ni el rendimiento de un EPUB completo. Se usaron 32 pasos de generación y semilla 42.

$ErrorActionPreference = 'Stop'
$taskModelDir = Join-Path $PSScriptRoot 'models'
New-Item -ItemType Directory -Force -Path $taskModelDir | Out-Null
$taskRevision = '361609388ae572a820d085185bbbe2a2aac4b30e'
$taskModels = @(
    @{Name='omnivoice-base-Q8_0.gguf'; Hash='2882d887921798aea13d45236556bdf8012842ab6f8cd2690943eead6289f298'},
    @{Name='omnivoice-tokenizer-Q8_0.gguf'; Hash='75204fa566a8e30984e7a1066da6557184c9fd099c8f1bc0cb5b9415edfec255'}
)
foreach ($taskModel in $taskModels) {
    $taskTarget = Join-Path $taskModelDir $taskModel.Name
    if ((Test-Path -LiteralPath $taskTarget) -and ((Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash -eq $taskModel.Hash)) {
        Write-Host ('Modelo verificado: ' + $taskModel.Name)
        continue
    }
    $taskPartial = $taskTarget + '.part'
    $taskUrl = 'https://huggingface.co/Serveurperso/OmniVoice-GGUF/resolve/' + $taskRevision + '/' + $taskModel.Name
    Write-Host ('Descargando ' + $taskModel.Name)
    Invoke-WebRequest -Uri $taskUrl -OutFile $taskPartial
    if ((Get-FileHash -LiteralPath $taskPartial -Algorithm SHA256).Hash -ne $taskModel.Hash) {
        throw ('Checksum incorrecto; no se instalará ' + $taskModel.Name)
    }
    Move-Item -LiteralPath $taskPartial -Destination $taskTarget -Force
}
Write-Host 'Modelos listos. Abre Iniciar.cmd para usar NovelVoice.'

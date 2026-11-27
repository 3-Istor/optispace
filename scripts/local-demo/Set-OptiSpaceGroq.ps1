$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'OptiSpace - configuration Groq'
$keyFile = Join-Path $PSScriptRoot '.groq-key.xml'
$temporaryFile = "$keyFile.$([guid]::NewGuid().ToString('N')).tmp"

Write-Host 'Configuration locale de Groq pour OptiSpace'
Write-Host 'La clé sera conservée chiffrée pour votre compte Windows et réutilisée au démarrage.'
$key = Read-Host -AsSecureString 'Collez votre clé Groq, puis appuyez sur Entrée'
try {
    if ($null -eq $key -or $key.Length -eq 0) { throw 'Saisie vide. La configuration existante est conservée.' }
    $key | Export-Clixml -LiteralPath $temporaryFile
    if (Test-Path -LiteralPath $keyFile) {
        [IO.File]::Replace($temporaryFile, $keyFile, [NullString]::Value)
    } else {
        [IO.File]::Move($temporaryFile, $keyFile)
    }
    Write-Host 'Clé Groq enregistrée. Le serveur peut maintenant la charger.'
} finally {
    if ($null -ne $key) { $key.Dispose() }
    if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile }
}

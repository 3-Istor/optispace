param(
    [Alias('WithoutGemini')][switch]$WithoutAI,
    [ValidateSet('groq')][string]$ReportProvider = 'groq',
    [switch]$SmokeTest,
    [switch]$ReferenceCases,
    [switch]$VerifyAIAD,
    [switch]$AIADData
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $repo 'backend'
$frontend = Join-Path $repo 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$node = (Get-Command node.exe).Source
$serverPort = '5301'
$webPort = '5300'
$webUrl = "http://127.0.0.1:$webPort"
$knownCases = Join-Path $PSScriptRoot 'verified-cases.json'
$keyFile = Join-Path $PSScriptRoot ('.' + $ReportProvider + '-key.xml')
$keyEnvName = 'GROQ_API_KEY'
$keySetting = 'groq_api_key'
$providerName = 'Groq'
$demoEnvNames = @('DB_TYPE', 'DB_ENABLED', 'SQLITE_PATH', 'OIDC_ISSUER', 'DEV_FAKE_USER', 'BACKEND_HOST', 'PYTHONPATH', 'GEMINI_API_KEY', 'GROQ_API_KEY')
$previousEnv = @{}
foreach ($name in $demoEnvNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
    $env:DB_TYPE = 'sqlite'
    $env:DB_ENABLED = 'true'
    $databaseName = if ($ReferenceCases -or $SmokeTest) { 'optispace-iot38.sqlite3' } else { 'optispace-fm-demo.sqlite3' }
    $env:SQLITE_PATH = Join-Path $PSScriptRoot $databaseName
    if ($AIADData) {
        if ($ReferenceCases -or $SmokeTest -or $VerifyAIAD) { throw 'Utilisez -AIADData seul, avec éventuellement -ReportProvider et -WithoutAI.' }
        $env:SQLITE_PATH = Join-Path $repo 'output\aiad\demo.sqlite3'
        if (-not (Test-Path -LiteralPath $env:SQLITE_PATH)) { throw 'Lancez verify_aiad.py avant -AIADData pour préparer le jeu figé.' }
    }
    $env:OIDC_ISSUER = ''
    $env:DEV_FAKE_USER = '{"sub":"iot38-local-fm","email":"test-fm@example.com","name":"Facility manager local","groups":["facility-managers"],"organization":["demo-a"]}'
    $env:BACKEND_HOST = "http://127.0.0.1:$serverPort"
    $env:PYTHONPATH = $backend
    if ($WithoutAI -or $SmokeTest) { $env:GROQ_API_KEY = ' ' }

    if (($ReferenceCases -or $SmokeTest) -and -not (Test-Path -LiteralPath $knownCases)) {
        if (Test-Path -LiteralPath $env:SQLITE_PATH) { throw 'La base locale existe déjà. Utilisez une base vide pour réinitialiser cet essai.' }
        Push-Location -LiteralPath $backend
        try {
            & $python -m alembic upgrade head
            if ($LASTEXITCODE -ne 0) { throw 'Échec de la préparation de la base locale.' }
            & $python (Join-Path $PSScriptRoot 'seed_demo.py') (Join-Path $PSScriptRoot 'iot-38.json') $knownCases
            if ($LASTEXITCODE -ne 0) { throw 'Échec du chargement des données fictives.' }
        } finally { Pop-Location }
    }

    if (-not ($ReferenceCases -or $SmokeTest -or $VerifyAIAD -or $AIADData)) {
        Push-Location -LiteralPath $backend
        try {
            & $python -m alembic upgrade head
            if ($LASTEXITCODE -ne 0) { throw 'Échec de la préparation de la base FM.' }
            & $python (Join-Path $PSScriptRoot 'seed_report_demo.py')
            if ($LASTEXITCODE -ne 0) { throw 'Échec du chargement des données simulées FM.' }
        } finally { Pop-Location }
    }

    if (-not $WithoutAI -and -not $SmokeTest) {
        $Host.UI.RawUI.WindowTitle = "OptiSpace - essai local $providerName"
        Write-Host 'OptiSpace local - rapport Facility Manager et données simulées'
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($keyEnvName, 'Process'))) {
            Push-Location -LiteralPath $backend
            try {
                $configured = & $python -c 'import sys; from app.config import get_settings; print(int(bool(getattr(get_settings(), sys.argv[1]).get_secret_value().strip())))' $keySetting
                if ($LASTEXITCODE -ne 0) { throw 'Échec de la lecture de la configuration IA.' }
            } finally { Pop-Location }
            if ($configured -ne '1') {
                if (-not (Test-Path -LiteralPath $keyFile)) { & (Join-Path $PSScriptRoot ("Set-OptiSpace$providerName.ps1")) }
                try {
                    $key = Import-Clixml -LiteralPath $keyFile
                } catch {
                    throw 'Impossible de déchiffrer la clé locale dans cette session. Lancez ce script depuis votre terminal Windows habituel, avec le compte utilisé pour enregistrer la clé.'
                }
                try {
                    if ($key -isnot [Security.SecureString] -or $key.Length -eq 0) { throw "La clé locale est illisible. Relancez Set-OptiSpace$providerName.ps1." }
                    [Environment]::SetEnvironmentVariable($keyEnvName, [System.Net.NetworkCredential]::new('', $key).Password, 'Process')
                } finally {
                    if ($key -is [Security.SecureString]) { $key.Dispose() }
                }
            }
        }
        Write-Host "Configuration $providerName chargée pour la synthèse et le rapport."
    } else {
        Write-Host 'Mode de test sans IA.'
    }

    if ($VerifyAIAD) {
        Push-Location -LiteralPath $backend
        try {
            & $python (Join-Path $PSScriptRoot 'verify_aiad.py') --real-provider
            if ($LASTEXITCODE -ne 0) { throw 'Échec de la recette AIAD. Consultez les assertions affichées.' }
        } finally { Pop-Location }
        return
    }

    $server = $null
    $web = $null
    try {
        try {
            $server = Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -PassThru `
                -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',$serverPort) `
                -RedirectStandardOutput (Join-Path $PSScriptRoot 'backend.stdout.log') `
                -RedirectStandardError (Join-Path $PSScriptRoot 'backend.stderr.log')
        } finally {
            Remove-Item -LiteralPath 'Env:GEMINI_API_KEY' -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath 'Env:GROQ_API_KEY' -ErrorAction SilentlyContinue
        }
        $web = Start-Process -FilePath $node -WorkingDirectory $frontend -WindowStyle Hidden -PassThru `
            -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',$webPort,'--strictPort') `
            -RedirectStandardOutput (Join-Path $PSScriptRoot 'frontend.stdout.log') `
            -RedirectStandardError (Join-Path $PSScriptRoot 'frontend.stderr.log')

        $ready = $false
        for ($i = 0; $i -lt 24; $i++) {
            if ($server.HasExited -or $web.HasExited) { throw "Le serveur local s'est arrêté. Consultez les journaux dans $PSScriptRoot." }
            try {
                $profile = Invoke-RestMethod -Uri "$webUrl/api/v1/me" -TimeoutSec 2
                if ($profile) { $ready = $true; break }
            } catch { Start-Sleep -Milliseconds 500 }
        }
        if (-not $ready) { throw "OptiSpace n'a pas démarré. Consultez les journaux dans $PSScriptRoot." }

        if ($SmokeTest) {
            $sample = (Get-Content -LiteralPath $knownCases -Raw | ConvertFrom-Json).'J-01'
            $fromIso = if ($sample.from -is [datetime]) { $sample.from.ToString('o') } else { $sample.from }
            $toIso = if ($sample.to -is [datetime]) { $sample.to.ToString('o') } else { $sample.to }
            $frm = [uri]::EscapeDataString($fromIso)
            $to = [uri]::EscapeDataString($toIso)
            $actual = Invoke-RestMethod -Uri "$webUrl/api/v1/spaces/$($sample.space_id)/insights?from=$frm&to=$to" -TimeoutSec 5
            if ($actual.kpis.occupancy_pct -ne 50 -or $actual.kpis.observed_min -ne 180 -or $actual.summary.mode -ne 'template_fallback') {
                throw 'Le résultat de la route du tableau de bord ne correspond pas à J-01.'
            }
            Write-Host 'J-01 OK sur la route du tableau de bord : 50 %, 180 min observées, gabarit.'
        } else {
            Write-Host "OptiSpace est prêt : $webUrl/admin"
            Write-Host 'Laissez cette fenêtre ouverte pendant le test. Ctrl+C arrête la démo.'
            Wait-Process -Id $server.Id
        }
    } finally {
        foreach ($process in @($web, $server)) {
            if ($null -ne $process -and -not $process.HasExited) { $process.Kill() }
        }
    }
} finally {
    foreach ($name in $demoEnvNames) { [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], 'Process') }
}

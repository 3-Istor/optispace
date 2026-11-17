param(
    [switch]$WithoutGemini,
    [switch]$SmokeTest,
    [switch]$ReferenceCases
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
$keyFile = Join-Path $PSScriptRoot '.gemini-key.xml'
$demoEnvNames = @('DB_TYPE', 'DB_ENABLED', 'SQLITE_PATH', 'OIDC_ISSUER', 'DEV_FAKE_USER', 'BACKEND_HOST', 'PYTHONPATH', 'GEMINI_API_KEY')
$previousEnv = @{}
foreach ($name in $demoEnvNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
    $env:DB_TYPE = 'sqlite'
    $env:DB_ENABLED = 'true'
    $databaseName = if ($ReferenceCases -or $SmokeTest) { 'optispace-iot38.sqlite3' } else { 'optispace-fm-demo.sqlite3' }
    $env:SQLITE_PATH = Join-Path $PSScriptRoot $databaseName
    $env:OIDC_ISSUER = ''
    $env:DEV_FAKE_USER = '{"sub":"iot38-local-fm","email":"test-fm@example.com","name":"Facility manager local","groups":["facility-managers"],"organization":["demo-a"]}'
    $env:BACKEND_HOST = "http://127.0.0.1:$serverPort"
    $env:PYTHONPATH = $backend
    if ($WithoutGemini -or $SmokeTest) { $env:GEMINI_API_KEY = ' ' }

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

    if (-not ($ReferenceCases -or $SmokeTest)) {
        Push-Location -LiteralPath $backend
        try {
            & $python -m alembic upgrade head
            if ($LASTEXITCODE -ne 0) { throw 'Échec de la préparation de la base FM.' }
            & $python (Join-Path $PSScriptRoot 'seed_report_demo.py')
            if ($LASTEXITCODE -ne 0) { throw 'Échec du chargement des données simulées FM.' }
        } finally { Pop-Location }
    }

    if (-not $WithoutGemini -and -not $SmokeTest) {
        $Host.UI.RawUI.WindowTitle = 'OptiSpace - essai local Gemini'
        Write-Host 'OptiSpace local - rapport Facility Manager et données simulées'
        if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
            Push-Location -LiteralPath $backend
            try {
                $configured = & $python -c 'from app.config import get_settings; print(int(bool(get_settings().gemini_api_key.get_secret_value().strip())))'
                if ($LASTEXITCODE -ne 0) { throw 'Échec de la lecture de la configuration Gemini.' }
            } finally { Pop-Location }
            if ($configured -ne '1') {
                if (-not (Test-Path -LiteralPath $keyFile)) { & (Join-Path $PSScriptRoot 'Set-OptiSpaceGemini.ps1') }
                try {
                    $key = Import-Clixml -LiteralPath $keyFile
                } catch {
                    throw 'Impossible de déchiffrer la clé locale dans cette session. Lancez ce script depuis votre terminal Windows habituel, avec le compte utilisé pour enregistrer la clé.'
                }
                try {
                    if ($key -isnot [Security.SecureString] -or $key.Length -eq 0) { throw 'La clé locale est illisible. Relancez Set-OptiSpaceGemini.ps1.' }
                    $env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $key).Password
                } finally {
                    if ($key -is [Security.SecureString]) { $key.Dispose() }
                }
            }
        }
        Write-Host 'Configuration Gemini chargée pour le serveur.'
    } else {
        Write-Host 'Mode de test sans Gemini.'
    }

    $server = $null
    $web = $null
    try {
        try {
            $server = Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -PassThru `
                -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',$serverPort) `
                -RedirectStandardOutput (Join-Path $PSScriptRoot 'backend.stdout.log') `
                -RedirectStandardError (Join-Path $PSScriptRoot 'backend.stderr.log')
        } finally { Remove-Item -LiteralPath 'Env:GEMINI_API_KEY' -ErrorAction SilentlyContinue }
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

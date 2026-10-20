<#
.SYNOPSIS
    Instalador Universal de Auto Switcher Pro para Windows (Gentle-Shell, Pi y CPAMC)
.DESCRIPTION
    Instala de forma desatendida o guiada la extensión para Gentle-Shell y Pi,
    y suministra la biblioteca nativa auto-switcher-pro-windows-amd64.dll para
    servidores CPAMC que se ejecuten directamente en Windows.
#>

param(
    [string]$Url = "http://localhost:8317",
    [string]$Key = "",
    [switch]$ExtensionOnly = $false,
    [string]$CpamcDir = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "⚡ AUTO SWITCHER PRO — Instalador Universal para Windows" -ForegroundColor Cyan
Write-Host "   Compatible con Gentle-Shell, Pi y CLIProxyAPI (CPAMC)" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Detección de ejecución local vs tubería web (iex)
$isLocalExecution = $false
$extSource = $null
$binSource = $null

if ($MyInvocation.MyCommand.Path -and (Test-Path $MyInvocation.MyCommand.Path)) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = Split-Path -Parent $scriptRoot
    $localExt = Join-Path $repoRoot "extensions\cpamc-auto-switcher"
    $localBin = Join-Path $repoRoot "bin\auto-switcher-pro-windows-amd64.dll"
    if (Test-Path $localExt) {
        $isLocalExecution = $true
        $extSource = $localExt
        $binSource = $localBin
    }
}

# Si se ejecuta directamente vía web (irm ... | iex), preparar descarga temporal
$tempWorkDir = $null
if (-not $isLocalExecution) {
    Write-Host "Obteniendo paquete oficial desde GitHub..." -ForegroundColor Gray
    $tempWorkDir = Join-Path $env:TEMP "cpamc-install-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Force -Path $tempWorkDir | Out-Null
    $tempZip = Join-Path $tempWorkDir "bundle.zip"
    Invoke-WebRequest -Uri "https://github.com/WiloxDev/cpamc-auto-switcher-pro/archive/refs/heads/main.zip" -OutFile $tempZip
    Expand-Archive -Path $tempZip -DestinationPath $tempWorkDir -Force
    $extSource = Join-Path $tempWorkDir "cpamc-auto-switcher-pro-main\extensions\cpamc-auto-switcher"
    $binSource = Join-Path $tempWorkDir "cpamc-auto-switcher-pro-main\bin\auto-switcher-pro-windows-amd64.dll"
}

# ------------------------------------------------------------------------------
# 1. INSTALACIÓN DE LA EXTENSIÓN (Gentle-Shell & Pi)
# ------------------------------------------------------------------------------
Write-Host "`n[Paso 1/2] Instalando extensión en agentes..." -ForegroundColor Yellow

$targets = @(
    (Join-Path $env:USERPROFILE ".gentle-shell\agent\extensions"),
    (Join-Path $env:USERPROFILE ".pi\agent\extensions"),
    (Join-Path $env:USERPROFILE ".pi\agent-j0k3r\extensions")
)

$installedCount = 0

foreach ($baseDir in $targets) {
    try {
        $parent = Split-Path -Parent $baseDir
        # Instalar si existe el directorio del agente o crearlo para Gentle-Shell
        if ((Test-Path $parent) -or ($baseDir -like "*gentle-shell*")) {
            if (-not (Test-Path $baseDir)) {
                New-Item -ItemType Directory -Force -Path $baseDir | Out-Null
            }
            $dest = Join-Path $baseDir "cpamc-auto-switcher"
            if (Test-Path $dest) {
                Remove-Item -Recurse -Force -Path $dest
            }

            Copy-Item -Recurse -Force -Path $extSource -Destination $dest
            Write-Host "  ✓ Extensión instalada en: $dest" -ForegroundColor Green
            $installedCount++
        }
    } catch {
        Write-Warning "No se pudo instalar en ${baseDir}: $_"
    }
}

if ($installedCount -eq 0) {
    # Instalar en ruta predeterminada de Gentle-Shell
    $defaultDest = Join-Path $env:USERPROFILE ".gentle-shell\agent\extensions\cpamc-auto-switcher"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $defaultDest) | Out-Null
    Copy-Item -Recurse -Force -Path $extSource -Destination $defaultDest
    Write-Host "  ✓ Extensión instalada en ruta por defecto: $defaultDest" -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 2. PLUGIN PARA SERVIDOR CPAMC (DLL para Windows Nativo o Nota de Docker)
# ------------------------------------------------------------------------------
if (-not $ExtensionOnly) {
    Write-Host "`n[Paso 2/2] Verificando servidor CPAMC (CLIProxyAPI)..." -ForegroundColor Yellow

    $candidateDirs = @(
        $CpamcDir,
        ".",
        (Join-Path $env:USERPROFILE "services\cliproxy"),
        (Join-Path $env:USERPROFILE "cliproxy"),
        "C:\cliproxy"
    ) | Where-Object { $_ -and (Test-Path $_) }

    $foundCpamc = $null
    foreach ($dir in $candidateDirs) {
        if ((Test-Path (Join-Path $dir "CLIProxyAPI.exe")) -or (Test-Path (Join-Path $dir "config.yaml"))) {
            $foundCpamc = $dir
            break
        }
    }

    if ($foundCpamc) {
        Write-Host "  Detectado servidor CPAMC nativo en: $foundCpamc" -ForegroundColor Cyan
        $pluginsDir = Join-Path $foundCpamc "plugins"
        if (-not (Test-Path $pluginsDir)) {
            New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
        }

        $targetDll = Join-Path $pluginsDir "auto-switcher-pro-windows-amd64.dll"
        if (Test-Path $binSource) {
            Copy-Item -Force -Path $binSource -Destination $targetDll
            Write-Host "  ✓ Plugin nativo instalado: $targetDll" -ForegroundColor Green
        } else {
            Write-Host "  Descargando DLL precompilada para Windows..." -ForegroundColor Gray
            $dllUrl = "https://github.com/WiloxDev/cpamc-auto-switcher-pro/raw/main/bin/auto-switcher-pro-windows-amd64.dll"
            try {
                Invoke-WebRequest -Uri $dllUrl -OutFile $targetDll
                Write-Host "  ✓ Plugin nativo descargado en: $targetDll" -ForegroundColor Green
            } catch {
                Write-Warning "No se pudo descargar automáticamente la DLL. Si usas Docker Desktop en Windows, CPAMC utiliza el contenedor Linux con .so."
            }
        }
    } else {
        Write-Host "  ℹ️  No se detectó un CLIProxyAPI.exe local en Windows." -ForegroundColor Gray
        Write-Host "     Si tu CPAMC corre en Docker (recomendado) o en un servidor remoto," -ForegroundColor Gray
        Write-Host "     solo necesitas la extensión en Gentle-Shell ya instalada." -ForegroundColor Gray
    }
}

# ------------------------------------------------------------------------------
# 3. CONFIGURACIÓN DE CONECTIVIDAD
# ------------------------------------------------------------------------------
if ($Url) {
    [Environment]::SetEnvironmentVariable("CLIPROXYAPI_BASE_URL", $Url.TrimEnd("/"), "User")
    $env:CLIPROXYAPI_BASE_URL = $Url.TrimEnd("/")
    Write-Host "`n🌐 CLIPROXYAPI_BASE_URL configurada como: $Url" -ForegroundColor Cyan
}

if ($Key) {
    [Environment]::SetEnvironmentVariable("CLIPROXYAPI_MANAGEMENT_KEY", $Key.Trim(), "User")
    $env:CLIPROXYAPI_MANAGEMENT_KEY = $Key.Trim()
    Write-Host "🔑 CLIPROXYAPI_MANAGEMENT_KEY configurada con éxito." -ForegroundColor Cyan
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 ¡Instalación Completada con Éxito!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Para comenzar, abre una nueva terminal y ejecuta:"
Write-Host "  gentle-shell" -ForegroundColor Yellow
Write-Host "Los pools aparecerán automáticamente en tu sesión."

# Limpieza de temporales si se ejecutó vía web
if ($tempWorkDir -and (Test-Path $tempWorkDir)) {
    Remove-Item -Recurse -Force -Path $tempWorkDir -ErrorAction SilentlyContinue
}

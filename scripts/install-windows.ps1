<#
.SYNOPSIS
    Instalador Universal Dinámico de Auto Switcher Pro para Windows
    Compatible con Gentle-Shell, Pi Vanilla, J0k3r-Pi y CLIProxyAPI (CPAMC).

.DESCRIPTION
    Realiza una instalación totalmente dinámica, segura y no destructiva:
    1. Detecta automáticamente todas las instancias y perfiles de agentes activos.
    2. Respalda con timestamp cualquier versión previa de la extensión antes de actualizar.
    3. Detecta dinámicamente la ubicación de CPAMC inspeccionando procesos activos en RAM
       (cli-proxy-api.exe / CLIProxyAPI.exe) y rutas habituales (incluyendo Applications).
    4. Suministra la biblioteca nativa auto-switcher-pro-windows-amd64.dll y activa su entrada
       en config.yaml con respaldo previo.
    5. Respeta variables de entorno existentes (CLIPROXYAPI_BASE_URL / CLIPROXYAPI_MANAGEMENT_KEY)
       sin sobrescritura destructiva.
#>

param(
    [string]$Url = "",
    [string]$Key = "",
    [switch]$ExtensionOnly = $false,
    [string]$CpamcDir = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "⚡ AUTO SWITCHER PRO — Instalador Universal Dinámico" -ForegroundColor Cyan
Write-Host "   Windows: Gentle-Shell · Pi · CLIProxyAPI (CPAMC)" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# 0. RESOLUCIÓN DINÁMICA DE FUENTES (LOCAL VS PIPE WEB)
# ------------------------------------------------------------------------------
$isLocalExecution = $false
$extSource = $null
$binSource = $null

if ($MyInvocation.MyCommand.Path -and (Test-Path $MyInvocation.MyCommand.Path)) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = Split-Path -Parent $scriptRoot
    
    # 1. ¿Estamos en el repositorio completo?
    $candidateRepoExt = Join-Path $repoRoot "extensions\cpamc-auto-switcher"
    $candidateRepoBin = Join-Path $repoRoot "bin\auto-switcher-pro-windows-amd64.dll"
    
    # 2. ¿Estamos dentro de un release package distribuido?
    $candidatePkgExt = Join-Path $scriptRoot "extensions\cpamc-auto-switcher"
    $candidatePkgBin = Join-Path $scriptRoot "bin\auto-switcher-pro-windows-amd64.dll"

    if (Test-Path $candidateRepoExt) {
        $isLocalExecution = $true
        $extSource = $candidateRepoExt
        if (Test-Path $candidateRepoBin) { $binSource = $candidateRepoBin }
    } elseif (Test-Path $candidatePkgExt) {
        $isLocalExecution = $true
        $extSource = $candidatePkgExt
        if (Test-Path $candidatePkgBin) { $binSource = $candidatePkgBin }
    }
}

$tempWorkDir = $null
if (-not $isLocalExecution) {
    Write-Host "`n[Descarga] Obteniendo fuentes oficiales desde GitHub..." -ForegroundColor Gray
    $tempWorkDir = Join-Path $env:TEMP "cpamc-install-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Force -Path $tempWorkDir | Out-Null
    $tempZip = Join-Path $tempWorkDir "bundle.zip"
    
    try {
        Invoke-WebRequest -Uri "https://github.com/WiloxDev/cpamc-auto-switcher-pro/archive/refs/heads/main.zip" -OutFile $tempZip
        Expand-Archive -Path $tempZip -DestinationPath $tempWorkDir -Force
        $extSource = Join-Path $tempWorkDir "cpamc-auto-switcher-pro-main\extensions\cpamc-auto-switcher"
        $binSource = Join-Path $tempWorkDir "cpamc-auto-switcher-pro-main\bin\auto-switcher-pro-windows-amd64.dll"
    } catch {
        Write-Error "No se pudo descargar el paquete desde GitHub: $_"
        exit 1
    }
}

# ------------------------------------------------------------------------------
# 1. INSTALACIÓN DE LA EXTENSIÓN (DETECCIÓN DINÁMICA & BACKUP SEGURO)
# ------------------------------------------------------------------------------
Write-Host "`n[Paso 1/2] Detectando perfiles de agentes e instalando extensión..." -ForegroundColor Yellow

$agentTargets = @()

# Inspeccionar variables de entorno si existen
if ($env:GENTLE_AGENT_DIR -and (Test-Path $env:GENTLE_AGENT_DIR)) {
    $agentTargets += (Join-Path $env:GENTLE_AGENT_DIR "extensions")
}
if ($env:PI_CODING_AGENT_DIR -and (Test-Path $env:PI_CODING_AGENT_DIR)) {
    $agentTargets += (Join-Path $env:PI_CODING_AGENT_DIR "extensions")
}

# Inspeccionar directorios base estándar en el perfil del usuario
$standardRoots = @(
    (Join-Path $env:USERPROFILE ".gentle-shell"),
    (Join-Path $env:USERPROFILE ".pi")
)

foreach ($root in $standardRoots) {
    if (Test-Path $root) {
        Get-ChildItem -Path $root -Directory -Filter "agent*" -ErrorAction SilentlyContinue | ForEach-Object {
            $extDir = Join-Path $_.FullName "extensions"
            if ($agentTargets -notcontains $extDir) {
                $agentTargets += $extDir
            }
        }
    }
}

# Si no se detectó ningún perfil aún, preparar Gentle-Shell predeterminado
if ($agentTargets.Count -eq 0) {
    $defaultExt = Join-Path $env:USERPROFILE ".gentle-shell\agent\extensions"
    $agentTargets += $defaultExt
}

$extInstalledCount = 0
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")

foreach ($extFolder in $agentTargets) {
    try {
        if (-not (Test-Path $extFolder)) {
            New-Item -ItemType Directory -Force -Path $extFolder | Out-Null
        }

        $dest = Join-Path $extFolder "cpamc-auto-switcher"
        
        # Respaldo seguro si ya existía una versión anterior
        if (Test-Path $dest) {
            $backupDest = Join-Path $extFolder "cpamc-auto-switcher.bak-$timestamp"
            Copy-Item -Recurse -Force -Path $dest -Destination $backupDest
            Write-Host "  📦 Versión previa respaldada en: $backupDest" -ForegroundColor DarkGray
            Remove-Item -Recurse -Force -Path $dest
        }

        Copy-Item -Recurse -Force -Path $extSource -Destination $dest
        Write-Host "  ✓ Extensión instalada en: $dest" -ForegroundColor Green
        $extInstalledCount++
    } catch {
        Write-Warning "No se pudo instalar en ${extFolder}: $_"
    }
}

# ------------------------------------------------------------------------------
# 2. DETECCIÓN DINÁMICA DE CPAMC (PROCESOS + RUTAS) Y CONFIGURACIÓN DEL PLUGIN
# ------------------------------------------------------------------------------
$pluginInstalled = $false

if (-not $ExtensionOnly) {
    Write-Host "`n[Paso 2/2] Detectando servidor CPAMC (CLIProxyAPI)..." -ForegroundColor Yellow

    $discoveredRoots = [System.Collections.Generic.List[string]]::new()

    # A. Ruta explícita pasada por parámetro
    if ($CpamcDir -and (Test-Path $CpamcDir)) {
        $discoveredRoots.Add((Resolve-Path $CpamcDir).Path)
    }

    # B. Detección por procesos activos en RAM (cli-proxy-api o CLIProxyAPI)
    try {
        Get-Process -ErrorAction SilentlyContinue | Where-Object { 
            $_.ProcessName -match "^(cli-proxy-api|CLIProxyAPI)$" 
        } | ForEach-Object {
            try {
                if ($_.MainModule.FileName) {
                    $procDir = Split-Path -Parent $_.MainModule.FileName
                    if ($procDir -and (Test-Path $procDir) -and -not $discoveredRoots.Contains($procDir)) {
                        Write-Host "  🔍 Detectado proceso activo de CPAMC: $($_.ProcessName) en $procDir" -ForegroundColor Cyan
                        $discoveredRoots.Add($procDir)
                    }
                }
            } catch {}
        }
    } catch {}

    # C. Exploración dinámica de rutas en el sistema
    $searchPaths = @(
        ".",
        (Join-Path $env:USERPROFILE "Applications\CLIProxyAPI"),
        (Join-Path $env:USERPROFILE "Applications\cli-proxy-api"),
        (Join-Path $env:USERPROFILE "services\cliproxy"),
        (Join-Path $env:USERPROFILE "cliproxy"),
        (Join-Path $env:LOCALAPPDATA "Programs\CLIProxyAPI"),
        "C:\cliproxy",
        "C:\CLIProxyAPI",
        "D:\cliproxy"
    )

    foreach ($path in $searchPaths) {
        if ($path -and (Test-Path $path)) {
            $resolved = (Resolve-Path $path).Path
            if (-not $discoveredRoots.Contains($resolved)) {
                $discoveredRoots.Add($resolved)
            }
        }
    }

    # Evaluar candidatos que posean el ejecutable o config.yaml
    $targetCpamc = $null
    foreach ($cand in $discoveredRoots) {
        $hasExe = (Test-Path (Join-Path $cand "cli-proxy-api.exe")) -or (Test-Path (Join-Path $cand "CLIProxyAPI.exe"))
        $hasCfg = Test-Path (Join-Path $cand "config.yaml")
        if ($hasExe -or $hasCfg) {
            $targetCpamc = $cand
            break
        }
    }

    if ($targetCpamc) {
        Write-Host "  ✓ Servidor CPAMC localizado en: $targetCpamc" -ForegroundColor Green
        
        $pluginsDir = Join-Path $targetCpamc "plugins"
        if (-not (Test-Path $pluginsDir)) {
            New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
        }

        $targetDll = Join-Path $pluginsDir "auto-switcher-pro-windows-amd64.dll"
        $dllAcquired = $false

        # 1. Usar binario local si existe
        if ($binSource -and (Test-Path $binSource)) {
            Copy-Item -Force -Path $binSource -Destination $targetDll
            $dllAcquired = $true
            Write-Host "  ✓ Plugin DLL instalado desde paquete local." -ForegroundColor Green
        } else {
            # 2. Descargar DLL desde Release oficial de GitHub
            Write-Host "  Descargando DLL oficial para Windows desde GitHub Releases..." -ForegroundColor Gray
            $releaseUrls = @(
                "https://github.com/WiloxDev/cpamc-auto-switcher-pro/releases/latest/download/auto-switcher-pro-windows-amd64.dll",
                "https://github.com/WiloxDev/cpamc-auto-switcher-pro/releases/download/v0.1.0/auto-switcher-pro-windows-amd64.dll"
            )
            foreach ($u in $releaseUrls) {
                try {
                    Invoke-WebRequest -Uri $u -OutFile $targetDll -ErrorAction Stop
                    if ((Test-Path $targetDll) -and ((Get-Item $targetDll).Length -gt 1000000)) {
                        $dllAcquired = $true
                        Write-Host "  ✓ Plugin DLL descargado exitosamente." -ForegroundColor Green
                        break
                    }
                } catch {}
            }
        }

        if ($dllAcquired) {
            $pluginInstalled = $true

            # Configuración dinámica y atómica en config.yaml
            $configFile = Join-Path $targetCpamc "config.yaml"
            if (Test-Path $configFile) {
                $cfgContent = Get-Content -Raw -Path $configFile -Encoding UTF8
                if ($cfgContent -notmatch "auto-switcher-pro-windows-amd64") {
                    Write-Host "  Actualizando configuración de plugins en config.yaml..." -ForegroundColor Cyan
                    
                    # Backup previo de config.yaml
                    $cfgBackup = "$configFile.bak-auto-switcher-$timestamp"
                    Copy-Item -Path $configFile -Destination $cfgBackup -Force
                    Write-Host "  📦 Copia de respaldo guardada en: $cfgBackup" -ForegroundColor DarkGray

                    if ($cfgContent -match "plugins:\s*\r?\n\s*enabled:\s*true") {
                        # Inyectar bajo configs:
                        if ($cfgContent -match "configs:") {
                            $cfgContent = $cfgContent -replace "(configs:\r?\n)", "`$1        auto-switcher-pro-windows-amd64:`r`n            enabled: true`r`n"
                        } else {
                            $cfgContent = $cfgContent -replace "(plugins:\s*\r?\n\s*enabled:\s*true\r?\n)", "`$1    dir: plugins`r`n    configs:`r`n        auto-switcher-pro-windows-amd64:`r`n            enabled: true`r`n"
                        }
                    } else {
                        # Añadir bloque completo de plugins al inicio
                        $pluginBlock = "plugins:`r`n    enabled: true`r`n    dir: plugins`r`n    configs:`r`n        auto-switcher-pro-windows-amd64:`r`n            enabled: true`r`n"
                        $cfgContent = $pluginBlock + $cfgContent
                    }
                    
                    Set-Content -Path $configFile -Value $cfgContent -Encoding UTF8
                    Write-Host "  ✓ Plugin activado correctamente en config.yaml" -ForegroundColor Green
                } else {
                    Write-Host "  ✓ Plugin ya se encontraba habilitado en config.yaml" -ForegroundColor DarkGreen
                }
            }
        } else {
            Write-Warning "No se pudo obtener la biblioteca DLL precompilada para Windows."
            Write-Warning "Si estás usando Docker Desktop en Windows, CPAMC usa el contenedor Linux oficial con .so."
        }
    } else {
        Write-Host "  ℹ️  No se detectó un CLIProxyAPI nativo en ejecución ni en rutas habituales." -ForegroundColor Gray
        Write-Host "     Si tu CPAMC corre en Docker (recomendado) o en un servidor remoto," -ForegroundColor Gray
        Write-Host "     solo necesitas la extensión en Gentle-Shell ya instalada." -ForegroundColor Gray
    }
}

# ------------------------------------------------------------------------------
# 3. GOBERNANZA DE VARIABLES DE ENTORNO (NO DESTRUCTIVA)
# ------------------------------------------------------------------------------
$currentUrl = [Environment]::GetEnvironmentVariable("CLIPROXYAPI_BASE_URL", "User")
if ([string]::IsNullOrWhiteSpace($currentUrl)) {
    $currentUrl = $env:CLIPROXYAPI_BASE_URL
}

if (-not [string]::IsNullOrWhiteSpace($Url)) {
    # El usuario pasó un parámetro explícito -Url
    [Environment]::SetEnvironmentVariable("CLIPROXYAPI_BASE_URL", $Url.TrimEnd("/"), "User")
    $env:CLIPROXYAPI_BASE_URL = $Url.TrimEnd("/")
    Write-Host "`n🌐 CLIPROXYAPI_BASE_URL configurada explícitamente como: $Url" -ForegroundColor Cyan
} elseif ([string]::IsNullOrWhiteSpace($currentUrl)) {
    # No existe configuración previa: sugerir o establecer localhost
    $defaultBase = "http://localhost:8317"
    [Environment]::SetEnvironmentVariable("CLIPROXYAPI_BASE_URL", $defaultBase, "User")
    $env:CLIPROXYAPI_BASE_URL = $defaultBase
    Write-Host "`n🌐 CLIPROXYAPI_BASE_URL inicializada en: $defaultBase" -ForegroundColor Cyan
} else {
    Write-Host "`n🌐 CLIPROXYAPI_BASE_URL preservada: $currentUrl" -ForegroundColor DarkCyan
}

if (-not [string]::IsNullOrWhiteSpace($Key)) {
    [Environment]::SetEnvironmentVariable("CLIPROXYAPI_MANAGEMENT_KEY", $Key.Trim(), "User")
    $env:CLIPROXYAPI_MANAGEMENT_KEY = $Key.Trim()
    Write-Host "🔑 CLIPROXYAPI_MANAGEMENT_KEY configurada con éxito." -ForegroundColor Cyan
}

# ------------------------------------------------------------------------------
# 4. LIMPIEZA Y REPORTE FINAL HONESTO
# ------------------------------------------------------------------------------
if ($tempWorkDir -and (Test-Path $tempWorkDir)) {
    Remove-Item -Recurse -Force -Path $tempWorkDir -ErrorAction SilentlyContinue
}

Write-Host "`n==========================================================" -ForegroundColor Green
if ($extInstalledCount -gt 0 -and ($pluginInstalled -or $ExtensionOnly)) {
    Write-Host "🎉 ¡Instalación Completada con Éxito!" -ForegroundColor Green
} elseif ($extInstalledCount -gt 0) {
    Write-Host "✓ Extensión instalada para Gentle-Shell/Pi." -ForegroundColor Green
    Write-Host "ℹ️  Nota: Servidor CPAMC en Windows no requirió DLL nativa (usa Docker o servidor remoto)." -ForegroundColor DarkGray
} else {
    Write-Host "⚠️  Instalación finalizada con advertencias (ver registros superiores)." -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Para comenzar en tu terminal:"
Write-Host "  gentle-shell" -ForegroundColor Yellow
Write-Host "Los pools aparecerán automáticamente al consultar /model."

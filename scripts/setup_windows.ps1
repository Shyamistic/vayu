param(
    [string]$PythonShortcut = "C:\Users\shyam.BATCONSOLE\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Python 3.13\Python 3.13 (64-bit).lnk",
    [string]$VenvDir = ".venv",
    [switch]$InstallDeps = $true,
    [switch]$CoreOnly = $false
)

$ErrorActionPreference = "Stop"

function Resolve-PythonFromShortcut {
    param([string]$ShortcutPath)

    if (!(Test-Path $ShortcutPath)) {
        throw "Python shortcut not found: $ShortcutPath"
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $target = $shortcut.TargetPath

    if ([string]::IsNullOrWhiteSpace($target) -or !(Test-Path $target)) {
        throw "Could not resolve Python executable from shortcut: $ShortcutPath"
    }

    return $target
}

Write-Host "[1/5] Resolving Python executable from shortcut..." -ForegroundColor Cyan
$pythonExe = Resolve-PythonFromShortcut -ShortcutPath $PythonShortcut
Write-Host "Using Python: $pythonExe" -ForegroundColor Green

Write-Host "[2/5] Creating virtual environment in $VenvDir ..." -ForegroundColor Cyan
& "$pythonExe" -m venv "$VenvDir"

$venvPython = Join-Path $VenvDir "Scripts\python.exe"
$venvActivate = Join-Path $VenvDir "Scripts\Activate.ps1"

if (!(Test-Path $venvPython)) {
    throw "Virtual environment creation failed. Missing: $venvPython"
}

Write-Host "[3/5] Activating virtual environment..." -ForegroundColor Cyan
. "$venvActivate"

Write-Host "[4/5] Upgrading pip/setuptools/wheel..." -ForegroundColor Cyan
& "$venvPython" -m pip install --upgrade pip setuptools wheel

if ($InstallDeps) {
    Write-Host "[5/5] Installing project dependencies..." -ForegroundColor Cyan
    if ($CoreOnly) {
        & "$venvPython" -m pip install --upgrade torch torch-geometric numpy scipy xarray pandas typer tqdm
    } else {
        & "$venvPython" -m pip install -e ".[dev]"
    }
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "To activate in a new shell:" -ForegroundColor Yellow
Write-Host "    .\.venv\Scripts\Activate.ps1"
Write-Host "To run training:" -ForegroundColor Yellow
Write-Host "    .\scripts\train_local.ps1"

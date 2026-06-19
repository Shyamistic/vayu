param(
    [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path ".env.example")) {
    throw ".env.example not found in repo root."
}

if (!(Test-Path $EnvFile)) {
    Copy-Item ".env.example" $EnvFile
    Write-Host "Created $EnvFile from .env.example" -ForegroundColor Green
}

$envText = Get-Content $EnvFile -Raw

function Set-Or-ReplaceEnvVar {
    param(
        [string]$Name,
        [string]$Value
    )

    $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
    $replacement = "$Name=$Value"

    if ($envText -match $pattern) {
        $script:envText = [regex]::Replace($envText, $pattern, $replacement)
    } else {
        $script:envText = $envText.TrimEnd() + "`r`n$replacement`r`n"
    }
}

Write-Host "Enter Cesium ion token (input hidden):" -ForegroundColor Cyan
$cesium = Read-Host -AsSecureString
$cesiumPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cesium)
)

Write-Host "Enter Google Maps API key (input hidden):" -ForegroundColor Cyan
$gmap = Read-Host -AsSecureString
$gmapPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($gmap)
)

Set-Or-ReplaceEnvVar -Name "CESIUM_ION_TOKEN" -Value $cesiumPlain
Set-Or-ReplaceEnvVar -Name "VITE_CESIUM_ION_TOKEN" -Value $cesiumPlain
Set-Or-ReplaceEnvVar -Name "GOOGLE_MAPS_API_KEY" -Value $gmapPlain
Set-Or-ReplaceEnvVar -Name "VITE_GOOGLE_MAPS_API_KEY" -Value $gmapPlain

Set-Content -Path $EnvFile -Value $envText -Encoding UTF8
Write-Host "Updated $EnvFile with API keys." -ForegroundColor Green
Write-Host "Reminder: Do not commit .env to git." -ForegroundColor Yellow

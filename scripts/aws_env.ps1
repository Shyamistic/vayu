# Selects AWS credentials for this PowerShell session.
#
#   . .\scripts\aws_env.ps1              # normal use: the 'vayu' deploy profile
#   . .\scripts\aws_env.ps1 -UseRoot     # only for IAM/root-key administration
#
# Preferred path is the named profile written by scripts/create_deploy_user.ps1,
# which lives in ~/.aws/credentials and belongs to the scoped `vayu-deploy` IAM
# user. The -UseRoot fallback reads .env.local, whose human-readable key names
# ("Access key" / "secret access key") no AWS SDK picks up on its own.
#
# Root keys are deliberately not the default: they cannot be scoped, they bypass
# the MFA configured on the root login, and losing one means the whole account is
# compromised. Never echo either secret.

param(
    [string]$ProfileName = 'vayu',
    [string]$Region = 'ap-south-1',
    [switch]$UseRoot,
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env.local')
)

$ErrorActionPreference = 'Continue'

# Any ambient AWS_* keys win over -profile, so they are cleared first to avoid
# silently authenticating as whoever was loaded earlier in the session.
$env:AWS_ACCESS_KEY_ID = $null
$env:AWS_SECRET_ACCESS_KEY = $null
$env:AWS_SESSION_TOKEN = $null
$env:AWS_PROFILE = $null

$env:AWS_DEFAULT_REGION = $Region
$env:AWS_REGION = $Region

if ($UseRoot) {
    if (-not (Test-Path $EnvFile)) { throw "Credentials file not found: $EnvFile" }
    $raw = Get-Content $EnvFile -Raw

    function Get-EnvValue([string]$Label) {
        $m = [regex]::Match($raw, "(?im)^\s*$Label\s*=\s*(.+)$")
        if (-not $m.Success) { throw "Missing '$Label' in $EnvFile" }
        return $m.Groups[1].Value.Trim().Trim('"').Trim("'")
    }

    $env:AWS_ACCESS_KEY_ID     = Get-EnvValue 'Access key'
    $env:AWS_SECRET_ACCESS_KEY = Get-EnvValue 'secret access key'
    Write-Host "WARNING: using ROOT account keys. Prefer the '$ProfileName' profile for deploys." -ForegroundColor Yellow
    return
}

$found = & aws configure list-profiles 2>&1 | Where-Object { $_ -eq $ProfileName }
if (-not $found) {
    throw "AWS profile '$ProfileName' not found. Run scripts\create_deploy_user.ps1 first, or pass -UseRoot."
}

$env:AWS_PROFILE = $ProfileName
Write-Host "AWS profile '$ProfileName' selected for region $Region"

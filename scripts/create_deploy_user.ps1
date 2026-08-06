# Creates a dedicated IAM deploy user and stores its keys in a named AWS profile.
#
# Why this exists: the account's root access keys were being used for deployment.
# Root keys cannot be scoped, cannot be limited by MFA (access keys bypass the
# MFA that is enabled on the root login), and cannot be safely rotated without a
# window where nothing works. A dedicated user can be deleted or rotated at any
# time without touching the account itself.
#
# The new secret is written straight into the AWS shared credentials file
# (~/.aws/credentials) under a named profile. It is never printed and never
# written inside the repository.
#
# Run once, with root credentials already loaded:
#   . .\scripts\aws_env.ps1
#   .\scripts\create_deploy_user.ps1

param(
    [string]$UserName = 'vayu-deploy',
    [string]$ProfileName = 'vayu',
    [string]$Region = 'ap-south-1'
)

# Native stderr must not be fatal here: the AWS CLI writes normal diagnostics to
# stderr, and `get-user` on a missing user is an expected non-zero exit rather
# than a script failure. Success is decided by $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'

function Invoke-Aws {
    <#  Runs the AWS CLI and returns [exit code, combined output] without
        letting stderr terminate the script. #>
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    $output = & aws @Args 2>&1 | Out-String
    return @($LASTEXITCODE, $output.Trim())
}

function Assert-Aws($code, $output, $what) {
    if ($code -ne 0) { throw "$what failed (exit $code): $output" }
}

Write-Host "1/5  Creating IAM user '$UserName'..."
$code, $out = Invoke-Aws iam get-user --user-name $UserName
if ($code -eq 0) {
    Write-Host "     user already exists, reusing it"
} else {
    # Tag values must be quoted: unquoted `Key=Project,Value=VAYU` is parsed by
    # PowerShell as a two-element array and reaches the CLI as two broken tags.
    $code, $out = Invoke-Aws iam create-user --user-name $UserName `
        --tags 'Key=Project,Value=VAYU' 'Key=Purpose,Value=deployment'
    Assert-Aws $code $out "create-user"
    Write-Host "     created"
}

# AdministratorAccess is required rather than lazy: `cdk bootstrap` creates IAM
# roles and a KMS key, and the stacks create VPC, ECS, ALB, CloudFront, S3 and
# ECR resources. A narrower policy would have to enumerate all of those plus
# iam:CreateRole. This is still a large reduction in blast radius versus root,
# which additionally controls billing, support and account closure.
Write-Host "2/5  Attaching AdministratorAccess..."
$code, $out = Invoke-Aws iam attach-user-policy --user-name $UserName `
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
Assert-Aws $code $out "attach-user-policy"
Write-Host "     attached"

# AWS allows at most two keys per user; clear any inactive leftovers so a repeat
# run does not fail on the limit.
Write-Host "3/5  Checking existing access keys..."
$code, $keyIds = Invoke-Aws iam list-access-keys --user-name $UserName `
    --query "AccessKeyMetadata[].AccessKeyId" --output text
if ($code -eq 0 -and $keyIds) {
    foreach ($id in ($keyIds -split '\s+' | Where-Object { $_ })) {
        Write-Host "     deleting previous key ...$($id.Substring($id.Length - 4))"
        Invoke-Aws iam delete-access-key --user-name $UserName --access-key-id $id | Out-Null
    }
}

Write-Host "4/5  Creating a new access key and writing profile '$ProfileName'..."
$code, $raw = Invoke-Aws iam create-access-key --user-name $UserName --output json
Assert-Aws $code $raw "create-access-key"

$key = ($raw | ConvertFrom-Json).AccessKey
if (-not $key.AccessKeyId -or -not $key.SecretAccessKey) {
    throw "create-access-key returned no usable credentials"
}

# Write directly to the shared credentials file. The secret is only ever
# available at creation time, so this happens immediately and is verified below.
aws configure set aws_access_key_id     $key.AccessKeyId     --profile $ProfileName
aws configure set aws_secret_access_key $key.SecretAccessKey --profile $ProfileName
aws configure set region                $Region              --profile $ProfileName
aws configure set output                json                 --profile $ProfileName

$newKeyId = $key.AccessKeyId
$key = $null
$raw = $null
[System.GC]::Collect()

Write-Host "     profile written to $HOME\.aws\credentials (key id ends ...$($newKeyId.Substring($newKeyId.Length - 4)))"

# IAM is eventually consistent: a brand-new key can 401 for a few seconds.
Write-Host "5/5  Verifying the new credentials..."
$identity = $null
$verified = $false
for ($i = 1; $i -le 10; $i++) {
    Start-Sleep -Seconds 3
    # The ambient root AWS_* variables take precedence over --profile, so they
    # are cleared for this check to prove the new key itself works.
    $saved = @{
        Id     = $env:AWS_ACCESS_KEY_ID
        Secret = $env:AWS_SECRET_ACCESS_KEY
    }
    $env:AWS_ACCESS_KEY_ID = $null
    $env:AWS_SECRET_ACCESS_KEY = $null
    $code, $identity = Invoke-Aws sts get-caller-identity --profile $ProfileName --output json
    $env:AWS_ACCESS_KEY_ID = $saved.Id
    $env:AWS_SECRET_ACCESS_KEY = $saved.Secret

    if ($code -eq 0) { $verified = $true; break }
    Write-Host "     not active yet, retrying ($i/10)..."
}
if (-not $verified) { throw "New credentials never became valid: $identity" }

$arn = ($identity | ConvertFrom-Json).Arn
Write-Host ""
Write-Host "SUCCESS. Deploy identity: $arn"
Write-Host "Use it with:  `$env:AWS_PROFILE = '$ProfileName'"

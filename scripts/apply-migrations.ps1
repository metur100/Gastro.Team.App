<#
.SYNOPSIS
  Generates the idempotent EF Core migration script and applies it to the database from the env file.

.DESCRIPTION
  Explicit deployment step — the API never migrates a production database automatically.
  Review db/migrations.sql (and back up the database) before running against production.

.EXAMPLE
  ./scripts/apply-migrations.ps1                 # generate + apply (asks for confirmation)
  ./scripts/apply-migrations.ps1 -GenerateOnly   # only regenerate db/migrations.sql
#>
param(
    [string]$EnvFile = "$env:USERPROFILE\.gastroteam\production.env",
    [switch]$GenerateOnly,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$script = Join-Path $root 'db\migrations.sql'

Push-Location (Join-Path $root 'backend')
try {
    dotnet ef migrations script --idempotent -p GastroTeam.Infrastructure -s GastroTeam.Api -o $script
    if ($LASTEXITCODE -ne 0) { throw 'Generating the migration script failed' }
} finally { Pop-Location }
Write-Host "Script written to $script"
if ($GenerateOnly) { return }

$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $i = $line.IndexOf('='); $cfg[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
}
if (-not $Yes) {
    $answer = Read-Host "Apply migrations to $($cfg['GT_DB_SERVER'])/$($cfg['GT_DB_NAME'])? (yes/no)"
    if ($answer -ne 'yes') { Write-Host 'Aborted.'; return }
}
$env:SQLCMDPASSWORD = $cfg['GT_DB_PASSWORD']
try {
    sqlcmd -S $cfg['GT_DB_SERVER'] -d $cfg['GT_DB_NAME'] -U $cfg['GT_DB_USER'] -C -b -I -i $script
    if ($LASTEXITCODE -ne 0) { throw 'Applying migrations failed' }
} finally { Remove-Item Env:SQLCMDPASSWORD -ErrorAction SilentlyContinue }
Write-Host 'Migrations applied.'

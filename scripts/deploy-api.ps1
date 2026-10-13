<#
.SYNOPSIS
  Publishes GastroTeam.Api and deploys it to the MonsterASP.NET / runasp.net site via Web Deploy.

.DESCRIPTION
  Secrets are read from an env file outside the repository (default: %USERPROFILE%\.gastroteam\production.env).
  A web.config containing them as environment variables is generated into the publish folder only.
  Database migrations are NOT applied here; run scripts/apply-migrations.ps1 explicitly beforehand.

.EXAMPLE
  ./scripts/deploy-api.ps1
  ./scripts/deploy-api.ps1 -SelfContained   # if the host lacks the required .NET runtime
#>
param(
    [string]$EnvFile = "$env:USERPROFILE\.gastroteam\production.env",
    [switch]$SelfContained,
    [switch]$StdoutLogs
)
$ErrorActionPreference = 'Stop'

function Read-EnvFile([string]$path) {
    if (-not (Test-Path $path)) { throw "Env file not found: $path (see docs/DEPLOYMENT.md)" }
    $cfg = @{}
    foreach ($line in Get-Content $path) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        $i = $line.IndexOf('=')
        $cfg[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
    }
    return $cfg
}

$cfg = Read-EnvFile $EnvFile
foreach ($k in 'GT_CONNECTION', 'GT_JWT_SIGNING_KEY', 'GT_DEPLOY_SERVER', 'GT_DEPLOY_SITE', 'GT_DEPLOY_USER', 'GT_DEPLOY_PASSWORD', 'GT_WEB_URL', 'GT_WEB_ORIGIN') {
    if (-not $cfg[$k]) { throw "Missing $k in $EnvFile" }
}

$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $env:TEMP 'gastroteam-api-publish'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }

$publish = @('publish', "$root\backend\GastroTeam.Api\GastroTeam.Api.csproj", '-c', 'Release', '-o', $out, '--nologo')
if ($SelfContained) { $publish += @('-r', 'win-x64', '--self-contained', 'true') }
& dotnet @publish
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

function X([string]$s) { [System.Security.SecurityElement]::Escape($s) }
$envVars = [ordered]@{
    'ASPNETCORE_ENVIRONMENT'                = 'Production'
    'ConnectionStrings__Default'            = $cfg['GT_CONNECTION']
    'Jwt__SigningKey'                       = $cfg['GT_JWT_SIGNING_KEY']
    'App__WebBaseUrl'                       = $cfg['GT_WEB_URL']
    'Cors__AllowedOrigins__0'               = $cfg['GT_WEB_ORIGIN']
    # E-mail verification is required by default once SMTP is configured (override with GT_REQUIRE_EMAIL_VERIFICATION).
    'App__RequireEmailVerification'         = $(if ($cfg['GT_REQUIRE_EMAIL_VERIFICATION']) { $cfg['GT_REQUIRE_EMAIL_VERIFICATION'] } elseif ($cfg['GT_SMTP_HOST']) { 'true' } else { 'false' })
    # No payment provider: plan changes are allowed in clearly labelled test mode.
    'App__AllowManualPlanChange'            = $(if ($cfg['GT_ALLOW_MANUAL_PLAN_CHANGE']) { $cfg['GT_ALLOW_MANUAL_PLAN_CHANGE'] } else { 'true' })
}
foreach ($k in 'GT_SMTP_HOST', 'GT_SMTP_PORT', 'GT_SMTP_USER', 'GT_SMTP_PASSWORD', 'GT_SMTP_FROM', 'GT_SMTP_FROM_NAME', 'GT_SMTP_SECURITY') {
    if ($cfg[$k]) {
        $name = @{ GT_SMTP_HOST = 'Email__SmtpHost'; GT_SMTP_PORT = 'Email__SmtpPort'; GT_SMTP_USER = 'Email__SmtpUser'; GT_SMTP_PASSWORD = 'Email__SmtpPassword'; GT_SMTP_FROM = 'Email__FromAddress'; GT_SMTP_FROM_NAME = 'Email__FromName'; GT_SMTP_SECURITY = 'Email__Security' }[$k]
        $envVars[$name] = $cfg[$k]
    }
}
if ($cfg['GT_PLATFORM_ADMIN_EMAIL']) { $envVars['App__PlatformAdminEmails__0'] = $cfg['GT_PLATFORM_ADMIN_EMAIL'] }

$envXml = ($envVars.GetEnumerator() | ForEach-Object { "          <environmentVariable name=`"$($_.Key)`" value=`"$(X $_.Value)`" />" }) -join "`r`n"
$processPath = if ($SelfContained) { '.\GastroTeam.Api.exe' } else { 'dotnet' }
$arguments = if ($SelfContained) { '' } else { '.\GastroTeam.Api.dll' }
$stdout = if ($StdoutLogs) { 'true' } else { 'false' }
@"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <location path="." inheritInChildApplications="false">
    <system.webServer>
      <handlers>
        <add name="aspNetCore" path="*" verb="*" modules="AspNetCoreModuleV2" resourceType="Unspecified" />
      </handlers>
      <aspNetCore processPath="$processPath" arguments="$arguments" stdoutLogEnabled="$stdout" stdoutLogFile=".\logs\stdout" hostingModel="inprocess">
        <environmentVariables>
$envXml
        </environmentVariables>
      </aspNetCore>
      <httpProtocol>
        <customHeaders>
          <remove name="X-Powered-By" />
        </customHeaders>
      </httpProtocol>
    </system.webServer>
  </location>
</configuration>
"@ | Set-Content -Path (Join-Path $out 'web.config') -Encoding UTF8

$msdeploy = 'C:\Program Files\IIS\Microsoft Web Deploy V3\msdeploy.exe'
if (-not (Test-Path $msdeploy)) { throw 'Web Deploy (msdeploy.exe) is not installed.' }
$server = $cfg['GT_DEPLOY_SERVER']; $site = $cfg['GT_DEPLOY_SITE']
$dest = "contentPath='$site',computerName='https://${server}:8172/msdeploy.axd?site=$site',userName='$($cfg['GT_DEPLOY_USER'])',password='$($cfg['GT_DEPLOY_PASSWORD'])',authType='Basic'"
& $msdeploy "-verb:sync" "-source:contentPath='$out'" "-dest:$dest" "-allowUntrusted" "-enableRule:AppOffline" "-skip:objectName=dirPath,absolutePath=\\logs$" "-retryAttempts:3"
if ($LASTEXITCODE -ne 0) { throw 'msdeploy failed' }
Remove-Item $out -Recurse -Force
Write-Host "Deployed. Check $($cfg['GT_API_URL'])/health"

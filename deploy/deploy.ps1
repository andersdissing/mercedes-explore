<#
.SYNOPSIS
    Deploys the Mercedes-Benz Data Explorer to Azure.
    - Static website on Azure Storage Account
    - CORS proxy on Azure Functions (Consumption plan)

.PARAMETER ResourceGroupName
    Name of the Azure resource group to create/use.

.PARAMETER Location
    Azure region (default: westeurope).

.PARAMETER StorageAccountName
    Name of the storage account (must be globally unique, lowercase, 3-24 chars).

.PARAMETER FunctionAppName
    Name of the function app (must be globally unique).

.EXAMPLE
    .\deploy.ps1 -ResourceGroupName "rg-mercedes-explore" -StorageAccountName "stmercedesexplore01" -FunctionAppName "func-mercedes-explore"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $false)]
    [string]$Location = "westeurope",

    [Parameter(Mandatory = $true)]
    [string]$StorageAccountName,

    [Parameter(Mandatory = $true)]
    [string]$FunctionAppName
)

$ErrorActionPreference = "Stop"

Write-Host "=== Mercedes-Benz Data Explorer - Azure Deployment ===" -ForegroundColor Cyan

# ---------------------------------------------------------------
# Step 0: Check and install prerequisites
# ---------------------------------------------------------------
Write-Host "`n[0/8] Checking prerequisites..." -ForegroundColor Yellow

$azInstalled = $null
try { $azInstalled = Get-Command az -ErrorAction SilentlyContinue } catch {}

if (-not $azInstalled) {
    Write-Host "  Azure CLI not found. Installing via winget..." -ForegroundColor Yellow
    try {
        winget install Microsoft.AzureCLI --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }
    catch {
        Write-Host "  winget failed. Trying MSI installer..." -ForegroundColor Yellow
        $msiUrl = "https://aka.ms/installazurecliwindowsx64"
        $msiPath = Join-Path $env:TEMP "AzureCLI.msi"
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
        Remove-Item $msiPath -ErrorAction SilentlyContinue
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }

    try {
        az --version | Select-Object -First 1
        Write-Host "  Azure CLI installed successfully." -ForegroundColor Green
    }
    catch {
        Write-Host "  ERROR: Azure CLI installation failed. Install manually:" -ForegroundColor Red
        Write-Host "  https://aka.ms/installazurecliwindows" -ForegroundColor Red
        exit 1
    }
}
else {
    $azVersion = (az version 2>$null | ConvertFrom-Json).'azure-cli'
    Write-Host "  Azure CLI found: v$azVersion" -ForegroundColor Green
}

try {
    az bicep version 2>$null | Out-Null
    Write-Host "  Bicep available." -ForegroundColor Green
}
catch {
    Write-Host "  Installing Bicep..." -ForegroundColor Yellow
    az bicep install
    Write-Host "  Bicep installed." -ForegroundColor Green
}

# ---------------------------------------------------------------
# Step 1: Ensure logged in to Azure
# ---------------------------------------------------------------
Write-Host "`n[1/8] Checking Azure login..." -ForegroundColor Yellow

$loginValid = $false
try {
    $testResult = az account show 2>&1
    if ($LASTEXITCODE -eq 0) {
        $account = $testResult | ConvertFrom-Json
        az group list --query "[0].name" --output none 2>$null
        if ($LASTEXITCODE -eq 0) {
            $loginValid = $true
        }
    }
}
catch {}

if (-not $loginValid) {
    Write-Host "  Not logged in or session expired. Opening browser for Azure login..." -ForegroundColor Yellow
    az login --output none
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Azure login failed." -ForegroundColor Red
        exit 1
    }
    $account = az account show | ConvertFrom-Json
}

Write-Host "  Logged in as: $($account.user.name)" -ForegroundColor Green
Write-Host "  Subscription: $($account.name) ($($account.id))" -ForegroundColor Green

# ---------------------------------------------------------------
# Step 2: Create resource group
# ---------------------------------------------------------------
Write-Host "`n[2/8] Creating resource group '$ResourceGroupName'..." -ForegroundColor Yellow
az group create --name $ResourceGroupName --location $Location --output none
Write-Host "  Resource group ready." -ForegroundColor Green

# ---------------------------------------------------------------
# Step 3: Deploy Bicep template (Storage + Function App)
# ---------------------------------------------------------------
Write-Host "`n[3/8] Deploying infrastructure (Storage + Function App)..." -ForegroundColor Yellow
$bicepPath = Join-Path $PSScriptRoot "main.bicep"

$deployOutput = az deployment group create `
    --resource-group $ResourceGroupName `
    --template-file $bicepPath `
    --parameters storageAccountName=$StorageAccountName functionAppName=$FunctionAppName `
    --query "properties.outputs" `
    --output json | ConvertFrom-Json

$functionUrl = $deployOutput.functionUrl.value
Write-Host "  Infrastructure deployed." -ForegroundColor Green
Write-Host "  Function App URL: $functionUrl" -ForegroundColor Green

# ---------------------------------------------------------------
# Step 4: Get storage account key
# ---------------------------------------------------------------
Write-Host "`n[4/8] Retrieving storage account key..." -ForegroundColor Yellow
$accountKey = az storage account keys list `
    --account-name $StorageAccountName `
    --resource-group $ResourceGroupName `
    --query "[0].value" `
    --output tsv

if (-not $accountKey) {
    Write-Host "  ERROR: Could not retrieve storage account key." -ForegroundColor Red
    exit 1
}
Write-Host "  Storage key retrieved." -ForegroundColor Green

# ---------------------------------------------------------------
# Step 5: Enable static website hosting
# ---------------------------------------------------------------
Write-Host "`n[5/8] Enabling static website hosting..." -ForegroundColor Yellow
az storage blob service-properties update `
    --account-name $StorageAccountName `
    --account-key $accountKey `
    --static-website `
    --index-document "index.html" `
    --404-document "index.html" `
    --output none

Write-Host "  Static website enabled." -ForegroundColor Green

# ---------------------------------------------------------------
# Step 6: Deploy Function App code
# ---------------------------------------------------------------
Write-Host "`n[6/8] Deploying Function App code..." -ForegroundColor Yellow

# Clear platform CORS so the function handles CORS manually
az webapp config set --resource-group $ResourceGroupName --name $FunctionAppName --generic-configurations '{\"cors\": null}' --output none 2>$null

$apiRoot = Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) "src") "api"

# Install npm dependencies
Write-Host "  Installing function dependencies..." -ForegroundColor Yellow
Push-Location $apiRoot
npm install --omit=dev 2>&1 | Out-Null
Pop-Location

# Create zip of function app
$funcZipPath = Join-Path $env:TEMP "mercedes-explore-func.zip"
if (Test-Path $funcZipPath) { Remove-Item $funcZipPath }
Compress-Archive -Path (Join-Path $apiRoot "*") -DestinationPath $funcZipPath -Force

# Deploy
az functionapp deployment source config-zip `
    --resource-group $ResourceGroupName `
    --name $FunctionAppName `
    --src $funcZipPath `
    --output none

Remove-Item $funcZipPath -ErrorAction SilentlyContinue
Write-Host "  Function App deployed." -ForegroundColor Green

# ---------------------------------------------------------------
# Step 7: Upload static files (with config pointing to Function App)
# ---------------------------------------------------------------
Write-Host "`n[7/8] Uploading static files..." -ForegroundColor Yellow
$appRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "src"

# Generate config.js with the function URL
$buildStamp = (Get-Date -Format "yyyy-MM-dd HH:mm")
$configContent = "// Generated by deploy script - points to Azure Function proxy`nconst PROXY_CONFIG = { proxyUrl: '$functionUrl/api/proxy', build: '$buildStamp' };`n"
$configPath = Join-Path (Join-Path $appRoot "js") "config.js"
Set-Content -Path $configPath -Value $configContent -Encoding UTF8

# Stage static files (exclude api/ and server.js)
$stagingDir = Join-Path $env:TEMP "mercedes-explore-static"
if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $stagingDir | Out-Null

Copy-Item (Join-Path $appRoot "index.html") -Destination $stagingDir
Copy-Item (Join-Path $appRoot "css") -Destination (Join-Path $stagingDir "css") -Recurse
Copy-Item (Join-Path $appRoot "js") -Destination (Join-Path $stagingDir "js") -Recurse
Copy-Item (Join-Path $appRoot "proto") -Destination (Join-Path $stagingDir "proto") -Recurse

az storage blob upload-batch `
    --account-name $StorageAccountName `
    --account-key $accountKey `
    --destination '$web' `
    --source $stagingDir `
    --content-cache-control "no-cache" `
    --overwrite `
    --output none

Remove-Item $stagingDir -Recurse -Force

# Restore local config.js
$localConfig = "// Proxy configuration - overridden during Azure deployment`nconst PROXY_CONFIG = { proxyUrl: '/api/proxy', build: 'local' };`n"
Set-Content -Path $configPath -Value $localConfig -Encoding UTF8

Write-Host "  Static files uploaded." -ForegroundColor Green

# ---------------------------------------------------------------
# Step 8: Get website URL and verify
# ---------------------------------------------------------------
Write-Host "`n[8/8] Verifying deployment..." -ForegroundColor Yellow

$endpoint = az storage account show `
    --name $StorageAccountName `
    --resource-group $ResourceGroupName `
    --query "primaryEndpoints.web" `
    --output tsv

$retries = 0
$maxRetries = 4
$deployed = $false

while ($retries -lt $maxRetries -and -not $deployed) {
    try {
        $status = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 10
        if ($status.StatusCode -eq 200) { $deployed = $true }
    }
    catch {
        $retries++
        if ($retries -lt $maxRetries) {
            Write-Host "  Waiting for site (attempt $retries/$maxRetries)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
}

if ($deployed) {
    Write-Host "  Site is live!" -ForegroundColor Green
}
else {
    Write-Host "  Site may still be starting. Check the URL manually." -ForegroundColor Yellow
}

# ---------------------------------------------------------------
# Done
# ---------------------------------------------------------------
Write-Host "`n=== Deployment Complete ===" -ForegroundColor Cyan
Write-Host "Website URL:      $endpoint" -ForegroundColor Green
Write-Host "Function App URL: $functionUrl" -ForegroundColor Green
Write-Host ""

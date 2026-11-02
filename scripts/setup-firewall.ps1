<#
.SYNOPSIS
  SyncWave Windows Defender Firewall Configuration Script
.DESCRIPTION
  Adds a firewall rule allowing local Wi-Fi inbound TCP connections on port 3210
  specifically scoped to the Private Network Profile.
#>

$ruleName = "SyncWave Local Audio Streaming"
$port = 3210

Write-Host "Configuring Windows Defender Firewall for SyncWave on port $port..." -ForegroundColor Cyan

# Check if rule already exists
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existing) {
    Write-Host "Firewall rule '$ruleName' already exists. Updating..." -ForegroundColor Yellow
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private
} else {
    try {
        New-NetFirewallRule -DisplayName $ruleName `
                            -Direction Inbound `
                            -LocalPort $port `
                            -Protocol TCP `
                            -Action Allow `
                            -Profile Private `
                            -Description "Allows mobile and desktop receiver devices to connect to SyncWave audio broadcast over local Wi-Fi."
        Write-Host "Firewall rule successfully created for Private Network profile on port $port." -ForegroundColor Green
    } catch {
        Write-Warning "Could not add firewall rule automatically (requires Administrator privileges)."
        Write-Host "To add manually in an elevated PowerShell prompt:" -ForegroundColor White
        Write-Host "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -LocalPort $port -Protocol TCP -Action Allow -Profile Private" -ForegroundColor Gray
    }
}

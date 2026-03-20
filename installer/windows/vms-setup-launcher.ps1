Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Start-VmsInstaller {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptName,
    [string[]]$ScriptArgs = @(),
    [switch]$RequireElevation
  )

  $scriptPath = Join-Path $scriptDir $ScriptName
  if (-not (Test-Path $scriptPath)) {
    [System.Windows.Forms.MessageBox]::Show("Missing script: $scriptPath", 'VMS Setup Launcher', 'OK', 'Error') | Out-Null
    return
  }

  $escapedPath = '"' + $scriptPath + '"'
  $argsLine = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $escapedPath) + $ScriptArgs

  $startInfo = @{
    FilePath = 'powershell.exe'
    ArgumentList = $argsLine
    WorkingDirectory = $scriptDir
    WindowStyle = 'Normal'
  }

  if ($RequireElevation) {
    $startInfo.Verb = 'RunAs'
  }

  try {
    Start-Process @startInfo | Out-Null
  }
  catch {
    [System.Windows.Forms.MessageBox]::Show("Failed to start installer: $($_.Exception.Message)", 'VMS Setup Launcher', 'OK', 'Error') | Out-Null
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'VMS Setup Launcher'
$form.Size = New-Object System.Drawing.Size(640, 440)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.ForeColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Text = 'VMS Deployment Launcher'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(30, 24)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Choose how you want to install and onboard this site.'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(32, 62)
$form.Controls.Add($subtitle)

$btnServerQuick = New-Object System.Windows.Forms.Button
$btnServerQuick.Text = 'One-Click Server Install + Provision'
$btnServerQuick.Size = New-Object System.Drawing.Size(560, 52)
$btnServerQuick.Location = New-Object System.Drawing.Point(32, 110)
$btnServerQuick.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnServerQuick.ForeColor = [System.Drawing.Color]::White
$btnServerQuick.FlatStyle = 'Flat'
$btnServerQuick.Add_Click({
  Start-VmsInstaller -ScriptName 'install-vms-server.ps1' -ScriptArgs @('-Mode', 'Quick', '-ConfigureNow') -RequireElevation
})
$form.Controls.Add($btnServerQuick)

$btnServerGuided = New-Object System.Windows.Forms.Button
$btnServerGuided.Text = 'Guided Server Walkthrough (Prompts)'
$btnServerGuided.Size = New-Object System.Drawing.Size(560, 52)
$btnServerGuided.Location = New-Object System.Drawing.Point(32, 174)
$btnServerGuided.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnServerGuided.ForeColor = [System.Drawing.Color]::White
$btnServerGuided.FlatStyle = 'Flat'
$btnServerGuided.Add_Click({
  Start-VmsInstaller -ScriptName 'install-vms-server.ps1' -ScriptArgs @('-Mode', 'Guided', '-ConfigureNow') -RequireElevation
})
$form.Controls.Add($btnServerGuided)

$btnClient = New-Object System.Windows.Forms.Button
$btnClient.Text = 'Install Desktop Client On This Device'
$btnClient.Size = New-Object System.Drawing.Size(560, 52)
$btnClient.Location = New-Object System.Drawing.Point(32, 238)
$btnClient.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnClient.ForeColor = [System.Drawing.Color]::White
$btnClient.FlatStyle = 'Flat'
$btnClient.Add_Click({
  Start-VmsInstaller -ScriptName 'install-vms-client.ps1' -ScriptArgs @('-LaunchAfterInstall')
})
$form.Controls.Add($btnClient)

$footer = New-Object System.Windows.Forms.Label
$footer.Text = 'Tip: Use Guided mode when entering proprietary environment details.'
$footer.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$footer.AutoSize = $true
$footer.Location = New-Object System.Drawing.Point(32, 312)
$form.Controls.Add($footer)

$btnExit = New-Object System.Windows.Forms.Button
$btnExit.Text = 'Close'
$btnExit.Size = New-Object System.Drawing.Size(120, 36)
$btnExit.Location = New-Object System.Drawing.Point(472, 344)
$btnExit.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$btnExit.ForeColor = [System.Drawing.Color]::White
$btnExit.FlatStyle = 'Flat'
$btnExit.Add_Click({ $form.Close() })
$form.Controls.Add($btnExit)

[void]$form.ShowDialog()

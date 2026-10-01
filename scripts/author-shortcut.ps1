param(
  [string]$Url = "http://localhost:4321/author/"
)

$desktop = "C:\Users\gkane\Desktop"
if (-not (Test-Path $desktop)) {
  $desktop = [Environment]::GetFolderPath("Desktop")
}

$shortcutPath = Join-Path $desktop "Travel Log Author.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\explorer.exe"
$shortcut.Arguments = $Url
$shortcut.Description = "Travel Log author"
$shortcut.Save()

$urlPath = Join-Path $desktop "Travel Log Author.url"
@(
  "[InternetShortcut]"
  "URL=$Url"
) | Set-Content -Path $urlPath -Encoding ASCII

Write-Output "Shortcut: $shortcutPath"
Write-Output "URL file: $urlPath"
Write-Output "Opens: $Url"

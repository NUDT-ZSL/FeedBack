$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$port = 8765
$url = "http://127.0.0.1:$port/index.html"
Write-Host "区域仓网调拨工作台: $url"
Start-Process $url
python -m http.server $port

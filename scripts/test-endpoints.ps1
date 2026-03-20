$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$urlFile = Join-Path $root 'url.txt'

if (!(Test-Path $urlFile)) {
  Write-Host "url.txt not found at $urlFile" -ForegroundColor Red
  exit 1
}

$base = (Get-Content $urlFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($base)) {
  Write-Host "url.txt is empty" -ForegroundColor Red
  exit 1
}

$base = $base.TrimEnd('/')
$baseV1 = "$base/v1.0"

$reqId = [guid]::NewGuid().ToString()
$auth = "Authorization: Bearer test-token"
$rid = "X-Request-Id: $reqId"

Write-Host "== HEAD /v1.0 =="
curl.exe -s -I "$baseV1" | Write-Host

Write-Host "== GET /user/devices =="
curl.exe -s -i -H $auth -H $rid "$baseV1/user/devices" | Write-Host

Write-Host "== POST /user/devices/query =="
$queryBody = '{"devices":[{"id":"lamp1"}]}'
$queryPath = Join-Path $PSScriptRoot 'test-query.json'
Set-Content -Path $queryPath -Value $queryBody -NoNewline -Encoding Ascii
curl.exe -s -i -H $auth -H $rid -H "Content-Type: application/json" --data-binary "@$queryPath" "$baseV1/user/devices/query" | Write-Host

Write-Host "== POST /user/devices/action =="
$actionBody = '{"payload":{"devices":[{"id":"lamp1","capabilities":[{"type":"devices.capabilities.on_off","state":{"instance":"on","value":true}}]}]}}'
$actionPath = Join-Path $PSScriptRoot 'test-action.json'
Set-Content -Path $actionPath -Value $actionBody -NoNewline -Encoding Ascii
curl.exe -s -i -H $auth -H $rid -H "Content-Type: application/json" --data-binary "@$actionPath" "$baseV1/user/devices/action" | Write-Host

Write-Host "== POST /user/unlink =="
curl.exe -s -i -H $auth -H $rid -H "Content-Type: application/json" -d "{}" "$baseV1/user/unlink" | Write-Host

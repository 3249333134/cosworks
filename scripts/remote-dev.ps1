param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Init', 'Refresh', 'Start', 'Stop', 'Check')]
  [string]$Action,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$StateDirectory = Join-Path $ProjectRoot '.local'
$PidFile = Join-Path $StateDirectory 'remote-dev-tunnel.json'
$EnvFile = Join-Path $ProjectRoot 'apps/server/.env.remote-dev'
$ExampleEnvFile = Join-Path $ProjectRoot 'apps/server/.env.remote-dev.example'
$SshKey = Join-Path $env:USERPROFILE '.ssh/cosworks_deploy_ed25519'
$Remote = 'cosworks@47.115.220.98'
$DevDatabase = 'cosworks_dev'
$DevUser = 'cosworks_dev_app'
$RedisDatabase = '1'
$SshOptions = @('-i', $SshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3')

function Assert-SafeTargets {
  if ($DevDatabase -cne 'cosworks_dev' -or $DevUser -cne 'cosworks_dev_app' -or $RedisDatabase -cne '1') {
    throw 'Safety check failed: remote-dev targets are not the expected isolated resources.'
  }
}

function Assert-Prerequisites {
  if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw 'OpenSSH client (ssh.exe) is required.' }
  if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) { throw "SSH key not found: $SshKey" }
  if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm is required.' }
}

function Invoke-RemoteCapture([string]$Command) {
  $output = & ssh.exe @SshOptions $Remote $Command
  if ($LASTEXITCODE -ne 0) { throw "SSH command failed with exit code $LASTEXITCODE." }
  return ($output -join "`n").Trim()
}

function Invoke-RemoteScript([string]$Script) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script))
  & ssh.exe @SshOptions $Remote "printf '%s' '$encoded' | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { throw "Remote operation failed with exit code $LASTEXITCODE." }
}

function New-Secret([int]$Bytes = 24) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Get-EnvValues {
  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw 'Run pnpm remote-dev:init first.' }
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
    if ($line.Trim().Length -eq 0 -or $line.TrimStart().StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -gt 0) { $values[$line.Substring(0, $separator)] = $line.Substring($separator + 1) }
  }
  return $values
}

function Assert-LocalEnv($Values) {
  if ($Values['DB_NAME'] -cne $DevDatabase -or $Values['DB_USER'] -cne $DevUser -or $Values['DB_HOST'] -cne '127.0.0.1' -or $Values['DB_PORT'] -cne '13306') { throw 'Unsafe MySQL target in .env.remote-dev.' }
  if ($Values['REDIS_DB'] -cne $RedisDatabase -or $Values['REDIS_HOST'] -cne '127.0.0.1' -or $Values['REDIS_PORT'] -cne '16379') { throw 'Unsafe Redis target in .env.remote-dev.' }
  if ($Values['DB_PASSWORD'] -notmatch '^[A-Za-z0-9]+$') { throw 'DB_PASSWORD contains unsupported characters.' }
}

function Write-LocalEnv([string]$DatabasePassword, [string]$RedisPassword, [string]$JwtSecret) {
  $content = @"
NODE_ENV=development
HOST=0.0.0.0
PORT=5000
PUBLIC_ORIGIN=http://localhost:5173

DATA_MODE=mysql
DEPENDENCY_CHECK_STRICT=true
DB_HOST=127.0.0.1
DB_PORT=13306
DB_NAME=$DevDatabase
DB_USER=$DevUser
DB_PASSWORD=$DatabasePassword

REDIS_ENABLED=true
REDIS_HOST=127.0.0.1
REDIS_PORT=16379
REDIS_DB=$RedisDatabase
REDIS_USERNAME=
REDIS_PASSWORD=$RedisPassword

JWT_SECRET=$JwtSecret
JWT_EXPIRES_IN=7d
COOKIE_SECURE=false

AI_PROVIDER=local
AI_API_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=12000
"@
  [IO.File]::WriteAllText($EnvFile, $content.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
}

function Get-RefreshScript([string]$DatabasePassword, [bool]$DropFirst, [bool]$OnlySeedEmptyRedis) {
  $dropStatement = if ($DropFirst) { "DROP DATABASE IF EXISTS $DevDatabase;" } else { '' }
  $tableGuard = if ($DropFirst) { '0' } else { '$(docker exec -e MYSQL_PWD="$mysql_root_password" mysql-server mysql -uroot --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=''{0}''")' -f $DevDatabase }
  $redisGuard = if ($OnlySeedEmptyRedis) { 'if [ "$redis_size" = "0" ]; then' } else { 'if true; then' }
  return @"
set -euo pipefail
dev_db='$DevDatabase'
dev_user='$DevUser'
dev_password='$DatabasePassword'
[ "`$dev_db" = 'cosworks_dev' ] && [ '$RedisDatabase' = '1' ] || { echo 'unsafe target' >&2; exit 40; }
mysql_root_password=`$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' mysql-server | sed -n 's/^MYSQL_ROOT_PASSWORD=//p' | head -n 1)
[ -n "`$mysql_root_password" ] || { echo 'MySQL root credential is unavailable' >&2; exit 41; }
docker exec -e MYSQL_PWD="`$mysql_root_password" mysql-server mysql -uroot --execute "$dropStatement CREATE DATABASE IF NOT EXISTS $DevDatabase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '$DevUser'@'%' IDENTIFIED BY '$DatabasePassword'; ALTER USER '$DevUser'@'%' IDENTIFIED BY '$DatabasePassword'; GRANT ALL PRIVILEGES ON $DevDatabase.* TO '$DevUser'@'%'; FLUSH PRIVILEGES;"
table_count=$tableGuard
if [ "`$table_count" = '0' ]; then
  docker exec -e MYSQL_PWD="`$mysql_root_password" mysql-server mysqldump -uroot --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF cosworks | docker exec -i -e MYSQL_PWD="`$mysql_root_password" mysql-server mysql -uroot $DevDatabase
fi
redis_password=`$(sed -n 's/^REDIS_PASSWORD=//p' /opt/cosworks/shared/.env.production | tail -n 1)
[ -n "`$redis_password" ] || { echo 'Redis credential is unavailable' >&2; exit 42; }
redis_size=`$(docker exec -e REDISCLI_AUTH="`$redis_password" redis-server redis-cli -n $RedisDatabase DBSIZE)
$redisGuard
  docker exec -e REDISCLI_AUTH="`$redis_password" redis-server redis-cli -n $RedisDatabase FLUSHDB >/dev/null
  docker exec -e REDISCLI_AUTH="`$redis_password" redis-server redis-cli -n 0 EVAL "local cursor='0'; local copied=0; repeat local result=redis.call('SCAN',cursor,'COUNT',500); cursor=result[1]; for _,key in ipairs(result[2]) do if not string.match(key,'^room:.*:online$') then redis.call('COPY',key,key,'DB',$RedisDatabase,'REPLACE'); copied=copied+1; end; end; until cursor=='0'; return copied" 0 >/dev/null
fi
echo '[remote-dev] Isolated MySQL and Redis resources are ready.'
"@
}

function Initialize-RemoteDev {
  Assert-SafeTargets
  Assert-Prerequisites
  $databasePassword = New-Secret
  $jwtSecret = New-Secret 32
  $redisPassword = Invoke-RemoteCapture "sed -n 's/^REDIS_PASSWORD=//p' /opt/cosworks/shared/.env.production | tail -n 1"
  if ([string]::IsNullOrWhiteSpace($redisPassword)) { throw 'Could not read the Redis application credential on the server.' }
  Invoke-RemoteScript (Get-RefreshScript $databasePassword $false $true)
  Write-LocalEnv $databasePassword $redisPassword $jwtSecret
  Write-Host '[remote-dev] Initialization complete. Local secrets were written to the ignored .env.remote-dev file.'
}

function Refresh-RemoteDev {
  Assert-SafeTargets
  Assert-Prerequisites
  $values = Get-EnvValues
  Assert-LocalEnv $values
  if (-not $Force) {
    $confirmation = Read-Host 'This replaces cosworks_dev and Redis DB1. Type REFRESH to continue'
    if ($confirmation -cne 'REFRESH') { throw 'Refresh cancelled.' }
  }
  Invoke-RemoteScript (Get-RefreshScript $values['DB_PASSWORD'] $true $false)
  Write-Host '[remote-dev] Snapshot refresh complete. Production data was not modified.'
}

function Test-TcpPort([int]$Port, [int]$TimeoutMilliseconds = 8000) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch { return $false } finally { $client.Dispose() }
}

function Get-RecordedTunnel {
  if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) { return $null }
  try {
    $record = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction Stop
    if ($process.ProcessName -cne 'ssh' -or $process.StartTime.ToUniversalTime().Ticks -ne [long]$record.startTimeUtcTicks) { return $null }
    return $process
  } catch { return $null }
}

function Start-Tunnel {
  Assert-Prerequisites
  New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
  $existing = Get-RecordedTunnel
  if ($existing) { return $existing }
  if ((Test-TcpPort 13306 200) -or (Test-TcpPort 16379 200)) { throw 'Local port 13306 or 16379 is already in use by an unrecorded process.' }
  $arguments = @('-N') + $SshOptions + @('-o', 'ExitOnForwardFailure=yes', '-L', '127.0.0.1:13306:127.0.0.1:3306', '-L', '127.0.0.1:16379:127.0.0.1:6379', $Remote)
  $process = Start-Process -FilePath 'ssh.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $record = @{ pid = $process.Id; startTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($PidFile, $record, [Text.UTF8Encoding]::new($false))
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($process.HasExited) { throw 'SSH tunnel exited before forwarding ports. Verify the key and server access.' }
    if ((Test-TcpPort 13306 200) -and (Test-TcpPort 16379 200)) { Write-Host '[remote-dev] SSH tunnel is ready.'; return $process }
    Start-Sleep -Milliseconds 250
  }
  Stop-Tunnel
  throw 'Timed out waiting for SSH tunnel ports.'
}

function Stop-Tunnel {
  $process = Get-RecordedTunnel
  if ($process) {
    Stop-Process -Id $process.Id
    $process.WaitForExit(5000) | Out-Null
    Write-Host '[remote-dev] SSH tunnel stopped.'
  } else {
    Write-Host '[remote-dev] No recorded SSH tunnel is running.'
  }
  if (Test-Path -LiteralPath $PidFile -PathType Leaf) { Remove-Item -LiteralPath $PidFile -Force }
}

function Invoke-DependencyCheck {
  $values = Get-EnvValues
  Assert-LocalEnv $values
  if (-not (Get-RecordedTunnel)) { throw 'SSH tunnel is not running. Run pnpm remote-dev:start first.' }
  $env:DOTENV_CONFIG_PATH = $EnvFile
  & pnpm --filter @ruxiju/server exec tsx scripts/remote-dev-check.ts
  if ($LASTEXITCODE -ne 0) { throw 'Remote dependency check failed.' }
}

Push-Location $ProjectRoot
try {
  switch ($Action) {
    'Init' { Initialize-RemoteDev }
    'Refresh' { Refresh-RemoteDev }
    'Start' {
      $values = Get-EnvValues
      Assert-LocalEnv $values
      Start-Tunnel | Out-Null
      $env:DOTENV_CONFIG_PATH = $EnvFile
      try { & pnpm dev; if ($LASTEXITCODE -ne 0) { throw "pnpm dev failed with exit code $LASTEXITCODE." } } finally { Stop-Tunnel }
    }
    'Stop' { Stop-Tunnel }
    'Check' { Invoke-DependencyCheck }
  }
} finally {
  Pop-Location
}

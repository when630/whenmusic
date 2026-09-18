# poc/ctl-host.ps1 - resident SMTC control host.
# The 250ms measured earlier was almost all process spawn + WinRT init. Pay it ONCE:
# keep this process alive and feed it commands on stdin, one per line.
#   sessions              -> count of sessions
#   pos <appIdFragment>   -> timeline position in seconds
#   pause|play <frag>     -> targeted transport command
#   seek <frag> <seconds> -> absolute seek
# Each reply is one line on stdout, so the Node side can pair request/response.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
  $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]

# The expensive part, paid once for the life of the process.
$mgr = Await ($mgrType::RequestAsync()) $mgrType

function Find($frag) {
  foreach ($s in $mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -like "*$frag*") { return $s }
  }
  return $null
}

Write-Output 'READY'
[Console]::Out.Flush()

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim() -split '\s+'
  $cmd = $parts[0]
  try {
    switch ($cmd) {
      'sessions' { Write-Output ($mgr.GetSessions().Count) }
      'quit'     { break }
      default {
        $s = Find $parts[1]
        if (-not $s) { Write-Output 'ERR no-session' }
        else {
          switch ($cmd) {
            'pos'   { Write-Output ([math]::Round($s.GetTimelineProperties().Position.TotalSeconds, 2)) }
            'stat'  { Write-Output ($s.GetPlaybackInfo().PlaybackStatus) }
            'pause' { Write-Output ('OK ' + (Await ($s.TryPauseAsync()) ([bool]))) }
            'play'  { Write-Output ('OK ' + (Await ($s.TryPlayAsync()) ([bool]))) }
            'seek'  {
              $ticks = [long]([double]$parts[2] * 10000000)
              Write-Output ('OK ' + (Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool])))
            }
            default { Write-Output 'ERR unknown-cmd' }
          }
        }
      }
    }
  } catch {
    Write-Output ('ERR ' + $_.Exception.Message)
  }
  [Console]::Out.Flush()
}

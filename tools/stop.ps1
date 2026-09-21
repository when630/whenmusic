# tools/stop.ps1 — 이 앱의 개발 인스턴스만 종료한다.
#
# `taskkill /IM electron.exe`처럼 이름만 보고 끄면 같은 PC에서 돌고 있는
# 형제 앱의 개발 인스턴스까지 함께 죽는다. 실제로 그렇게 죽였다 —
# 명령줄에 whenmusic이 든 것만 고른다.

$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*whenmusic*' }

if (-not $procs) {
  Write-Output 'whenmusic 인스턴스가 없습니다'
  exit 0
}

foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Output ("whenmusic 인스턴스 {0}개 종료" -f @($procs).Count)

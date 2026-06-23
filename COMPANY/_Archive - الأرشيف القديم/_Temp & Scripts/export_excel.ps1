$files = @(
    "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\WORKSHOP DATABASE - قاعدة بيانات الورشة.xlsx",
    "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\Attendance - الحضور\Active - الحالي\Master Attendance Register - سجل الحضور الموحد.xlsx",
    "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\Attendance - الحضور\Active - الحالي\Master Attendance 2025-2026 - سجل الحضور الموحد.xlsx"
)

$outDir = "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\_temp_csvs"
if (-Not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$excel = New-Object -ComObject Excel.Application
$excel.DisplayAlerts = $false
$excel.Visible = $false

foreach ($f in $files) {
    if (Test-Path $f) {
        Write-Output "Processing $f"
        $wb = $excel.Workbooks.Open($f)
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($f)
        foreach ($sh in $wb.Sheets) {
            $shName = $sh.Name
            # xlCSVUTF8 format code is 62
            $csvPath = Join-Path $outDir "$baseName - $shName.csv"
            $sh.SaveAs($csvPath, 62)
        }
        $wb.Close($false)
    } else {
        Write-Output "File not found: $f"
    }
}
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
Write-Output "Done exporting."

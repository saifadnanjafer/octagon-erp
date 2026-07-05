$outDir = "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\_temp_csvs"
if (-Not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$files = @()
$files += Get-ChildItem -Path "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\*WORKSHOP DATABASE*.xlsx" | Select-Object -ExpandProperty FullName
$files += Get-ChildItem -Path "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\Attendance*\Active*\*Master Attendance Register*.xlsx" | Select-Object -ExpandProperty FullName
$files += Get-ChildItem -Path "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\Attendance*\Active*\*Master Attendance 2025-2026*.xlsx" | Select-Object -ExpandProperty FullName

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
            $csvPath = Join-Path $outDir "$baseName - $shName.csv"
            $sh.SaveAs($csvPath, 62) # xlCSVUTF8
        }
        $wb.Close($false)
    }
}
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
Write-Output "Done exporting."

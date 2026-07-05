$outDir = "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\_temp_csvs"
if (-Not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$dbFiles = Get-ChildItem -Path "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\*WORKSHOP DATABASE*.xlsx"
$attRegFiles = Get-ChildItem -Path "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\Attendance*\Active*\*Master Attendance Register*.xlsx"
$att2025Files = Get-ChildItem -Path "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\Attendance*\Active*\*Master Attendance 2025-2026*.xlsx"

$tempPaths = @()

if ($dbFiles.Count -gt 0) { 
    $p = "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\temp_db.xlsx"
    Copy-Item -LiteralPath $dbFiles[0].FullName -Destination $p -Force
    $tempPaths += $p 
}
if ($attRegFiles.Count -gt 0) { 
    $p = "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\temp_reg.xlsx"
    Copy-Item -LiteralPath $attRegFiles[0].FullName -Destination $p -Force
    $tempPaths += $p 
}
if ($att2025Files.Count -gt 0) { 
    $p = "c:\Users\Zahraa dlbooz\OneDrive\Documents\notebooklm\temp_att2025.xlsx"
    Copy-Item -LiteralPath $att2025Files[0].FullName -Destination $p -Force
    $tempPaths += $p 
}

$excel = New-Object -ComObject Excel.Application
$excel.DisplayAlerts = $false
$excel.Visible = $false

foreach ($f in $tempPaths) {
    if (Test-Path $f) {
        Write-Output "Processing $f"
        try {
            $wb = $excel.Workbooks.Open($f)
            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($f)
            foreach ($sh in $wb.Sheets) {
                # Sanitize sheet name if it contains invalid chars
                $shName = $sh.Name -replace '[\\/:\*\?"<>\|]', '_'
                $csvPath = Join-Path $outDir "$baseName - $shName.csv"
                $sh.SaveAs($csvPath, 62)
            }
            $wb.Close($false)
        } catch {
            Write-Output "Error opening $f : $_"
        }
    }
}
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
Write-Output "Done exporting."

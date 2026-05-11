[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "http://localhost,https://airi.moeru.ai,https://post.tommylee.ai", "User")
$env:OLLAMA_ORIGINS = "http://localhost,https://airi.moeru.ai,https://post.tommylee.ai"
taskkill /F /IM "ollama app.exe"
taskkill /F /IM "ollama.exe"
Start-Sleep -Seconds 2
Start-Process "$env:LocalAppData\Programs\Ollama\ollama app.exe"
Write-Output "Ollama restarted with new CORS policy"

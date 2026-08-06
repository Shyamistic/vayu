# Runs the built image locally with a 4 GB memory cap (matching the Fargate
# task) and all region data bind-mounted read-only from local disk, so real
# memory behavior can be measured without waiting on an S3 download each time.
#
#   .\scripts\run_memtest.ps1

docker rm -f vayu-memtest 2>&1 | Out-Null

$repoRoot = (Split-Path $PSScriptRoot -Parent) -replace '\\', '/'

docker run -d --name vayu-memtest --memory=4g -p 8010:8000 `
    -e CLIMATE_DATA_ROOT=/app/data `
    -e STATIC_RASTER_ROOT=/app/static `
    -v "D:/vayu_data/processed_western_ghats_1981:/app/data/processed_western_ghats_1981:ro" `
    -v "D:/vayu_data/processed_north_east_india_1981:/app/data/processed_north_east_india_1981:ro" `
    -v "D:/vayu_data/processed_indo_gangetic_plain_1981:/app/data/processed_indo_gangetic_plain_1981:ro" `
    -v "D:/vayu_data/processed_central_india_1981:/app/data/processed_central_india_1981:ro" `
    -v "D:/vayu_data/processed_full_india_05:/app/data/processed_full_india_05:ro" `
    -v "D:/static_western_ghats:/app/static/static_western_ghats:ro" `
    -v "D:/static_north_east_india:/app/static/static_north_east_india:ro" `
    -v "D:/static_indo_gangetic_plain:/app/static/static_indo_gangetic_plain:ro" `
    -v "D:/static_central_india:/app/static/static_central_india:ro" `
    -v "D:/static_full_india_05:/app/static/static_full_india_05:ro" `
    -v "${repoRoot}/checkpoints:/app/checkpoints:ro" `
    vayu-backend:latest

Write-Host "RUN_EXIT=$LASTEXITCODE"

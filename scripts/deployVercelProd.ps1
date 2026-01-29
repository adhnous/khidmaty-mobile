param(
  [string]$Scope = "fateh-adhnouss-projects",
  [string]$Project = "khidmaty-mobile"
)

$ErrorActionPreference = "Stop"

# Build the Expo web export and deploy the generated static `dist` folder to Vercel.
# Use this script when Vercel CLI upload limits are not blocking deployments.

$mobileDir = Resolve-Path (Join-Path $PSScriptRoot "..")

Set-Location $mobileDir
npm run export:web

Set-Location (Join-Path $mobileDir "dist")

# Always link explicitly to avoid accidentally creating a new project (e.g. a "dist" project).
npx vercel@latest link --yes --project $Project --scope $Scope

# Deploy to production
npx vercel@latest --prod --yes --project $Project --scope $Scope --archive=tgz


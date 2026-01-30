# S3 Deployment Script for Uniserved Chatbot
# This script builds and deploys your static Next.js site to S3

param(
    [string]$BucketName = "uniserved-chatbot",
    [string]$Region = "us-east-1"
)

Write-Host "🚀 Deploying Uniserved Chatbot to S3" -ForegroundColor Cyan
Write-Host "Bucket: $BucketName" -ForegroundColor Gray
Write-Host "Region: $Region" -ForegroundColor Gray
Write-Host ""

# Check if AWS CLI is installed
try {
    $awsVersion = aws --version 2>&1
    Write-Host "✅ AWS CLI found" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS CLI is not installed. Please install it first." -ForegroundColor Red
    Write-Host "Download from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check if AWS credentials are configured
try {
    $identity = aws sts get-caller-identity 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ AWS credentials not configured. Run 'aws configure' first." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ AWS credentials configured" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS credentials not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 1: Build
Write-Host "📦 Step 1: Building static site..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed! Please fix errors and try again." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "out")) {
    Write-Host "❌ Build output folder 'out' not found!" -ForegroundColor Red
    Write-Host "   Make sure next.config.ts has 'output: export'" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Build successful" -ForegroundColor Green
Write-Host ""

# Step 2: Create bucket (if doesn't exist)
Write-Host "🪣 Step 2: Creating S3 bucket..." -ForegroundColor Yellow
$bucketExists = aws s3 ls s3://$BucketName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Bucket already exists" -ForegroundColor Green
} else {
    aws s3 mb s3://$BucketName --region $Region 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Bucket created successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to create bucket. It might already exist or name is taken." -ForegroundColor Red
        Write-Host "   Try a different bucket name or check AWS Console." -ForegroundColor Yellow
        exit 1
    }
}
Write-Host ""

# Step 3: Enable website hosting
Write-Host "🌐 Step 3: Enabling static website hosting..." -ForegroundColor Yellow
aws s3 website s3://$BucketName `
  --index-document index.html `
  --error-document 404.html 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Website hosting enabled" -ForegroundColor Green
} else {
    Write-Host "⚠️  Warning: Could not enable website hosting automatically" -ForegroundColor Yellow
    Write-Host "   Enable it manually in AWS Console → S3 → Bucket → Properties → Static website hosting" -ForegroundColor Yellow
}
Write-Host ""

# Step 4: Upload files
Write-Host "📤 Step 4: Uploading files to S3..." -ForegroundColor Yellow
aws s3 sync out/ s3://$BucketName --delete 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Files uploaded successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to upload files" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 5: Set bucket policy (create file)
Write-Host "📋 Step 5: Setting bucket policy..." -ForegroundColor Yellow
$policy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid = "PublicReadGetObject"
            Effect = "Allow"
            Principal = "*"
            Action = "s3:GetObject"
            Resource = "arn:aws:s3:::$BucketName/*"
        }
    )
} | ConvertTo-Json -Depth 10

$policy | Out-File -FilePath "bucket-policy.json" -Encoding utf8 -Force

aws s3api put-bucket-policy `
  --bucket $BucketName `
  --policy file://bucket-policy.json 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Bucket policy set" -ForegroundColor Green
    Remove-Item "bucket-policy.json" -Force
} else {
    Write-Host "⚠️  Warning: Could not set bucket policy automatically" -ForegroundColor Yellow
    Write-Host "   Policy saved as 'bucket-policy.json' - apply it manually in AWS Console" -ForegroundColor Yellow
    Write-Host "   Go to: S3 → Bucket → Permissions → Bucket policy" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 Your website URL:" -ForegroundColor Cyan
Write-Host "   http://$BucketName.s3-website-$Region.amazonaws.com" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  IMPORTANT: Don't forget to:" -ForegroundColor Yellow
Write-Host "   1. Go to AWS Console → S3 → $BucketName" -ForegroundColor White
Write-Host "   2. Permissions tab → Block public access" -ForegroundColor White
Write-Host "   3. Click 'Edit' and UNCHECK all boxes" -ForegroundColor White
Write-Host "   4. Save changes" -ForegroundColor White
Write-Host ""
Write-Host "🌐 RECOMMENDED: Set up CloudFront for HTTPS and SPA routing:" -ForegroundColor Cyan
Write-Host "   Run: .\setup-cloudfront.ps1" -ForegroundColor White
Write-Host "   Or follow guide in S3_DEPLOY.md" -ForegroundColor White
Write-Host ""
Write-Host "   ⚠️  CRITICAL: Configure error responses in CloudFront:" -ForegroundColor Yellow
Write-Host "      - 403 → /index.html (HTTP 200)" -ForegroundColor Gray
Write-Host "      - 404 → /index.html (HTTP 200)" -ForegroundColor Gray
Write-Host "   This is required for Next.js client-side routing!" -ForegroundColor Yellow
Write-Host ""


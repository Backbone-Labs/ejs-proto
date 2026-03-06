const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

// Parse arguments
const args = process.argv.slice(2);
const zipFilePath = args[0] || "build/emulator-build.zip";
const envFile = args[1] || ".env";

// Load environment variables from file
console.log(`📄 Loading environment from: ${envFile}`);
if (fs.existsSync(envFile)) {
  const result = dotenv.config({ path: envFile });
  if (result.error) {
    console.error(`Error loading ${envFile}:`, result.error);
    process.exit(1);
  }
} else {
  console.log(`Warning: ${envFile} not found, using default .env file`);
  dotenv.config();
}

// Verify build exists before proceeding
console.log(`\n🔍 Checking for build at: ${zipFilePath}`);
if (!fs.existsSync(zipFilePath)) {
  console.error(`❌ Error: Build file not found at ${zipFilePath}`);
  console.error(`   Make sure the build process completed successfully first.`);
  process.exit(1);
}

// Get file stats
const fileStats = fs.statSync(zipFilePath);
const fileSize = (fileStats.size / (1024 * 1024)).toFixed(2);
console.log(`✅ Found build file: ${zipFilePath} (${fileSize} MB)`);

// Check for required environment variables
const requiredEnvVars = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error(
    `\n❌ Error: Missing required environment variables: ${missingEnvVars.join(
      ", "
    )}`
  );
  console.error(
    "   Please create a .env file with these variables or set them in your environment."
  );
  process.exit(1);
}

// Create R2 client with more reliable configuration
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  maxAttempts: 3,
});

// Read version from version.txt (if present)
let buildVersion = null;
const versionFile = path.join(path.dirname(zipFilePath), "..", "version.txt");
if (fs.existsSync(versionFile)) {
  buildVersion = fs.readFileSync(versionFile, "utf-8").trim();
  console.log(`📌 Build version: ${buildVersion}`);
}

// Upload the zip file to R2 using multipart streaming upload
async function uploadToR2(uploadFileName) {
  const fileStream = fs.createReadStream(zipFilePath);
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: uploadFileName,
      Body: fileStream,
      ContentType: "application/zip",
      ContentDisposition: `attachment; filename=${uploadFileName}`,
    },
  });
  upload.on("httpUploadProgress", (progress) => {
    const loaded = progress.loaded || 0;
    const total = progress.total || fileStats.size;
    const pct = Math.round((loaded / total) * 100);
    console.log(`  📊 ${uploadFileName}: ${pct}% (${(loaded/(1024*1024)).toFixed(2)}MB / ${(total/(1024*1024)).toFixed(2)}MB)`);
  });
  await upload.done();
  console.log(`  ✅ Uploaded: ${uploadFileName}`);

  // Purge Cloudflare CDN cache for this file
  if (process.env.CF_ZONE_ID && process.env.CF_API_TOKEN && process.env.R2_PUBLIC_URL) {
    const purgeUrl = `${process.env.R2_PUBLIC_URL}/${uploadFileName}`;
    const purgeRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${process.env.CF_ZONE_ID}/purge_cache`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files: [purgeUrl] }),
      }
    );
    const purgeData = await purgeRes.json();
    if (purgeData.success) {
      console.log(`  🔄 Cache purged: ${purgeUrl}`);
    } else {
      console.error(`  ❌ Cache purge failed for ${purgeUrl}:`, JSON.stringify(purgeData.errors));
    }
  }
}

async function uploadZipToR2() {
  try {
    const fileName = "emulator-build.zip";
    console.log(`\n📤 Uploading ${fileSize} MB to R2 bucket ${process.env.R2_BUCKET_NAME}...`);
    console.log(`🔗 Endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);

    // Upload unversioned (emulator-build.zip)
    await uploadToR2(fileName);

    // Also upload versioned copy (emulator-build-0.0.8.zip) to bypass CDN cache
    if (buildVersion) {
      const versionedName = `emulator-build-${buildVersion}.zip`;
      await uploadToR2(versionedName);
      console.log(`\n⭐ Versioned URL: ${process.env.R2_PUBLIC_URL}/${versionedName}`);
    }

    console.log("\n🎉 Upload process completed successfully!\n");
  } catch (error) {
    console.error("❌ Error uploading to R2:", error.message);
    process.exit(1);
  }
}

// Run the upload
uploadZipToR2();

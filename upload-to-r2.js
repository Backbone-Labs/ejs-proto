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

// Upload the zip file to R2 using multipart streaming upload
async function uploadZipToR2() {
  try {
    const fileName = "emulator-build.zip";
    console.log(
      `\n📤 Preparing to upload ${fileName} (${fileSize} MB) to R2 bucket ${process.env.R2_BUCKET_NAME}...`
    );

    // Configuration info
    console.log(
      `🔗 Using endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    );
    console.log(`🪣 Bucket: ${process.env.R2_BUCKET_NAME}`);
    console.log(
      `🔑 Using access key: ${process.env.R2_ACCESS_KEY_ID.substring(
        0,
        5
      )}...${process.env.R2_ACCESS_KEY_ID.substring(
        process.env.R2_ACCESS_KEY_ID.length - 5
      )}`
    );

    // Create a read stream for the file
    console.log(`⏳ Creating file stream...`);
    const fileStream = fs.createReadStream(zipFilePath);

    // Use the Upload class from @aws-sdk/lib-storage for multipart uploads
    console.log(`⏳ Starting multipart upload...`);
    const upload = new Upload({
      client: r2Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: fileStream,
        ContentType: "application/zip",
        ContentDisposition: `attachment; filename=${fileName}`,
      },
    });

    // Add event listeners for progress
    upload.on("httpUploadProgress", (progress) => {
      const loaded = progress.loaded || 0;
      const total = progress.total || fileStats.size;
      const percentLoaded = Math.round((loaded / total) * 100);
      console.log(
        `📊 Upload progress: ${percentLoaded}% (${(
          loaded /
          (1024 * 1024)
        ).toFixed(2)}MB / ${(total / (1024 * 1024)).toFixed(2)}MB)`
      );
    });

    // Start the upload
    await upload.done();

    console.log("✅ Upload successful!");

    // Purge Cloudflare CDN cache so devices get the new build immediately
    if (process.env.CF_ZONE_ID && process.env.CF_API_TOKEN) {
      const purgeUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;
      console.log(`\n🔄 Purging Cloudflare cache for: ${purgeUrl}`);
      const purgeRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${process.env.CF_ZONE_ID}/purge_cache`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.CF_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ files: [purgeUrl] }),
        }
      );
      const purgeData = await purgeRes.json();
      if (purgeData.success) {
        console.log("✅ Cloudflare cache purged successfully!");
      } else {
        console.error("❌ Cloudflare cache purge failed:", JSON.stringify(purgeData.errors));
      }
    } else {
      console.warn("⚠️  CF_ZONE_ID or CF_API_TOKEN not set — skipping Cloudflare cache purge");
    }

    // Log the URL in a more prominent way
    const directR2Url = `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${fileName}`;

    console.log("\n📋 File URLs:");
    console.log("====================");

    if (process.env.R2_PUBLIC_URL) {
      console.log(`🌐 Public URL: ${process.env.R2_PUBLIC_URL}/${fileName}`);
    }

    console.log(`🔒 Direct R2 URL: ${directR2Url}`);
    console.log("====================\n");

    console.log("\n🎉 Upload process completed successfully!\n");
  } catch (error) {
    console.error("❌ Error uploading to R2:", error.message);
    console.error("\n💡 Troubleshooting suggestions:");
    console.error("  1. Verify your R2 credentials in the .env file");
    console.error("  2. Check your network connection");
    console.error(
      "  3. Try uploading a smaller test file using test-r2-connection.js"
    );
    console.error(
      "  4. The file might be too large - check if your R2 bucket has size limits"
    );
    process.exit(1);
  }
}

// Run the upload
uploadZipToR2();

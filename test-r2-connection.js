const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const {
  S3Client,
  PutObjectCommand,
  ListBucketsCommand,
} = require("@aws-sdk/client-s3");

// Load environment variables
const envFile = process.argv[2] || ".env.local";
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

// Check required vars
const requiredEnvVars = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error(
    `❌ Missing environment variables: ${missingEnvVars.join(", ")}`
  );
  process.exit(1);
}

// Create R2 client
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Try with path style URLs
});

async function testR2Connection() {
  try {
    console.log("🔍 Testing R2 connection...");
    console.log(
      `🔗 Endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    );
    console.log(`🪣 Bucket: ${process.env.R2_BUCKET_NAME}`);

    // Create a tiny test file
    const testData = Buffer.from("R2 connection test");
    const testFileName = "test-connection.txt";

    // Upload test file
    console.log("📤 Uploading tiny test file...");
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: testFileName,
      Body: testData,
      ContentType: "text/plain",
    });

    await r2Client.send(command);
    console.log("✅ Test upload successful!");
    console.log(
      `✅ Your R2 credentials and bucket configuration are working correctly.`
    );
  } catch (error) {
    console.error("❌ Error connecting to R2:", error);
    console.error("\n💡 Troubleshooting suggestions:");
    console.error(
      "  1. Double-check your R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY"
    );
    console.error(
      "  2. Verify your R2_BUCKET_NAME exists and the API key has write access to it"
    );
    console.error(
      "  3. Check if there are any network issues or proxies interfering with the connection"
    );
    process.exit(1);
  }
}

testR2Connection();

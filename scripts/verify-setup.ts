
// Simple verification script
// Run with: npx ts-node scripts/verify-setup.ts

async function run() {
  console.log("Checking Health Endpoint...");
  try {
    const res = await fetch('http://localhost:3000/health');
    if (res.ok) {
        console.log("✅ Server is reachable");
    } else {
        console.error("❌ Server returned", res.status);
    }
  } catch (e: any) {
    console.error("❌ Failed to connect to server:", e.message);
    console.log("Make sure to run 'npm run dev' or 'npm start' in a separate terminal.");
  }
}

run();

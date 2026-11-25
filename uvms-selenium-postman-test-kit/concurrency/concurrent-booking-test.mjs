import process from "node:process";

const baseUrl = process.env.UVMS_BASE_URL;
const path = process.env.UVMS_BOOKING_PATH;
const payloadText = process.env.UVMS_BOOKING_PAYLOAD;
const tokenList = (process.env.UVMS_AUTH_TOKENS || process.env.UVMS_AUTH_TOKEN || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const successCodes = new Set((process.env.UVMS_SUCCESS_CODES || "200,201")
  .split(",").map(Number));
const conflictCodes = new Set((process.env.UVMS_CONFLICT_CODES || "400,409,422")
  .split(",").map(Number));

function fail(message) {
  console.error(`CONFIGURATION ERROR: ${message}`);
  process.exit(2);
}

if (!baseUrl) fail("Set UVMS_BASE_URL, e.g. http://localhost:5000");
if (!path || path.includes("REPLACE_WITH")) fail("Set UVMS_BOOKING_PATH to the actual create-booking route");
if (!payloadText) fail("Set UVMS_BOOKING_PAYLOAD to a valid JSON request body");
if (tokenList.length === 0) fail("Set UVMS_AUTH_TOKEN or comma-separated UVMS_AUTH_TOKENS");

let payload;
try { payload = JSON.parse(payloadText); }
catch { fail("UVMS_BOOKING_PAYLOAD is not valid JSON"); }

const count = Number(process.argv[2] || 10);
if (![2, 5, 10, 25, 50].includes(count)) {
  fail("Choose a concurrency level: 2, 5, 10, 25 or 50");
}

const url = new URL(path, baseUrl).toString();
const startGate = (() => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
})();

async function sendRequest(index) {
  await startGate.promise;
  const token = tokenList[index % tokenList.length];
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let responseBody = text;
    try { responseBody = JSON.parse(text); } catch {}
    return {
      request: index + 1,
      status: response.status,
      success: successCodes.has(response.status),
      conflict: conflictCodes.has(response.status),
      startedAt,
      body: responseBody
    };
  } catch (error) {
    return { request: index + 1, status: null, success: false, conflict: false,
      startedAt, networkError: String(error) };
  }
}

console.log(`Target: ${url}`);
console.log(`Concurrency: ${count}`);
console.log("All requests are released from the same start gate...");
const requests = Array.from({ length: count }, (_, i) => sendRequest(i));
// Allow all async tasks to reach the gate before releasing it.
await new Promise(resolve => setImmediate(resolve));
startGate.release();
const results = await Promise.all(requests);

for (const result of results) {
  console.log(JSON.stringify(result));
}

const successful = results.filter(r => r.success).length;
const conflicts = results.filter(r => r.conflict).length;
const unexpected = results.filter(r => !r.success && !r.conflict).length;

console.log("\nSUMMARY");
console.log(`Requests sent: ${results.length}`);
console.log(`Successful responses: ${successful}`);
console.log(`Conflict responses: ${conflicts}`);
console.log(`Unexpected/network responses: ${unexpected}`);
console.log(`Expected successful allocations: exactly 1`);

if (successful !== 1 || unexpected > 0) {
  console.error("FAIL: response-level concurrency acceptance criteria not met.");
  console.error("Independently inspect booking and timetable tables; responses alone are not proof.");
  process.exitCode = 1;
} else {
  console.log("RESPONSE CHECK PASSED. Database verification is still mandatory.");
}

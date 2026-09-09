import { readFile } from "node:fs/promises";

const [submission, demo, checklist, issuance, pilot] = await Promise.all([
  readFile(new URL("../docs/submission.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/demo-script.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/submission-checklist.md", import.meta.url), "utf8"),
  readFile(new URL("../config/issuance.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/pilot.json", import.meta.url), "utf8").then(JSON.parse),
]);

const packageText = `${submission}\n${demo}\n${checklist}`;
const normalizedSubmission = submission.toLowerCase().replace(/\s+/g, " ");
const requiredEvidence = [
  issuance.factory,
  issuance.issuerController,
  issuance.token,
  issuance.bondVault,
  issuance.proofSubmission.transactionHash,
  pilot.depositTransactionHash,
];

for (const value of requiredEvidence) {
  if (!packageText.toLowerCase().includes(value.toLowerCase())) {
    throw new Error(`Submission package omits recorded evidence: ${value}`);
  }
}

for (const boundary of ["redemption", "reserve asset", "attestation", "audited"]) {
  if (!normalizedSubmission.includes(boundary)) {
    throw new Error(`Submission package omits trust boundary: ${boundary}`);
  }
}

if (!submission.includes("Attestcoin bridge example") || !submission.includes("Manatee") || !submission.includes("Bliker")) {
  throw new Error("Submission package does not acknowledge relevant existing work");
}

if (/\b(?:TODO|TBD|FIXME)\b/.test(packageText)) {
  throw new Error("Submission package contains an unresolved placeholder");
}

console.log(`PASS submission package: ${requiredEvidence.length} evidence identities and 4 trust boundaries checked`);

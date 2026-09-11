import { readFile } from "node:fs/promises";

const [submission, demo, checklist, hosting, rootIndex, heroScreenshot, portfolioScreenshot, v2Deployments, v2Pilot] = await Promise.all([
  readFile(new URL("../docs/submission.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/demo-script.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/submission-checklist.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/public-hosting.md", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../docs/screenshots/live-proof-dashboard.png", import.meta.url)),
  readFile(new URL("../docs/screenshots/issuer-portfolio.png", import.meta.url)),
  readFile(new URL("../config/v2-deployments.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config/v2-pilot.json", import.meta.url), "utf8").then(JSON.parse),
]);

const packageText = `${submission}\n${demo}\n${checklist}\n${hosting}`;
const publicUrl = "https://webghost01-ng.github.io/resyvr/";
const normalizedSubmission = submission.toLowerCase().replace(/\s+/g, " ");
const requiredEvidence = [
  v2Deployments.source.address,
  v2Deployments.destination.address,
  v2Pilot.source.vault,
  v2Pilot.destination.controller,
  v2Pilot.destination.token,
  v2Pilot.destination.bondVault,
  ...Object.values(v2Pilot.source).filter((value) => value?.transactionHash).map((value) => value.transactionHash),
  ...Object.values(v2Pilot.destination).filter((value) => value?.transactionHash).map((value) => value.transactionHash),
];

for (const value of requiredEvidence) {
  if (!packageText.toLowerCase().includes(value.toLowerCase())) {
    throw new Error(`Submission package omits recorded evidence: ${value}`);
  }
}

for (const boundary of ["redemption", "reserve asset", "attestation", "audited", "legal", "custody", "default", "not insurance"]) {
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

if (!demo.includes("three-minute demo")) throw new Error("Demo script is not the final three-minute version");
if (!rootIndex.includes("./dashboard/")) throw new Error("Public project root does not lead to the dashboard");
if (![submission, checklist, hosting].every((document) => document.includes(publicUrl))) {
  throw new Error("Submission package does not consistently include the verified public URL");
}
for (const [name, screenshot] of [["hero", heroScreenshot], ["portfolio", portfolioScreenshot]]) {
  if (screenshot.length < 10_000 || screenshot.subarray(1, 4).toString() !== "PNG") {
    throw new Error(`${name} screenshot is missing or invalid`);
  }
}

console.log(`PASS submission package: ${requiredEvidence.length} V2 evidence identities and 8 trust boundaries checked`);

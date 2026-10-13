import { resetLocalDemoData, seedReferenceData } from "../src/lib/seed";

const args = process.argv.slice(2);

function main() {
  if (args.includes("--reset-local")) {
    resetLocalDemoData();
    console.log("Reset local demo database. Browser sessions will receive fresh synthetic fixtures.");
    return;
  }
  if (!args.includes("--init")) throw new Error("Use --init or --reset-local");
  seedReferenceData();
  console.log("Reference data is ready. Visitor sessions seed independently on first use.");
}

main();

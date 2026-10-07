import { isEmpty, seedDemo } from "../src/lib/seed";

const args = process.argv.slice(2);

async function main() {
  if (args.includes("--if-empty") && !isEmpty()) return;
  await seedDemo();
  console.log("Seeded demo data.");
}

main();

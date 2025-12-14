// scripts/testFaq.js
import { findBestFaqMatch } from "../src/services/faqService.js";

async function test(query) {
  const { faq, score } = await findBestFaqMatch(query);
  console.log("Query:", query);
  console.log("Score:", score.toFixed(3));
  console.log("FAQ id:", faq?.id);
  console.log("FAQ question:", faq?.question);
  console.log("FAQ answer (first 120 chars):", faq?.answer?.slice(0, 120) + "...");
  console.log("----");
}

async function run() {
  await test("Kuinka kauan revontuliretki kestää?");
  await test("How long does the aurora tour last?");
  await test("Onko teillä instagram?");
  await test("Do you have social media?");
  await test("Mitä muita aktiviteetteja teillä on kuin revontuliretket?");
  await test("What other activities do you offer besides northern lights tours?");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

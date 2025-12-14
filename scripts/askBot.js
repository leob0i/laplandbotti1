// scripts/askBot.js
import { findBestFaqMatch } from "../src/services/faqService.js";
import { config } from "../src/config.js";

// Luetaan kysymys komentorivin argumenteista
const question = process.argv.slice(2).join(" ");

if (!question) {
  console.log('Usage: node scripts/askBot.js "Your question here"');
  process.exit(1);
}

// Käytetään samaa thresholdia kuin backend (config.js)
const CONFIDENCE_THRESHOLD = config.CONFIDENCE_THRESHOLD;

console.log("Using CONFIDENCE_THRESHOLD:", CONFIDENCE_THRESHOLD);

const { faq, score } = await findBestFaqMatch(question);

console.log("User question:", question);
console.log("Score:", score.toFixed(3));

if (!faq) {
  console.log(
    "\nNo FAQ match found. Bot olisi hiljaa ja keskustelu menisi HUMAN-tilaan."
  );
  process.exit(0);
}

console.log("Matched FAQ id:", faq.id);
console.log("Matched FAQ question:", faq.question);
console.log("");

if (score < CONFIDENCE_THRESHOLD) {
  console.log(
    `Score (${score.toFixed(
      3
    )}) < CONFIDENCE_THRESHOLD (${CONFIDENCE_THRESHOLD}).`
  );
  console.log("Bot EI vastaisi mitään. Keskustelu -> HUMAN.");
} else {
  console.log("Bot reply:");
  console.log("----------");
  console.log(faq.answer);
  console.log("----------");
  console.log(
    `(Bot vastasi, koska score ${score.toFixed(
      3
    )} >= threshold ${CONFIDENCE_THRESHOLD})`
  );
}

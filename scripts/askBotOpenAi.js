// scripts/askBotOpenAi.js
import { findBestFaqMatch } from "../src/services/faqService.js";
import { config } from "../src/config.js";
import { rewriteFaqAnswer } from "../src/services/openaiService.js";

// Luetaan kysymys komentorivin argumenteista
const question = process.argv.slice(2).join(" ");

if (!question) {
  console.log('Usage: node scripts/askBotOpenAi.js "Your question here"');
  process.exit(1);
}

const CONFIDENCE_THRESHOLD = config.CONFIDENCE_THRESHOLD;

console.log("Using CONFIDENCE_THRESHOLD:", CONFIDENCE_THRESHOLD);
console.log("OPENAI_API_KEY present:", !!config.OPENAI_API_KEY);

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

// Jos score jää alle kynnyksen → botin ei pitäisi vastata
if (score < CONFIDENCE_THRESHOLD) {
  console.log(
    `Score (${score.toFixed(
      3
    )}) < CONFIDENCE_THRESHOLD (${CONFIDENCE_THRESHOLD}).`
  );
  console.log("Bot EI vastaisi mitään. Keskustelu -> HUMAN.");
  process.exit(0);
}

// Tässä kohtaa botti vastaisi – ajetaan vastaus OpenAI:n läpi
const rewritten = await rewriteFaqAnswer(question, faq.answer);

if (rewritten === "NO_VALID_ANSWER") {
  console.log(
    'OpenAI palautti NO_VALID_ANSWER → Bot EI vastaisi mitään. Keskustelu -> HUMAN.'
  );
  process.exit(0);
}

console.log("Bot reply (OpenAI rewritten):");
console.log("----------");
console.log(rewritten);
console.log("----------");
console.log(
  `(Bot vastasi, koska score ${score.toFixed(
    3
  )} >= threshold ${CONFIDENCE_THRESHOLD})`
);

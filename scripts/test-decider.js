import { findTopFaqCandidates } from "../src/services/faqService.js";
import { decideFaqAnswerFromCandidates } from "../src/services/openaiService.js";
import { config } from "../src/config.js";

const question =
  process.argv.slice(2).join(" ").trim() ||
  "Paljonko maksaa ja mitä se sisältää?";

console.log("Question:", question);
console.log("Model:", config.OPENAI_MODEL);

const candidates = await findTopFaqCandidates(question, config.OPENAI_DECIDER_TOPK || 10);

console.log("\nTop candidates:");
for (const c of candidates.slice(0, 5)) {
  console.log(`- ${c.id} score=${c.score.toFixed(3)} q="${c.question}"`);
}

const decision = await decideFaqAnswerFromCandidates(question, candidates);

console.log("\nDecision:");
console.dir(decision, { depth: null });

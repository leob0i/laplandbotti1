import { findBestFaqMatch, findTopFaqCandidates } from "../src/services/faqService.js";
import { rewriteFaqAnswer, decideFaqAnswerFromCandidates } from "../src/services/openaiService.js";
import { config } from "../src/config.js";

const question =
  process.argv.slice(2).join(" ").trim() ||
  "What is included on the tour?";

console.log("Question:", question);
console.log("CONFIDENCE_THRESHOLD:", config.CONFIDENCE_THRESHOLD);
console.log("Model:", config.OPENAI_MODEL);

const { faq, score } = await findBestFaqMatch(question);

console.log("\nBest FAQ match:");
console.log({ id: faq?.id, score: Number(score?.toFixed?.(3) ?? score) });

if (faq && score >= config.CONFIDENCE_THRESHOLD) {
  console.log("\nPath: STRONG MATCH -> rewriteFaqAnswer()");
  const rewritten = await rewriteFaqAnswer(question, faq.answer);
  console.log("\nReply:");
  console.log(rewritten);
} else {
  console.log("\nPath: LOW MATCH -> decider()");
  const candidates = await findTopFaqCandidates(question, config.OPENAI_DECIDER_TOPK || 10);

  console.log("\nTop candidates:");
  for (const c of candidates.slice(0, 5)) {
    console.log(`- ${c.id} score=${c.score.toFixed(3)} q="${c.question}"`);
  }

  const decision = await decideFaqAnswerFromCandidates(question, candidates);
  console.log("\nDecision:");
  console.dir(decision, { depth: null });
}

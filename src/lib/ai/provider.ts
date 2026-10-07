import type { Extracted, Finding } from "../types";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";

export interface ExplainInput {
  invoice: Extracted;
  vendorName: string | null;
  findings: Finding[];
}

// The only surface the rest of the app knows about. Outputs are `unknown` on purpose:
// the pipeline validates every response against a zod schema before trusting it.
export interface AIProvider {
  id: string;
  model: string;
  extractInvoice(rawText: string): Promise<unknown>;
  explainExceptions(input: ExplainInput): Promise<unknown>;
}

export const mockProvider = new MockProvider();

export function getProvider(): AIProvider {
  const key = process.env.OPENAI_API_KEY;
  return key ? new OpenAIProvider(key, process.env.OPENAI_MODEL ?? "gpt-4o-mini") : mockProvider;
}

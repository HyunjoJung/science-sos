import { z } from "zod";
export const proposalSchema = z.object({
  hypothesis: z.enum(["mass_only", "size_only", "liquid_missed", "hold"]),
  reason_status: z.enum(["supported", "contradictory", "insufficient"]),
  evidence: z.string().max(300),
  note: z.string().max(500),
});
export const reasonSchema = z
  .string()
  .trim()
  .refine(
    (s) => [...s].length > 0 && [...s].length <= 300,
    "1~300자로 입력해 주세요.",
  );
export function validProposal(value: unknown, reason: string) {
  const p = proposalSchema.parse(value);
  if (p.evidence && !reason.includes(p.evidence))
    throw Error("근거가 원문과 일치하지 않습니다.");
  return p;
}

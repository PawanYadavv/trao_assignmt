export interface LlmRequirement {
  text: string;
  kind: "technical" | "behavioural" | "domain";
  priority: "must" | "nice";
}

function configured() {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_API_URL);
}

export async function extractRequirementsWithLlm(jd: string): Promise<LlmRequirement[] | null> {
  if (!configured()) return null;

  const response = await fetch(process.env.LLM_API_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "free-model",
      temperature: 0,
      messages: [{ role: "system", content: "Return only a JSON array of job requirements. Each item must have text, kind (technical|behavioural|domain), and priority (must|nice). Never invent requirements." }, { role: "user", content: jd.slice(0, 18000) }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`LLM provider returned ${response.status}.`);

  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
  const json = content.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("LLM returned an invalid requirement list.");
  return parsed.filter((item): item is LlmRequirement => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return typeof value.text === "string" && ["technical", "behavioural", "domain"].includes(String(value.kind)) && ["must", "nice"].includes(String(value.priority));
  }).slice(0, 12);
}

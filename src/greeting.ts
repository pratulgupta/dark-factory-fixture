export type Tone = "formal" | "casual";

export interface GreetingInput {
  name: string;
  tone?: Tone;
}

export interface Greeting {
  name: string;
  tone: Tone;
}

export function createGreeting(input: GreetingInput): Greeting {
  if (!input.name) {
    throw new Error("name is required");
  }
  if (input.tone !== undefined && input.tone !== "formal" && input.tone !== "casual") {
    throw new Error("tone must be formal or casual");
  }
  return {
    name: input.name,
    tone: input.tone ?? "casual",
  };
}

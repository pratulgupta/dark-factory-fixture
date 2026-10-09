export type Tone = "formal" | "casual";

export interface Greeting {
  name: string;
  tone?: Tone;
}

export interface GreetingInput {
  name?: string;
  tone?: string;
}

export const createGreeting = (input: GreetingInput): Greeting => {
  if (!input.name) {
    throw new Error("name is required");
  }
  if (input.tone !== undefined && input.tone !== "formal" && input.tone !== "casual") {
    throw new Error("tone must be formal or casual");
  }
  return { name: input.name, ...(input.tone !== undefined && { tone: input.tone as Tone }) };
};

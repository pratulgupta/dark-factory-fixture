export type GreetingTone = "formal" | "casual";

export interface Greeting {
  name: string;
  tone?: GreetingTone;
}

export interface GreetingInput {
  name: string;
  tone?: string;
}

export const createGreeting = (input: GreetingInput): Greeting => {
  if (!input.name || input.name.trim() === "") {
    throw new Error("name is required");
  }
  if (input.tone !== undefined && input.tone !== "formal" && input.tone !== "casual") {
    throw new Error("tone must be formal or casual");
  }
  return { name: input.name, tone: input.tone as GreetingTone | undefined };
};

import { describe, expect, test } from "bun:test";

import { hasSuggestion, parseNoteBody, withSuggestion } from "./suggestion";

describe("parseNoteBody", () => {
  test("a plain note is all prose", () => {
    expect(parseNoteBody("ordering looks wrong")).toEqual({
      prose: "ordering looks wrong",
      suggestion: null,
    });
  });

  test("pulls the replacement out of a suggestion fence", () => {
    const body = "use the helper\n\n```suggestion\n\tif err != nil {\n\t\treturn err\n\t}\n```";
    expect(parseNoteBody(body)).toEqual({
      prose: "use the helper",
      suggestion: "\tif err != nil {\n\t\treturn err\n\t}",
    });
  });

  test("keeps prose that follows the fence", () => {
    const body = "before\n```suggestion\nx := 1\n```\nafter";
    expect(parseNoteBody(body)).toEqual({ prose: "before\nafter", suggestion: "x := 1" });
  });

  test("a fence with nothing in it suggests deleting the lines", () => {
    expect(parseNoteBody("drop this\n```suggestion\n```")).toEqual({
      prose: "drop this",
      suggestion: "",
    });
  });

  test("an unterminated fence is prose, not a half-read suggestion", () => {
    const body = "look\n```suggestion\nx := 1";
    expect(parseNoteBody(body).suggestion).toBeNull();
    expect(parseNoteBody(body).prose).toBe(body);
  });

  test("tolerates carriage returns, which a paste can bring", () => {
    expect(parseNoteBody("why\r\n```suggestion\r\nx := 1\r\n```").suggestion).toBe("x := 1");
  });

  test("ignores a fence that is not a suggestion", () => {
    expect(parseNoteBody("see\n```go\nx := 1\n```").suggestion).toBeNull();
  });

  test("takes the first suggestion when someone writes two", () => {
    const body = "```suggestion\nfirst\n```\n```suggestion\nsecond\n```";
    expect(parseNoteBody(body).suggestion).toBe("first");
  });
});

describe("withSuggestion", () => {
  test("builds a body GitHub renders as a suggestion", () => {
    expect(withSuggestion("try this", "x := 2")).toBe("try this\n\n```suggestion\nx := 2\n```");
  });

  test("round-trips through the parser", () => {
    const body = withSuggestion("try this", "a\nb");
    expect(parseNoteBody(body)).toEqual({ prose: "try this", suggestion: "a\nb" });
  });

  test("works with no prose at all", () => {
    expect(parseNoteBody(withSuggestion("", "x := 2"))).toEqual({ prose: "", suggestion: "x := 2" });
  });
});

describe("hasSuggestion", () => {
  test("is true only for a complete fence", () => {
    expect(hasSuggestion("```suggestion\nx\n```")).toBe(true);
    expect(hasSuggestion("```suggestion\nx")).toBe(false);
    expect(hasSuggestion("just words")).toBe(false);
  });
});

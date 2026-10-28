import test from "node:test";
import assert from "node:assert/strict";
import { conversationGreeting } from "./conversation-greeting";
test("short greetings and microphone checks get a reply", () => {
  for (const text of ["Привет!", "Здравствуйте.", "Привет, как дела?", "Алло?", "Вы меня слышите?"]) assert.ok(conversationGreeting(text),text);
});
test("greetings with symptoms or questions still enter the medical pipeline", () => {
  for (const text of ["Здравствуйте, у меня боль в груди", "Привет! Не могу дышать", "Как дела с моим гемоглобином?", "Привет, что значит высокий ТТГ?", "Как снизить давление?"]) assert.equal(conversationGreeting(text),undefined,text);
});

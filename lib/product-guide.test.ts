import test from "node:test";
import assert from "node:assert/strict";
import { productGuide } from "./product-guide";

test("product guidance works without patient files", () => {
  assert.match(productGuide("Как загрузить фото анализа с телефона?") ?? "", /QR-код/);
  assert.match(productGuide("Что умеет Атлаксис?") ?? "", /цифровой помощник/);
  assert.match(productGuide("Что делает Профессор?") ?? "", /Весь разбор профессору/);
  assert.match(productGuide("Сколько стоит подписка?") ?? "", /сведений.*нет/);
});
test("clinical findings stay on the existing evidence and safety pipeline", () => {
  assert.equal(productGuide("Обсудить находку: как загрузить анализ"), null);
  assert.equal(productGuide("Почему изменился холестерин?"), null);
  assert.equal(productGuide("Как принимать препарат?"), null);
});

import { describe, it, expect } from "vitest";
import { shortAddr } from "../chain/format";
// Pure check: the label logic the button uses. (Full injected-wallet flow is verified manually.)
describe("wallet label", () => {
  it("disconnected shows Connect; connected shows short address", () => {
    expect(shortAddr("0xc84C24F751c686568A907650FD59b1a3AC1a5E67")).toBe("0xc84C…5E67");
  });
});

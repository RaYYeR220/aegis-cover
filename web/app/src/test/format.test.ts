import { describe, it, expect } from "vitest";
import { fmtSTT, pctFromBps, riskBand, shortAddr, fmtDuration } from "../chain/format";

describe("format", () => {
  it("fmtSTT renders wei→STT with given dp", () => {
    expect(fmtSTT(10n ** 17n)).toBe("0.1");          // 0.1 STT default 2dp -> "0.1"
    expect(fmtSTT(90n * 10n ** 15n)).toBe("0.09");    // 0.09
    expect(fmtSTT(0n)).toBe("0.00");
    expect(fmtSTT(1234n * 10n ** 18n, 0)).toBe("1,234");
  });
  it("pctFromBps", () => { expect(pctFromBps(1000n)).toBe("10%"); expect(pctFromBps(300n)).toBe("3%"); });
  it("riskBand maps score to label", () => {
    expect(riskBand(20n)).toEqual({ band: "Low", rateBps: 300n });
    expect(riskBand(50n)).toEqual({ band: "Medium", rateBps: 600n });
    expect(riskBand(80n)).toEqual({ band: "High", rateBps: 1000n });
  });
  it("shortAddr", () => { expect(shortAddr("0xc84C24F751c686568A907650FD59b1a3AC1a5E67")).toBe("0xc84C…5E67"); });
  it("fmtDuration seconds→Nd", () => { expect(fmtDuration(90n * 86400n)).toBe("90d"); });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechController, type RecognitionLike } from "@/lib/client/speech-controller";

/** Fake recognizer that behaves like iOS Safari: ends by itself after a pause. */
class FakeRec implements RecognitionLike {
  static instances: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  starts = 0;
  running = false;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: RecognitionLike["onend"] = null;
  onstart: RecognitionLike["onstart"] = null;
  constructor() {
    FakeRec.instances.push(this);
  }
  start() {
    if (this.running) throw new Error("InvalidStateError");
    this.running = true;
    this.starts++;
    this.onstart?.();
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  say(finalText: string, interim = "") {
    const results = [Object.assign([{ transcript: finalText }], { isFinal: true })];
    if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
    this.onresult?.({ results });
  }
  end() {
    if (!this.running) return;
    this.running = false;
    this.onend?.();
  }
}

describe("speech controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRec.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it("keeps listening across the browser's automatic pauses until the user stops", () => {
    const c = new SpeechController(FakeRec);
    c.start();
    const rec = FakeRec.instances[0]!;
    rec.say("מחר בשלוש פגישה עם דני");
    rec.end(); // Safari stops on a pause
    vi.advanceTimersByTime(200);
    expect(c.getSnapshot().status).toBe("recording");
    expect(rec.starts).toBe(2);
    rec.say("ולהכין את ההצעה");
    c.stop();
    expect(c.getSnapshot().status).toBe("idle");
    expect(c.take()).toBe("מחר בשלוש פגישה עם דני ולהכין את ההצעה");
  });

  it("reuses one recognizer, so permission is requested once per page", () => {
    const c = new SpeechController(FakeRec);
    c.start();
    c.stop();
    c.start();
    c.stop();
    expect(FakeRec.instances).toHaveLength(1);
  });

  it("does not restart after the user denied the microphone", () => {
    const c = new SpeechController(FakeRec);
    c.start();
    const rec = FakeRec.instances[0]!;
    rec.onerror?.({ error: "not-allowed" });
    rec.end();
    vi.advanceTimersByTime(500);
    expect(rec.starts).toBe(1);
    expect(c.getSnapshot().status).toBe("idle");
    expect(c.getSnapshot().error).toBe("not-allowed");
  });

  it("cancel discards what was heard", () => {
    const c = new SpeechController(FakeRec);
    c.start();
    FakeRec.instances[0]!.say("לא לשמור");
    c.cancel();
    expect(c.take()).toBe("");
    expect(c.getSnapshot().status).toBe("idle");
  });

  it("keeps words not yet marked final when the browser pauses", () => {
    const c = new SpeechController(FakeRec);
    c.start();
    const rec = FakeRec.instances[0]!;
    rec.say("לקנות", "חלב");
    rec.end();
    vi.advanceTimersByTime(200);
    c.stop();
    expect(c.take()).toBe("לקנות חלב");
  });

  it("reports unsupported browsers instead of failing silently", () => {
    const c = new SpeechController(null);
    c.start();
    expect(c.getSnapshot().error).toBe("unsupported");
  });
});

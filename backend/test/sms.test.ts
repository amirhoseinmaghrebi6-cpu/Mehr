import type { FastifyBaseLogger } from "fastify";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { buildServer } from "../src/server";
import { createSmsSender, SmsError, type SmsSender } from "../src/sms/sms";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
const provider = { url: "https://api.iranpayamak.test", apiKey: "test-key-123", sender: "90008361", patterns: { code: "PCODE", invitation: "PINVITE" } };
const ok = () => new Response(JSON.stringify({ status: "success", message: "", data: {} }), { status: 200 });

describe("SMS through FarazSMS / IranPayamak", () => {
  it("sends a login code as a pattern, to the local number, with the key in Api-Key", async () => {
    const fetchImpl = vi.fn(async () => ok());
    await createSmsSender(provider, false, fetchImpl)!.sendCode("+989121234567", "123456", log);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.iranpayamak.test/ws/v1/sms/pattern");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Api-Key"]).toBe("test-key-123");
    expect(JSON.parse(init.body as string)).toEqual({ code: "PCODE", recipient: "09121234567", attributes: { code: "123456" }, line_number: "90008361", number_format: "english" });
  });

  it("sends an invitation with short names, and nothing without its pattern", async () => {
    const fetchImpl = vi.fn(async () => ok());
    await createSmsSender(provider, false, fetchImpl)!.sendInvitation("+989121234567", "Sara", "A very long home name that goes on and on", log);
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).attributes).toEqual({ name: "Sara", home: "A very long home name that go…" });
    await createSmsSender({ ...provider, patterns: { code: "PCODE", invitation: null } }, false, fetchImpl)!.sendInvitation("+989121234567", "Sara", "Home", log);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails when the provider refuses or cannot be reached", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ status: "error", message: "pattern not approved" }), { status: 422 }));
    await expect(createSmsSender(provider, false, refused)!.sendCode("+989121234567", "123456", log)).rejects.toThrow(/422.*pattern not approved/);
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(createSmsSender(provider, false, down)!.sendCode("+989121234567", "123456", log)).rejects.toBeInstanceOf(SmsError);
  });

  it("only logs in development without a key, and cannot send in production", () => {
    expect(createSmsSender(null, true)).not.toBeNull();
    expect(createSmsSender(null, false)).toBeNull();
  });
});

describe("SMS configuration", () => {
  const base = { DATABASE_URL: "postgres://m2_api:pw@127.0.0.1:15432/m2smart" };
  it("has no provider until the key, the sender and the code pattern are all set", () => {
    expect(loadConfig(base).sms).toBeNull();
    expect(loadConfig({ ...base, SMS_API_KEY: "secret-key", SMS_SENDER: "90008361" }).sms).toBeNull();
    expect(loadConfig({ ...base, SMS_API_KEY: "secret-key", SMS_SENDER: "90008361", SMS_PATTERN_CODE: "abc" }).sms).toEqual({
      url: "https://api.iranpayamak.com",
      apiKey: "secret-key",
      sender: "90008361",
      patterns: { code: "abc", invitation: null },
    });
  });
});

describe("POST /internal/kratos/sms", () => {
  const secret = "s".repeat(40);
  const pool = new Pool({ connectionString: "postgres://m2_api:unused@127.0.0.1:1/m2smart" });
  const sent: Array<[string, string]> = [];
  const sender: SmsSender = { sendCode: async (to, code) => void sent.push([to, code]), sendInvitation: async () => undefined };
  const app = buildServer({ logLevel: "silent", kratosWebhookSecret: secret }, pool, { sms: sender });
  const noProvider = buildServer({ logLevel: "silent", kratosWebhookSecret: secret }, pool, { sms: null });
  const failing = buildServer({ logLevel: "silent", kratosWebhookSecret: secret }, pool, { sms: { ...sender, sendCode: async () => { throw new SmsError("down"); } } });
  const post = (server: typeof app, payload: object, headers: Record<string, string> = { "x-webhook-secret": secret }) =>
    server.inject({ method: "POST", url: "/internal/kratos/sms", payload, headers });

  afterAll(async () => {
    await Promise.all([app.close(), noProvider.close(), failing.close()]);
    await pool.end();
  });

  it("needs the shared secret", async () => {
    expect((await post(app, { to: "+989121234567", code: "123456" }, {})).statusCode).toBe(401);
    expect((await post(app, { to: "+989121234567", code: "123456" }, { "x-webhook-secret": "wrong" })).statusCode).toBe(401);
  });

  it("sends only the code: from the template data, or read from the text", async () => {
    expect((await post(app, { to: "+989121234567", text: "Your code is 999999", template: "login_code_valid", code: "123456" })).statusCode).toBe(204);
    expect((await post(app, { to: "+989121234568", text: "Your registration code is: 654321", template: "registration_code_valid" })).statusCode).toBe(204);
    expect(sent).toEqual([["+989121234567", "123456"], ["+989121234568", "654321"]]);
  });

  it("refuses a message without a code or recipient", async () => {
    expect((await post(app, { to: "+989121234567", text: "hello" })).statusCode).toBe(400);
    expect((await post(app, { text: "code 123456" })).statusCode).toBe(400);
  });

  it("answers 503 without a provider and 502 when sending fails, so the courier retries", async () => {
    expect((await post(noProvider, { to: "+989121234567", code: "123456" })).statusCode).toBe(503);
    expect((await post(failing, { to: "+989121234567", code: "123456" })).statusCode).toBe(502);
  });
});

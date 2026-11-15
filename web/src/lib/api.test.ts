import { afterEach, expect, test, vi } from "vitest";
import { fetchData } from "./api.ts";
import { request } from "./workflow.ts";
afterEach(() => vi.unstubAllGlobals());
test("login failure and session expiration have distinct messages", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errcode: 200001 }),
    }),
  );
  await expect(fetchData("/auth/login")).rejects.toThrow("账号或密码错误");
  await expect(request("/activity/projects/p/workflow")).rejects.toMatchObject({
    status: 401,
    code: 200001,
    message: "登录已失效，请重新登录。",
  });
});
test("network and invalid JSON failures do not expose browser diagnostics", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      }),
  );
  await expect(request("/test")).rejects.toThrow("网络连接失败");
  await expect(request("/test")).rejects.toThrow("请求失败，请重试。");
});

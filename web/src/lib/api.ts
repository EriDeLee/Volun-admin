import type { ApiError, ApiPath, ApiResult } from "../types.ts";
export function asApiError(value: unknown): ApiError {
  return value instanceof Error ? value : new Error("请求失败，请重试。");
}
export async function api<P extends ApiPath>(
  path: P,
  options: RequestInit = {},
): Promise<ApiResult<P>> {
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("网络连接失败，请检查网络后重试。");
  }
  const decoded: unknown = await response.json().catch(() => null);
  const body =
    typeof decoded === "object" && decoded !== null
      ? (decoded as Record<string, unknown>)
      : null;
  if (
    !response.ok ||
    !body ||
    (body.errcode !== undefined && body.errcode !== 0)
  ) {
    const error: ApiError = new Error(
      response.status === 401
        ? "账号或密码不正确，或登录状态已失效。"
        : response.status === 403
          ? "当前账号没有访问权限，请联系管理员。"
          : response.status >= 500
            ? "服务暂时不可用，请稍后重试。"
            : typeof body?.message === "string"
              ? body.message
              : "请求失败，请重试。",
    );
    error.status = response.status;
    error.code = typeof body?.errcode === "number" ? body.errcode : undefined;
    throw error;
  }
  // The server JSON boundary is typed by the route-specific DTO contract.
  return body.data as ApiResult<P>;
}

import { createMiddleware } from "hono/factory";

export const REQUEST_ID_HEADER = "x-request-id";

function validRequestId(value: string | undefined) {
  return Boolean(value && /^[a-zA-Z0-9_.:-]{8,128}$/.test(value));
}

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = validRequestId(incoming) ? incoming! : `req_${crypto.randomUUID()}`;
  c.set("requestId", requestId);
  c.header(REQUEST_ID_HEADER, requestId);
  await next();
});

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

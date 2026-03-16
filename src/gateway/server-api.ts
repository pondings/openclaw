import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { listSessionsFromStore, loadCombinedSessionStoreForGateway, readSessionMessages, loadSessionEntry } from "./session-utils.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { dispatchInboundMessage } from "../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import { createReplyPrefixOptions } from "../channels/reply-prefix.js";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { resolveSendPolicy } from "../sessions/send-policy.js";

// Basic authentication middleware using existing gateway logic
const createAuthMiddleware = (resolvedAuth: ResolvedGatewayAuth) => {
  return async (c: import("hono").Context, next: () => Promise<void>) => {
    const authHeader = c.req.header("Authorization");
    let token = null;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    // Default mode is none if no password is set, otherwise check password
    if (resolvedAuth.mode === "password" && token !== resolvedAuth.password) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
};

export function createGatewayApiApp(resolvedAuth: ResolvedGatewayAuth) {
  const app = new Hono();

  app.use("*", createAuthMiddleware(resolvedAuth));

  // GET /api/v1/sessions
  app.get("/api/v1/sessions", async (c) => {
    try {
      const cfg = loadConfig();
      const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
      const limit = Number(c.req.query("limit")) || 100;
      const opts = { limit };

      const result = listSessionsFromStore({
        cfg,
        storePath,
        store,
        opts,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // GET /api/v1/sessions/:sessionKey/messages
  app.get("/api/v1/sessions/:sessionKey/messages", async (c) => {
    try {
      const sessionKey = c.req.param("sessionKey");
      const { storePath, entry } = loadSessionEntry(sessionKey);
      const sessionId = entry?.sessionId;

      if (!sessionId || !storePath) {
        return c.json({ ok: false, error: "session not found" }, 404);
      }

      const rawMessages = readSessionMessages(sessionId, storePath, entry?.sessionFile);
      const limit = Number(c.req.query("limit")) || 200;
      const messages = limit < rawMessages.length ? rawMessages.slice(-limit) : rawMessages;

      return c.json({ ok: true, sessionKey, sessionId, messages });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // POST /api/v1/messages
  app.post("/api/v1/messages", async (c) => {
    try {
      const body = await c.req.json();
      const sessionKey = body.sessionKey;
      const message = body.message;

      if (!sessionKey || typeof sessionKey !== "string") {
        return c.json({ ok: false, error: "sessionKey is required and must be a string" }, 400);
      }
      if (!message || typeof message !== "string") {
        return c.json({ ok: false, error: "message is required and must be a string" }, 400);
      }

      const cfg = loadConfig();
      const { entry, canonicalKey } = loadSessionEntry(sessionKey);

      const sendPolicy = resolveSendPolicy({
        cfg,
        entry,
        sessionKey: canonicalKey,
        channel: entry?.channel,
        chatType: entry?.chatType,
      });

      if (sendPolicy === "deny") {
        return c.json({ ok: false, error: "send blocked by session policy" }, 403);
      }

      const agentId = resolveSessionAgentId({
        sessionKey: canonicalKey,
        config: cfg,
      });

      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });

      const deliveredReplies: Array<{ payload: import("../auto-reply/types.js").ReplyPayload; kind: string }> = [];
      const dispatcher = createReplyDispatcher({
        ...prefixOptions,
        onError: (err) => {
          console.error(`api dispatch failed:`, err);
        },
        deliver: async (payload, info) => {
          if (info.kind !== "block" && info.kind !== "final") {
            return;
          }
          deliveredReplies.push({ payload, kind: info.kind });
        },
      });

      const clientRunId = body.idempotencyKey || randomUUID();
      const abortController = new AbortController();

      const ctx = {
        Body: message,
        BodyForAgent: message, // Missing timestamp inject for brevity, but fine for generic REST
        BodyForCommands: message,
        RawBody: message,
        CommandBody: message,
        SessionKey: canonicalKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
        ExplicitDeliverRoute: false,
        ChatType: "direct" as const,
        CommandAuthorized: true,
        MessageSid: clientRunId,
      };

      await dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: abortController.signal,
          onModelSelected,
        },
      });

      const combinedReply = deliveredReplies
        .filter((entry) => entry.kind === "final")
        .map((entry) => entry.payload)
        .map((part) => part.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n\n")
        .trim();

      return c.json({
        ok: true,
        runId: clientRunId,
        reply: combinedReply || null
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  return app;
}

import * as useRateLimit from "express-rate-limit";
import { Route, router } from "./router";
import { sendError } from "../lib/utils";
import * as express from "express";

const asyncHandler = (
  handler: express.RequestHandler
): express.RequestHandler => (req, res, next) => {
  const response: any = handler(req, res, next);
  if (response instanceof Promise) {
    response.catch(next);
  }
};

const createRateLimit = ({ rateLimit }: Route) =>
  useRateLimit({
    windowMs: rateLimit.rateLimitMs,
    max: rateLimit.maxRequests,
    skipFailedRequests: rateLimit.skipFailedRequests,
    handler: (req, res) => {
      res.setHeader("X-RateLimit-Remaining", rateLimit.rateLimitMs);
      sendError(res, {
        success: false,
        error: "Too many requests, calm down!",
        code: 429,
      });
    },
  });

const requiresAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (
    !req.headers.authorization ||
    req.headers.authorization != process.env.AUTH_TOKEN
  )
    return sendError(res, {
      success: false,
      error: "Forbidden",
      code: 403,
    });
  next();
};

const allowedWorkers = ["firediscord.workers.dev"];

export const setupRoutes = (app: express.Application) => {
  app.use((req, res, next) => {
    if (
      req.headers["cf-worker"] &&
      !allowedWorkers.includes(req.headers["cf-worker"] as string)
    )
      return sendError(res, {
        success: false,
        error: "Access from Cloudflare Workers is forbidden",
        code: 403,
      });
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });
  router.forEach((route) => {
    const handlers: express.RequestHandler[] = [];

    if (route.rateLimit && process.env.NODE_ENV != "development") {
      handlers.push(createRateLimit(route));
    }

    if (route.requiresAuth && process.env.NODE_ENV != "development") {
      handlers.push(requiresAuth);
    }

    const routeHandler = asyncHandler(route.handler);
    if (route.methods === "ALL") {
      app.all(route.endpoint, handlers, routeHandler);
    } else {
      route.methods.forEach((method) => {
        app[method.toLowerCase()](route.endpoint, handlers, routeHandler);
      });
    }

    app.manager.logger.info(
      `[Rest] Loaded route ${route.methods} ${route.endpoint}`
    );
  });

  app.manager.logger.info(`[Rest] Loaded ${router.length} routes.`);

  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      // Sentry eventually TM
      // app.client.sentry.captureException(err);
      if (process.env.NODE_ENV == "development")
        req.app.manager.logger.error(err.stack);
      try {
        sendError(res, {
          success: false,
          error: err.message || "Internal Server Error",
          code: 500,
        });
      } catch {}
    }
  );
  app.manager.logger.info(`[Rest] Loaded error handler.`);
};

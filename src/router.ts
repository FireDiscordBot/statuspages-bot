import { HtmlErrorResponse } from "../lib/interfaces";
import { executeRoute } from "./routes/execute";
import { sendErrorHTML } from "../lib/utils";
import { rootRoute } from "./routes/root";
import { listRoute } from "./routes/list";
import * as express from "express";

export type HttpMethod =
  | "GET"
  | "POST"
  | "DELETE"
  | "PUT"
  | "CONNECT"
  | "OPTIONS"
  | "HEAD"
  | "TRACE";

export type Route = {
  name: string;
  description: string;
  methods: HttpMethod[] | "ALL";
  endpoint: string;
  rateLimit?: {
    maxRequests: number;
    rateLimitMs: number;
    skipFailedRequests: boolean;
  };
  requiresAuth?: boolean;
  handler: express.RequestHandler;
};

export const router: Route[] = [
  {
    name: "Root",
    description: "Redirects to the Fire website",
    methods: ["GET"],
    endpoint: "/",
    requiresAuth: false,
    handler: rootRoute,
  },
  {
    name: "List",
    description: "List all hooks",
    methods: ["GET"],
    endpoint: "/api/list",
    requiresAuth: true,
    handler: listRoute,
  },
  {
    name: "Execute",
    description: "Execute a statuspage.io webhook",
    methods: ["POST", "GET"],
    endpoint: "/:id/:token",
    requiresAuth: false,
    handler: executeRoute,
  },
  {
    name: "Fallback",
    description: "Fallback endpoint so express doesn't complain",
    methods: [
      "CONNECT",
      "OPTIONS",
      "HEAD",
      "TRACE",
      "GET",
      "POST",
      "PUT",
      "DELETE",
    ],
    endpoint: "*",
    requiresAuth: false,
    handler: (req: express.Request, res: express.Response) => {
      const response: HtmlErrorResponse = {
        title: "Not Found",
        text: "Whatever you're looking for, it's not here :(",
        referral: req.headers.referer,
        code: 404,
        button: "Take me back",
      };
      sendErrorHTML(res, response);
    },
  },
];

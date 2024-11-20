import { Client as Postgres } from "ts-postgres";
import { setupRoutes } from "./src/routeManager";
import { StatusManager } from "./src/manager";
import { Client, Options } from "discord.js";
import { FireConsole } from "./lib/console";
import { sendError } from "./lib/utils";
import * as express from "express";

require("dotenv").config({
  path: process.env.NODE_ENV == "development" ? "dev.env" : ".env",
});

declare module "express-serve-static-core" {
  export interface Application {
    manager: StatusManager;
  }
}

const db = new Postgres({
  user: process.env.POSTGRES_USER ?? "postgres",
  password: process.env.POSTGRES_PASS,
  database: process.env.NODE_ENV == "development" ? "dev" : "fire",
});
db.on("error", (e) => logger.error(`[DB] ${e}`));
db.on("end", (e) => logger.error("[DB]", e));

const bot = new Client({
  allowedMentions: {
    parse: [],
    users: [],
    roles: [],
  },
  makeCache: Options.cacheWithLimits({
    BaseGuildEmojiManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    GuildStickerManager: 0,
    MessageManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    VoiceStateManager: 0,
  }),
  intents: ["GUILDS"],
});
const logger = new FireConsole();
const app = express();

const manager = new StatusManager(db, bot, logger);
app.manager = manager;

app.use(express.json());

app.use((req, res, next) => {
  logger.debug(`[API] Recieved request on ${req.path}!`);
  if (req.path.includes("favicon.ico")) return next();

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, Content-Type, Accept, Authorization"
  );

  res.header("Access-Control-Allow-Methods", "GET, POST");
  logger.debug(`[API] Executing route for ${req.path}!`);
  return next();
});

async function start() {
  setupRoutes(app);
  logger.info(`[DB] Connecting...`);
  await db.connect();
  logger.info(`[DB] Successfully connected!`);
  bot.once("ready", async () => {
    logger.log(`[Bot] Ready.`);
    await manager.loadWebhooks();
  });
  bot.on(
    "rateLimit",
    (rateLimit: {
      timeout: number;
      limit: number;
      method: string;
      path: string;
      route: string;
      reason?: string;
    }) =>
      logger.debug(
        `[Rest] Limited on route ${
          rateLimit.route
        } while trying to ${rateLimit.method?.toUpperCase()}${
          rateLimit.reason ? ' due to "' + rateLimit.reason + '"' : ""
        } with limit ${rateLimit.limit}, waiting for timeout of ${
          rateLimit.timeout
        }ms`
      )
  );
  bot.login();
}

try {
  start().then(() => {
    app.listen(1341, () => {
      logger.info(`[API] Successfully started!`);
    });
  });
} catch (e) {
  logger.error("[API] Failed to initialize. Maybe the port is in use?");
}

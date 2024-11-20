import * as centra from "centra";
import { APIEmbed } from "discord-api-types";
import {
  Client,
  Collection,
  Guild,
  MessageEmbed,
  NewsChannel,
  Permissions,
  TextChannel,
  User,
} from "discord.js";
import Semaphore from "semaphore-async-await";
import { Client as Postgres } from "ts-postgres";
import { FireConsole } from "../lib/console";
import {
  BasicEmbed,
  Incident,
  IncidentUpdate,
  SlashCommand,
  WebhookData,
} from "../lib/interfaces";
import { Respond, titleCase } from "../lib/utils";
import AddCommand from "./commands/add";
import AlertCommand from "./commands/alert";
import BackfillCommand from "./commands/backfill";
import ImageCommand from "./commands/image";
import ListCommand from "./commands/list";
import RegisterCommand from "./commands/register";
import { StatuspageIOFetcher } from "./fetcher";
import { StatusHook } from "./page";

const timerWarnings = [15000, 60000, 100000, 150000, 300000, 600000];

type StatusPageTypes = "statuspage.io";

export class StatusManager {
  bot: Client;
  db: Postgres;
  logger: FireConsole;
  sentWarning: string[];
  allowsHooks: string[];
  hooks: Collection<string, WebhookData>;
  pages: Collection<string, StatusHook[]>;
  pageCheckLocks: Collection<string, Semaphore>;
  fetchers: Collection<string, StatuspageIOFetcher>;
  commands: Collection<
    string,
    (
      interaction: SlashCommand,
      respond: Respond,
      manager: StatusManager
    ) => Promise<any>
  >;
  incidentColors: {
    none: string;
    minor: string;
    major: string;
    critical: string;
    maintenance: string;
  };
  componentColors: {
    operational: string;
    degraded_performance: string;
    partial_outage: string;
    major_outage: string;
    under_maintenance: string;
  };
  emoji: {
    operational: string;
    degraded_performance: string;
    partial_outage: string;
    major_outage: string;
    under_maintenance: string;
  };

  constructor(db: Postgres, bot: Client, logger: FireConsole) {
    this.db = db;
    this.bot = bot;
    this.logger = logger;
    this.sentWarning = [];
    this.allowsHooks = [];
    this.hooks = new Collection();
    this.pages = new Collection();
    this.commands = new Collection();
    this.fetchers = new Collection();
    this.pageCheckLocks = new Collection();
    this.incidentColors = {
      none: "#33CC66",
      minor: "#F1C40F",
      major: "#CC6600",
      critical: "#CC3333",
      maintenance: "#3498DB",
    };
    this.componentColors = {
      operational: "#33CC66",
      degraded_performance: "#F1C40F",
      partial_outage: "#CC6600",
      major_outage: "#CC3333",
      under_maintenance: "#3498DB",
    };
    this.emoji = {
      operational: "<:operational:685538400639385649>",
      degraded_performance: "<:degraded_performance:685538400228343808>",
      partial_outage: "<:partial_outage:685538400555499675>",
      major_outage: "<:major_outage:685538400639385706>",
      under_maintenance: "<:maintenance:685538400337395743>",
    };
    this.bot.once("ready", () => this.loadCommands());
    setInterval(async () => {
      const promises = this.fetchers.map((fetcher) => fetcher.execute());
      await Promise.all(promises).catch(() => {});
    }, 1500);
  }

  async loadCommands() {
    const commands = [
      AddCommand,
      ListCommand,
      BackfillCommand,
      AlertCommand,
      ImageCommand,
      RegisterCommand,
    ];
    for (const [data, handler] of commands)
      this.commands.set(data.name, handler);
    if (process.env.NODE_ENV == "production")
      await this.bot.application.commands.set(
        commands.map(([d]) => d).filter((c) => c.name != "register")
      );
    // @ts-ignore
    this.bot.ws.on("INTERACTION_CREATE", async (interaction: SlashCommand) => {
      const handler = this.commands.get(interaction.data.name);
      if (handler) {
        const respond = new Respond(interaction, this);
        await respond.ack(interaction.data.name == "add").catch(() => {});
        if (
          !respond.member.permissions.has(Permissions.FLAGS.MANAGE_WEBHOOKS) &&
          interaction.data.name != "invite"
        )
          return await respond.error(
            'You need the "Manage Webhooks" permission to use my commands.'
          );
        await handler(interaction, respond, this);
      }
    });
  }

  async loadWebhooks() {
    this.logger.warn("[Manager] Loading webhooks...");
    this.hooks = new Collection();
    const results = await this.db.query("SELECT * FROM statushooks;");
    for await (const row of results) {
      if (
        !this.bot.guilds.cache.has(row.get("gid") as string) ||
        !this.bot.channels.cache
          .filter((channel) =>
            ["GUILD_TEXT", "GUILD_NEWS"].includes(channel.type)
          )
          .has(row.get("cid") as string)
      )
        continue;
      const guild = this.bot.guilds.cache.get(row.get("gid") as string);
      const role = guild.roles.cache.get(row.get("rid") as string);
      this.hooks.set(row.get("url") as string, {
        url: row.get("url") as string,
        page: row.get("page") as string,
        guild,
        channel: this.bot.channels.cache
          .filter((channel) =>
            ["GUILD_TEXT", "GUILD_NEWS"].includes(channel.type)
          )
          .get(row.get("cid") as string) as TextChannel | NewsChannel,
        user:
          this.bot.users.cache.get(row.get("uid") as string) ||
          (row.get("uid") as string),
        role,
        alertForAll: (row.get("pingonupdate") as boolean) ?? false,
        disabled: false,
      });
    }
    this.logger.log(
      `[Manager] Loaded ${this.hooks.size} webhooks, loading pages now...`
    );
    const pages = this.hooks.map((hook) => {
      return { url: hook.page, hook: hook.url };
    });
    const promises = [];
    for (const page of pages) promises.push([this.preparePage, page]);
    let resolved = false;
    setTimeout(() => {
      if (!resolved)
        this.logger.warn(
          `[Manager] Still loading pages after 2 minutes, ${this.pages.size}/${pages.length}. Remaining pages:`,
          (() => {
            const remaining = pages
              .filter(({ url }) => !this.pages.has(url))
              .map(({ url }) => url);
            return remaining
              .filter((url, index) => remaining.indexOf(url) == index)
              .join(", ");
          })()
        );
    }, 120000);
    await Promise.all(
      promises.map(([promise, page]) => promise.bind(this)(page))
    ).then(() => (resolved = true));
    this.logger.log(
      `[Manager] Loaded ${this.pages.size} pages with ${this.allowsHooks.length} allowing webhooks.`
    );
    // TODO: add smth to get correct fetcher for page type
    for (const [page] of this.pages.filter(
      (_, pageURL) => !this.allowsHooks.find((url) => url == pageURL)
    ))
      this.fetchers.set(page, new StatuspageIOFetcher(page, this));
    for (const [hook] of this.hooks) await this.checkHookExists(hook);
    this.logger.log(
      `[Manager] Finished loading webhooks! Everything is ready to go :D`
    );
  }

  private async preparePage(page: {
    url: string;
    hook: string;
    pageType?: StatusPageTypes;
  }) {
    if (!this.pageCheckLocks.has(page.url))
      this.pageCheckLocks.set(page.url, new Semaphore(1));
    const valid = await this.checkPageExists(
      page,
      page.pageType ?? "statuspage.io"
    );
    if (!valid) {
      this.logger.error(
        `[Manager] ${page.url} failed statuspage validity check, ignoring.`
      );
      this.pageCheckLocks.get(page.url)?.release();
      return;
    } else if (valid == "cache")
      return this.pageCheckLocks.get(page.url)?.release();
    const instance = new StatusHook(page.url, page.hook, this);
    const instances = this.pages.get(page.url) ?? [];
    instances.push(instance);
    this.pages.set(page.url, instances);
    this.pageCheckLocks.get(page.url)?.release();
  }

  async checkPageExists(
    page: string | URL | { url: string; hook: string },
    pageType: StatusPageTypes
  ) {
    const pageURL =
      typeof page == "object" && !(page instanceof URL)
        ? page.url
        : page.toString();
    if (this.allowsHooks.includes(pageURL)) return "webhook";
    let url: URL;
    if (page instanceof URL) url = page;
    else {
      try {
        url = new URL(pageURL);
        if (!url) throw new Error("lol");
      } catch {
        this.logger.error(
          `[Manager] ${pageURL} failed to be parsed, ignoring.`
        );
        return false;
      }
    }
    let semaphore: Semaphore;
    if (this.pageCheckLocks.has(pageURL))
      semaphore = this.pageCheckLocks.get(pageURL);
    else semaphore = new Semaphore(1);
    this.pageCheckLocks.set(pageURL, semaphore);
    await semaphore.acquire();
    if (
      this.fetchers.has(pageURL) &&
      typeof page == "object" &&
      !(page instanceof URL)
    ) {
      const instance = new StatusHook(pageURL, page.hook, this);
      const instances = this.pages.get(pageURL) ?? [];
      instances.push(instance);
      this.pages.set(pageURL, instances);
      return "cache";
    }
    this.logger.debug(`[Manager] Checking if ${url} exists...`);
    const timeouts = timerWarnings.map((time) =>
      setTimeout(() => {
        this.logger.warn(
          `[Manager] Fetching ${url} has taken longer than ${
            time / 1000
          } seconds!`
        );
      }, time)
    );
    const start = +new Date();
    const pageInfoReq = await centra(url)
      .header(
        "User-Agent",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
      )
      .send()
      .catch(() => {});
    timeouts.map((timeout) => clearTimeout(timeout));
    if (+new Date() - start > 15000)
      this.logger.warn(
        `[Manager] Page ${url} responded with ${
          pageInfoReq ? pageInfoReq.statusCode : "nothing, it didn't respond"
        } in ${+new Date() - start}ms`
      );
    if (!pageInfoReq || pageInfoReq.statusCode != 200) return false;
    switch (pageType) {
      case "statuspage.io": {
        if (
          !pageInfoReq.body
            .toString()
            .includes("SP.pollForChanges('/api/v2/status.json');")
        )
          return false;
        else {
          if (
            pageInfoReq.body.toString().includes("updates-dropdown-webhook-btn")
          ) {
            this.allowsHooks.push(pageURL);
            return "webhook";
          }
          return pageInfoReq;
        }
      }
    }
  }

  async checkHookExists(hook: string) {
    const data = this.hooks.get(hook);
    if (!data) return;
    const hookInfoReq = await centra(
      `https://canary.discord.com/api/v9/webhooks/${data.url}`
    )
      .header(
        "User-Agent",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
      )
      .send();
    if (hookInfoReq.statusCode == 404) {
      const hookInfo = await hookInfoReq.json();
      this.logger.warn(
        `[Manager] Deleting webhook ${hook} for ${data.guild}/#${
          data.channel.name
        } due to ${
          hookInfo?.message || "status code " + hookInfoReq.statusCode
        }`
      );
      await this.db
        .query("DELETE FROM statushooks WHERE url=$1;", [hook])
        .then(() => {
          const instance = this.pages
            .get(data.page)
            ?.find((h) => h.hook == hook);
          instance.disable();
          const instances = this.pages.get(data.page);
          if (instances.length) {
            this.pages.set(
              data.page,
              instances.filter((h) => h.hook != hook)
            );
          }
          this.hooks.delete(hook);
        })
        .catch((e) => {
          this.logger.error(
            `[Manager] Failed to delete hook ${hook}!`,
            e.stack
          );
        });
    }
  }

  async addWebhook(
    hook: string,
    page: string,
    guild: Guild,
    channel: TextChannel | NewsChannel,
    user: User,
    webhook: boolean = false
  ) {
    const result = await this.db
      .query(
        "INSERT INTO statushooks (url, page, gid, cid, uid) VALUES ($1, $2, $3, $4, $5);",
        [hook, page, guild.id, channel.id, user.id]
      )
      .catch(() => {});
    if (!result) return false;
    else if (result.status.startsWith("INSERT")) {
      this.logger.info(
        `[Manager] Added webhook for ${page} in #${channel.name} | ${
          guild.name
        }, created by ${user.discriminator == "0" ? user.username : user.tag}`
      );
      this.hooks.set(hook, {
        url: hook,
        page,
        guild,
        channel,
        user,
      });
      if (webhook) return true;
      const instance = new StatusHook(page, hook, this);
      const instances = this.pages.get(page) ?? [];
      instances.push(instance);
      this.pages.set(page, instances);
      if (!this.fetchers.has(page))
        this.fetchers.set(page, new StatuspageIOFetcher(page, this));
      return true;
    } else return false;
  }

  async deleteWebhook(hook: string) {
    const result = await this.db
      .query("DELETE FROM statushooks WHERE url=$1;", [hook])
      .catch(() => {});
    if (!result) return false;
    else if (result.status.startsWith("DELETE")) return true;
    return false;
  }

  listWebhooks(listFor: Guild | TextChannel | NewsChannel) {
    const hooks = this.hooks.filter((hook) =>
      listFor instanceof Guild
        ? hook.guild?.id == listFor.id
        : hook.channel?.id == listFor.id
    );
    if (!hooks) return [];
    else return [...hooks.values()];
  }

  getUpdateEmbed(incident: Incident, update: IncidentUpdate) {
    let affectedComponents: string[] = [];
    if (
      update.affected_components?.length &&
      update.affected_components[0]?.code
    )
      affectedComponents = (update.affected_components || []).map(
        (component) =>
          `${this.emoji[component.new_status]} **${
            component.name
          }**: ${titleCase(component.new_status.replace("_", " "))}`
      );
    const embed = new MessageEmbed()
      .setTitle(incident.name)
      .setURL(`${incident.shortlink}?u=${update.id}`)
      .setDescription(
        affectedComponents.length &&
          affectedComponents.join("\n").length <= 4096
          ? affectedComponents.join("\n")
          : "null"
      )
      .setColor(this.incidentColors[incident.impact] || "#ffffff")
      .addField(
        titleCase(update.status.replace("_", " ")),
        update.body.length <= 1024
          ? update.body
          : update.body.slice(0, 1021) + "..."
      )
      .setFooter(`Incident ID: ${incident.id} | Update ID: ${update.id}`)
      .setTimestamp(
        new Date(
          incident.scheduled_for && update.status == "scheduled"
            ? incident.scheduled_for ?? update.updated_at
            : update.updated_at ?? update.created_at
        )
      );
    if (embed.description == "null") delete embed.description;
    return embed;
  }

  getBasicEmbedData(embed: MessageEmbed | APIEmbed) {
    return {
      title: embed.title,
      description: embed.description,
      status: embed.fields[0]?.name || "Unknown",
      body: embed.fields[0]?.value || "Unknown",
      color: embed.color,
    } as BasicEmbed;
  }

  areBasicEmbedsEqual(before: BasicEmbed, after: BasicEmbed) {
    return (
      before.title == after.title &&
      before.description == after.description &&
      before.status == after.status &&
      before.body == after.body &&
      before.color == after.color
    );
  }

  async haste(text: string): Promise<string> {
    const h: { key: string } = await (
      await centra("https://hst.sh/", "POST")
        .path("/documents")
        .body(text, "buffer")
        .header(
          "User-Agent",
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
        )
        .send()
    ).json();
    if (!h.key) throw new Error(JSON.stringify(h));
    return `https://hst.sh/${h.key}`;
  }

  // OLD WEBHOOK CHECK, SAVE FOR FUTURE REFERENCE?

  // const pageStatusReq = await centra(page.url + "api/v2/status.json")
  //   .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1")
  //   .send();
  // if (pageStatusReq.statusCode != 200) {
  //   this.logger.debug(
  //     `[Manager] ${page.url} gave an invalid status code (${pageStatusReq.statusCode}) when getting the page id, ignoring.`
  //   );
  //   continue;
  // }
  // const pageStatus: StatuspagePage = await pageStatusReq.json();
  // const id = pageStatus.page.id;
  // const pageInfoReq = await centra(
  //   `https://api.statuspage.io/v1/pages/${id}`
  // )
  //   .header("Authorization", process.env.STATUSPAGE_KEY)
  //   .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1")
  //   .send();
  // if (pageInfoReq.statusCode != 200) {
  //   this.logger.debug(
  //     `[Manager] ${page.url} gave an invalid status code (${pageInfoReq.statusCode}) when getting the page info, ignoring.`
  //   );
  //   continue;
  // }
  // const pageInfo: StatuspagePageInfo = await pageInfoReq.json();
  // if (pageInfo.allow_webhook_subscribers) {
  //   this.logger.debug(
  //     `[Manager] ${page.url} allows webhook subscribers, ignoring.`
  //   );
  //   continue;
  // }
}

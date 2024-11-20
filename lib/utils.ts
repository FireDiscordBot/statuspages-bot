import {
  WebhookMessageOptions,
  MessagePayload,
  GuildChannel,
  GuildMember,
  Guild,
} from "discord.js";
import { ErrorResponse, HtmlErrorResponse, SlashCommand } from "./interfaces";
import { RawGuildMemberData } from "discord.js/typings/rawDataTypes";
import { StatusManager } from "../src/manager";
import { errorHtml } from "../static/error";
import * as express from "express";

export const sendError = (res: express.Response, error: ErrorResponse) =>
  res.status(error.code).json(error);

export function sendErrorHTML(
  res: express.Response,
  error: HtmlErrorResponse
): void {
  res.header("Content-Type", "text/html");
  let body = errorHtml;
  Object.entries(error.headers || {}).forEach((entry) => {
    res.header(entry[0], entry[1]);
  });
  const replacements = {
    "{API_PAGE_TITLE}": "Fire - Status Webhooks",
    "{API_TITLE}": "Fire - Status Webhooks",
    "{API_ERROR_TITLE}": error.title || "Internal Server Error",
    "{API_ERROR_TEXT}":
      error.text || "Something went wrong and an error wasn't provided.",
    "{API_REFERRAL}": error.referral || "https://getfire.bot/",
    "{API_BUTTON}": error.button || "Go back",
  };
  Object.entries(replacements).forEach((entry) => {
    body = body.replace(entry[0], entry[1]);
  });
  res.status(error.code).send(body);
}

export const titleCase = (string: string) =>
  string
    .toLowerCase()
    .split(" ")
    .map((sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1))
    .join(" ");

export class Respond {
  manager: StatusManager;
  channel?: GuildChannel | null;
  member: GuildMember;
  user_id: string;
  token: string;
  guild: Guild;
  id: string;

  constructor(interaction: SlashCommand, manager: StatusManager) {
    this.id = interaction.id;
    this.token = interaction.token;
    this.manager = manager;
    this.guild = manager.bot.guilds.cache.get(interaction.guild_id);
    this.channel = this.guild?.channels.cache.get(
      interaction.channel_id
    ) as GuildChannel;
    this.member =
      this.guild.members.cache.get(interaction.member.user.id) ||
      new GuildMember(
        this.manager.bot,
        interaction.member as RawGuildMemberData,
        this.guild
      );
    this.user_id = interaction.member.user.id;
  }

  async send(
    options?:
      | string
      | MessagePayload
      | (WebhookMessageOptions & { split?: false }),
    flags?: number // Used for success/error, can also be set
  ) {
    let apiMessage: MessagePayload;

    if (options instanceof MessagePayload) apiMessage = options.resolveData();
    else {
      apiMessage = MessagePayload.create(
        // @ts-ignore
        { client: this.manager.bot },
        options
      ).resolveData();
    }

    const { data, files } = (await apiMessage.resolveFiles()) as {
      data: any;
      files: any[];
    };

    // @ts-ignore
    data.flags = this.msgFlags;
    // @ts-ignore
    if (typeof flags == "number") data.flags = flags;

    // embeds in ephemeral wen eta
    // @ts-ignore
    if (data.embeds?.length && (data.flags & 64) == 64) data.flags -= 1 << 6;

    // @ts-ignore
    await this.manager.bot.api
      // @ts-ignore
      .webhooks(this.manager.bot.user.id)(this.token)
      .post({
        data,
        files,
      })
      .then(() => {
        // @ts-ignore
        if ((data.flags & 64) != 64) this.message.sent = "message";
      })
      .catch(() => {});
  }

  async error(message: string) {
    return await this.send(
      `<:major_outage:685538400639385706> ${message}`
    ).catch(() => {});
  }

  async success(message: string) {
    return await this.send(
      `<:operational:685538400639385649> ${message}`
    ).catch(() => {});
  }

  async warn(message: string) {
    return await this.send(
      `<:partial_outage:685538400555499675> ${message}`
    ).catch(() => {});
  }

  // Acknowledges without sending a message
  async ack(ephemeral: boolean = false) {
    // @ts-ignore
    await this.manager.bot.api
      // @ts-ignore
      .interactions(this.id)(this.token)
      .callback.post({
        data: { type: 5, data: { flags: ephemeral ? 64 : 0 } },
        query: { wait: true },
      })
      .catch(() => {});
  }
}

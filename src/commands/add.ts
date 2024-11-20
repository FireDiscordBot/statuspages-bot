import {
  ApplicationCommandData,
  NewsChannel,
  TextChannel,
  Guild,
} from "discord.js";
import { SlashCommand } from "../../lib/interfaces";
import { StatusManager } from "../manager";
import { Respond } from "../../lib/utils";

const iconMeta = /<link rel="shortcut icon" href='(?<uri>.*)'>/gim;

export default [
  {
    name: "add",
    description: "Add a webhook for a statuspage.io page",
    options: [
      {
        name: "channel",
        description: "This is the channel I'll post incidents in",
        required: true,
        type: 7,
      },
      {
        name: "page",
        description:
          "This is the URL of the status page you want to add, e.g. https://discordstatus.com/",
        required: true,
        type: 3,
      },
    ],
  } as ApplicationCommandData,
  async (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => {
    const { bot } = manager;
    const me = await respond.guild.members.fetch(bot.user.id).catch(() => {});
    if (!me)
      return await respond.error(
        "I don't seem to be present in this guild. You must keep the bot itself in the guild for status updates to be sent."
      );
    const channelID = interaction.data.options.find(
      (option) => option.name == "channel"
    )?.value;
    const channel = bot.channels.cache
      .filter((channel) => ["GUILD_NEWS", "GUILD_TEXT"].includes(channel.type))
      .get(channelID as string) as TextChannel | NewsChannel;
    if (!channel)
      return await respond.error("You must provide a valid channel!");
    else if (!me.permissionsIn(channel).has(536937472n)) {
      return await respond.error(
        `I seem to be missing some permissions in that channel! Make sure I have ${me
          .permissionsIn(channel)
          .missing(536937472n)
          .join(", ")} in there.`
      );
    }
    const page = interaction.data.options.find(
      (option) => option.name == "page"
    )?.value as string;
    if (!page) return await respond.error("You must provide a valid page URL!");
    let url: URL;
    try {
      if (!page.startsWith("https://") || !page.endsWith("/"))
        throw new Error("lol");
      url = new URL(page);
      if (!url || url.protocol != "https:" || !url.href.endsWith("/"))
        throw !url
          ? new Error("Failed to parse URL")
          : new Error(
              url.protocol != "https:"
                ? "Protocol is not HTTPS"
                : "URL is missing trailing slash"
            );
    } catch (e) {
      manager.logger.debug(`[AddCommand] URL is invalid, ${e}`);
      return await respond.error(
        "URL seems malformed, make sure it's a valid URL (include https:// and trailing slash)"
      );
    }
    const validStatusPage = await manager.checkPageExists(url, "statuspage.io");
    const lock = manager.pageCheckLocks.get(url.toString());
    if (lock && !lock.getPermits()) lock.release();
    if (!validStatusPage)
      return await respond.error(
        "That doesn't seem like a valid status page. Make sure you include the trailing slash & https:// and the page uses statuspage.io (you can test this by going to /api)"
      );
    const pages = manager.hooks.map((data) => data.page);
    if (pages.includes(url.toString())) {
      const alreadyExists = manager.hooks.find(
        (data) =>
          (data.guild instanceof Guild
            ? data.guild.id == respond.guild.id
            : data.guild == respond.guild.id) &&
          data.page.trim() == url.toString().trim()
      );
      if (alreadyExists) {
        await manager.checkHookExists(alreadyExists.url).catch(() => {});
        if (manager.hooks.has(alreadyExists.url))
          return await respond.error(
            `Seems you already have a webhook setup for this status page in this server in ${alreadyExists.channel}`
          );
      }
    }
    let avatarURL: string;
    if (typeof validStatusPage != "string") {
      const body = validStatusPage
        ? validStatusPage.body
            .toString()
            .split("\n")
            .filter((ln) => ln.includes("<link"))
            .join("\n")
        : "";
      const faviconMatch = iconMeta.exec(body);
      iconMeta.lastIndex = 0;
      if (faviconMatch && faviconMatch.groups.uri) {
        const match = faviconMatch.groups.uri;
        if (match.startsWith("//")) avatarURL = `https:${match}`;
        else if (match.startsWith("https")) avatarURL = match;
      }
    }
    const webhook = await channel
      .createWebhook(
        url.hostname.includes("discordstatus")
          ? "discоrdstatus.com"
          : url.hostname,
        {
          reason: `${
            respond.member.user.discriminator == "0"
              ? respond.member.user.username
              : respond.member.user.tag
          } requested status page updates from ${url.hostname} in this channel`,
          avatar:
            avatarURL ??
            manager.bot.user.displayAvatarURL({ size: 4096, format: "png" }),
        }
      )
      .catch(() => {});
    if (!webhook)
      return await respond.error(
        `I failed to make a webhook in ${channel}! Make sure I have the "Manage Webhooks" permission there!`
      );
    const added = await manager.addWebhook(
      `${webhook.id}/${webhook.token}`,
      url.toString(),
      respond.guild,
      channel,
      respond.member.user,
      validStatusPage == "webhook"
    );
    if (!added)
      return await respond.error(
        `I failed to add an entry into my database. Try delete the webhook I created in ${channel} and try again...`
      );
    else {
      if (validStatusPage == "webhook")
        return await respond.success(`Hooray! I've done some magic and created this webhook url for you to use!
You should be able to head to the page and subscribe with the url below to receive updates:
<https://statuspage.inv.wtf/${webhook.id}/${webhook.token}>`);
      else
        return await respond.success(
          `Hooray! You should now receive status updates from ${url.hostname} in ${channel}!`
        );
    }
  },
] as unknown as [
  ApplicationCommandData,
  (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => Promise<any>
];

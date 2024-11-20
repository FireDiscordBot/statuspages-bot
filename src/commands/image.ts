import { ApplicationCommandData, Guild } from "discord.js";
import { SlashCommand } from "../../lib/interfaces";
import { StatusManager } from "../manager";
import { Respond } from "../../lib/utils";
import * as centra from "centra";

const iconMeta = /<link rel="shortcut icon" href='(?<uri>.*)'>/gim;

export default [
  {
    name: "avatar",
    description:
      "Sets the avatar of the webhook used to send posts, uses the page's favicon if you don't specify one",
    options: [
      {
        name: "page",
        description:
          "This is the URL of the status page you want to set the avatar for, e.g. https://discordstatus.com/",
        required: true,
        type: 3,
      },
      {
        name: "image",
        description: "This is the URL of the image you'd like the avatar to be",
        required: false,
        type: 3,
      },
    ],
  } as ApplicationCommandData,
  async (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => {
    const pageURL = interaction.data.options.find(
      (option) => option.name == "page"
    )?.value as string;
    let avatarURL =
      (interaction.data.options.find((option) => option.name == "image")
        ?.value as string) ?? "not a valid url lol";
    let url: URL;
    try {
      url = new URL(pageURL);
    } catch {}
    if (!url)
      return await respond.error("The page you provided is not a valid URL.");
    if (avatarURL == "not a valid url lol") {
      const page = await centra(pageURL)
        .header(
          "User-Agent",
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
        )
        .send()
        .catch(() => {});
      const body = page
        ? page.body
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
    try {
      url = new URL(avatarURL);
    } catch {}
    if (!url)
      return await respond.error("The image you provided is not a valid URL.");
    const existing = manager.hooks.find((data) =>
      data.guild instanceof Guild
        ? data.guild.id == respond.guild.id && data.page == pageURL
        : data.guild == respond.guild.id && data.page == pageURL
    );
    if (!existing)
      return await respond.error("A webhook for that page was not found.");
    const [id] = existing.url.split("/");
    const webhooks = await existing.channel.fetchWebhooks();
    const webhook = webhooks.find((webhook) => webhook.id == id);
    if (!webhook)
      return await respond.error(
        "The webhook was not found on the channel, maybe it was deleted? If it was, I will soon forget about it"
      );
    const edited = await webhook.edit({ avatar: avatarURL }).catch(() => {});
    if (!edited)
      return await respond.error(
        "Failed to set avatar, make sure the image is a valid PNG/JPEG"
      );
    else
      return await respond.success(
        `Successfully set the avatar to <${avatarURL}>`
      );
  },
] as unknown as [
  ApplicationCommandData,
  (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => Promise<any>
];

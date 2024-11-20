import {
  PaginatorEmbedInterface,
  WrappedPaginator,
} from "../../lib/paginators";
import {
  ApplicationCommandData,
  MessageEmbed,
  TextChannel,
  Guild,
} from "discord.js";
import { SlashCommand } from "../../lib/interfaces";
import { StatusManager } from "../manager";
import { Respond } from "../../lib/utils";

export default [
  {
    name: "list",
    description: "List current status webhooks",
  } as ApplicationCommandData,
  async (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => {
    const { bot } = manager;
    const existing = manager.hooks.filter((data) =>
      data.guild instanceof Guild
        ? data.guild.id == respond.guild.id
        : data.guild == respond.guild.id
    );
    const list: string[] = [];
    for (const [, data] of existing) {
      let page: string;
      try {
        page = new URL(data.page).hostname;
      } catch {
        page = data.page;
      }
      list.push(
        `[${list.length + 1}] [${page}](${data.page}) posting to ${
          data.channel
        }${
          data.role
            ? data.alertForAll
              ? " and alerting " + data.role.toString() + " for all updates"
              : " and alerting " + data.role.toString() + " once per incident"
            : ""
        }${data.disabled ? " (Disabled! Check permissions)" : ""}`
      );
    }
    if (list.join("\n").length > 4096) {
      const paginator = new WrappedPaginator("", "", 3500);
      for (const line of list) paginator.addLine(line);
      const embed = new MessageEmbed()
        .setColor(respond.member.displayColor)
        .setTitle(`${respond.guild.name}'s status page webhooks`)
        .setFooter(
          respond.member.user.discriminator == "0"
            ? respond.member.user.username
            : respond.member.user.tag,
          respond.member.user.displayAvatarURL({
            size: 2048,
            format: "png",
            dynamic: true,
          })
        );
      const paginatorInterface = new PaginatorEmbedInterface(bot, paginator, {
        owner: respond.member,
        embed,
      });
      return await paginatorInterface.send(respond.channel as TextChannel);
    }
    const embed = new MessageEmbed()
      .setColor(respond.member.displayColor)
      .setTitle(`${respond.guild.name}'s status page webhooks`)
      .setDescription(list.join("\n"))
      .setFooter(
        respond.member.user.discriminator == "0"
          ? respond.member.user.username
          : respond.member.user.tag,
        respond.member.user.displayAvatarURL({
          size: 2048,
          format: "png",
          dynamic: true,
        })
      );
    return await respond.send({ embeds: [embed] });
  },
] as unknown as [
  ApplicationCommandData,
  (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => Promise<any>
];

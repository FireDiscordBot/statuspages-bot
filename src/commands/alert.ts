import { ApplicationCommandData, Guild } from "discord.js";
import { SlashCommand } from "../../lib/interfaces";
import { StatusManager } from "../manager";
import { Respond } from "../../lib/utils";

export default [
  {
    name: "alert",
    description: "Set a role to ping for status updates",
    options: [
      {
        name: "page",
        description:
          "This is the URL of the status page you want to set alerts for, e.g. https://discordstatus.com/",
        required: true,
        type: 3,
      },
      {
        name: "role",
        description:
          'The role you would like to "alert" (ping) for status updates',
        required: false,
        type: 8,
      },
      {
        name: "all",
        description:
          "Whether or not the role should be pinged for all updates or just per incident",
        required: false,
        type: 5,
      },
    ],
  } as ApplicationCommandData,
  async (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => {
    const { db } = manager;
    const pageURL = interaction.data.options.find(
      (option) => option.name == "page"
    )?.value as string;
    let url: URL;
    try {
      url = new URL(pageURL);
    } catch {}
    if (!url)
      return await respond.error("The page you provided is not a valid URL.");
    const existing = manager.hooks.find((data) =>
      data.guild instanceof Guild
        ? data.guild.id == respond.guild.id && data.page == pageURL
        : data.guild == respond.guild.id && data.page == pageURL
    );
    if (!existing)
      return await respond.error("A webhook for that page was not found.");
    const roleId = interaction.data.options.find(
      (option) => option.name == "role"
    )?.value as string;
    const role = respond.guild.roles.cache.get(roleId);
    if (!role && !existing.role)
      return await respond.error("That role does not seem to be valid.");
    else if (!role) {
      const updated = await db
        .query("UPDATE statushooks SET rid=$1 WHERE url=$2 AND page=$3;", [
          null,
          existing.url,
          existing.page,
        ])
        .catch(() => {});
      if (!updated) return await respond.error("Something went wrong!");
      else
        return await respond.success(
          "Successfully reset the alert role for this page"
        );
    }
    if (respond.guild.roles.everyone.id == role.id)
      return await respond.error(
        "You cannot use the @\u200beveryone role as the alert role"
      );
    const alertForAll =
      (interaction.data.options.find((option) => option.name == "all")
        ?.value as boolean) ?? false;

    const updated = await db
      .query(
        "UPDATE statushooks SET rid=$1, pingonupdate=$2 WHERE url=$3 AND page=$4;",
        [role.id, alertForAll, existing.url, existing.page]
      )
      .catch(() => {});
    if (!updated) return await respond.error("Something went wrong!");

    manager.hooks.set(existing.url, { ...existing, role, alertForAll });
    return await respond.success(
      `Successfully set the alert role to ${role} and will ping it ${
        alertForAll ? "on each update" : "once for each incident"
      }.`
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

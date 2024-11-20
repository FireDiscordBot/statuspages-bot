import { ApplicationCommandData } from "discord.js";
import { SlashCommand } from "../../lib/interfaces";
import { StatusManager } from "../manager";
import { Respond } from "../../lib/utils";

import BackfillCommand from "./backfill";
import AlertCommand from "./alert";
import ImageCommand from "./image";
import ListCommand from "./list";
import AddCommand from "./add";

export default [
  {
    name: "register",
    description: "Registers all commands globally",
  } as ApplicationCommandData,
  async (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => {
    if (respond.user_id != "287698408855044097")
      return await respond.error("no");
    const commands = [
      AddCommand,
      ListCommand,
      BackfillCommand,
      AlertCommand,
      ImageCommand,
    ];
    try {
      process.env.NODE_ENV == "production"
        ? await manager.bot.application.commands.set(commands.map(([d]) => d))
        : await respond.guild.commands.set(commands.map(([d]) => d));
      await respond.success("yes");
    } catch (e) {
      await respond.error(e.stack);
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

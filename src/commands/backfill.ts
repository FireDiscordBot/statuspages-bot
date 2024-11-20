import {
  ScheduledMaintenance,
  SlashCommand,
  Incidents,
} from "../../lib/interfaces";
import { ApplicationCommandData, DiscordAPIError, Guild } from "discord.js";
import { Message } from "../../lib/message";
import { StatusManager } from "../manager";
import { Respond } from "../../lib/utils";
import * as centra from "centra";

export default [
  {
    name: "backfill",
    description:
      "Backfill all or one incident(s) and send their updates in the set channel",
    options: [
      {
        name: "page",
        description:
          "This is the URL of the status page you want to backfill, e.g. https://discordstatus.com/",
        required: true,
        type: 3,
      },
      {
        name: "incident",
        description: "An incident ID to backfill only this incident",
        required: false,
        type: 3,
      },
      {
        name: "mention",
        description:
          "Whether or not to mention the alert role while backfilling",
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
    const pageURL = interaction.data.options.find(
      (option) => option.name == "page"
    )?.value as string;
    const incidentId = interaction.data.options.find(
      (option) => option.name == "incident"
    )?.value as string;
    const mention =
      (interaction.data.options.find((option) => option.name == "mention")
        ?.value as boolean) || false;
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
    const hook = existing.url;
    const page = manager.pages.get(pageURL).find((h) => h.hook == hook);
    const [incidentsReq, maintenancesReq] = await Promise.all([
      centra(pageURL + "/api/v2/incidents.json")
        .header(
          "User-Agent",
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
        )
        .send()
        .catch(() => {}),
      centra(pageURL + "/api/v2/scheduled-maintenances.json")
        .header(
          "User-Agent",
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
        )
        .send()
        .catch(() => {}),
    ]);
    if (
      !incidentsReq ||
      incidentsReq.statusCode != 200 ||
      !maintenancesReq ||
      maintenancesReq.statusCode != 200
    )
      return await respond.error(
        "Failed to fetch incidents and/or scheduled maintenances"
      );
    let { incidents }: Incidents =
      incidentsReq.statusCode == 200
        ? await incidentsReq.json()
        : { page: {}, incidents: [] };
    if (maintenancesReq.statusCode == 200) {
      const { scheduled_maintenances }: ScheduledMaintenance =
        await maintenancesReq.json();
      incidents.push(...scheduled_maintenances);
    }
    incidents = incidents.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return +dateA - +dateB;
    });
    if (incidentId)
      incidents = incidents.filter((incident) => incident.id == incidentId);
    await respond.warn(
      `Backfilling ${
        incidents.flatMap((i) => i.incident_updates).length
      } updates for ${incidents.length} incident(s)...`
    );
    const [id] = hook.split("/");
    const webhooks = await existing.channel.fetchWebhooks();
    const webhook = webhooks.find((w) => w.id == id);
    for (const incident of incidents) {
      const updates = incident.incident_updates.reverse().map((u) => u.id);
      for (const update of incident.incident_updates) {
        const embed = manager.getUpdateEmbed(incident, update);
        const isFirstUpdate = updates.indexOf(update.id) == 0;
        const alertRole = existing.role;
        const shouldPing =
          mention && alertRole && (existing.alertForAll || isFirstUpdate);
        let content: string;
        if (shouldPing) content = alertRole.toString();
        await webhook
          .send({
            embeds: [embed.toJSON()],
            content,
            allowedMentions: {
              roles: [alertRole?.id],
            },
          })
          .then((message) => {
            if (!page) return;
            page.incidentMessages.push({
              message: { id: message.id, embeds: [embed], deleted: false },
              channelId: existing.channel.id,
              incidentId: incident.id,
              updateId: update.id,
            });
          })
          .catch((e: Error) => {
            if (
              e instanceof DiscordAPIError &&
              e.httpStatus == 404 &&
              e.code == 10015
            )
              return manager.checkHookExists(hook);
          });
      }
    }
    await respond.success("Backfill complete!").catch(() => {});
  },
] as unknown as [
  ApplicationCommandData,
  (
    interaction: SlashCommand,
    respond: Respond,
    manager: StatusManager
  ) => Promise<any>
];

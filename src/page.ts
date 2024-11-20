import {
  Channel,
  Collection,
  DiscordAPIError,
  HTTPError,
  MessageEmbed,
  NewsChannel,
  Permissions,
} from "discord.js";
import { Incident, IncidentUpdate } from "../lib/interfaces";
import { Message } from "../lib/message";
import { StatusManager } from "./manager";

type IncidentUpdateMessageV2 = {
  message: { id: string; embeds: MessageEmbed[]; deleted: boolean };
  incidentId: string;
  channelId: string;
  updateId: string;
};

const footerRegex =
  /Incident ID: (?<incident>\w+) \| Update ID: (?<update>\w+)/gim;

export class StatusHook {
  page: string;
  hook: string;
  ignore: string[];
  lastUpdate: string;
  manager: StatusManager;
  incidentMessages: IncidentUpdateMessageV2[];
  backfilled: boolean | "running";
  backfillPromise: Promise<void>;
  enabled: boolean;

  constructor(page: string, hook: string, manager: StatusManager) {
    this.page = page;
    this.hook = hook;
    this.ignore = [];
    this.manager = manager;
    this.incidentMessages = [];

    this.backfilled = false;

    this.enabled = true;
  }

  get name() {
    const hook = this.manager.hooks.find((h) => h.url == this.hook);
    if (hook) return `${hook.guild}/#${hook.channel?.name}`;
    else {
      const [id, token] = this.hook.split("/");
      return `${id}/${"*".repeat(token.length)}`;
    }
  }

  disable() {
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
  }

  getIncidentFromEmbed(embed: MessageEmbed) {
    const match = footerRegex.exec(embed.footer?.text);
    footerRegex.lastIndex = 0;
    if (match.groups?.incident && match.groups.update)
      return { incident: match.groups.incident, update: match.groups.update };
    return false;
  }

  // TODO: refine this for a single hook
  async backfillIncidents(incidents: Incident[]) {
    if (this.backfilled != false) return await this.backfillPromise;
    let resolve: () => void;
    this.backfillPromise = new Promise((r) => (resolve = r));
    this.backfilled = "running";
    const hook = this.manager.hooks.find((h) => h.url == this.hook);
    const [id] = hook.url.split("/");
    const { channel } = hook;
    if (!(channel instanceof Channel)) {
      try {
        this.manager.logger.warn(
          // @ts-ignore
          `[StatusPage] Invalid/No channel for webhook ${id}, got ${
            (channel as any)?.constructor?.name ?? "nothing"
          } instead`,
          (channel as any)?.toJSON?.()
        );
      } catch {
        this.manager.logger.warn(
          // @ts-ignore
          `[StatusPage] Invalid/No channel for webhook ${id}, got ${
            (channel as any)?.constructor?.name ?? "nothing"
          } instead`
        );
      }
      this.backfilled = true;
      return;
    }
    const messages = await channel?.messages
      .fetch({ limit: 100 })
      .then((msgs) => msgs.filter((message) => !!message.webhookId))
      .catch(() => {});
    if (!messages || !messages.size) return (this.backfilled = true);
    for (const message of messages.values()) {
      if (message.webhookId != id || !message.embeds.length) continue;
      const update = this.getIncidentFromEmbed(message.embeds[0]);
      if (
        update &&
        incidents.find((incident) => incident.id == update.incident)
      )
        this.incidentMessages.push({
          incidentId: update.incident,
          updateId: update.update,
          channelId: channel.id,
          message: {
            id: message.id,
            embeds: message.embeds,
            deleted: message.deleted,
          },
        });
      // TODO: fix below deleting incidents that exist
      // else if (update) {
      //   if (!this.ignore.includes(update.incident))
      //     this.ignore.push(update.incident);
      //   if (
      //     message.channel?.type == "DM" ||
      //     !message.guild?.me
      //       .permissionsIn(message.channel)
      //       .has("MANAGE_MESSAGES")
      //   )
      //     continue;
      //   if (message.channel?.isText())
      //     this.manager.logger.warn(
      //       `[StatusPage] Deleting update ${update.update} (${message?.id}) in ${message.channel?.name}/${message.guild?.name} due to unknown incident ${update.incident} for page ${this.page}`
      //     );
      //   message.delete().catch(() => {});
      // }
    }
    for (const updateData of this.incidentMessages) {
      const incident = incidents.find(
        (incident) => incident.id == updateData.incidentId
      );
      const update = incident.incident_updates.find(
        (update) => update.id == updateData.updateId
      );
      const embed = this.manager.getUpdateEmbed(incident, update);
      if (
        !updateData.message ||
        updateData.message.deleted ||
        this.manager.areBasicEmbedsEqual(
          this.manager.getBasicEmbedData(embed.toJSON()),
          this.manager.getBasicEmbedData(
            updateData?.message.embeds[0]?.toJSON()
          )
        )
      )
        continue;
      // @ts-ignore
      await this.manager.bot.api
        // @ts-ignore
        .webhooks(this.hook)
        .messages(updateData.message.id)
        .patch({ data: { embeds: [embed.toJSON()], nonce: update.id } })
        .catch((e: Error) => {
          if (
            e instanceof DiscordAPIError &&
            e.httpStatus == 404 &&
            e.code == 10015
          )
            return this.manager.checkHookExists(this.hook);
          else if (
            e instanceof DiscordAPIError &&
            e.httpStatus == 404 &&
            e.code == 10008
          ) {
            this.manager.logger.warn(
              `[StatusPage] Message ${updateData.message.id} not found, removing from cache...`
            );
            const index = this.incidentMessages.findIndex(
              (m) => m.updateId == updateData.updateId
            );
            if (this.incidentMessages[index]?.message)
              this.incidentMessages[index].message.deleted = true;
            return;
          } else if (e instanceof HTTPError && e.code >= 500) {
            this.manager.logger.error(
              `[StatusPage] Encountered ${e.code} on "/webhooks/${this.hook}/messages/${updateData.message.id}"`
            );
            return;
          }
          this.manager.logger.warn(
            `[StatusPage] Failed to edit message ${updateData.message.id} for ${updateData.incidentId}/${updateData.updateId} for ${this.name}`
          );
        });
    }

    this.backfilled = true;
    resolve();
    this.manager.logger.log(
      `[StatusPage] Successfully backfilled ${incidents.length} incidents for ${this.page} - ${this.name}.`
    );
  }

  shouldSend(incident: Incident, update: IncidentUpdate) {
    if (this.ignore.includes(update.id) || this.backfilled != true)
      return false;
    const embed = this.manager.getUpdateEmbed(incident, update);
    const already = this.incidentMessages.find((m) => m.updateId == update.id);
    if (already) {
      const message = already.message;
      if (
        message.embeds.length &&
        !this.manager.areBasicEmbedsEqual(
          this.manager.getBasicEmbedData(message.embeds[0].toJSON()),
          this.manager.getBasicEmbedData(embed)
        )
      )
        return this.updateIncidentMessage(already, incident);
      else return false;
    }
    if (+new Date() - +new Date(update.created_at) > 180000000) {
      this.ignore.push(update.id);
      return false;
    }
    const currentTimestamp = +new Date(update.updated_at);
    const latestTimestamp = +new Date(
      incident.incident_updates.sort(
        (a, b) => +new Date(a.updated_at) - +new Date(b.updated_at)
      )[incident.incident_updates.length - 1].updated_at
    );
    if (latestTimestamp > currentTimestamp) {
      this.ignore.push(update.id);
      return false;
    }
    return this.sendIncidentUpdate(incident, update);
  }

  async sendIncidentUpdate(incident: Incident, update: IncidentUpdate) {
    const embed = this.manager.getUpdateEmbed(incident, update);
    if (
      this.lastUpdate == update.id &&
      !this.incidentMessages.find((m) => m.updateId == update.id)
    )
      return;
    else if (this.lastUpdate == update.id) {
      const already = this.incidentMessages.find(
        (m) => m.updateId == update.id
      );
      const message = already.message;
      if (
        message.embeds.length &&
        !this.manager.areBasicEmbedsEqual(
          this.manager.getBasicEmbedData(message.embeds[0].toJSON()),
          this.manager.getBasicEmbedData(embed)
        )
      )
        return this.updateIncidentMessage(already, incident);
      else return false;
    }
    const created = +new Date(update.created_at);
    // if the update is over 6 hours ago and considered a "new update", don't send
    if (+new Date() - created > 21600000 && !update.updated_at) return;
    const hook = this.manager.hooks.find((h) => h.url == this.hook);
    const updates = incident.incident_updates
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
      .map((u) => u.id);
    if (this.incidentMessages.find((data) => data.updateId == update.id))
      return;
    const isFirstUpdate = updates.indexOf(update.id) == 0;
    const alertRole = hook?.role;
    const shouldPing = alertRole && (hook.alertForAll || isFirstUpdate);
    let content: string;
    if (shouldPing) content = alertRole.toString();
    // @ts-ignore
    const execution = await this.manager.bot.api
      // @ts-ignore
      .webhooks(hook.url)
      .post({
        data: {
          embeds: [embed.toJSON()],
          content,
          nonce: update.id,
          enforce_nonce: true,
        },
        query: { wait: true },
      })
      .catch((e: Error) => {
        if (
          (e instanceof DiscordAPIError && e.httpStatus == 404) ||
          (e instanceof DiscordAPIError && e.httpStatus == 401)
        )
          this.manager.checkHookExists(hook.url).catch(() => {});
      });
    if (execution) {
      this.manager.logger.info(
        `[StatusPage] Sent update for ${
          incident.scheduled_for ? "maintenance" : "incident"
        } ${incident.name} for page ${this.page} to ${this.name}`
      );
      this.lastUpdate = update.id;
      try {
        let message: Message;
        this.incidentMessages.push({
          message: { id: execution.id, embeds: [embed], deleted: false },
          channelId: hook.channel.id,
          incidentId: incident.id,
          updateId: update.id,
        });
        message = new Message(this.manager.bot, execution);
        const myPermissions = hook.channel.permissionsFor(hook.guild.me);
        if (
          message &&
          hook.channel instanceof NewsChannel &&
          myPermissions.has(Permissions.FLAGS.MANAGE_MESSAGES) &&
          myPermissions.has(Permissions.FLAGS.SEND_MESSAGES)
        ) {
          this.manager.logger.debug(
            `[StatusPage] Crossposting incident update for ${this.name}...`
          );
          message?.crosspost().catch((e) => {
            if (e instanceof DiscordAPIError && e.code != 50001)
              this.manager.logger.error(
                `[StatusPage] Failed to crosspost update for ${this.name} due to ${e.message}`
              );
          });
        }
      } catch (e) {
        this.manager.logger.error(
          `[StatusPage] Failed to handle message data for ${incident.id}/${update.id} in ${this.name}`,
          e.stack
        );
      }
    } else
      this.manager.logger.warn(
        `[StatusPage] Failed to send update for ${incident.id}/${update.id} in ${this.name}`
      );
  }

  async updateIncidentMessage(
    message: IncidentUpdateMessageV2,
    incident: Incident
  ) {
    const hook = this.manager.hooks.find((h) => h.url == this.hook);
    if (!hook) return;
    const update = incident.incident_updates.find(
      (u) => u.id == message.updateId
    );
    const embed = this.manager.getUpdateEmbed(incident, update);
    if (!embed) return false;
    // @ts-ignore
    const execution = await this.manager.bot.api
      // @ts-ignore
      .webhooks(hook.url)
      .messages(message.message.id)
      .patch({ data: { embeds: [embed.toJSON()], nonce: update.id } })
      .catch(async (e: Error) => {
        if (
          e instanceof DiscordAPIError &&
          e.code == 10008 &&
          e.httpStatus == 404
        ) {
          this.manager.logger.warn(
            `[StatusPage] Message ${message.message.id} not found, removing from cache...`
          );
          const index = this.incidentMessages.findIndex(
            (m) => m.updateId == update.id
          );
          if (this.incidentMessages[index]?.message)
            this.incidentMessages[index].message.deleted = true;
          return;
        } else if (
          e instanceof DiscordAPIError &&
          e.code == 10015 &&
          e.httpStatus == 404
        ) {
          return await this.manager.checkHookExists(hook.url).catch(() => {});
        } else if (e instanceof HTTPError && e.code >= 500) {
          this.manager.logger.error(
            `[StatusPage] Encountered ${e.code} on PATCH /webhooks/${hook.url}/messages/${message.message.id}`
          );
          return;
        }
        this.manager.logger.warn(
          `[StatusPage] Failed to edit message ${message.message.id} for ${incident.id}/${update.id} for ${this.name}`,
          e.stack
        );
      });
    if (execution) {
      this.manager.logger.info(
        `[StatusPage] Edited update for incident ${incident.name} for page ${this.page} to ${this.name}`
      );
      const index = this.incidentMessages.findIndex(
        (m) => m.updateId == update.id
      );
      try {
        this.incidentMessages[index].message = {
          id: execution.id,
          embeds: [embed],
          deleted: false,
        };
      } catch (e) {
        if (e instanceof TypeError)
          this.incidentMessages.push({
            message: { id: execution.id, embeds: [embed], deleted: false },
            incidentId: incident.id,
            updateId: update.id,
            channelId: hook.channel.id,
          });
      }
    }
  }
}

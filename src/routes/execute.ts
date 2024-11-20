import { DiscordAPIError, NewsChannel, Permissions } from "discord.js";
import * as express from "express";
import {
  ComponentStatus,
  ComponentUpdate,
  Incident,
} from "../../lib/interfaces";
import { Message } from "../../lib/message";
import { sendError } from "../../lib/utils";

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const executeRoute = async (
  req: express.Request,
  res: express.Response
) => {
  const { manager } = req.app;
  const hook = `${req.params.id}/${req.params.token}`;
  if (req.method == "GET" && manager.hooks.has(hook))
    return res.status(202).send();
  else if (req.method == "GET")
    return sendError(res, {
      success: false,
      error: "Not Found",
      code: 404,
    });
  if (!req.headers["user-agent"]?.includes("statuspage.io/webhooks/"))
    return sendError(res, {
      success: false,
      error: "Unauthorized",
      code: 401,
    });
  if (!manager.hooks.has(hook)) {
    // manager.logger.warn(`[API] Got request to ${hook} with unknown webhook`);
    return sendError(res, {
      success: false,
      error: "Invalid ID or Token",
      code: 400,
    });
  }
  let hookData = manager.hooks.get(hook);
  const raw = req.body;
  if (!raw) {
    manager.logger.warn(
      `[API] Got request to ${hook} (${hookData.page}) with missing or invalid body`
    );
    return sendError(res, {
      success: false,
      error: "Missing or invalid body",
      code: 400,
    });
  }
  res.status(204).send();
  if (raw.component_update) {
    await sleep(2500);
    hookData = manager.hooks.get(hook);
    const componentUpdate = raw.component_update as ComponentUpdate;
    if (hookData.latestUpdate?.message_id) {
      const { incident, update, message_id } = hookData.latestUpdate;
      const affected = update.affected_components.find(
        (component) => component.code == componentUpdate.component_id
      );
      const affectedIndex = update.affected_components.findIndex(
        (component) => component.code == componentUpdate.component_id
      );
      if (affected) {
        if (affected.new_status != componentUpdate.new_status) {
          affected.old_status = componentUpdate.old_status as ComponentStatus;
          affected.new_status = componentUpdate.new_status as ComponentStatus;
        } else return;
        update.affected_components[affectedIndex] = affected;
      } else {
        update.affected_components.push({
          code: componentUpdate.component_id,
          name: raw.component?.name || "Unknown",
          old_status: componentUpdate.old_status as ComponentStatus,
          new_status: componentUpdate.new_status as ComponentStatus,
        });
      }
      hookData.latestUpdate.update = update;
      const embed = manager.getUpdateEmbed(incident, update);
      // @ts-ignore
      const hookEdit = await manager.bot.api
        // @ts-ignore
        .webhooks(hookData.url)
        .messages(message_id)
        .patch({ data: { embeds: [embed.toJSON()], nonce: update.id } })
        .catch((e) => e);
      if (hookEdit instanceof Error) {
        manager.logger.warn(
          `[API] Failed to update affected components for incident ${
            incident.name
          } from page ${hookData.page} for ${hook} with status ${
            hookEdit instanceof DiscordAPIError ? hookEdit.httpStatus : 500
          }. `,
          hookEdit.message
        );
        if (
          hookEdit instanceof DiscordAPIError &&
          (hookEdit.httpStatus == 404 || hookEdit.httpStatus == 401)
        )
          manager.checkHookExists(hook).catch(() => {});
      }
    }
  } else if (raw.incident) {
    const incident: Incident = raw.incident;
    const isFirstUpdate = incident.incident_updates.length == 1;
    const alertRole = hookData.role;
    const shouldPing = alertRole && (hookData.alertForAll || isFirstUpdate);
    const update = incident.incident_updates[0];
    const embed = manager.getUpdateEmbed(incident, update);
    let content: string;
    if (shouldPing) content = alertRole.toString();
    // @ts-ignore
    const hookMsg = await manager.bot.api
      // @ts-ignore
      .webhooks(hookData.url)
      .post({
        data: {
          embeds: [embed.toJSON()],
          content,
          nonce: update.id,
          enforce_nonce: true,
        },
        query: { wait: true },
      })
      .catch((e) => e);
    if (hookMsg instanceof Error) {
      manager.logger.warn(
        `[API] Failed to send update for incident ${incident.name} from page ${
          hookData.page
        } to ${hook} with status ${
          hookMsg instanceof DiscordAPIError ? hookMsg.httpStatus : 500
        }. `,
        hookMsg.message
      );
      if (
        hookMsg instanceof DiscordAPIError &&
        (hookMsg.httpStatus == 404 || hookMsg.httpStatus == 401)
      )
        manager.checkHookExists(hook).catch(() => {});
    } else {
      try {
        hookData.latestUpdate = {
          message_id: hookMsg.id,
          incident,
          update,
        };
        manager.hooks.set(hook, hookData);
        const message = new Message(manager.bot, hookMsg);
        const myPermissions = hookData.channel.permissionsFor(
          hookData.guild.me
        );
        if (
          message &&
          hookData.channel instanceof NewsChannel &&
          myPermissions.has(Permissions.FLAGS.MANAGE_MESSAGES) &&
          myPermissions.has(Permissions.FLAGS.SEND_MESSAGES)
        ) {
          manager.logger.debug(
            `[API] Crossposting incident update in ${hookData.guild}/#${hookData.channel.name}...`
          );
          message
            ?.crosspost()
            .catch((e) =>
              manager.logger.error(
                `[API] Failed to crosspost update in ${hookData.guild}/#${hookData.channel.name} due to ${e}...`
              )
            );
        }
      } catch (e) {
        manager.logger.error(
          `[API] Failed to read message data & crosspost update in ${hookData.guild}/#${hookData.channel.name}`,
          e.stack
        );
      }
      manager.logger.info(
        `[API] Sent update for ${
          incident.scheduled_for ? "maintenance" : "incident"
        } ${incident.name} from page ${hookData.page} to ${hook}. `
      );
    }
  } else manager.logger.debug(raw);
};

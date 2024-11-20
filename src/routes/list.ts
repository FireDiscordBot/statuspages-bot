import { Guild, GuildChannel, GuildMember, User } from "discord.js";
import * as express from "express";

export const listRoute = async (
  req: express.Request,
  res: express.Response
) => {
  const hooks = [];
  if (req.query.includeHooks == "true")
    for (const hook of req.app.manager.hooks.values()) {
      let user: User;
      if (hook.user instanceof User) user = hook.user;
      else
        user = await req.app.manager.bot.users
          .fetch(hook.user)
          .catch(() => null);
      let me: GuildMember;
      if (hook.guild instanceof Guild)
        me = await hook.guild.members
          .fetch(req.app.manager.bot.user.id)
          .catch(() => null);
      const data = {
        url: hook.url,
        page: hook.page,
        user:
          user instanceof User
            ? {
                id: user.id,
                name: user.discriminator == "0" ? user.username : user.tag,
              }
            : hook.user instanceof User
            ? {
                id: hook.user.id,
                name:
                  hook.user.discriminator == "0"
                    ? hook.user.username
                    : hook.user.tag,
              }
            : hook.user,
        channel:
          hook.channel instanceof GuildChannel
            ? {
                name: hook.channel.name,
                id: hook.channel.id,
                lastMessageId: hook.channel.lastMessageId,
              }
            : hook.channel,
        guild:
          hook.guild instanceof Guild
            ? {
                name: hook.guild.name,
                id: hook.guild.id,
                memberCount: hook.guild.memberCount,
                ownerId: hook.guild.ownerId,
              }
            : hook.guild,
        role: hook.role
          ? {
              name: hook.role.name,
              id: hook.role.id,
              alertForAll: hook.alertForAll,
            }
          : {},
        disabled: hook.disabled,
        missing: me ? me.permissionsIn(hook.channel).missing(536937472n) : null,
      };
      hooks.push(data);
    }
  return res.json({
    pages:
      req.query.includePages == "true"
        ? req.app.manager.pages.map((hooks, page) => {
            return {
              url: page,
              hooks: hooks.map((h) => ({
                backfilled: h.backfilled,
                lastUpdate: h.lastUpdate,
                messages: h.incidentMessages,
              })),
            };
          })
        : [],
    hooks,
  });
};

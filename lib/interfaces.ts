import { Guild, NewsChannel, Role, TextChannel, User } from "discord.js";
import { APIGuildMember as Member } from "discord-api-types";

export type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

export interface ErrorResponse {
  success: boolean;
  error: string;
  code: number;
}

export interface HtmlErrorResponse {
  title: string;
  text: string;
  button?: string;
  referral?: string;
  headers?: object;
  code: number;
}

export interface WebhookData {
  url: string;
  page: string;
  guild: Guild;
  channel: TextChannel | NewsChannel;
  user: string | User;
  latestUpdate?: {
    message_id: string;
    incident: Incident;
    update: IncidentUpdate;
  };
  role?: Role;
  alertForAll?: boolean;
  disabled?: boolean;
}

export interface StatuspagePage {
  page: Page;
  status: Status;
}

export interface Page {
  id: string;
  name: string;
  url: string;
  time_zone: string;
  upstringd_at: string;
}

export interface Status {
  indicator: string;
  description: string;
}

export interface StatuspagePageInfo {
  id: string;
  created_at: string;
  upstringd_at: string;
  name: string;
  page_description: string;
  headline: string;
  branding: string;
  subdomain: string;
  domain: string;
  url: string;
  support_url: string;
  hidden_from_search: boolean;
  allow_page_subscribers: boolean;
  allow_incident_subscribers: boolean;
  allow_email_subscribers: boolean;
  allow_sms_subscribers: boolean;
  allow_rss_atom_feeds: boolean;
  allow_webhook_subscribers: boolean;
  notifications_from_email: string;
  notifications_email_footer: string;
  activity_score: number;
  twitter_username: string;
  viewers_must_be_team_members: boolean;
  ip_restrictions: string;
  city: string;
  state: string;
  country: string;
  time_zone: string;
  css_body_background_color: string;
  css_font_color: string;
  css_light_font_color: string;
  css_greens: string;
  css_yellows: string;
  css_oranges: string;
  css_blues: string;
  css_reds: string;
  css_border_color: string;
  css_graph_color: string;
  css_link_color: string;
  css_no_data: string;
  favicon_logo: string;
  transactional_logo: string;
  hero_cover: string;
  email_logo: string;
  twitter_logo: string;
}

export interface Incidents {
  page: Page;
  incidents: Incident[];
}

export interface ScheduledMaintenance {
  page: Page;
  scheduled_maintenances: Incident[];
}

export interface Incident {
  id: string;
  components: Component[];
  created_at: string;
  impact: string;
  impact_override: string;
  incident_updates: IncidentUpdate[];
  monitoring_at: string;
  name: string;
  page_id: string;
  postmortem_body: string;
  postmortem_body_last_updated_at: string;
  postmortem_ignored: boolean;
  postmortem_notified_subscribers: boolean;
  postmortem_notified_twitter: boolean;
  postmortem_published_at: boolean;
  resolved_at: string;
  scheduled_auto_completed: boolean;
  scheduled_auto_in_progress: boolean;
  scheduled_for: string;
  scheduled_remind_prior: boolean;
  scheduled_reminded_at: string;
  scheduled_until: string;
  shortlink: string;
  status:
    | "investigating"
    | "identified"
    | "monitoring"
    | "resolved"
    | "scheduled"
    | "in_progress"
    | "completed";
  updated_at: string;
}

export interface Component {
  id: string;
  page_id: string;
  group_id: string;
  created_at: string;
  updated_at: string;
  group: boolean;
  name: string;
  description: string;
  position: number;
  status: string;
  showcase: boolean;
  only_show_if_degraded: boolean;
  automation_email: string;
  start_date: string;
}

export interface IncidentUpdate {
  id: string;
  incident_id: string;
  affected_components: AffectedComponent[];
  body: string;
  created_at: string;
  custom_tweet: string;
  deliver_notifications: boolean;
  display_at: string;
  status:
    | "investigating"
    | "identified"
    | "monitoring"
    | "resolved"
    | "scheduled"
    | "in_progress"
    | "completed";
  tweet_id: string;
  twitter_updated_at: string;
  updated_at: string;
  wants_twitter_update: boolean;
}

export interface ComponentUpdate {
  created_at: string;
  new_status: string;
  old_status: string;
  id: string;
  component_id: string;
}

export interface AffectedComponent {
  code: string;
  name: string;
  old_status: ComponentStatus;
  new_status: ComponentStatus;
}

export interface SlashCommand {
  type: number;
  token: string;
  member: Member;
  id: string;
  guild_id: string;
  data: CommandData;
  channel_id: string;
}

export interface CommandData {
  options?: Option[];
  name: string;
  id?: string;
}

export interface Option {
  name: string;
  value?: string | number | boolean;
  options?: Option[];
}

export enum ApplicationCommandOptionType {
  SUB_COMMAND = 1,
  SUB_COMMAND_GROUP = 2,
  STRING = 3,
  INTEGER = 4,
  BOOLEAN = 5,
  USER = 6,
  CHANNEL = 7,
  ROLE = 8,
}

export interface BasicEmbed {
  title: string;
  description: string;
  status: string;
  body: string;
  color: number;
}

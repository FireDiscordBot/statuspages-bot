import * as centra from "centra";
import Semaphore from "semaphore-async-await";
import { Incidents, ScheduledMaintenance } from "../lib/interfaces";
import { StatusManager } from "./manager";
import { StatusHook } from "./page";

export class StatuspageIOFetcher {
  manager: StatusManager;
  lastCheck: number;
  lock: Semaphore;
  page: string;

  constructor(page: string, manager: StatusManager) {
    this.page = page;
    this.manager = manager;
    this.lock = new Semaphore(1);

    this.execute(true);
  }

  get hooks(): StatusHook[] {
    return this.manager.pages.get(this.page) ?? [];
  }

  async execute(backfilling: boolean = false) {
    if (!this.lock.getPermits()) return;
    const now = +new Date();
    await this.lock.acquire();
    this.lastCheck = now;
    const [incidentsReq, maintenancesReq] = await Promise.all([
      centra(`${this.page}/api/v2/incidents.json?ts=${+new Date()}`)
        .header(
          "User-Agent",
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
        )
        .send()
        .catch(() => {}),
      centra(
        `${this.page}/api/v2/scheduled-maintenances.json?ts=${+new Date()}`
      )
        .header(
          "User-Agent",
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4531.0 Safari/537.36 Edg/93.0.916.1"
        )
        .send()
        .catch(() => {}),
    ]);
    if (!incidentsReq || !maintenancesReq) return this.lock.release();
    if (incidentsReq.statusCode != 200 && maintenancesReq.statusCode != 200) {
      this.manager.logger.warn(
        `[StatusPage] Failed to check status for page "${this.page}" with status codes ${incidentsReq.statusCode} & ${maintenancesReq.statusCode}`
      );
      if (
        (incidentsReq.statusCode >= 300 && incidentsReq.statusCode <= 400) ||
        (maintenancesReq.statusCode >= 300 && maintenancesReq.statusCode <= 400)
      ) {
        const valid = await this.manager.checkPageExists(
          this.page,
          "statuspage.io"
        );
        if (!valid) this.manager.pages.delete(this.page);
      }
      return this.lock.release();
    }
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
    if (backfilling)
      await Promise.all(
        this.hooks
          .filter((h) => !h.backfilled)
          .map((h) => h.backfillIncidents(incidents).catch(() => {}))
      );
    if (
      !incidents.length ||
      !incidents.every((incident) => incident.incident_updates.length)
    )
      return this.lock.release();
    for (const incident of incidents)
      for (const update of incident.incident_updates)
        for (const hook of this.hooks) await hook.shouldSend(incident, update);
    return this.lock.release();
  }
}

import type { ActivitySource } from "../types";
import { agentEventsSource } from "./agent-events";
import { agentRunsSource } from "./agent-runs";
import { callsSource } from "./calls";
import { contactsSource } from "./contacts";
import { webApplicationsSource } from "./web-applications";
import { liveViewsSource } from "./live-views";

/** All sources, in lane-override order (later sources override earlier lane facts). */
export function defaultSources(): ActivitySource[] {
  return [agentRunsSource, contactsSource, callsSource, webApplicationsSource, liveViewsSource, agentEventsSource];
}

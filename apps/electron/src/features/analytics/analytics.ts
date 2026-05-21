export type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
};

export function trackPiksyEvent(event: AnalyticsEvent): void {
  window.piksy?.analytics.track(event.name, event.properties);
}

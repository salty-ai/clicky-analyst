export type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
};

export function trackGlideEvent(event: AnalyticsEvent): void {
  window.glide?.analytics.track(event.name, event.properties);
}

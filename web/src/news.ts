// Manually reviewed public news snapshot; not a feed of eyewitness reports.
export type NewsItem = {
  id: string;
  place: string;
  lon: number;
  lat: number;
  headline: string;
  summary: string;
  publishedAt: string;
  validUntil: string;
  sourceName: string;
  sourceUrl: string;
  placeUrl: string;
};
export const NEWS_CHECKED_AT = "2026-10-11T02:56:37Z";
export const NEWS_ITEMS: NewsItem[] = [
  {
    id: "delhi-news-2026-10-11-1",
    place: "Jantar Mantar",
    lon: 77.2166166,
    lat: 28.6271791,
    headline: "11 Oct protest call",
    summary:
      "NDTV reports a protest call at Jantar Mantar for 10 am on 11 October. This is an announced event, not confirmation of a gathering.",
    publishedAt: "2026-10-11T06:35:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/way/223456559",
  },
  {
    id: "delhi-news-2026-10-11-2",
    place: "Connaught Place",
    lon: 77.2193804,
    lat: 28.6317695,
    headline: "11 Oct traffic advisory",
    summary:
      "NDTV relays a Delhi Traffic Police advisory listing this area for possible traffic disruption on 11 October. Restrictions depend on conditions.",
    publishedAt: "2026-10-11T06:41:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/node/561299050",
  },
  {
    id: "delhi-news-2026-10-11-3",
    place: "Mandi House",
    lon: 77.2341966,
    lat: 28.6256122,
    headline: "11 Oct traffic advisory",
    summary:
      "NDTV relays a Delhi Traffic Police advisory listing this area for possible traffic disruption on 11 October. Restrictions depend on conditions.",
    publishedAt: "2026-10-11T06:41:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/node/6539894856",
  },
  {
    id: "delhi-news-2026-10-11-4",
    place: "Patel Chowk",
    lon: 77.214031,
    lat: 28.6229664,
    headline: "11 Oct traffic advisory",
    summary:
      "NDTV relays a Delhi Traffic Police advisory listing this area for possible traffic disruption on 11 October. Restrictions depend on conditions.",
    publishedAt: "2026-10-11T06:41:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/node/7018886726",
  },
  {
    id: "delhi-news-2026-10-11-5",
    place: "Dhaula Kuan Flyover",
    lon: 77.1665087,
    lat: 28.5945492,
    headline: "11 Oct traffic advisory",
    summary:
      "NDTV relays a Delhi Traffic Police advisory listing this area for possible traffic disruption on 11 October. Restrictions depend on conditions.",
    publishedAt: "2026-10-11T06:41:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/way/34404761",
  },
  {
    id: "delhi-news-2026-10-11-6",
    place: "Bhikaji Cama Place",
    lon: 77.1878709,
    lat: 28.5702618,
    headline: "11 Oct traffic advisory",
    summary:
      "NDTV relays a Delhi Traffic Police advisory listing this area for possible traffic disruption on 11 October. Restrictions depend on conditions.",
    publishedAt: "2026-10-11T06:41:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/node/6453544486",
  },
  {
    id: "delhi-news-2026-10-11-7",
    place: "Moti Bagh",
    lon: 77.1769289,
    lat: 28.5818356,
    headline: "11 Oct traffic advisory",
    summary:
      "NDTV relays a Delhi Traffic Police advisory listing this area for possible traffic disruption on 11 October. Restrictions depend on conditions.",
    publishedAt: "2026-10-11T06:41:00+05:30",
    validUntil: "2026-10-12T00:00:00+05:30",
    sourceName: "NDTV",
    sourceUrl:
      "https://www.ndtv.com/india-news/delhi-cjp-protest-live-updates-jantar-mantar-2-0-gyanesh-kumar-metro-stations-road-closure-traffic-advisory-trains-cancelled-delhi-police-election-com-12164478",
    placeUrl: "https://www.openstreetmap.org/relation/3674225",
  },
];
export function newsForMap(now: number): NewsItem[] {
  return NEWS_ITEMS.filter((item) => now < Date.parse(item.validUntil));
}
export function newsDate(value: string): string {
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value)) + " IST"
  );
}

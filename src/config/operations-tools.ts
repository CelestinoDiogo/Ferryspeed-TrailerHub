export type OperationsToolCategory = "roads" | "weather" | "ferry" | "contacts";

export type OperationsToolIcon =
  | "map"
  | "traffic"
  | "cloud"
  | "waves"
  | "ship"
  | "anchor"
  | "phone";

export type OperationsTool = {
  id: string;
  label: string;
  description: string;
  url: string;
  category: OperationsToolCategory;
  icon: OperationsToolIcon;
  enabled: boolean;
};

export const operationsToolCategories: Array<{ id: OperationsToolCategory; label: string }> = [
  { id: "roads", label: "ROADS & TRAFFIC" },
  { id: "weather", label: "WEATHER & MARINE" },
  { id: "ferry", label: "FERRY & PORT" },
  { id: "contacts", label: "CONTACTS" },
];

export const operationsTools: OperationsTool[] = [
  {
    id: "guernsey-road-closures",
    label: "Guernsey Road Closures",
    description: "Live status and active road restrictions.",
    url: "https://gov.gg/roadworks",
    category: "roads",
    icon: "traffic",
    enabled: true,
  },
  {
    id: "google-maps",
    label: "Google Maps",
    description: "Open full map navigation in a separate tab.",
    url: "https://maps.google.com",
    category: "roads",
    icon: "map",
    enabled: true,
  },
  {
    id: "guernsey-weather",
    label: "Guernsey Weather",
    description: "Current weather and short-term forecast.",
    url: "https://www.gov.gg/weather",
    category: "weather",
    icon: "cloud",
    enabled: true,
  },
  {
    id: "marine-forecast",
    label: "Marine Forecast",
    description: "Marine outlook for channel and port operations.",
    url: "https://www.metoffice.gov.uk/weather/specialist-forecasts/coast-and-sea",
    category: "weather",
    icon: "waves",
    enabled: true,
  },
  {
    id: "ferry-status",
    label: "Ferry Status",
    description: "Sailing status and disruption updates.",
    url: "https://www.condorferries.co.uk/",
    category: "ferry",
    icon: "ship",
    enabled: true,
  },
  {
    id: "guernsey-harbour",
    label: "Guernsey Harbour",
    description: "Harbour notices and operational updates.",
    url: "https://www.ports.gg/guernseyharbours",
    category: "ferry",
    icon: "anchor",
    enabled: true,
  },
  {
    id: "operational-contacts",
    label: "Useful Operational Contacts",
    description: "Emergency and operational contacts reference.",
    url: "https://www.gov.gg/contacts",
    category: "contacts",
    icon: "phone",
    enabled: true,
  },
];
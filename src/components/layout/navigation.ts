export type NavItem = {
  label: string;
  href: string;
  icon: "dashboard" | "arrival" | "departure" | "search" | "compound" | "load" | "edit" | "deliveries" | "waiting" | "calendar" | "fleet" | "operations" | "opsCentre";
};

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "New Arrival", href: "/dashboard/new-arrival", icon: "arrival" },
  { label: "Departure", href: "/dashboard/departure", icon: "departure" },
  { label: "Search", href: "/dashboard/search", icon: "search" },
  { label: "Compound", href: "/dashboard/compound", icon: "compound" },
  { label: "Load Trailer", href: "/dashboard/load-trailer", icon: "load" },
  { label: "Edit Trailer", href: "/dashboard/edit-trailer", icon: "edit" },
  { label: "Deliveries", href: "/dashboard/deliveries", icon: "deliveries" },
  { label: "Waiting Collection", href: "/dashboard/deliveries?filter=waiting_collection", icon: "waiting" },
  { label: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
  { label: "Company Trailers", href: "/dashboard/company-trailers", icon: "fleet" },
  { label: "Operations Board", href: "/dashboard/operations", icon: "operations" },
  { label: "Operations Centre", href: "/dashboard/operations-centre", icon: "opsCentre" },
];

export const isNavItemActive = (pathname: string, href: string) => {
  const baseHref = href.split("?")[0];
  if (baseHref === "/dashboard") return pathname === "/dashboard";
  return pathname === baseHref || pathname.startsWith(`${baseHref}/`);
};

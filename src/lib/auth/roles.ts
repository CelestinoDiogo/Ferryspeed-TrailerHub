export const roleKeys = ["administrator", "supervisor", "operator", "driver"] as const;

export type RoleKey = (typeof roleKeys)[number];

export const roleLabels: Record<RoleKey, string> = {
  administrator: "Administrator",
  supervisor: "Supervisor",
  operator: "Operator",
  driver: "Driver",
};

export function toRoleLabel(roleKey: RoleKey | null | undefined) {
  if (!roleKey) {
    return "Unassigned role";
  }

  return roleLabels[roleKey] ?? "Unassigned role";
}

import { z } from "zod";

export const updateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  roleKey: z.enum(["administrator", "supervisor", "operator", "driver"]),
  isActive: z.boolean().optional(),
});

export const updateRoleSchema = z.object({
  roleKey: z.enum(["administrator", "supervisor", "operator", "driver"]),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable(),
});

export const updatePermissionSchema = z.object({
  roleKey: z.enum(["administrator", "supervisor", "operator", "driver"]),
  moduleKey: z.string().trim().min(1).max(80),
  canView: z.boolean(),
  canCreate: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canReports: z.boolean(),
});

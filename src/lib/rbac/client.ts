import { z } from "zod";
import { moduleKeys } from "@/lib/auth/permissions";
import { roleKeys } from "@/lib/auth/roles";

export const updateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  roleKey: z.enum(roleKeys),
  isActive: z.boolean().optional(),
});

export const updateRoleSchema = z.object({
  roleKey: z.enum(roleKeys),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable(),
});

export const updatePermissionSchema = z.object({
  roleKey: z.enum(roleKeys),
  moduleKey: z.enum(moduleKeys),
  canView: z.boolean(),
  canCreate: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canReports: z.boolean(),
});

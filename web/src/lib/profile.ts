import type { User } from "../types.ts";

export const profileComplete = (user: User) =>
  !!(user.name?.trim() && user.id?.trim() && user.phone?.trim());

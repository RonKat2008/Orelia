"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/** Browser auth client (Neon Auth / Better Auth). Talks to the /api/auth/[...path] proxy route. */
export const authClient = createAuthClient();

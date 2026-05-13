export type AppRole =
  | "ADMIN" | "MANAGER" | "RECEPTION" | "HOUSEKEEPING" | "WAITER" | "KITCHEN" | "BARTENDER" | "CASHIER" | "GUEST";

export type Scope =
  | "*"
  | "inventory:read" | "inventory:write" | "inventory:adjust"
  | "rooms:read" | "rooms:write" | "reservations:read" | "reservations:write" | "folios:read" | "folios:write" | "checkin:write" | "checkout:write"
  | "orders:read" | "orders:write" | "orders:status"
  | "kds:read"
  | "tabs:read" | "tabs:write"
  | "spa:read" | "spa:write"
  | "payments:read" | "payments:write"
  | "cash:read" | "cash:open" | "cash:close"
  | "invoices:read" | "invoices:write"
  | "reports:read" | "export:read";

const ALL: Scope[] = [
  "*",
  "inventory:read","inventory:write","inventory:adjust",
  "rooms:read","rooms:write","reservations:read","reservations:write","folios:read","folios:write","checkin:write","checkout:write",
  "orders:read","orders:write","orders:status",
  "kds:read",
  "tabs:read","tabs:write",
  "spa:read","spa:write",
  "payments:read","payments:write",
  "cash:read","cash:open","cash:close",
  "invoices:read","invoices:write",
  "reports:read","export:read",
];

export function scopesForRole(role: AppRole | string): Scope[] {
  switch (role) {
    case "ADMIN":
      return ALL;
    case "MANAGER":
      return [
        "inventory:read","inventory:write","inventory:adjust",
        "rooms:read","reservations:read",
        "orders:read",
        "spa:read",
        "payments:read",
        "cash:read","cash:close",
        "invoices:read","invoices:write",
        "reports:read","export:read",
      ];
    case "RECEPTION":
      return [
        "rooms:read","rooms:write",
        "reservations:read","reservations:write",
        "folios:read","folios:write",
        "checkin:write","checkout:write",
        "payments:write",
        "cash:open","cash:read",
        "invoices:read",
      ];
    case "HOUSEKEEPING":
      return ["rooms:read","rooms:write"];
    case "WAITER":
      return ["orders:read","orders:write","payments:write","inventory:read", "inventory:write"];
    case "KITCHEN":
      return ["kds:read","orders:status","orders:read"];
    case "BARTENDER":
      return ["tabs:read","tabs:write","payments:write"];
    case "CASHIER":
      return ["cash:open","cash:close","cash:read","payments:read","payments:write","invoices:read"];
    case "GUEST":
      return [];
    default:
      return [];
  }
}

export function hasScopes(userScopes: string[] | undefined, required: string | string[]): boolean {
  if (!userScopes) return false;
  const req = Array.isArray(required) ? required : [required];
  if (userScopes.includes("*")) return true;
  return req.every((s) => userScopes.includes(s));
}

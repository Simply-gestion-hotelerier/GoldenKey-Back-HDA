// auth/jwt.ts — mise à jour du type JwtPayload

import jwt from "jsonwebtoken";
import { ENV } from "../env";

export type JwtPayload = {
  sub: number;
  email: string;
  role: string;
  scopes: string[];
  operatorName?: string;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, ENV.JWT_SECRET as jwt.Secret) as unknown;
  return decoded as JwtPayload;
}
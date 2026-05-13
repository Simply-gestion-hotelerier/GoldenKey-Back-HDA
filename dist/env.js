"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function get(name, fallback) {
    const v = process.env[name] ?? fallback;
    if (!v)
        throw new Error(`Missing env ${name}`);
    return v;
}
exports.ENV = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: Number(process.env.PORT ?? 4000),
    DATABASE_URL: get("DATABASE_URL", "postgres://neondb_owner:npg_DIeaKh9S8lVo@ep-orange-shape-ad92whmy-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"),
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
    JWT_SECRET: get("JWT_SECRET", "9a24ea9daf84ef04792912ae0778e474d4fe180568620d048eb810dea99596bbfd9de7141aa7a6a6ac17f50031e775ba5e0ab9b0d16e2f81863fd70887a7d88d"),
};

import { createHash, randomBytes } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const newApiKey = () => `apk_${randomBytes(24).toString("base64url")}`;

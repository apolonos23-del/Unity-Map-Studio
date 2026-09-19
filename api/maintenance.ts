import { timingSafeEqual } from "node:crypto";
import { cleanupPayloads } from "../server/boards";
import {
  privateResponse,
  sendError,
  HttpError,
  type ApiRequest,
  type ApiResponse,
} from "../server/http";
export default async function handler(req: ApiRequest, res: ApiResponse) {
  privateResponse(res);
  try {
    const expected = process.env.CRON_SECRET;
    const header = req.headers.authorization;
    const token =
      typeof header === "string" ? header.replace(/^Bearer /, "") : "";
    if (
      !expected ||
      Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
      throw new HttpError(401, "Unauthorized");
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
    res.status(200).json(await cleanupPayloads());
  } catch (error) {
    sendError(res, error);
  }
}

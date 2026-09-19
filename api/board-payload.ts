import {
  authenticate,
  body,
  id,
  privateResponse,
  rateLimit,
  sendError,
  type ApiRequest,
  type ApiResponse,
  HttpError,
} from "../server/http";
import { loadBoard, saveBoard, validateState } from "../server/boards";
export default async function handler(req: ApiRequest, res: ApiResponse) {
  privateResponse(res);
  try {
    const user = await authenticate(req);
    if (req.method === "GET") {
      res
        .status(200)
        .json(await loadBoard(user.uid, id(req.query.mapId, "mapId")));
    } else if (req.method === "POST") {
      await rateLimit(user.uid, "save", 180);
      const input = body(req);
      res
        .status(200)
        .json(
          await saveBoard(
            user.uid,
            id(input.mapId, "mapId"),
            validateState(input.state),
            input.baseState == null ? null : validateState(input.baseState),
            typeof input.baseRevision === "number"
              ? input.baseRevision
              : undefined,
          ),
        );
    } else {
      throw new HttpError(405, "Η μέθοδος δεν υποστηρίζεται.");
    }
  } catch (error) {
    sendError(res, error);
  }
}

import express from "express";
import { migrateAttendanceData } from "../utils/script";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { authenticate, authorize } from "../middlewares/authMiddleware";

const router = express.Router();

router.get(
    "/attandance-reset",
    // authenticate, // Optional: Add auth if needed
    // authorize(["super_admin"]), // Optional: Add auth if needed
    asyncHandler(async (req: express.Request, res: express.Response) => {
        await migrateAttendanceData();
        res
            .status(200)
            .json(new ApiResponse(200, null, "Attendance migration completed successfully"));
    })
);

export default router;

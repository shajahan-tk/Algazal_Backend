import express from "express";
import { migrateProjectDrivers } from "../utils/script";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { authenticate, authorize } from "../middlewares/authMiddleware";
import { migrateProjectEngineers } from "../utils/script2";

const router = express.Router();

router.get(
    "/project-drivers-migration",
    // authenticate, // Optional: Add auth if needed
    // authorize(["super_admin"]), // Optional: Add auth if needed
    asyncHandler(async (_req: express.Request, res: express.Response) => {
        // Call the migration function from the utility script
        const message = await migrateProjectDrivers();

        // Send a success response
        res
            .status(200)
            .json(new ApiResponse(200, null, message));
    })
);
router.get(
    "/project-engineers-migration",

    // CRITICAL: Restrict this to super_admins only
    asyncHandler(async (_req: express.Request, res: express.Response) => {
        // Call the migration function from the utility script
        const message = await migrateProjectEngineers();

        // Send a success response back to the client
        res
            .status(200)
            .json(new ApiResponse(200, null, message));
    })
);

export default router;
import { Router, Request, Response } from "express";
import { Settings } from "../models/settingsModel";
import { ApiError } from "../utils/apiHandlerHelpers";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

// Get current backend status
router.get(
    "/status",
    asyncHandler(async (_req: Request, res: Response) => {
        let setting = await Settings.findOne({ key: "backend_enabled" });

        if (!setting) {
            setting = await Settings.create({ key: "backend_enabled", value: true });
        }

        res.status(200).json({
            success: true,
            data: {
                backend_enabled: setting.value,
                last_updated: setting.updatedAt,
            },
        });
    })
);

// Toggle backend status (enable/disable)
router.patch(
    "/toggle",
    asyncHandler(async (req: Request, res: Response) => {
        const { value } = req.body;

        if (typeof value !== "boolean") {
            throw new ApiError(400, "Value must be a boolean");
        }

        let setting = await Settings.findOne({ key: "backend_enabled" });

        if (!setting) {
            setting = await Settings.create({ key: "backend_enabled", value });
        } else {
            setting.value = value;
            await setting.save();
        }

        res.status(200).json({
            success: true,
            message: `Backend ${value ? "enabled" : "disabled"} successfully`,
            data: {
                backend_enabled: setting.value,
                last_updated: setting.updatedAt,
            },
        });
    })
);

// Enable backend
router.post(
    "/enable",
    asyncHandler(async (_req: Request, res: Response) => {
        let setting = await Settings.findOne({ key: "backend_enabled" });

        if (!setting) {
            setting = await Settings.create({ key: "backend_enabled", value: true });
        } else {
            setting.value = true;
            await setting.save();
        }

        res.status(200).json({
            success: true,
            message: "Backend enabled successfully",
            data: {
                backend_enabled: setting.value,
                last_updated: setting.updatedAt,
            },
        });
    })
);

// Disable backend
router.post(
    "/disable",
    asyncHandler(async (_req: Request, res: Response) => {
        let setting = await Settings.findOne({ key: "backend_enabled" });

        if (!setting) {
            setting = await Settings.create({ key: "backend_enabled", value: false });
        } else {
            setting.value = false;
            await setting.save();
        }

        res.status(200).json({
            success: true,
            message: "Backend disabled successfully",
            data: {
                backend_enabled: setting.value,
                last_updated: setting.updatedAt,
            },
        });
    })
);

export default router;
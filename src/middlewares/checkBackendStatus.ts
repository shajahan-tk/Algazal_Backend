import { Request, Response, NextFunction } from "express";
import { Settings } from "../models/settingsModel";
import { ApiError } from "../utils/apiHandlerHelpers";

// Cache the backend status to avoid DB queries on every request
let cachedBackendStatus = true;
let lastChecked = Date.now();
const CACHE_DURATION = 5000; // 5 seconds

export const checkBackendStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Skip check for the restriction route itself
        if (req.path.includes("/api/restriction")) {
            return next();
        }

        // Use cache if it's fresh
        const now = Date.now();
        if (now - lastChecked < CACHE_DURATION) {
            if (!cachedBackendStatus) {
                return res.status(503).json({
                    success: false,
                    message: "Backend is currently disabled by administrator",
                });
            }
            return next();
        }

        // Check database
        const setting = await Settings.findOne({ key: "backend_enabled" });

        if (!setting) {
            // If setting doesn't exist, create it with default value true
            await Settings.create({ key: "backend_enabled", value: true });
            cachedBackendStatus = true;
            lastChecked = now;
            return next();
        }

        cachedBackendStatus = setting.value;
        lastChecked = now;

        if (!cachedBackendStatus) {
            return res.status(503).json({
                success: false,
                message: "Backend is currently disabled by administrator",
            });
        }

        next();
    } catch (error) {
        console.error("Error checking backend status:", error);
        // On error, allow the request to proceed
        next();
    }
};
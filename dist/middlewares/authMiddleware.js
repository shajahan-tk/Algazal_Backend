"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorize = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const userModel_1 = require("../models/userModel");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const authenticate = async (req, res, next) => {
    const token = req.header("Authorization")?.split(" ")[1];
    if (!token) {
        return next(new apiHandlerHelpers_1.ApiError(401, "Unauthorized: No token provided"));
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, "alghaza_secret");
        const user = await userModel_1.User.findById(decoded.userId).select("-password");
        if (!user) {
            return next(new apiHandlerHelpers_1.ApiError(401, "Unauthorized: User not found"));
        }
        req.user = {
            userId: user._id.toString(),
            email: user.email,
            role: user.role,
        };
        next();
    }
    catch (error) {
        return next(new apiHandlerHelpers_1.ApiError(401, "Unauthorized: Invalid token"));
    }
};
exports.authenticate = authenticate;
const authorize = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return next(new apiHandlerHelpers_1.ApiError(403, "Forbidden: Insufficient permissions"));
        }
        next();
    };
};
exports.authorize = authorize;
//# sourceMappingURL=authMiddleware.js.map
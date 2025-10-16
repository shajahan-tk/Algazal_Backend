"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const userController_1 = require("../controllers/userController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.post("/login", userController_1.login);
// Apply authentication to all routes
router.use(authMiddleware_1.authenticate);
//
router.get("/engineers", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), userController_1.getActiveEngineers);
router.get("/drivers", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), userController_1.getActiveDrivers);
router.get("/workers", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), userController_1.getActiveWorkers);
// Create user - Admin only
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), multer_1.upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "signatureImage", maxCount: 1 },
    { name: "emiratesIdDocument", maxCount: 1 },
    { name: "passportDocument", maxCount: 1 },
]), userController_1.createUser);
// Get all users - Admin + Finance
router.get("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), userController_1.getUsers);
router.get("/me", authMiddleware_1.authenticate, userController_1.getCurrentUser);
router.get("/export/csv", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), userController_1.exportUsersToCSV);
// Get single user
router.get("/:id", userController_1.getUser);
// Update user
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), multer_1.upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "signatureImage", maxCount: 1 },
    { name: "emiratesIdDocument", maxCount: 1 },
    { name: "passportDocument", maxCount: 1 },
]), userController_1.updateUser);
// Delete user - Admin only
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), userController_1.deleteUser);
exports.default = router;
//# sourceMappingURL=userRoutes.js.map
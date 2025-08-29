"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const commentController_1 = require("../controllers/commentController");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(authMiddleware_1.authenticate);
// Get client by ID
router.post("/:projectId", commentController_1.addProjectComment);
router.get("/:projectId", commentController_1.getProjectActivity);
exports.default = router;
//# sourceMappingURL=commentRoutes.js.map
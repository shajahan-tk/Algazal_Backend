"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const lpoController_1 = require("../controllers/lpoController");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Create LPO with document uploads
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), multer_1.upload.array("documents", 5), // Max 5 files
lpoController_1.createLPO);
// Get all LPOs for a project
router.get("/project/:projectId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), lpoController_1.getLPOsByProject);
router.put('/:id', multer_1.upload.array('documents', 5), lpoController_1.updateLPO);
// Get LPO details
router.get("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer"]), lpoController_1.getLPODetails);
// Delete LPO
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), lpoController_1.deleteLPO);
exports.default = router;
//# sourceMappingURL=lpoRoutes.js.map
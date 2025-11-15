"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bankDetailsController_1 = require("../controllers/bankDetailsController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// For now no need to link banks to createdBy, but keep admin protection if required
router.use(authMiddleware_1.authenticate);
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), bankDetailsController_1.createBank);
router.get("/", bankDetailsController_1.getBanks);
router.get("/:id", bankDetailsController_1.getBank);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), bankDetailsController_1.updateBank);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), bankDetailsController_1.deleteBank);
exports.default = router;
//# sourceMappingURL=bankDetailsRoutes.js.map
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 100,
    },
    fileFilter: (req, file, cb) => {
        // Allow images and PDFs
        if (file.mimetype.startsWith("image/") ||
            file.mimetype === "application/pdf") {
            cb(null, true);
        }
        else {
            cb(new Error("Only images and PDF files are allowed!"));
        }
    },
});
exports.upload = upload;
//# sourceMappingURL=multer.js.map
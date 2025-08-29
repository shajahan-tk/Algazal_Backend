"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Comment = void 0;
const mongoose_1 = require("mongoose");
const commentSchema = new mongoose_1.Schema({
    content: {
        type: String,
        required: true,
        trim: true,
    },
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    actionType: {
        type: String,
        enum: ["approval", "rejection", "check", "general", "progress_update"],
        required: true,
    },
    progress: {
        type: Number,
        min: 0,
        max: 100,
    },
}, { timestamps: true });
exports.Comment = (0, mongoose_1.model)("Comment", commentSchema);
//# sourceMappingURL=commentModel.js.map
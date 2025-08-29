"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Attendance = void 0;
const mongoose_1 = require("mongoose");
const attendanceSchema = new mongoose_1.Schema({
    project: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Project",
        required: function () {
            return this.type === "project";
        },
    },
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    date: {
        type: Date,
        required: true,
        default: Date.now(),
    },
    present: {
        type: Boolean,
        required: true,
    },
    markedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    type: {
        type: String,
        enum: ["project", "normal"],
        required: true,
        default: "project",
    },
    workingHours: {
        type: Number,
        required: true,
        min: 0,
        max: 24,
        default: 0,
    },
    overtimeHours: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
}, { timestamps: true });
// Calculate overtime before saving
attendanceSchema.pre("save", function (next) {
    if (this.isModified("workingHours")) {
        const basicHours = 10;
        this.overtimeHours = Math.max(0, this.workingHours - basicHours);
    }
    next();
});
// Compound index for quick lookups (only for project type)
attendanceSchema.index({ project: 1, user: 1, date: 1 }, {
    unique: true,
    partialFilterExpression: { type: "project" },
});
exports.Attendance = (0, mongoose_1.model)("Attendance", attendanceSchema);
//# sourceMappingURL=attendanceModel.js.map
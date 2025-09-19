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
// FIXED: Separate compound indexes for different attendance types
// Index for project attendance (project + user + date must be unique)
attendanceSchema.index({ project: 1, user: 1, date: 1, type: 1 }, {
    unique: true,
    partialFilterExpression: { type: "project" },
    name: "project_attendance_unique"
});
// Index for normal attendance (user + date must be unique for normal type)
attendanceSchema.index({ user: 1, date: 1, type: 1 }, {
    unique: true,
    partialFilterExpression: { type: "normal" },
    name: "normal_attendance_unique"
});
// Additional indexes for query optimization
attendanceSchema.index({ user: 1, date: 1 }, { name: "user_date_lookup" });
attendanceSchema.index({ user: 1, type: 1, date: 1 }, { name: "user_type_date_lookup" });
attendanceSchema.index({ project: 1, date: 1 }, { name: "project_date_lookup" });
attendanceSchema.index({ date: 1, type: 1 }, { name: "date_type_lookup" });
exports.Attendance = (0, mongoose_1.model)("Attendance", attendanceSchema);
//# sourceMappingURL=attendanceModel.js.map
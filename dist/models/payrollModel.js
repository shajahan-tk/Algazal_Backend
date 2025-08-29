"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Payroll = void 0;
const mongoose_1 = require("mongoose");
const payrollSchema = new mongoose_1.Schema({
    employee: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    labourCard: {
        type: String,
        required: true,
        trim: true
    },
    labourCardPersonalNo: {
        type: String,
        required: true,
        trim: true
    },
    period: {
        type: String,
        required: true,
        trim: true
    },
    allowance: {
        type: Number,
        required: true,
        min: 0
    },
    deduction: {
        type: Number,
        required: true,
        min: 0
    },
    mess: {
        type: Number,
        required: true,
        min: 0
    },
    advance: {
        type: Number,
        required: true,
        min: 0
    },
    net: {
        type: Number,
        required: true
    },
    remark: {
        type: String,
        trim: true
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true
    }
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
            delete ret.__v;
            return ret;
        }
    }
});
// Indexes for optimized queries
payrollSchema.index({ employee: 1 });
payrollSchema.index({ period: 1 });
payrollSchema.index({ createdBy: 1 });
payrollSchema.index({ labourCard: 1 });
payrollSchema.index({ labourCardPersonalNo: 1 });
exports.Payroll = (0, mongoose_1.model)("Payroll", payrollSchema);
//# sourceMappingURL=payrollModel.js.map
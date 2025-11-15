"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bank = void 0;
const mongoose_1 = require("mongoose");
const bankSchema = new mongoose_1.Schema({
    bankName: {
        type: String,
        required: true,
        trim: true,
    },
    accountName: {
        type: String,
        required: true,
        trim: true,
    },
    accountNumber: {
        type: String,
        required: true,
        trim: true,
        unique: true,
    },
    iban: {
        type: String,
        required: true,
        trim: true,
        unique: true,
    },
    swiftCode: {
        type: String,
        required: true,
        trim: true,
    },
}, { timestamps: true });
bankSchema.index({ bankName: 1 });
bankSchema.index({ accountNumber: 1 });
bankSchema.index({ iban: 1 });
exports.Bank = (0, mongoose_1.model)("Bank", bankSchema);
//# sourceMappingURL=bankDetailsModel.js.map